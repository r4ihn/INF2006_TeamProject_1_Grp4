"""Walk-forward evaluation: forecast from a past day using only earlier days, compare with
what actually happened, move on a week, repeat. Mirrors how the nightly forecast is used and
never lets a method see the future.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import fmean
from typing import Iterable, Mapping, Sequence

from .methods import REFERENCE, Forecaster, Method, get_method
from .metrics import bias, mae, mape, relative_mae, wape


@dataclass(frozen=True)
class Point:
    origin: int  # index of the first forecast day (history = series[:origin])
    offset: int  # 0 = the first forecast day
    actual: float
    predicted: float


def walk_forward(
    series: Sequence[float],
    forecaster: Forecaster,
    *,
    horizon: int = 7,
    step: int = 7,
    min_history: int = 28,
    max_origins: int | None = None,
) -> list[Point]:
    """Forecasts ``horizon`` days from origins every ``step`` days, counted back from the end
    so the most recent days are always scored. Oldest origin first."""
    origins = []
    t = len(series) - horizon
    while t >= min_history and (max_origins is None or len(origins) < max_origins):
        origins.append(t)
        t -= step
    points = []
    for origin in reversed(origins):
        predicted = forecaster(series[:origin], horizon)
        for h in range(horizon):
            points.append(Point(origin, h, float(series[origin + h]), float(predicted[h])))
    return points


@dataclass(frozen=True)
class Score:
    points: int
    mae: float | None
    wape: float | None
    mape: float | None
    #: days with demand that MAPE could use
    mape_days: int
    bias: float | None
    #: MAE ÷ the reference method's MAE on the same days (below 1 beats it)
    mase: float | None = None
    #: WAPE of 7-day totals — how well the week as a whole was predicted
    weekly_wape: float | None = None


def score(points: Sequence[Point], reference: Sequence[Point] | None = None) -> Score:
    actual = [p.actual for p in points]
    predicted = [p.predicted for p in points]
    totals: dict[int, list[float]] = {}
    for p in points:
        t = totals.setdefault(p.origin, [0.0, 0.0])
        t[0] += p.actual
        t[1] += p.predicted
    m = mae(actual, predicted)
    ref_mae = mae([p.actual for p in reference], [p.predicted for p in reference]) if reference else None
    return Score(
        points=len(points),
        mae=m,
        wape=wape(actual, predicted),
        mape=mape(actual, predicted),
        mape_days=sum(1 for a in actual if a > 0),
        bias=bias(actual, predicted),
        mase=relative_mae(m, ref_mae) if reference is not None else None,
        weekly_wape=wape([t[0] for t in totals.values()], [t[1] for t in totals.values()]),
    )


@dataclass
class MethodComparison:
    method: Method
    items: dict[str, Score] = field(default_factory=dict)
    points: int = 0
    #: all items' error ÷ all items' demand (dominated by high-volume items)
    wape: float | None = None
    #: average of item MAPEs
    mape: float | None = None
    #: average of item MASEs — every item counts equally, whatever its unit
    mase: float | None = None
    weekly_wape: float | None = None


def compare_methods(
    series_by_item: Mapping[str, Sequence[float]],
    methods: Iterable[Method],
    *,
    horizon: int = 7,
    step: int = 7,
    min_history: int = 28,
    max_origins: int | None = None,
) -> dict[str, MethodComparison]:
    """Scores each method on every item, with MASE against "same day last week"."""
    opts = dict(horizon=horizon, step=step, min_history=min_history, max_origins=max_origins)
    reference = get_method(REFERENCE)
    ref_points = {k: walk_forward(s, reference.forecast, **opts) for k, s in series_by_item.items()}
    results: dict[str, MethodComparison] = {}
    for method in methods:
        comp = MethodComparison(method)
        all_points: list[Point] = []
        for key, series in series_by_item.items():
            pts = walk_forward(series, method.forecast, **opts)
            comp.items[key] = score(pts, ref_points[key])
            all_points.extend(pts)
        pooled = score(all_points)
        comp.points, comp.wape = pooled.points, pooled.wape
        comp.mape = _mean(s.mape for s in comp.items.values())
        # An item whose reference error is 0 (e.g. no demand at all) can't be scaled
        comp.mase = _mean(
            s.mase for key, s in comp.items.items() if _has_error(ref_points[key])
        )
        comp.weekly_wape = _weekly_pooled(series_by_item, method.forecast, opts)
        results[method.key] = comp
    return results


def _has_error(points: Sequence[Point]) -> bool:
    return any(p.actual != p.predicted for p in points)


def _weekly_pooled(series_by_item, forecaster, opts) -> float | None:
    actual, predicted = [], []
    for series in series_by_item.values():
        totals: dict[int, list[float]] = {}
        for p in walk_forward(series, forecaster, **opts):
            t = totals.setdefault(p.origin, [0.0, 0.0])
            t[0] += p.actual
            t[1] += p.predicted
        actual += [t[0] for t in totals.values()]
        predicted += [t[1] for t in totals.values()]
    return wape(actual, predicted)


def _mean(values: Iterable[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return fmean(vals) if vals else None
