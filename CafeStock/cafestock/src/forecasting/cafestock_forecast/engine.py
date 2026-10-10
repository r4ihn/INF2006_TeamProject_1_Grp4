"""One baseline run for a café: per item, a daily forecast with a band, a reorder
recommendation, and the method's error on recent weeks. This is what the nightly Lambda will
write to the forecast tables (Task 10) and what `npm run forecast` prints (Task 8).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from statistics import fmean
from typing import Callable, Sequence

from .backtest import Point, Score, score, walk_forward
from .methods import REFERENCE, get_method
from .reorder import Recommendation, ReorderInputs, recommend

# Chosen by `npm run forecast -- --compare` on the café dataset: lowest MASE over 47 weeks
# (0.83), and the daily twin of the team analysis's weekly MA-2 (the last two weeks).
DEFAULT_METHOD = "ma14"


@dataclass(frozen=True)
class ItemInput:
    item_id: str
    name: str
    unit: str
    on_hand: float
    #: The supplier's lead time; None when the item has no supplier
    lead_time_days: int | None
    spoilage_cap: float | None
    #: Daily demand, oldest first, ending the day before ``as_of``. Days without sales are 0.
    history: Sequence[float]
    #: Date of ``history[0]`` (None when there is no history)
    history_start: dt.date | None = None


@dataclass(frozen=True)
class ForecastDay:
    date: dt.date
    predicted: float
    lower: float
    upper: float


@dataclass
class ItemResult:
    item: ItemInput
    forecast: list[ForecastDay]
    recommendation: Recommendation
    #: The method's error on this item's recent weeks (walk-forward)
    error: Score
    notes: list[str] = field(default_factory=list)


@dataclass
class RunResult:
    model_tag: str
    method_label: str
    as_of: dt.date
    horizon_days: int
    review_days: int
    service_level_z: float
    history_window: int
    items: list[ItemResult]
    #: Across items: pooled WAPE, mean MAPE and mean MASE (vs "same day last week")
    error: Score


def _q(x: float) -> float:
    return round(x + 0.0, 3)


def _notes(item: ItemInput, lead_assumed: int | None, recent: Sequence[float]) -> list[str]:
    notes = []
    if lead_assumed is not None:
        notes.append(f"No supplier lead time: assumed {lead_assumed} days.")
    if not item.history:
        notes.append("No demand history yet: forecast is 0.")
    elif len(item.history) < 14:
        notes.append(
            f"Only {len(item.history)} days of history: treat this forecast with care."
        )
    nonzero = [i for i, x in enumerate(item.history) if x > 0]
    if nonzero:
        quiet = len(item.history) - 1 - nonzero[-1]
        if quiet >= 28:
            notes.append(
                f"No demand recorded in the last {quiet} days, so the forecast is close to 0. "
                "Is it still sold, and is its usage being recorded?"
            )
    if len(recent) >= 14:
        zero_share = sum(1 for x in recent if x == 0) / len(recent)
        if zero_share > 0.5:
            notes.append(
                f"No demand on {zero_share:.0%} of recent days: daily forecasts are rough."
            )
    return notes


#: forecast_for(item, days) → the daily forecast for that item, starting on as_of
ForecastFor = Callable[[ItemInput, int], list[float]]
#: points_for(item) → (the method's walk-forward points, the reference's on the same days)
PointsFor = Callable[[ItemInput], tuple[list[Point], list[Point]]]


def run_forecast(
    items: Sequence[ItemInput],
    *,
    as_of: dt.date,
    model_tag: str,
    method_label: str,
    forecast_for: ForecastFor,
    points_for: PointsFor,
    notes_for: Callable[[ItemInput], list[str]] | None = None,
    horizon_days: int = 7,
    review_days: int = 7,
    service_level_z: float = 1.65,
    history_window: int = 28,
    default_lead_time: int = 2,
) -> RunResult:
    """Forecasts every item from ``as_of`` (the first forecast day) with any method, recommends
    orders, and scores the method on recent weeks. ``run_baseline`` and the publish command
    (which can use the LightGBM model) both build on this."""
    if not 1 <= horizon_days <= 90:
        raise ValueError("horizon_days must be between 1 and 90")
    if history_window < 1:
        raise ValueError("history_window must be at least 1")

    results: list[ItemResult] = []
    all_points = []
    for item in items:
        history = [float(x) for x in item.history]
        lead_assumed = default_lead_time if item.lead_time_days is None else None
        lead = item.lead_time_days if item.lead_time_days is not None else default_lead_time
        recent = history[-history_window:]

        days_needed = max(horizon_days, lead + review_days)
        daily = forecast_for(item, days_needed)
        rec = recommend(
            ReorderInputs(
                on_hand=item.on_hand,
                lead_time_days=lead,
                daily_forecast=daily,
                recent_demand=recent,
                spoilage_cap=item.spoilage_cap,
                service_level_z=service_level_z,
                review_days=review_days,
            )
        )
        # Band: Z × σ of daily demand either side, never below zero
        spread = service_level_z * rec.demand_std_dev
        forecast = [
            ForecastDay(
                date=as_of + dt.timedelta(days=h),
                predicted=_q(daily[h]),
                lower=_q(max(0.0, daily[h] - spread)),
                upper=_q(daily[h] + spread),
            )
            for h in range(horizon_days)
        ]
        points, ref_points = points_for(item)
        all_points.extend(points)
        notes = _notes(item, lead_assumed, recent) + (notes_for(item) if notes_for else [])
        results.append(
            ItemResult(
                item=item,
                forecast=forecast,
                recommendation=rec,
                error=score(points, ref_points),
                notes=notes,
            )
        )

    pooled = score(all_points)
    item_mapes = [r.error.mape for r in results if r.error.mape is not None]
    item_mases = [r.error.mase for r in results if r.error.mase is not None]
    run_error = Score(
        points=pooled.points,
        mae=None,  # units differ between items, so a pooled MAE means nothing
        wape=pooled.wape,
        mape=fmean(item_mapes) if item_mapes else None,
        mape_days=pooled.mape_days,
        bias=pooled.bias,
        mase=fmean(item_mases) if item_mases else None,
        weekly_wape=None,
    )
    return RunResult(
        model_tag=model_tag,
        method_label=method_label,
        as_of=as_of,
        horizon_days=horizon_days,
        review_days=review_days,
        service_level_z=service_level_z,
        history_window=history_window,
        items=results,
        error=run_error,
    )


def recent_points(item: ItemInput, forecaster, eval_weeks: int) -> list[Point]:
    """A method's walk-forward points on an item's most recent weeks."""
    return walk_forward(
        [float(x) for x in item.history], forecaster, horizon=7, step=7, min_history=28,
        max_origins=eval_weeks,
    )


def run_baseline(
    items: Sequence[ItemInput],
    *,
    as_of: dt.date,
    method: str = DEFAULT_METHOD,
    horizon_days: int = 7,
    review_days: int = 7,
    service_level_z: float = 1.65,
    history_window: int = 28,
    default_lead_time: int = 2,
    eval_weeks: int = 8,
) -> RunResult:
    """Forecasts every item with one of the simple methods (default: 14-day average).

    ``history_window`` days of recent demand give the average and σ; ``eval_weeks`` recent
    weekly origins score the method (7-day horizon, at least 28 days of history each).
    """
    if eval_weeks < 1:
        raise ValueError("history_window and eval_weeks must be at least 1")
    chosen = get_method(method)
    reference = get_method(REFERENCE)
    return run_forecast(
        items,
        as_of=as_of,
        model_tag=chosen.tag,
        method_label=chosen.label,
        forecast_for=lambda item, days: chosen.forecast([float(x) for x in item.history], days),
        points_for=lambda item: (
            recent_points(item, chosen.forecast, eval_weeks),
            recent_points(item, reference.forecast, eval_weeks),
        ),
        horizon_days=horizon_days,
        review_days=review_days,
        service_level_z=service_level_z,
        history_window=history_window,
        default_lead_time=default_lead_time,
    )
