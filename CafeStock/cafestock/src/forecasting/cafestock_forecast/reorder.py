"""Reorder maths — the formulas in docs/data-contract.md.

    safety stock   = Z × σ × √(lead time)
    reorder point  = lead-time demand + safety stock
    shortfall      = max(0, reorder point − on hand)
    order up to    = reorder point + demand over the review period (the next 7 days)
    recommended    = order up to − on hand (only when below the reorder point),
                     capped by the item's spoilage cap

    URGENT   on hand < lead-time demand: it runs out before a delivery could arrive
    REORDER  on hand < reorder point
    OK       otherwise

The order covers the review period so that, after it arrives, stock lasts until the next
check — ordering only the shortfall would put the item straight back at its reorder point.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import fmean, stdev
from typing import Literal, Sequence

Status = Literal["OK", "REORDER", "URGENT"]


@dataclass(frozen=True)
class ReorderInputs:
    on_hand: float
    lead_time_days: int
    #: Daily forecast starting today; must cover lead time + review period
    daily_forecast: Sequence[float]
    #: Recent daily demand (the history window) for the average and σ
    recent_demand: Sequence[float]
    spoilage_cap: float | None = None
    service_level_z: float = 1.65
    review_days: int = 7


@dataclass(frozen=True)
class Recommendation:
    on_hand: float
    lead_time_days: int
    avg_daily_demand: float
    demand_std_dev: float
    lead_time_demand: float
    safety_stock: float
    reorder_point: float
    shortfall: float
    review_days: int
    review_demand: float
    order_up_to: float
    recommended_qty: float
    spoilage_cap_applied: bool
    cover_days: float | None
    status: Status


def _q(x: float) -> float:
    """Quantities are stored with 3 decimals (NUMERIC(12,3))."""
    return round(x + 0.0, 3)


def _check(inputs: ReorderInputs) -> None:
    if inputs.on_hand < 0:
        raise ValueError("on_hand can't be negative")
    if inputs.lead_time_days < 0:
        raise ValueError("lead_time_days can't be negative")
    if inputs.review_days < 0:
        raise ValueError("review_days can't be negative")
    if inputs.service_level_z <= 0:
        raise ValueError("service_level_z must be positive")
    if inputs.spoilage_cap is not None and inputs.spoilage_cap < 0:
        raise ValueError("spoilage_cap can't be negative")
    if any(x < 0 for x in inputs.recent_demand) or any(x < 0 for x in inputs.daily_forecast):
        raise ValueError("demand and forecasts can't be negative")
    needed = inputs.lead_time_days + inputs.review_days
    if len(inputs.daily_forecast) < needed:
        raise ValueError(
            f"the forecast must cover lead time + review period ({needed} days), "
            f"got {len(inputs.daily_forecast)}"
        )


def recommend(inputs: ReorderInputs) -> Recommendation:
    _check(inputs)
    lead, review = inputs.lead_time_days, inputs.review_days
    recent = [float(x) for x in inputs.recent_demand]
    forecast = [float(x) for x in inputs.daily_forecast]

    avg = fmean(recent) if recent else 0.0
    sigma = stdev(recent) if len(recent) >= 2 else 0.0
    # Round σ first so the stored numbers reproduce exactly by hand
    sigma = _q(sigma)

    lead_time_demand = sum(forecast[:lead])
    safety_stock = inputs.service_level_z * sigma * math.sqrt(lead)
    reorder_point = lead_time_demand + safety_stock
    review_demand = sum(forecast[lead : lead + review])
    order_up_to = reorder_point + review_demand
    on_hand = float(inputs.on_hand)

    if on_hand < lead_time_demand:
        status: Status = "URGENT"
    elif on_hand < reorder_point:
        status = "REORDER"
    else:
        status = "OK"

    wanted = max(0.0, order_up_to - on_hand) if status != "OK" else 0.0
    cap = inputs.spoilage_cap
    capped = cap is not None and wanted > cap
    recommended = float(cap) if capped else wanted

    return Recommendation(
        on_hand=_q(on_hand),
        lead_time_days=lead,
        avg_daily_demand=_q(avg),
        demand_std_dev=sigma,
        lead_time_demand=_q(lead_time_demand),
        safety_stock=_q(safety_stock),
        reorder_point=_q(reorder_point),
        shortfall=_q(max(0.0, reorder_point - on_hand)),
        review_days=review,
        review_demand=_q(review_demand),
        order_up_to=_q(order_up_to),
        recommended_qty=_q(recommended),
        spoilage_cap_applied=capped,
        cover_days=round(on_hand / avg, 2) if avg > 0 else None,
        status=status,
    )
