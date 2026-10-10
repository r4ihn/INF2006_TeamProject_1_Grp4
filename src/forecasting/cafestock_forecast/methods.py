"""Daily forecasting methods.

Every method has the same shape: ``forecast(history, horizon) -> list[float]`` where
``history`` is daily demand, oldest first, ending the day before the first forecast day,
and the result has ``horizon`` values (the next days, in order). No history → zeros.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import fmean
from typing import Callable, Sequence

Forecaster = Callable[[Sequence[float], int], list[float]]

WEEK = 7


def _flat(value: float, horizon: int) -> list[float]:
    return [max(0.0, float(value))] * horizon


def naive(history: Sequence[float], horizon: int) -> list[float]:
    """Yesterday repeats."""
    return _flat(history[-1] if history else 0.0, horizon)


def seasonal_naive(history: Sequence[float], horizon: int) -> list[float]:
    """The same day last week repeats. Falls back to the average with less than a week."""
    if len(history) < WEEK:
        return _flat(fmean(history) if history else 0.0, horizon)
    last_week = list(history[-WEEK:])
    return [max(0.0, float(last_week[h % WEEK])) for h in range(horizon)]


def moving_average(window: int) -> Forecaster:
    """The average of the last ``window`` days (all of them if there are fewer)."""
    if window < 1:
        raise ValueError("window must be at least 1")

    def forecast(history: Sequence[float], horizon: int) -> list[float]:
        recent = history[-window:]
        return _flat(fmean(recent) if recent else 0.0, horizon)

    return forecast


def weekday_average(weeks: int) -> Forecaster:
    """For each future day, the average of the same weekday over the last ``weeks`` weeks.

    Captures a café's weekly rhythm (busy weekends) while smoothing out one-off days.
    A weekday with no earlier value falls back to the average of all history.
    """
    if weeks < 1:
        raise ValueError("weeks must be at least 1")

    def forecast(history: Sequence[float], horizon: int) -> list[float]:
        if not history:
            return [0.0] * horizon
        n = len(history)
        overall = fmean(history)
        out = []
        for h in range(horizon):
            target = n + h
            same_day = [
                history[target - WEEK * k]
                for k in range(1, weeks + 1)
                if 0 <= target - WEEK * k < n
            ]
            out.append(max(0.0, float(fmean(same_day) if same_day else overall)))
        return out

    return forecast


def exponential_smoothing(alpha: float) -> Forecaster:
    """Simple exponential smoothing: a level that moves ``alpha`` of the way to each new day."""
    if not 0 < alpha <= 1:
        raise ValueError("alpha must be in (0, 1]")

    def forecast(history: Sequence[float], horizon: int) -> list[float]:
        if not history:
            return [0.0] * horizon
        level = float(history[0])
        for x in history[1:]:
            level = alpha * float(x) + (1 - alpha) * level
        return _flat(level, horizon)

    return forecast


@dataclass(frozen=True)
class Method:
    key: str
    label: str
    forecast: Forecaster

    @property
    def tag(self) -> str:
        """Shown in the app as the model, e.g. ``baseline-wd4``."""
        return f"baseline-{self.key}"


METHODS: dict[str, Method] = {
    m.key: m
    for m in [
        Method("naive", "Yesterday repeats", naive),
        Method("snaive", "Same day last week", seasonal_naive),
        Method("ma7", "Moving average, 7 days", moving_average(7)),
        Method("ma14", "Moving average, 14 days", moving_average(14)),
        Method("ma28", "Moving average, 28 days", moving_average(28)),
        Method("wd4", "Same weekday, last 4 weeks", weekday_average(4)),
        Method("wd8", "Same weekday, last 8 weeks", weekday_average(8)),
        Method("ses10", "Exponential smoothing, α 0.1", exponential_smoothing(0.1)),
        Method("ses30", "Exponential smoothing, α 0.3", exponential_smoothing(0.3)),
    ]
}

#: The reference every method is scored against (MASE = 1.0 means "as good as this").
REFERENCE = "snaive"


def get_method(key: str) -> Method:
    try:
        return METHODS[key]
    except KeyError:
        raise ValueError(
            f"Unknown method '{key}'. Choose from: {', '.join(METHODS)}"
        ) from None
