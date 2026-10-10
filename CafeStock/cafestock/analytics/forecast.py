#!/usr/bin/env python3
"""
=============================================================================
forecast.py - weekly demand forecast and reorder recommendations
=============================================================================

INPUT   data/weekly_demand.csv     55 complete weeks x 8 ingredients
        data/ingredients.csv       pack sizes, lead times, shelf lives
        data/stock_movements.csv   to read current stock off the ledger

OUTPUT  analytics/forecast_backtest.csv   every prediction, with its error
        analytics/method_comparison.csv   how each method scored
        analytics/reorder_recommendations.csv   what to order next week
        analytics/forecast_plot.png       actual vs forecast, for the report
        (analytics/evaluation.md is the hand-written write-up of these results)

METHOD
    A moving average over the last N complete weeks. Deliberately simple:
    a method that can be explained in one sentence is also one whose failures
    can be diagnosed. (A LightGBM model is evaluated against the same kind of
    baseline in analytics/demand_model.ipynb.)

    Four window lengths are compared against two baselines. The baselines
    matter: a forecast that cannot beat "assume next week equals last week"
    is not worth deploying, and reporting that honestly is the point of the
    evaluation.

EVALUATION
    Walk-forward, not a single hold-out. For each week t, the model sees only
    weeks up to t-1 and predicts week t. This mirrors how the forecast would
    actually be used and avoids leaking future data into the training window.

    Headline metric is MASE (mean absolute scaled error), which divides the
    error by that of a naive one-step forecast. MASE below 1 means the method
    beats the naive baseline; above 1 means it does not. MAPE is deliberately
    avoided: three ingredients have weeks with zero demand, which makes MAPE
    undefined or explosive.

    python3 forecast.py
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

# Weeks of history required before the first prediction is scored. Set by the
# longest window compared, so every method is scored on identical weeks.
MIN_HISTORY = 8

# Order policy applied on top of the forecast.
COVER_WEEKS = 1.0      # order to cover one week of demand
SERVICE_Z = 1.65       # ~95% service level, one-sided normal


def load():
    weekly = pd.read_csv(DATA / "weekly_demand.csv", parse_dates=["week_starting"])
    ingredients = pd.read_csv(DATA / "ingredients.csv")

    # The first week covers only three days (data starts on a Friday), so it
    # is not comparable with the rest and would drag every early average down.
    first = weekly["week_starting"].min()
    weekly = weekly[weekly["week_starting"] > first].copy()

    print(f"{weekly['week_starting'].nunique()} complete weeks, "
          f"{weekly['ingredient_id'].nunique()} ingredients")
    return weekly, ingredients


# =============================================================================
# Forecasting methods
# =============================================================================
# Each takes the history available up to the forecast week and returns one
# number: the prediction for the next week.

def naive(hist):
    """Last week repeats. The baseline everything else must beat."""
    return hist[-1]

def mean_all(hist):
    """Average of all history. A second baseline: it ignores any trend, so
    if it wins, the series has no trend worth modelling."""
    return float(np.mean(hist))

def moving_average(n):
    def f(hist):
        return float(np.mean(hist[-n:]))
    f.__name__ = f"MA-{n}"
    return f

def linear_trend(hist):
    """Fit a straight line to the last 8 weeks and extrapolate one week.

    Included because weekly demand roughly doubles across the year, which
    makes a trend term look like an obvious improvement. The backtest shows
    it is not: see evaluation.md.
    """
    n = min(8, len(hist))
    slope, intercept = np.polyfit(np.arange(n), hist[-n:], 1)
    return float(max(0.0, slope * n + intercept))

METHODS = {
    "Naive (last week)": naive,
    "Mean of all history": mean_all,
    "MA-2": moving_average(2),
    "MA-3": moving_average(3),
    "MA-4": moving_average(4),
    "MA-8": moving_average(8),
    "Linear trend (8wk)": linear_trend,
}


# =============================================================================
# Walk-forward backtest
# =============================================================================
def backtest(weekly):
    rows = []
    for iid, grp in weekly.groupby("ingredient_id"):
        grp = grp.sort_values("week_starting")
        series = grp["units"].to_numpy(dtype=float)
        weeks = grp["week_starting"].to_numpy()
        name = grp["ingredient_name"].iloc[0]

        for t in range(MIN_HISTORY, len(series)):
            hist = series[:t]              # everything strictly before week t
            actual = series[t]
            for label, fn in METHODS.items():
                pred = fn(hist)
                rows.append({
                    "ingredient_id": iid,
                    "ingredient_name": name,
                    "week_starting": weeks[t],
                    "method": label,
                    "actual": actual,
                    "predicted": round(pred, 2),
                    "error": round(pred - actual, 2),
                    "abs_error": round(abs(pred - actual), 2),
                })

    bt = pd.DataFrame(rows)
    print(f"backtest: {len(bt)} predictions "
          f"({bt['week_starting'].nunique()} weeks scored per ingredient per method)")
    return bt


def score(bt, weekly):
    """MASE divides each error by the naive forecast's error on the SAME
    scored weeks. That makes the naive baseline exactly 1.000 by
    construction, so every other number reads directly as "this fraction of
    the naive error". It also puts ingredients measured in millilitres and
    ingredients measured in units on one comparable axis.
    """
    naive_mae = (bt[bt["method"] == "Naive (last week)"]
                 .groupby("ingredient_id")["abs_error"].mean())

    bt = bt.copy()
    bt["scaled_error"] = bt["abs_error"] / bt["ingredient_id"].map(naive_mae)

    per_method = (bt.groupby("method")
                  .agg(MAE=("abs_error", "mean"),
                       RMSE=("error", lambda e: float(np.sqrt(np.mean(e ** 2)))),
                       MASE=("scaled_error", "mean"))
                  .round(3).sort_values("MASE"))

    per_item = (bt.groupby(["ingredient_name", "method"])
                .agg(MAE=("abs_error", "mean"), MASE=("scaled_error", "mean"))
                .round(3).reset_index())

    return bt, per_method, per_item


# =============================================================================
# Reorder recommendation
# =============================================================================
def recommend(weekly, ingredients, best_method_fn, best_method_name):
    """Turn next week's forecast into an order quantity in whole packs.

    order = forecast x cover + safety stock - what is already on hand,
    rounded up to the supplier's pack size.
    """
    ledger = pd.read_csv(DATA / "stock_movements.csv")
    on_hand = ledger.groupby("ingredient_id")["quantity"].sum()

    rows = []
    for iid, grp in weekly.groupby("ingredient_id"):
        grp = grp.sort_values("week_starting")
        hist = grp["units"].to_numpy(dtype=float)
        m = ingredients.set_index("ingredient_id").loc[iid]

        forecast = best_method_fn(hist)

        # Safety stock covers forecast error, not demand variability. The
        # residual standard deviation from the backtest window is the right
        # input here.
        resid_sd = float(np.std(hist[-8:]))
        safety = SERVICE_Z * resid_sd

        need = forecast * COVER_WEEKS + safety
        stock = float(on_hand.get(iid, 0))
        gap = max(0.0, need - stock)
        packs = int(np.ceil(gap / m["pack_size"])) if gap > 0 else 0

        # Never order more than the shelf life allows to sell through.
        max_weeks = m["shelf_life_days"] / 7 * 0.5
        cap_packs = int(np.floor(forecast * max_weeks / m["pack_size"])) if forecast else 0
        capped = packs > max(cap_packs, 1)
        packs = min(packs, max(cap_packs, 1)) if packs else 0

        rows.append({
            "ingredient_id": iid,
            "ingredient_name": m["ingredient_name"],
            "unit": m["unit"],
            "forecast_next_week": round(forecast, 1),
            "safety_stock": round(safety, 1),
            "current_stock": round(stock, 1),
            "suggested_order_packs": packs,
            "pack_description": m["pack_description"],
            "suggested_order_units": packs * int(m["pack_size"]),
            "capped_by_shelf_life": capped,
            "weeks_of_cover_after_order": round(
                (stock + packs * m["pack_size"]) / forecast, 1) if forecast else None,
            "method": best_method_name,
        })

    return pd.DataFrame(rows)


# =============================================================================
# Plot
# =============================================================================
def plot(bt, best):
    show = ["Fresh milk", "Espresso beans", "Paper cup 12oz", "Cocoa powder"]
    sub = bt[bt["method"] == best]

    # Display-only rescaling. The ledger and the backtest stay in the base
    # unit (ml for milk, g for beans); dividing by 1000 here only changes the
    # axis labels. MASE is scale-free so it is unaffected, and MAE in the
    # written evaluation is converted at the same factor.
    scale = {"Fresh milk": (1000, "L"), "Espresso beans": (1000, "kg")}

    fig, axes = plt.subplots(2, 2, figsize=(13, 7))
    for ax, name in zip(axes.flat, show):
        g = sub[sub["ingredient_name"] == name].sort_values("week_starting")
        div, unit = scale.get(name, (1, None))
        if unit is None:
            unit = "g" if name == "Cocoa powder" else "units"

        ax.plot(g["week_starting"], g["actual"] / div, color="#16191F",
                lw=1.6, label="Actual")
        ax.plot(g["week_starting"], g["predicted"] / div, color="#ED7100",
                lw=1.6, ls="--", label="Forecast")
        ax.set_title(f"{name}  ({unit}/week)", fontsize=11, loc="left")
        ax.tick_params(labelsize=8)
        ax.grid(alpha=0.25, lw=0.6)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
    axes.flat[0].legend(fontsize=9, frameon=False)
    fig.suptitle(f"Weekly demand: actual vs {best} forecast (walk-forward)",
                 fontsize=13, x=0.09, ha="left")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(OUT / "forecast_plot.png", dpi=150)
    print("wrote analytics/forecast_plot.png")


# =============================================================================
def main():
    OUT.mkdir(exist_ok=True)

    weekly, ingredients = load()
    bt = backtest(weekly)
    bt, per_method, per_item = score(bt, weekly)

    print("\n--- method comparison (all ingredients pooled) ---")
    print(per_method.to_string())

    best = per_method.index[0]
    print(f"\nbest overall: {best} (MASE {per_method.loc[best,'MASE']})")

    print("\n--- MASE by ingredient, best method vs naive ---")
    piv = per_item.pivot(index="ingredient_name", columns="method", values="MASE")
    print(piv[["Naive (last week)", best]].round(3).to_string())

    rec = recommend(weekly, ingredients, METHODS[best], best)
    print("\n--- reorder recommendation for the next week ---")
    print(rec[["ingredient_name", "forecast_next_week", "current_stock",
               "suggested_order_packs", "pack_description"]].to_string(index=False))

    bt.to_csv(OUT / "forecast_backtest.csv", index=False)
    per_method.to_csv(OUT / "method_comparison.csv")
    per_item.to_csv(OUT / "method_comparison_by_ingredient.csv", index=False)
    rec.to_csv(OUT / "reorder_recommendations.csv", index=False)
    plot(bt, best)

    print(f"\nwrote 5 files to {OUT}/")
    return bt, per_method, per_item, rec, best


if __name__ == "__main__":
    main()
