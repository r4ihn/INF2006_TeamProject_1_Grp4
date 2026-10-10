"""`npm run forecast` — run the baseline for a café and print what it recommends.

    npm run forecast                         the demo café, from the day after its history ends
    npm run forecast -- --compare            also score every method on the café's history
    npm run forecast -- --method ma28        use another method
    npm run forecast -- --as-of 2025-01-06   forecast as if it were that day
    npm run forecast -- --json               machine-readable output
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import os
import sys

from .backtest import compare_methods
from .engine import DEFAULT_METHOD, RunResult, run_baseline
from .methods import METHODS, REFERENCE

STATUS_ORDER = {"URGENT": 0, "REORDER": 1, "OK": 2}


def _num(x: float | None, unit: str = "") -> str:
    if x is None:
        return "—"
    text = f"{x:,.1f}".rstrip("0").rstrip(".") if abs(x) < 1000 else f"{x:,.0f}"
    return f"{text} {unit}".strip()


def _pct(x: float | None) -> str:
    return "—" if x is None else f"{x:.0%}" if x >= 0.1 else f"{x:.1%}"


def _ratio(x: float | None) -> str:
    return "—" if x is None else f"{x:.2f}"


def _table(rows: list[list[str]], right: set[int]) -> list[str]:
    widths = [max(len(r[c]) for r in rows) for c in range(len(rows[0]))]
    out = []
    for i, r in enumerate(rows):
        cells = [
            cell.rjust(widths[c]) if c in right else cell.ljust(widths[c])
            for c, cell in enumerate(r)
        ]
        out.append("  " + "  ".join(cells).rstrip())
        if i == 0:
            out.append("  " + "  ".join("─" * w for w in widths))
    return out


def _day(d: dt.date) -> str:
    return f"{d:%a} {d.day} {d:%b %Y}"


def print_run(org_name: str, slug: str, run: RunResult) -> None:
    last = run.as_of - dt.timedelta(days=1)
    print(f"CafeStock baseline forecast — {org_name} ({slug})")
    print(f"  Forecast from   {_day(run.as_of)} (history up to {_day(last)})")
    print(f"  Method          {run.method_label} [{run.model_tag}]")
    print(
        f"  Policy          service level Z = {run.service_level_z}, lead time from each "
        f"supplier, orders cover the next {run.review_days} days"
    )
    print()

    items = sorted(
        run.items,
        key=lambda r: (STATUS_ORDER[r.recommendation.status], r.item.name.lower()),
    )
    rows = [["Item", "On hand", "Avg/day", f"Next {run.horizon_days} days", "Lead", "Safety",
             "Reorder at", "Status", "Order"]]
    for r in items:
        rec, unit = r.recommendation, r.item.unit
        order = _num(rec.recommended_qty, unit) if rec.recommended_qty > 0 else "—"
        if rec.spoilage_cap_applied:
            order += " (cap)"
        rows.append([
            r.item.name,
            _num(rec.on_hand, unit),
            _num(rec.avg_daily_demand, unit),
            _num(sum(d.predicted for d in r.forecast), unit),
            f"{rec.lead_time_days} d",
            _num(rec.safety_stock, unit),
            _num(rec.reorder_point, unit),
            rec.status,
            order,
        ])
    print("\n".join(_table(rows, right={1, 2, 3, 4, 5, 6, 8})))
    print()

    print("  Forecast error on recent weeks (walk-forward, each week forecast 7 days ahead):")
    rows = [["Item", "MAPE", "WAPE", "MASE", "Days scored"]]
    for r in sorted(run.items, key=lambda r: r.item.name.lower()):
        e = r.error
        rows.append([r.item.name, _pct(e.mape), _pct(e.wape), _ratio(e.mase), str(e.points)])
    e = run.error
    rows.append(["All items", _pct(e.mape), _pct(e.wape), _ratio(e.mase), str(e.points)])
    print("\n".join(_table(rows, right={1, 2, 3, 4})))
    print(
        "  MAPE skips days with no demand · WAPE = total error ÷ total demand · "
        "MASE = error ÷ error of “same day last week” (below 1 beats it)"
    )

    notes = [(r.item.name, n) for r in run.items for n in r.notes]
    if notes:
        print()
        for name, note in notes:
            print(f"  Note — {name}: {note}")


def print_comparison(series_by_item: dict[str, list[float]], eval_weeks: int | None) -> None:
    results = compare_methods(
        series_by_item, METHODS.values(), horizon=7, step=7, min_history=56,
        max_origins=eval_weeks,
    )
    ranked = sorted(
        results.values(),
        key=lambda c: (c.mase is None, c.mase if c.mase is not None else 0),
    )
    print()
    scope = f"last {eval_weeks} weeks" if eval_weeks else "every week after the first 8"
    print(f"  Method comparison — walk-forward over {scope}, 7 days ahead, all items:")
    rows = [["Method", "Tag", "MASE", "MAPE", "WAPE", "Weekly WAPE"]]
    for c in ranked:
        mark = " (reference)" if c.method.key == REFERENCE else ""
        rows.append([
            c.method.label + mark, c.method.tag, _ratio(c.mase), _pct(c.mape), _pct(c.wape),
            _pct(c.weekly_wape),
        ])
    print("\n".join(_table(rows, right={2, 3, 4, 5})))
    print("  Sorted by MASE (lower is better). Weekly WAPE scores each 7-day total.")


def as_json(org_slug: str, run: RunResult) -> str:
    def default(o):
        if isinstance(o, dt.date):
            return o.isoformat()
        raise TypeError(type(o))

    data = dataclasses.asdict(run)
    data["org"] = org_slug
    return json.dumps(data, default=default, indent=2)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="npm run forecast --", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--org", default=os.environ.get("DEMO_ORG_SLUG", "demo-cafe"),
                   help="organisation slug (default: demo-cafe)")
    p.add_argument("--database-url", default=None,
                   help="PostgreSQL URL (default: DATABASE_URL from backend/.env)")
    p.add_argument("--as-of", type=dt.date.fromisoformat, default=None,
                   help="first day to forecast, YYYY-MM-DD (default: day after the history ends)")
    p.add_argument("--method", default=DEFAULT_METHOD, choices=list(METHODS),
                   help=f"forecasting method (default: {DEFAULT_METHOD})")
    p.add_argument("--horizon", type=int, default=7, help="days to forecast (default 7)")
    p.add_argument("--z", type=float, default=1.65, help="service level Z (default 1.65 ≈ 95%%)")
    p.add_argument("--eval-weeks", type=int, default=8,
                   help="recent weeks used to score the method (default 8)")
    p.add_argument("--compare", action="store_true",
                   help="also score every method on the whole history")
    p.add_argument("--json", action="store_true", help="print the run as JSON")
    args = p.parse_args(argv)

    from .db import DEFAULT_DATABASE_URL, connect, load_items

    url = args.database_url or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL
    try:
        conn = connect(url)
    except ImportError:
        print("pg8000 isn't installed. Run `npm run forecast:setup` first.", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(f"Can't reach the database ({err}). Is it running? Try `npm run db:up`.",
              file=sys.stderr)
        return 1
    try:
        try:
            org, as_of, items = load_items(conn, args.org, as_of=args.as_of)
        except LookupError as err:
            print(err, file=sys.stderr)
            return 1
        if not items:
            print(f"{org.name} has no active items. Add some, or run `npm run db:import`.",
                  file=sys.stderr)
            return 1
        run = run_baseline(items, as_of=as_of, method=args.method, horizon_days=args.horizon,
                           service_level_z=args.z, eval_weeks=args.eval_weeks)
        if args.json:
            print(as_json(org.slug, run))
            return 0
        print_run(org.name, org.slug, run)
        if args.compare:
            print_comparison({i.name: list(i.history) for i in items}, None)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
