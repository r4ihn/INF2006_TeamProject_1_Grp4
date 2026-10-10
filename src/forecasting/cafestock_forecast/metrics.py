"""Forecast error measures. ``None`` means "undefined for this data", never zero."""

from __future__ import annotations

from typing import Sequence


def _pairs(actual: Sequence[float], predicted: Sequence[float]):
    if len(actual) != len(predicted):
        raise ValueError(f"{len(actual)} actual values but {len(predicted)} predictions")
    return list(zip(actual, predicted))


def mae(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    """Mean absolute error, in the item's unit."""
    pairs = _pairs(actual, predicted)
    return sum(abs(p - a) for a, p in pairs) / len(pairs) if pairs else None


def wape(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    """Weighted absolute percentage error: total error ÷ total demand (0.2 = 20%).

    Stays defined on days with zero demand, which is why it is the more honest
    percentage for sparse items.
    """
    pairs = _pairs(actual, predicted)
    total = sum(a for a, _ in pairs)
    return sum(abs(p - a) for a, p in pairs) / total if total > 0 else None


def mape(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    """Mean absolute percentage error over days that had demand (0.2 = 20%).

    Days with zero demand are left out: a percentage of zero is undefined. On sparse items
    that leaves few days, so read it together with WAPE and MASE.
    """
    pairs = [(a, p) for a, p in _pairs(actual, predicted) if a > 0]
    return sum(abs(p - a) / a for a, p in pairs) / len(pairs) if pairs else None


def bias(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    """(total forecast − total demand) ÷ total demand. Positive = forecasting too much."""
    pairs = _pairs(actual, predicted)
    total = sum(a for a, _ in pairs)
    return (sum(p for _, p in pairs) - total) / total if total > 0 else None


def relative_mae(method_mae: float | None, reference_mae: float | None) -> float | None:
    """A method's MAE as a fraction of a reference method's MAE on the same days (MASE).

    Below 1 beats the reference. Both perfect → 1.0; only the reference perfect → undefined.
    """
    if method_mae is None or reference_mae is None:
        return None
    if reference_mae == 0:
        return 1.0 if method_mae == 0 else None
    return method_mae / reference_mae
