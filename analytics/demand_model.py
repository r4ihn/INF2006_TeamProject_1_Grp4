"""Task 8b: train a LightGBM demand model and evaluate it against the Task 8 baseline.

    npm run analytics              # evaluate, train the final model, write every output
    npm run analytics:notebook     # the same, as a narrated notebook (demand_model.ipynb)

Runs offline from the frozen snapshot in analytics/snapshots/ — no database or cloud account.
Deterministic: a fixed seed, one thread and pinned package versions give the same numbers on
every run.

Evaluation is the same walk-forward test as the baseline (forecasting/, Task 8): from every
week after the first 8 (47 weeks per item), forecast the next 7 days using only earlier days.
Before each of those weeks the model is **retrained** on everything known by then, so it never
sees the week it is scored on. The baseline (14-day moving average) and the reference ("same
day last week") are computed by the forecasting package itself on exactly the same days.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from statistics import fmean

import lightgbm as lgb
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "forecasting"))

from cafestock_forecast import ml  # noqa: E402
from cafestock_forecast.backtest import Point, Score, score, walk_forward  # noqa: E402
from cafestock_forecast.methods import REFERENCE, get_method  # noqa: E402
from cafestock_forecast.snapshot import ItemSeries, read  # noqa: E402

SNAPSHOT = ROOT / "analytics" / "snapshots" / "demand_2025-03-23.csv"
OUTPUTS = ROOT / "analytics" / "outputs"
MODEL_TAG = "lgbm-v1"
MODEL_DIR = ROOT / "analytics" / "models" / MODEL_TAG

HORIZON = 7
STEP = 7
MIN_HISTORY = 56  # 8 weeks before the first scored week — 47 scored weeks, as in the team's analysis
BASELINE = "ma14"

#: Fixed model settings and seed, shared with the nightly forecast (forecasting/…/ml.py)
PARAMS = ml.PARAMS
SEED = ml.SEED


# ─── Data ─────────────────────────────────────────────────────────────────────


def load_snapshot(path: Path = SNAPSHOT) -> dict[str, ItemSeries]:
    return read(path)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


Rows = ml.Rows


def build_rows(series: dict[str, ItemSeries]) -> Rows:
    return ml.build_rows(series, horizon=HORIZON)


def train(X: np.ndarray, y: np.ndarray) -> lgb.Booster:
    return ml.train(X, y)


# ─── Walk-forward evaluation ─────────────────────────────────────────────────


@dataclass
class MethodResult:
    key: str
    label: str
    items: dict[str, Score] = field(default_factory=dict)
    points: dict[str, list[Point]] = field(default_factory=dict)
    summary: dict = field(default_factory=dict)


def _origins(n: int) -> list[int]:
    """The scored weeks, exactly as the baseline's walk_forward picks them."""
    pts = walk_forward([0.0] * n, lambda h, k: [0.0] * k, horizon=HORIZON, step=STEP, min_history=MIN_HISTORY)
    return sorted({p.origin for p in pts})


def _summarise(result: MethodResult, reference: MethodResult) -> dict:
    all_points = [p for pts in result.points.values() for p in pts]
    pooled = score(all_points)
    with_ref_error = [
        name for name, pts in reference.points.items() if any(p.actual != p.predicted for p in pts)
    ]
    weekly_actual, weekly_pred = [], []
    for pts in result.points.values():
        totals: dict[int, list[float]] = {}
        for p in pts:
            t = totals.setdefault(p.origin, [0.0, 0.0])
            t[0] += p.actual
            t[1] += p.predicted
        weekly_actual += [t[0] for t in totals.values()]
        weekly_pred += [t[1] for t in totals.values()]
    from cafestock_forecast.metrics import wape

    mapes = [s.mape for s in result.items.values() if s.mape is not None]
    return {
        "points": pooled.points,
        "mase": fmean(result.items[n].mase for n in with_ref_error),
        "wape": pooled.wape,
        "mape": fmean(mapes) if mapes else None,
        "weekly_wape": wape(weekly_actual, weekly_pred),
        "bias": pooled.bias,
    }


def evaluate(series: dict[str, ItemSeries], rows: Rows | None = None, *, progress=None) -> dict[str, MethodResult]:
    """Scores the reference, the baseline and the model on identical days."""
    rows = rows or build_rows(series)
    reference = MethodResult(REFERENCE, get_method(REFERENCE).label)
    baseline = MethodResult(BASELINE, get_method(BASELINE).label)
    model = MethodResult(MODEL_TAG, "LightGBM (global model, retrained weekly)")

    for method in (reference, baseline):
        forecaster = get_method(method.key).forecast
        for name, s in series.items():
            method.points[name] = walk_forward(
                s.values, forecaster, horizon=HORIZON, step=STEP, min_history=MIN_HISTORY
            )

    # Model: retrained before each scored week (by calendar date, across all items)
    model.points = ml.walk_forward_model(
        series, rows, horizon=HORIZON, step=STEP, min_history=MIN_HISTORY, progress=progress
    )

    for method in (reference, baseline, model):
        for name in series:
            method.items[name] = score(method.points[name], reference.points[name])
        method.summary = _summarise(method, reference)
    return {"reference": reference, "baseline": baseline, "model": model}


def head_to_head(results: dict[str, MethodResult]) -> dict:
    """How often the model's weekly total was closer than the baseline's, and on which items."""
    model, baseline = results["model"], results["baseline"]
    better = worse = ties = 0
    for name, pts in model.points.items():
        for origin in sorted({p.origin for p in pts}):
            m = [p for p in pts if p.origin == origin]
            b = [p for p in baseline.points[name] if p.origin == origin]
            actual = sum(p.actual for p in m)
            em = abs(sum(p.predicted for p in m) - actual)
            eb = abs(sum(p.predicted for p in b) - actual)
            better += em < eb - 1e-9
            worse += em > eb + 1e-9
            ties += abs(em - eb) <= 1e-9
    items_better = sorted(
        n for n in model.items if (model.items[n].mase or 0) < (baseline.items[n].mase or 0)
    )
    return {
        "weeks_model_closer": int(better),
        "weeks_baseline_closer": int(worse),
        "weeks_tied": int(ties),
        "items_model_better_mase": items_better,
    }


# ─── Final model, example, next-week forecast ────────────────────────────────


def final_model(rows: Rows) -> lgb.Booster:
    """Trained on every example whose answer is known — what the nightly forecast will use."""
    return train(rows.X, rows.y)


def feature_importance(booster: lgb.Booster) -> list[dict]:
    gain = booster.feature_importance(importance_type="gain")
    total = float(gain.sum()) or 1.0
    ranked = sorted(zip(ml.FEATURES, gain), key=lambda kv: -kv[1])
    return [
        {"feature": f, "share": round(float(g) / total, 4), "description": ml.FEATURE_DESCRIPTIONS[f]}
        for f, g in ranked
    ]


def next_week(series: dict[str, ItemSeries], booster: lgb.Booster) -> list[dict]:
    """The forecast for the 7 days after the snapshot, model vs baseline, per item."""
    baseline = get_method(BASELINE).forecast
    out = []
    for name, s in sorted(series.items()):
        start = s.first_date + dt.timedelta(days=len(s.values))
        model = ml.predict(booster, s.values, s.first_date, HORIZON)
        base = baseline(s.values, HORIZON)
        for i in range(HORIZON):
            out.append(
                {
                    "item": name,
                    "unit": s.unit,
                    "date": (start + dt.timedelta(days=i)).isoformat(),
                    "model": round(model[i], 1),
                    "baseline": round(base[i], 1),
                }
            )
    return out


def example(series: dict[str, ItemSeries], booster: lgb.Booster, item: str = "Fresh milk") -> dict:
    """One worked example: the inputs the model sees for tomorrow, and what it predicts."""
    s = series[item]
    X, scale = ml.origin_features(s.values, s.first_date, 1)
    raw = float(booster.predict(X)[0])
    day = s.first_date + dt.timedelta(days=len(s.values))
    return {
        "item": item,
        "unit": s.unit,
        "forecast_day": day.isoformat(),
        "weekday": day.strftime("%A"),
        "level": round(scale, 3),
        "inputs": {f: round(float(v), 4) for f, v in zip(ml.FEATURES, X[0])},
        "model_output_scaled": round(raw, 4),
        "prediction": round(max(0.0, raw * scale), 1),
        "baseline_prediction": round(get_method(BASELINE).forecast(s.values, 1)[0], 1),
    }


# ─── Outputs ─────────────────────────────────────────────────────────────────


def _r(x, places=4):
    return None if x is None else round(float(x), places)


def results_json(series, results, h2h, importance, snapshot: Path) -> dict:
    per_item = {
        name: {
            key: {
                "mase": _r(r.items[name].mase),
                "wape": _r(r.items[name].wape),
                "mape": _r(r.items[name].mape),
                "mae": _r(r.items[name].mae, 3),
                "weekly_wape": _r(r.items[name].weekly_wape),
            }
            for key, r in results.items()
        }
        for name in sorted(series)
    }
    return {
        "model_tag": MODEL_TAG,
        "snapshot": {"file": snapshot.name, "sha256": file_sha256(snapshot)},
        "evaluation": {
            "method": "walk-forward: from each scored week, forecast 7 days using only earlier days; model retrained each week",
            "weeks_per_item": len(_origins(len(next(iter(series.values())).values))),
            "horizon_days": HORIZON,
            "reference": get_method(REFERENCE).label,
            "baseline": get_method(BASELINE).label,
        },
        "summary": {
            key: {k: _r(v) if isinstance(v, float) else v for k, v in r.summary.items()} | {"label": r.label}
            for key, r in results.items()
        },
        "head_to_head": h2h,
        "per_item": per_item,
        "feature_importance": importance,
        "params": PARAMS,
        "versions": {"lightgbm": lgb.__version__, "numpy": np.__version__},
    }


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def backtest_rows(series, results) -> list[dict]:
    out = []
    for name, s in sorted(series.items()):
        for b, m, r in zip(results["baseline"].points[name], results["model"].points[name], results["reference"].points[name]):
            origin_day = s.first_date + dt.timedelta(days=b.origin)
            out.append(
                {
                    "item": name,
                    "week_starting": origin_day.isoformat(),
                    "date": (origin_day + dt.timedelta(days=b.offset)).isoformat(),
                    "days_ahead": b.offset + 1,
                    "actual": round(b.actual, 3),
                    "model": round(m.predicted, 3),
                    "baseline": round(b.predicted, 3),
                    "same_day_last_week": round(r.predicted, 3),
                }
            )
    return out


def save_model(booster: lgb.Booster, rows: Rows, series, results, snapshot: Path) -> Path:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = MODEL_DIR / "model.txt"
    booster.save_model(str(path))
    meta = {
        "model_tag": MODEL_TAG,
        "file": "model.txt",
        "format": "LightGBM text model",
        "features": ml.FEATURES,
        "target": "daily demand ÷ level (mean of the last 28 days); multiply predictions by the level",
        "feature_code": "src/forecasting/cafestock_forecast/ml.py (origin_features, predict)",
        "min_history_days": ml.MIN_HISTORY,
        "trained_on": {
            "snapshot": snapshot.name,
            "sha256": file_sha256(snapshot),
            "rows": int(len(rows.y)),
            "items": len(series),
            "date_from": min(s.first_date for s in series.values()).isoformat(),
            "date_to": max(str(d) for d in rows.target_date),
        },
        "backtest": {k: results[k].summary["mase"] for k in results},
        "params": PARAMS,
        "lightgbm": lgb.__version__,
    }
    (MODEL_DIR / "model.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return path


# ─── Charts (static PNGs for the report) ─────────────────────────────────────

INK, INK_2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e6e5e0", "#fcfcfb"
MODEL_COLOUR, BASELINE_COLOUR = "#2a78d6", "#eb6834"  # categorical slots 1–2 (validated)


def _style(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=8, length=0)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def chart_weekly(series, results, path: Path, items=("Fresh milk", "Espresso beans", "Paper cup 12oz", "Cocoa powder")):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter

    fig, axes = plt.subplots(2, 2, figsize=(11, 6.2), facecolor=SURFACE)
    for ax, name in zip(axes.flat, items):
        _style(ax)
        s = series[name]
        weeks, actual, model, base = [], [], [], []
        for origin in sorted({p.origin for p in results["model"].points[name]}):
            m = [p for p in results["model"].points[name] if p.origin == origin]
            b = [p for p in results["baseline"].points[name] if p.origin == origin]
            weeks.append(s.first_date + dt.timedelta(days=origin))
            actual.append(sum(p.actual for p in m))
            model.append(sum(p.predicted for p in m))
            base.append(sum(p.predicted for p in b))
        ax.plot(weeks, actual, color=INK_2, linewidth=2, solid_capstyle="round", label="Actual")
        ax.plot(weeks, base, color=BASELINE_COLOUR, linewidth=2, solid_capstyle="round", label="Baseline (14-day average)")
        ax.plot(weeks, model, color=MODEL_COLOUR, linewidth=2, solid_capstyle="round", label="LightGBM")
        mase_m = results["model"].items[name].mase
        mase_b = results["baseline"].items[name].mase
        ax.set_title(
            f"{name} ({s.unit} per week)   MASE: model {mase_m:.2f} · baseline {mase_b:.2f}",
            loc="left", fontsize=9.5, color=INK,
        )
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:,.0f}"))
        ax.set_ylim(bottom=0)
        for label in ax.get_xticklabels():
            label.set_fontsize(8)
    handles, labels = axes.flat[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper right", frameon=False, ncol=3, fontsize=9, labelcolor=INK_2)
    fig.suptitle("Weekly demand vs 7-day-ahead forecasts (47 walk-forward weeks)", x=0.01, ha="left", fontsize=12, color=INK)
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(path, dpi=150, facecolor=SURFACE, metadata={"Software": None})
    plt.close(fig)


def chart_importance(importance: list[dict], path: Path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    names = [f["feature"] for f in importance][::-1]
    shares = [f["share"] * 100 for f in importance][::-1]
    fig, ax = plt.subplots(figsize=(7.5, 4), facecolor=SURFACE)
    _style(ax)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.barh(names, shares, color=MODEL_COLOUR, height=0.55)
    for y, v in enumerate(shares):
        ax.text(v + 0.6, y, f"{v:.0f}%", va="center", fontsize=8, color=INK_2)
    ax.set_xlabel("Share of total gain (%)", fontsize=8, color=INK_2)
    ax.set_title("LightGBM feature importance (final model)", loc="left", fontsize=11, color=INK)
    ax.tick_params(axis="y", labelsize=8.5, labelcolor=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150, facecolor=SURFACE, metadata={"Software": None})
    plt.close(fig)


# ─── Command ─────────────────────────────────────────────────────────────────


def run(snapshot: Path = SNAPSHOT, *, write: bool = True, progress=None) -> dict:
    series = load_snapshot(snapshot)
    rows = build_rows(series)
    results = evaluate(series, rows, progress=progress)
    h2h = head_to_head(results)
    booster = final_model(rows)
    importance = feature_importance(booster)
    summary = results_json(series, results, h2h, importance, snapshot)
    extras = {
        "series": series,
        "results": results,
        "booster": booster,
        "next_week": next_week(series, booster),
        "example": example(series, booster),
    }
    if write:
        OUTPUTS.mkdir(parents=True, exist_ok=True)
        (OUTPUTS / "results.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        write_csv(OUTPUTS / "backtest_predictions.csv", backtest_rows(series, results))
        write_csv(OUTPUTS / "next_week_forecast.csv", extras["next_week"])
        (OUTPUTS / "example_forecast.json").write_text(json.dumps(extras["example"], indent=2) + "\n", encoding="utf-8")
        write_csv(OUTPUTS / "feature_importance.csv", importance)
        chart_weekly(series, results, OUTPUTS / "model_vs_baseline.png")
        chart_importance(importance, OUTPUTS / "feature_importance.png")
        save_model(booster, rows, series, results, snapshot)
    return summary | {"_extras": extras}


def _pct(x):
    return "—" if x is None else f"{x:.1%}"


def main() -> int:
    def progress(i, n):
        print(f"\r  retraining for week {i}/{n}…", end="", flush=True)

    print(f"Snapshot: {SNAPSHOT.relative_to(ROOT)}")
    out = run(progress=progress)
    print("\r" + " " * 40 + "\r", end="")
    s = out["summary"]
    rows = [("Method", "MASE", "Weekly WAPE", "WAPE", "MAPE")]
    for key in ("reference", "baseline", "model"):
        r = s[key]
        rows.append((r["label"], f"{r['mase']:.3f}", _pct(r["weekly_wape"]), _pct(r["wape"]), _pct(r["mape"])))
    w = [max(len(r[i]) for r in rows) for i in range(5)]
    print("\nWalk-forward over 47 weeks × 8 items, 7 days ahead (lower is better):")
    for r in rows:
        print("  " + "  ".join(c.ljust(w[i]) if i == 0 else c.rjust(w[i]) for i, c in enumerate(r)))
    h = out["head_to_head"]
    print(
        f"\nWeekly totals: model closer in {h['weeks_model_closer']} weeks, baseline in "
        f"{h['weeks_baseline_closer']} (ties {h['weeks_tied']})."
    )
    print(f"Items where the model's MASE is lower: {', '.join(h['items_model_better_mase']) or 'none'}")
    print(f"\nWrote analytics/outputs/ and analytics/models/{MODEL_TAG}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
