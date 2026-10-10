"""Features for the LightGBM demand model (Task 8b), shared by training (analytics/) and the
nightly forecast (Task 10) so both build exactly the same inputs.

Needs numpy (and lightgbm to predict); the rest of this package doesn't, so it is only
imported where those are installed (`npm run analytics:setup`).

One **global** model serves every item. Quantities are divided by the item's recent level
(its average over the last 28 days), so milk in millilitres and cups in pieces look alike:
the model learns shapes — "Saturdays run 40% above the average" — not sizes. Its prediction
is multiplied back by the level. There is no item-identity feature, so it also works for
items it never saw in training.

Every feature for a forecast made on day ``t`` uses only days before ``t``.
"""

from __future__ import annotations

import datetime as dt
from typing import Sequence

import numpy as np

#: Model inputs, in the order the model expects them
FEATURES = [
    "days_ahead",  # 1 = tomorrow … 7
    "weekday",  # of the day being forecast, 0 = Monday
    "same_weekday_1w",  # that weekday one week earlier
    "same_weekday_2w",  # …two weeks earlier
    "weekday_avg_4w",  # average of that weekday over the last 4 weeks
    "last_day",  # the most recent day
    "mean_7",  # average of the last 7 days
    "mean_14",  # average of the last 14 days
    "std_28",  # day-to-day spread over the last 28 days
    "zero_share_28",  # share of the last 28 days with no demand
]

FEATURE_DESCRIPTIONS = {
    "days_ahead": "How many days ahead the forecast day is (1–7)",
    "weekday": "Weekday of the forecast day (0 = Monday … 6 = Sunday)",
    "same_weekday_1w": "Demand on the same weekday a week before, ÷ level",
    "same_weekday_2w": "Demand on the same weekday two weeks before, ÷ level",
    "weekday_avg_4w": "Average demand on that weekday over the last 4 weeks, ÷ level",
    "last_day": "Demand on the most recent day, ÷ level",
    "mean_7": "Average demand over the last 7 days, ÷ level",
    "mean_14": "Average demand over the last 14 days, ÷ level",
    "std_28": "Standard deviation of daily demand over the last 28 days, ÷ level",
    "zero_share_28": "Share of the last 28 days with zero demand (0–1)",
}

#: Days of history needed before a forecast can be made
MIN_HISTORY = 28
LEVEL_WINDOW = 28
MAX_DIRECT_HORIZON = 7


def level(history: Sequence[float]) -> float:
    """The item's recent level: mean of the last 28 days. 1.0 if that is 0 (nothing to scale)."""
    recent = np.asarray(history[-LEVEL_WINDOW:], dtype=float)
    m = float(recent.mean()) if recent.size else 0.0
    return m if m > 0 else 1.0


def origin_features(
    history: Sequence[float], first_date: dt.date, horizon: int = 7
) -> tuple[np.ndarray, float]:
    """Feature rows for forecasting the ``horizon`` (≤ 7) days after ``history``.

    ``first_date`` is the date of ``history[0]``. Returns ``(X, level)``: one row per day ahead,
    and the level to multiply predictions by.
    """
    h = np.asarray(history, dtype=float)
    n = len(h)
    if n < MIN_HISTORY:
        raise ValueError(f"needs at least {MIN_HISTORY} days of history, got {n}")
    if not 1 <= horizon <= MAX_DIRECT_HORIZON:
        raise ValueError(f"horizon must be 1–{MAX_DIRECT_HORIZON}")
    scale = level(h)
    last28 = h[-28:]
    common = [
        h[-1] / scale,
        h[-7:].mean() / scale,
        h[-14:].mean() / scale,
        last28.std() / scale,
        float((last28 == 0).mean()),
    ]
    first_weekday = first_date.weekday()
    rows = []
    for ahead in range(horizon):
        t = n + ahead  # index of the day being forecast
        same_day = [h[t - 7 * k] for k in range(1, 5)]  # t-7 … t-28, all < n
        rows.append(
            [
                ahead + 1,
                (first_weekday + t) % 7,
                h[t - 7] / scale,
                h[t - 14] / scale,
                float(np.mean(same_day)) / scale,
                *common,
            ]
        )
    return np.asarray(rows, dtype=float), scale


def training_rows(
    series: Sequence[float], first_date: dt.date, *, horizon: int = 7
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Every (origin, day-ahead) example in one item's history whose answer is known.

    Returns ``(X, y_scaled, origin, ahead, scale)``: features, target ÷ level, and for each row
    the origin index (first forecast day), the days-ahead offset (0-based) and the level used.
    A row may be used to train a model for origin ``t`` only if ``origin + ahead < t``.
    """
    s = np.asarray(series, dtype=float)
    xs, ys, origins, aheads, scales = [], [], [], [], []
    for origin in range(MIN_HISTORY, len(s)):
        steps = min(horizon, len(s) - origin)
        X, scale = origin_features(s[:origin], first_date, steps)
        xs.append(X)
        ys.append(s[origin : origin + steps] / scale)
        origins.append(np.full(steps, origin))
        aheads.append(np.arange(steps))
        scales.append(np.full(steps, scale))
    if not xs:
        empty = np.empty((0, len(FEATURES)))
        return empty, np.empty(0), np.empty(0, dtype=int), np.empty(0, dtype=int), np.empty(0)
    return (
        np.vstack(xs),
        np.concatenate(ys),
        np.concatenate(origins),
        np.concatenate(aheads),
        np.concatenate(scales),
    )


def predict(booster, history: Sequence[float], first_date: dt.date, horizon: int = 7) -> list[float]:
    """Daily demand forecast for the ``horizon`` days after ``history``, never negative.

    Beyond 7 days the model has no same-weekday history to look at, so days 8+ repeat the
    forecast for the same weekday in the first week.
    """
    direct = min(horizon, MAX_DIRECT_HORIZON)
    X, scale = origin_features(history, first_date, direct)
    week = [max(0.0, float(v) * scale) for v in booster.predict(X)]
    return [week[i % direct] for i in range(horizon)]


# ─── Training and walk-forward scoring (shared by analytics/ and the nightly run) ──────

SEED = 2006

#: Fixed in advance, not tuned on test weeks (tuning on them would flatter the model)
PARAMS = {
    "objective": "regression",  # predicts the expected (mean) demand, which the reorder maths needs
    "learning_rate": 0.05,
    "num_iterations": 200,
    "num_leaves": 15,
    "min_data_in_leaf": 40,
    "feature_fraction": 0.9,
    "lambda_l2": 1.0,
    "seed": SEED,
    "deterministic": True,
    "force_row_wise": True,
    "num_threads": 1,
    "verbose": -1,
}


def train(X: np.ndarray, y: np.ndarray):
    """A LightGBM model on scaled targets, with the fixed settings above."""
    import lightgbm as lgb

    data = lgb.Dataset(X, y, feature_name=FEATURES, free_raw_data=False, params={"verbose": -1})
    return lgb.train(PARAMS, data)


class Rows:
    """Every training example across items, with the day its answer became known."""

    def __init__(self, X, y, item, origin_date, target_date, ahead, scale):
        self.X, self.y, self.item = X, y, item
        self.origin_date, self.target_date = origin_date, target_date
        self.ahead, self.scale = ahead, scale


def build_rows(series, *, horizon: int = 7) -> Rows:
    """``series``: {key: object with ``first_date`` and ``values``} (e.g. snapshot.ItemSeries)."""
    parts = []
    for key, s in series.items():
        if len(s.values) <= MIN_HISTORY:
            continue
        X, y, origin, ahead, scale = training_rows(s.values, s.first_date, horizon=horizon)
        start = np.datetime64(s.first_date, "D")
        parts.append(
            (X, y, np.full(len(y), key, dtype=object), start + origin, start + origin + ahead, ahead, scale)
        )
    if not parts:
        empty = np.empty(0)
        return Rows(np.empty((0, len(FEATURES))), empty, empty.astype(object), empty, empty, empty, empty)
    return Rows(*(np.concatenate(p) if i else np.vstack(p) for i, p in enumerate(zip(*parts))))


def walk_forward_model(
    series,
    rows: Rows | None = None,
    *,
    horizon: int = 7,
    step: int = 7,
    min_history: int = 28,
    max_origins: int | None = None,
    progress=None,
):
    """The model scored exactly like ``backtest.walk_forward`` scores a method: same origins
    (counted back from the end), same days — but **retrained before each origin** on every
    item's examples whose answer was known by then, so it never sees the week it is scored on.

    Returns {key: [backtest.Point, …]}. Items with too little history get no points.
    """
    import datetime as dt

    from .backtest import Point, walk_forward

    rows = rows if rows is not None else build_rows(series, horizon=horizon)
    placeholder = {
        key: walk_forward(
            s.values,
            lambda h, k: [0.0] * k,
            horizon=horizon,
            step=step,
            min_history=max(min_history, MIN_HISTORY),
            max_origins=max_origins,
        )
        for key, s in series.items()
    }
    origin_dates = sorted(
        {
            series[key].first_date + dt.timedelta(days=p.origin)
            for key, pts in placeholder.items()
            for p in pts
        }
    )
    predictions: dict[tuple, float] = {}
    for i, day in enumerate(origin_dates):
        d = np.datetime64(day, "D")
        known = rows.target_date < d  # only answers known before this week
        test = (rows.origin_date == d) & (rows.ahead < horizon)
        if not known.any() or not test.any():
            continue
        booster = train(rows.X[known], rows.y[known])
        preds = np.maximum(booster.predict(rows.X[test]) * rows.scale[test], 0.0)
        for key, ahead, value in zip(rows.item[test], rows.ahead[test], preds):
            predictions[(key, d, int(ahead))] = float(value)
        if progress:
            progress(i + 1, len(origin_dates))

    out = {}
    for key, pts in placeholder.items():
        start = np.datetime64(series[key].first_date, "D")
        out[key] = [
            Point(p.origin, p.offset, p.actual, predictions[(key, start + p.origin, p.offset)])
            for p in pts
            if (key, start + p.origin, p.offset) in predictions
        ]
    return out
