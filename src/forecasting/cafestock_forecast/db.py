"""Reading a café's items and demand history from PostgreSQL (the tables the app writes).

Uses pg8000, a pure-Python driver, so the same code runs on Windows, macOS, Linux and in
AWS Lambda without compiled packages. Install it with `npm run forecast:setup`.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from .engine import ItemInput

DEFAULT_DATABASE_URL = "postgresql://cafestock:cafestock@localhost:5433/cafestock"


@dataclass(frozen=True)
class Org:
    id: str
    name: str
    slug: str
    timezone: str


def connect(url: str = DEFAULT_DATABASE_URL, *, ssl_context=None):
    """Opens a pg8000 connection from a postgresql:// URL (as in backend/.env).

    ``ssl_context`` encrypts the connection (Amazon RDS; see aws_lambda.ssl_context)."""
    import pg8000.native  # imported here so the rest of the library needs no driver

    u = urlparse(url)
    if u.scheme not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must start with postgresql://")
    return pg8000.native.Connection(
        user=unquote(u.username or ""),
        password=unquote(u.password or "") or None,
        host=u.hostname or "localhost",
        port=u.port or 5432,
        database=(u.path or "/").lstrip("/") or None,
        timeout=10,
        # Names like "Demo Café" need UTF-8 whatever the server's default encoding is
        startup_params={"client_encoding": "UTF8"},
        ssl_context=ssl_context,
    )


def load_items(conn, org_slug: str, *, as_of: dt.date | None = None):
    """Returns ``(org, as_of, items)`` for one café.

    ``as_of`` is the first day to forecast. By default it's the day after the café's latest
    demand, so an imported history with real (past) dates is forecast from where it ends.
    Each active item's history runs from its first demand day to the day before ``as_of``,
    with days that have no row filled with 0.
    """
    rows = conn.run(
        "SELECT id::text, name, slug, timezone FROM organizations WHERE slug = :slug",
        slug=org_slug,
    )
    if not rows:
        raise LookupError(f"No organisation '{org_slug}'. Run `npm run db:setup` first.")
    org = Org(*rows[0])

    if as_of is None:
        latest = conn.run(
            "SELECT max(date) FROM demand_history WHERE org_id = CAST(:org AS uuid)", org=org.id
        )[0][0]
        if latest is None:
            as_of = conn.run(
                "SELECT (now() AT TIME ZONE :tz)::date", tz=org.timezone
            )[0][0]
        else:
            as_of = latest + dt.timedelta(days=1)

    items = conn.run(
        """SELECT i.id::text, i.name, i.unit, i.on_hand::text, i.spoilage_cap::text,
                  s.lead_time_days
           FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id
           WHERE i.org_id = CAST(:org AS uuid) AND i.is_active
           ORDER BY i.name""",
        org=org.id,
    )
    demand = conn.run(
        """SELECT item_id::text, date, quantity::text FROM demand_history
           WHERE org_id = CAST(:org AS uuid) AND date < :as_of
           ORDER BY item_id, date""",
        org=org.id,
        as_of=as_of,
    )
    by_item: dict[str, dict[dt.date, float]] = {}
    for item_id, day, qty in demand:
        by_item.setdefault(item_id, {})[day] = float(qty)

    last_day = as_of - dt.timedelta(days=1)
    result = []
    for item_id, name, unit, on_hand, cap, lead in items:
        days = by_item.get(item_id, {})
        history: list[float] = []
        start = min(days) if days else None
        if days:
            day = start
            while day <= last_day:
                history.append(days.get(day, 0.0))
                day += dt.timedelta(days=1)
        result.append(
            ItemInput(
                item_id=item_id,
                name=name,
                unit=unit,
                on_hand=float(on_hand),
                lead_time_days=lead,
                spoilage_cap=float(cap) if cap is not None else None,
                history=history,
                history_start=start,
            )
        )
    return org, as_of, result
