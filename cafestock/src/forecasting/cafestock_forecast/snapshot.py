"""Frozen, dated snapshots of a café's demand history (Task 8b).

The ML notebook trains and is evaluated on a snapshot file kept in the repo, so anyone can
reproduce the results offline — no database or cloud account needed. The snapshot is exported
from the app's own `demand_history` table, i.e. from what `npm run db:import` loaded.

    npm run analytics:snapshot        # → analytics/snapshots/demand_<last day>.csv (+ .json)

CSV columns: ``date, item_name, unit, quantity`` — one row per item per day, from the item's
first day of history to the last day, with days that had no demand written as 0. Rows are
sorted, and there are no ids or timestamps, so the same data always gives the same file.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

HEADER = ["date", "item_name", "unit", "quantity"]


@dataclass(frozen=True)
class ItemSeries:
    name: str
    unit: str
    first_date: dt.date
    values: list[float]


def _qty(x: float) -> str:
    return f"{x:.3f}".rstrip("0").rstrip(".")


def to_csv(series: list[ItemSeries]) -> str:
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(HEADER)
    for s in sorted(series, key=lambda s: s.name.lower()):
        for i, v in enumerate(s.values):
            w.writerow([(s.first_date + dt.timedelta(days=i)).isoformat(), s.name, s.unit, _qty(v)])
    return out.getvalue()


def read(path: str | Path) -> dict[str, ItemSeries]:
    """Reads a snapshot back into one daily series per item (by name)."""
    rows: dict[str, list[tuple[dt.date, float]]] = {}
    units: dict[str, str] = {}
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != HEADER:
            raise ValueError(f"{path}: expected columns {HEADER}, got {reader.fieldnames}")
        for r in reader:
            rows.setdefault(r["item_name"], []).append(
                (dt.date.fromisoformat(r["date"]), float(r["quantity"]))
            )
            units[r["item_name"]] = r["unit"]
    result = {}
    for name, days in rows.items():
        days.sort()
        first = days[0][0]
        for i, (d, _) in enumerate(days):
            if d != first + dt.timedelta(days=i):
                raise ValueError(f"{path}: {name} is missing {first + dt.timedelta(days=i)}")
        result[name] = ItemSeries(name, units[name], first, [q for _, q in days])
    return result


def export(conn, org_slug: str, out_dir: str | Path) -> tuple[Path, dict]:
    """Writes ``demand_<last day>.csv`` and a ``.json`` description next to it."""
    from .db import load_items

    org, as_of, items = load_items(conn, org_slug)
    series = [
        ItemSeries(i.name, i.unit, i.history_start, list(i.history))
        for i in items
        if i.history_start is not None
    ]
    if not series:
        raise LookupError(f"{org.name} has no demand history to export. Run `npm run db:import`.")
    last = as_of - dt.timedelta(days=1)
    text = to_csv(series)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"demand_{last.isoformat()}.csv"
    path.write_text(text, encoding="utf-8", newline="")
    meta = {
        "file": path.name,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "organisation": org.slug,
        "source": "demand_history table (PostgreSQL), loaded by `npm run db:import` from data/",
        "date_from": min(s.first_date for s in series).isoformat(),
        "date_to": last.isoformat(),
        "items": len(series),
        "rows": sum(len(s.values) for s in series),
        "exported_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "command": "npm run analytics:snapshot",
    }
    path.with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return path, meta


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="npm run analytics:snapshot --")
    p.add_argument("--org", default=os.environ.get("DEMO_ORG_SLUG", "demo-cafe"))
    p.add_argument("--database-url", default=None)
    p.add_argument("--out", default=str(Path(__file__).resolve().parents[3] / "analytics" / "snapshots"))
    args = p.parse_args(argv)

    from .db import DEFAULT_DATABASE_URL, connect

    try:
        conn = connect(args.database_url or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL)
    except Exception as err:  # noqa: BLE001
        print(f"Can't reach the database ({err}). Try `npm run db:up`.", file=sys.stderr)
        return 1
    try:
        path, meta = export(conn, args.org, args.out)
    except LookupError as err:
        print(err, file=sys.stderr)
        return 1
    finally:
        conn.close()
    print(f"Wrote {path}")
    print(
        f"  {meta['items']} items, {meta['rows']:,} rows, {meta['date_from']} → {meta['date_to']}, "
        f"sha256 {meta['sha256'][:12]}…"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
