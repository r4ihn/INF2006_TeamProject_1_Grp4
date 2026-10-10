#!/usr/bin/env python3
"""
=============================================================================
evaluate_policy.py - does the forecast actually prevent stockouts?
=============================================================================

WHY THIS EXISTS
    forecast.py measures how CLOSE the prediction is (MAE, MASE). That is the
    wrong question for this service. The stated purpose of the forecast is to
    tell staff to reorder before stock runs out, so the measures that matter
    are:

        - how often did the shop run out anyway
        - how much demand went unmet
        - how much stock expired while waiting to be sold
        - how much stock was sitting on the shelf on an average day

    A forecast can have excellent MAE and still cause stockouts if it errs
    downward, and poor MAE while causing none if it errs upward. Accuracy and
    service level are different things, and only the second one is the goal.

METHOD
    Replay the full year day by day under each policy. Every Monday the policy
    forecasts the coming week and places an order; deliveries arrive after the
    lead time; real daily demand is consumed first-expiry-first-out; expired
    batches are written off.

    Demand is held fixed across policies, so any difference in outcome is
    caused by the ordering decision alone.

    Unmet demand is recorded as a stockout rather than back-ordered. A customer
    who cannot have a latte does not come back for it on Thursday.

INPUT   data/daily_demand.csv, data/ingredients.csv
OUTPUT  analytics/policy_comparison.csv
        analytics/policy_tradeoff.png

    python3 evaluate_policy.py
=============================================================================
"""

from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Paths resolve relative to the repository root, not the working directory,
# so these scripts run identically from anywhere.
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "analytics"

WARMUP_WEEKS = 8        # policies need history before they can forecast
COVER_WEEKS = 1.0       # order enough for one week plus safety


# =============================================================================
# Forecast rules under test
# =============================================================================
def f_naive(h):
    return h[-1]

def f_ma2(h):
    return float(np.mean(h[-2:]))

def f_ma4(h):
    return float(np.mean(h[-4:]))

def f_fixed(h):
    """No forecast at all: order to a level set once from the first eight
    weeks. This is the baseline the forecast has to beat, and it stands in
    for what a shop does without any analytics."""
    return float(np.mean(h[:WARMUP_WEEKS]))

POLICIES = {
    "Fixed level (no forecast)": f_fixed,
    "Naive (last week)": f_naive,
    "MA-2": f_ma2,
    "MA-4": f_ma4,
}


# =============================================================================
def simulate_with_review(daily, ing, forecast_fn, service_z, review_every):
    """One year under one policy for one ingredient. Returns outcome counters.

    review_every is the ordering cycle in days. It is passed explicitly so the
    evaluation can hold everything else fixed and vary only this.
    """
    demand = daily["units"].to_numpy(dtype=float)
    pack = int(ing["pack_size"])
    lead = int(ing["lead_time_days"])
    shelf = int(ing["shelf_life_days"])

    weekly_hist = []            # completed weeks, for the forecast
    week_running = 0.0

    batches = [{"qty": max(pack, int(np.ceil(demand.mean() * 14 / pack)) * pack),
                "expiry": shelf}]
    on_order = []

    stockout_days = 0
    units_short = 0.0
    units_expired = 0.0
    stock_levels = []
    units_ordered = 0.0

    for t in range(len(demand)):
        for _, qty in [o for o in on_order if o[0] == t]:
            batches.append({"qty": qty, "expiry": t + shelf})
        on_order = [o for o in on_order if o[0] != t]

        for b in batches:
            if b["expiry"] < t and b["qty"] > 0:
                units_expired += b["qty"]
                b["qty"] = 0
        batches = [b for b in batches if b["qty"] > 0]

        need = demand[t]
        batches.sort(key=lambda b: b["expiry"])
        while need > 0 and batches:
            take = min(need, batches[0]["qty"])
            batches[0]["qty"] -= take
            need -= take
            if batches[0]["qty"] <= 0:
                batches.pop(0)
        if need > 0:
            stockout_days += 1
            units_short += need

        on_hand = sum(b["qty"] for b in batches)
        stock_levels.append(on_hand)

        week_running += demand[t]
        if t % 7 == 6:
            weekly_hist.append(week_running)
            week_running = 0.0

        # Review on the policy's own cycle, using the latest complete weeks.
        if t % review_every == review_every - 1 and len(weekly_hist) >= WARMUP_WEEKS:
            h = np.array(weekly_hist, dtype=float)
            weekly_fc = max(0.0, forecast_fn(h))
            daily_fc = weekly_fc / 7

            sd_daily = float(np.std(h[-8:])) / 7
            # Cover the review interval plus the lead time, plus safety.
            target = daily_fc * (review_every + lead) + service_z * sd_daily * np.sqrt(
                review_every + lead)

            position = on_hand + sum(q for _, q in on_order)
            gap = target - position
            if gap > 0:
                # Do not order more than the shelf life can absorb before it
                # expires. This is the binding constraint on milk.
                cap = daily_fc * shelf if daily_fc > 0 else gap
                qty = int(np.ceil(min(gap, max(cap, pack)) / pack)) * pack
                on_order.append((t + lead, qty))
                units_ordered += qty

    total_demand = demand.sum()
    return {
        "stockout_days": stockout_days,
        "units_short": units_short,
        "service_level": 1 - units_short / total_demand if total_demand else 1.0,
        "units_expired": units_expired,
        "waste_rate": units_expired / total_demand if total_demand else 0.0,
        "avg_stock": float(np.mean(stock_levels)),
        "days_of_cover": float(np.mean(stock_levels)) / (total_demand / len(demand)),
        "units_ordered": units_ordered,
    }


def simulate(daily, ing, forecast_fn, service_z):
    """Default review cycle, driven by shelf life rather than convenience.

    An earlier version reviewed everything weekly and milk collapsed to a
    53.8% service level. A 7-day perishable ordered once a week must hold a
    full week of stock, and the oldest of it expires on the day the next order
    lands. Real cafes take milk deliveries two or three times a week for
    exactly this reason.
    """
    review_every = 3 if int(ing["shelf_life_days"]) <= 14 else 7
    return simulate_with_review(daily, ing, forecast_fn, service_z, review_every)


# =============================================================================
def main():
    OUT.mkdir(exist_ok=True)
    daily = pd.read_csv(DATA / "daily_demand.csv", parse_dates=["date"])
    ingredients = pd.read_csv(DATA / "ingredients.csv").set_index("ingredient_id")

    rows = []
    for label, fn in POLICIES.items():
        for z in (0.0, 1.0, 1.65, 2.5):
            agg = {"stockout_days": 0, "units_short": 0.0, "units_expired": 0.0,
                   "demand": 0.0, "stock_days": 0.0, "n": 0}
            per_item = []
            for iid, g in daily.groupby("ingredient_id"):
                g = g.sort_values("date")
                r = simulate(g, ingredients.loc[iid], fn, z)
                r["ingredient_name"] = ingredients.loc[iid, "ingredient_name"]
                per_item.append(r)
                agg["stockout_days"] += r["stockout_days"]
                agg["units_short"] += r["units_short"]
                agg["units_expired"] += r["units_expired"]
                agg["demand"] += g["units"].sum()
                agg["n"] += 1

            rows.append({
                "policy": label,
                "safety_z": z,
                "stockout_days_total": agg["stockout_days"],
                "ingredients_with_stockout": sum(1 for r in per_item if r["stockout_days"]),
                "service_level": round(float(np.mean([r["service_level"] for r in per_item])), 4),
                "waste_rate": round(float(np.mean([r["waste_rate"] for r in per_item])), 4),
                "avg_days_of_cover": round(float(np.mean([r["days_of_cover"] for r in per_item])), 1),
            })

    comp = pd.DataFrame(rows)
    comp.to_csv(OUT / "policy_comparison.csv", index=False)

    print("=== policy outcomes, full year, all 8 ingredients ===")
    print("service_level = share of demand met from stock")
    print("waste_rate    = share of demand-equivalent units expired")
    print("cover         = average days of stock on the shelf\n")
    for z in sorted(comp["safety_z"].unique()):
        print(f"--- safety factor z = {z} ---")
        s = comp[comp.safety_z == z].sort_values("service_level", ascending=False)
        print(f"{'policy':<28}{'stockout days':>14}{'service':>10}{'waste':>9}{'cover':>8}")
        for r in s.itertuples():
            print(f"{r.policy:<28}{r.stockout_days_total:>14}"
                  f"{r.service_level:>10.2%}{r.waste_rate:>9.2%}"
                  f"{r.avg_days_of_cover:>8.1f}")
        print()

    # What actually moves service level? Two panels, because the answer is
    # not the thing the forecast literature spends its time on.
    daily_m = daily[daily["ingredient_id"] == 2].sort_values("date")   # Fresh milk
    milk = ingredients.loc[2]
    milk_weekly = simulate_with_review(daily_m, milk, f_ma2, 1.65, 7)
    milk_twice = simulate_with_review(daily_m, milk, f_ma2, 1.65, 3)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    base = comp[comp.safety_z == 1.65].set_index("policy")
    order = ["Fixed level (no forecast)", "Naive (last week)", "MA-2", "MA-4"]
    vals = [base.loc[p, "service_level"] * 100 for p in order]
    cols = ["#98A2B3", "#527FFF", "#ED7100", "#01A88D"]
    ax1.bar(range(len(order)), vals, color=cols, width=0.62)
    ax1.set_xticks(range(len(order)))
    ax1.set_xticklabels(["No forecast\n(fixed level)", "Naive", "MA-2", "MA-4"],
                        fontsize=9)
    ax1.set_ylim(85, 100)
    ax1.set_ylabel("Service level: % of demand met from stock")
    ax1.set_title("Forecast method, all ingredients (z=1.65)", loc="left", fontsize=11)
    for i, v in enumerate(vals):
        ax1.text(i, v + 0.15, f"{v:.1f}%", ha="center", fontsize=9)

    mv = [milk_weekly["service_level"] * 100, milk_twice["service_level"] * 100]
    ax2.bar([0, 1], mv, color=["#98A2B3", "#ED7100"], width=0.5)
    ax2.set_xticks([0, 1])
    ax2.set_xticklabels(["Weekly review", "Twice-weekly review"], fontsize=9)
    ax2.set_ylim(0, 100)
    ax2.set_title("Review frequency, fresh milk (MA-2, z=1.65)", loc="left", fontsize=11)
    for i, v in enumerate(mv):
        ax2.text(i, v + 1.5, f"{v:.1f}%", ha="center", fontsize=9)

    for ax in (ax1, ax2):
        ax.grid(axis="y", alpha=0.25, lw=0.6)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)

    fig.suptitle("What actually prevents stockouts", fontsize=13, x=0.07, ha="left")
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(OUT / "policy_tradeoff.png", dpi=150)
    print("wrote analytics/policy_comparison.csv and policy_tradeoff.png")
    print(f"\nmilk, weekly review:       {milk_weekly['service_level']:.1%} service, "
          f"{milk_weekly['stockout_days']} stockout days")
    print(f"milk, twice-weekly review: {milk_twice['service_level']:.1%} service, "
          f"{milk_twice['stockout_days']} stockout days")


if __name__ == "__main__":
    main()
