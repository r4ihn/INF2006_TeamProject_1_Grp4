"""`npm run forecast:publish` — forecast every item, choose between the baseline and the ML
model, and write the result to the forecast tables the manager's page reads (Task 9).

This is the nightly job's core; Task 10 runs it on a schedule in AWS Lambda.

1. **Score both candidates on the café's most recent weeks** (walk-forward, 7 days ahead):
   the baseline (14-day moving average) and, when LightGBM and the model file are available,
   the model — retrained before each scored week so it never sees the answer.
2. **Use whichever has the lower MASE** (error ÷ error of "same day last week"). A tie, or a
   model that can't be scored, keeps the baseline.
3. **Write one run** — forecast_runs, forecasts, reorder_recommendations — in a single
   transaction (docs/data-contract.md). If anything fails, nothing half-written is left behind
   and a FAILED run records why.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from .engine import DEFAULT_METHOD, ItemInput, RunResult, recent_points, run_baseline, run_forecast
from .methods import REFERENCE, get_method

_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _PARENTS[3] if len(_PARENTS) > 3 else _PARENTS[-1]  # the project root (above src/)
DEFAULT_MODEL = REPO_ROOT / "analytics" / "models" / "lgbm-v1" / "model.txt"


@dataclass
class Outcome:
    """What a publish run decided — and, unless dry_run, what it wrote."""

    run: RunResult  # the forecast that was used
    baseline: RunResult
    model: RunResult | None  # None when the model couldn't be used
    model_problem: str | None  # why not, in words
    chosen: str  # "model" or "baseline"
    run_id: str | None = None


def _model_candidate(
    items: Sequence[ItemInput],
    *,
    as_of: dt.date,
    model_path: Path,
    eval_weeks: int,
    baseline_forecast,
    **opts,
) -> tuple[RunResult | None, str | None]:
    """The LightGBM candidate, or (None, why it couldn't run)."""
    try:
        import lightgbm as lgb

        from . import ml
        from .snapshot import ItemSeries
    except ImportError:
        return None, "LightGBM isn't installed here (npm run analytics:setup), so the baseline ran."
    if not model_path.exists():
        return None, f"No model file at {model_path}, so the baseline ran."
    try:
        booster = lgb.Booster(model_file=str(model_path))
    except Exception as err:  # noqa: BLE001 — a corrupt file must not stop tonight's forecast
        return None, f"The model file couldn't be loaded ({err}), so the baseline ran."

    meta_path = model_path.with_name("model.json")
    tag = model_path.parent.name
    if meta_path.exists():
        tag = json.loads(meta_path.read_text(encoding="utf-8")).get("model_tag", tag)

    enough = {i.item_id for i in items if i.history_start and len(i.history) >= ml.MIN_HISTORY}
    series = {
        i.item_id: ItemSeries(i.name, i.unit, i.history_start, [float(x) for x in i.history])
        for i in items
        if i.item_id in enough
    }
    points = ml.walk_forward_model(series, horizon=7, step=7, min_history=28, max_origins=eval_weeks)
    reference = get_method(REFERENCE).forecast

    def forecast_for(item: ItemInput, days: int) -> list[float]:
        if item.item_id in enough:
            return ml.predict(booster, item.history, item.history_start, days)
        return baseline_forecast(item, days)

    run = run_forecast(
        items,
        as_of=as_of,
        model_tag=tag,
        method_label=f"LightGBM ({tag})",
        forecast_for=forecast_for,
        points_for=lambda item: (
            points.get(item.item_id, []),
            recent_points(item, reference, eval_weeks) if item.item_id in points else [],
        ),
        notes_for=lambda item: []
        if item.item_id in enough
        else [f"Under {ml.MIN_HISTORY} days of history: the baseline forecast was used for this item."],
        **opts,
    )
    return run, None


def decide(
    items: Sequence[ItemInput],
    *,
    as_of: dt.date,
    method: str = DEFAULT_METHOD,
    use_model: bool = True,
    model_path: Path = DEFAULT_MODEL,
    eval_weeks: int = 8,
    service_level_z: float = 1.65,
    horizon_days: int = 7,
    review_days: int = 7,
) -> Outcome:
    """Scores the candidates and picks one. Doesn't touch the database."""
    opts = dict(service_level_z=service_level_z, horizon_days=horizon_days, review_days=review_days)
    baseline = run_baseline(items, as_of=as_of, method=method, eval_weeks=eval_weeks, **opts)
    chosen_method = get_method(method)
    model, problem = (None, None)
    if use_model:
        model, problem = _model_candidate(
            items,
            as_of=as_of,
            model_path=model_path,
            eval_weeks=eval_weeks,
            baseline_forecast=lambda item, days: chosen_method.forecast(list(item.history), days),
            **opts,
        )
    model_wins = (
        model is not None
        and model.error.mase is not None
        and baseline.error.mase is not None
        and model.error.mase < baseline.error.mase
    )
    return Outcome(
        run=model if model_wins else baseline,
        baseline=baseline,
        model=model,
        model_problem=problem,
        chosen="model" if model_wins else "baseline",
    )


def _r(x: float | None, places: int = 4):
    return None if x is None else round(float(x), places)


def _describe(err: Exception) -> str:
    """A readable error message; pg8000 puts the database's message in a dict under "M"."""
    first = err.args[0] if err.args else None
    if isinstance(first, dict) and "M" in first:
        return f"{first['M']} (code {first.get('C', '?')})"
    return str(err) or type(err).__name__


def write(conn, org_id: str, outcome: Outcome, *, eval_weeks: int, model_uri: str | None) -> str:
    """Writes the chosen run in one transaction and returns its id. On any error the
    transaction is rolled back and a FAILED run with the error message is recorded instead."""
    run, baseline, model = outcome.run, outcome.baseline, outcome.model
    used_model = outcome.chosen == "model"
    conn.run("START TRANSACTION")
    try:
        run_id = conn.run(
            """INSERT INTO forecast_runs
                 (org_id, model_tag, model_kind, is_fallback, status, horizon_days,
                  mape_model, mape_baseline, mase_model, mase_baseline, baseline_tag,
                  eval_weeks, forecast_from, review_days, service_level_z, model_uri)
               VALUES (CAST(:org AS uuid), :tag, CAST(:kind AS model_kind), :fallback, 'RUNNING',
                       :horizon, :mape_model, :mape_baseline, :mase_model, :mase_baseline,
                       :baseline_tag, :eval_weeks, :start, :review, :z, :uri)
               RETURNING id::text""",
            org=org_id,
            tag=run.model_tag,
            kind="ML" if used_model else "BASELINE",
            fallback=outcome.model_problem is not None,
            horizon=run.horizon_days,
            mape_model=_r(model.error.mape) if model else None,
            mape_baseline=_r(baseline.error.mape),
            mase_model=_r(model.error.mase) if model else None,
            mase_baseline=_r(baseline.error.mase),
            baseline_tag=baseline.model_tag,
            eval_weeks=eval_weeks,
            start=run.as_of,
            review=run.review_days,
            z=run.service_level_z,
            uri=model_uri if used_model else None,
        )[0][0]

        f_item, f_date, f_pred, f_lo, f_hi = [], [], [], [], []
        for r in run.items:
            for d in r.forecast:
                f_item.append(r.item.item_id)
                f_date.append(d.date)
                f_pred.append(d.predicted)
                f_lo.append(d.lower)
                f_hi.append(d.upper)
        if f_item:
            conn.run(
                """INSERT INTO forecasts (org_id, run_id, item_id, forecast_date, predicted_qty, lower_qty, upper_qty)
                   SELECT CAST(:org AS uuid), CAST(:run AS uuid), k.item, k.day, k.pred, k.lo, k.hi
                   FROM unnest(CAST(:items AS uuid[]), CAST(:days AS date[]), CAST(:preds AS numeric[]),
                               CAST(:los AS numeric[]), CAST(:his AS numeric[])) AS k(item, day, pred, lo, hi)""",
                org=org_id, run=run_id, items=f_item, days=f_date, preds=f_pred, los=f_lo, his=f_hi,
            )

        for r in run.items:
            rec = r.recommendation
            conn.run(
                """INSERT INTO reorder_recommendations
                     (org_id, run_id, item_id, on_hand, lead_time_days, avg_daily_demand, demand_std_dev,
                      lead_time_demand, safety_stock, reorder_point, shortfall, review_demand, order_up_to,
                      recommended_qty, spoilage_cap_applied, cover_days, item_mape, item_mase,
                      history_days, notes, status)
                   VALUES (CAST(:org AS uuid), CAST(:run AS uuid), CAST(:item AS uuid), :on_hand, :lead, :avg,
                           :sd, :ltd, :ss, :rop, :short, :review, :upto, :qty, :capped, :cover, :mape, :mase,
                           :days, CAST(:notes AS text[]), CAST(:status AS recommendation_status))""",
                org=org_id,
                run=run_id,
                item=r.item.item_id,
                on_hand=rec.on_hand,
                lead=rec.lead_time_days,
                avg=rec.avg_daily_demand,
                sd=rec.demand_std_dev,
                ltd=rec.lead_time_demand,
                ss=rec.safety_stock,
                rop=rec.reorder_point,
                short=rec.shortfall,
                review=rec.review_demand,
                upto=rec.order_up_to,
                qty=rec.recommended_qty,
                capped=rec.spoilage_cap_applied,
                cover=rec.cover_days,
                mape=_r(r.error.mape),
                mase=_r(r.error.mase),
                days=len(r.item.history),
                notes=r.notes,
                status=rec.status,
            )

        conn.run(
            """UPDATE forecast_runs SET status = 'SUCCEEDED', finished_at = now(), items_processed = :n
               WHERE id = CAST(:run AS uuid)""",
            n=len(run.items),
            run=run_id,
        )
        conn.run("COMMIT")
        return run_id
    except Exception as err:
        conn.run("ROLLBACK")
        conn.run(
            """INSERT INTO forecast_runs (org_id, model_tag, model_kind, status, error_message, finished_at)
               VALUES (CAST(:org AS uuid), :tag, CAST(:kind AS model_kind), 'FAILED', :msg, now())""",
            org=org_id,
            tag=run.model_tag,
            kind="ML" if used_model else "BASELINE",
            msg=_describe(err)[:1000],
        )
        raise


# Columns added by the Task 9 migration; if one is missing the database needs `npm run db:setup`.
REQUIRED_COLUMNS = (
    ("forecast_runs", "mase_model"),
    ("forecast_runs", "forecast_from"),
    ("reorder_recommendations", "order_up_to"),
    ("reorder_recommendations", "notes"),
)


def check_schema(conn) -> None:
    """Stops early, with the fix, when the database is missing this step's migration."""
    rows = conn.run(
        """SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name IN ('forecast_runs', 'reorder_recommendations')"""
    )
    have = {(t, c) for t, c in rows}
    missing = [f"{t}.{c}" for t, c in REQUIRED_COLUMNS if (t, c) not in have]
    if missing:
        raise LookupError(
            "The database hasn't been updated for this version yet "
            f"(missing {', '.join(missing)}).\n"
            "Run `npm run db:setup` (it applies the new migration and keeps your data), "
            "then `npm run forecast:publish` again."
        )


def publish(
    conn,
    org_slug: str,
    *,
    as_of: dt.date | None = None,
    dry_run: bool = False,
    model_uri: str | None = None,
    **options,
) -> tuple[object, Outcome]:
    """Loads the café's data, decides, and (unless dry_run) writes. Returns (org, outcome).

    ``model_uri`` is recorded as where the model came from (e.g. its s3:// address); by default
    the model file's path relative to the repo."""
    from .db import load_items

    if not dry_run:
        check_schema(conn)
    org, as_of, items = load_items(conn, org_slug, as_of=as_of)
    if not items:
        raise LookupError(f"{org.name} has no active items to forecast.")
    outcome = decide(items, as_of=as_of, **options)
    if not dry_run:
        model_path = Path(options.get("model_path", DEFAULT_MODEL))
        try:
            uri = model_uri or model_path.relative_to(REPO_ROOT).as_posix()
        except ValueError:
            uri = str(model_path)
        outcome.run_id = write(
            conn, org.id, outcome, eval_weeks=options.get("eval_weeks", 8), model_uri=uri
        )
    return org, outcome


# ─── Command ─────────────────────────────────────────────────────────────────


def _day(d: dt.date) -> str:
    return f"{d:%a} {d.day} {d:%b %Y}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="npm run forecast:publish --", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--org", default=os.environ.get("DEMO_ORG_SLUG", "demo-cafe"))
    p.add_argument("--database-url", default=None)
    p.add_argument("--as-of", type=dt.date.fromisoformat, default=None,
                   help="first day to forecast (default: the day after the history ends)")
    p.add_argument("--method", default=DEFAULT_METHOD, help="baseline method (default ma14)")
    p.add_argument("--no-model", action="store_true", help="don't try the LightGBM model")
    p.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="LightGBM model file")
    p.add_argument("--eval-weeks", type=int, default=8, help="recent weeks to score on (default 8)")
    p.add_argument("--dry-run", action="store_true", help="decide and print, but don't save")
    args = p.parse_args(argv)

    from .db import DEFAULT_DATABASE_URL, connect

    try:
        conn = connect(args.database_url or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL)
    except ImportError:
        print("pg8000 isn't installed. Run `npm run forecast:setup` first.", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(f"Can't reach the database ({err}). Try `npm run db:up`.", file=sys.stderr)
        return 1
    try:
        org, out = publish(
            conn, args.org, as_of=args.as_of, dry_run=args.dry_run, method=args.method,
            use_model=not args.no_model, model_path=args.model, eval_weeks=args.eval_weeks,
        )
    except LookupError as err:
        print(err, file=sys.stderr)
        return 1
    finally:
        conn.close()

    run = out.run
    print(f"{'Dry run — nothing saved' if args.dry_run else 'Forecast published'} for {org.name} ({org.slug})")
    print(f"  Forecast from  {_day(run.as_of)} (history up to {_day(run.as_of - dt.timedelta(days=1))})")
    print(f"  Scored on the last {args.eval_weeks} weeks, 7 days ahead (MASE, lower is better):")
    print(f"    {out.baseline.method_label:<34} {out.baseline.error.mase or 0:.3f}")
    if out.model:
        print(f"    {out.model.method_label:<34} {out.model.error.mase or 0:.3f}")
    else:
        print(f"    LightGBM: not used — {out.model_problem}")
    print(f"  Used           {run.model_tag} ({'lower MASE' if out.model else 'baseline'})")
    statuses = [r.recommendation.status for r in run.items]
    print(
        f"  Items          {len(run.items)} · to order: {statuses.count('REORDER') + statuses.count('URGENT')}"
        f" ({statuses.count('URGENT')} urgent)"
    )
    if out.run_id:
        print(f"  Run            {out.run_id}")
        print("\nOpen the app as a manager → Forecast.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
