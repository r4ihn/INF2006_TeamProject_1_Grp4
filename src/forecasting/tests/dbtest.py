"""Shared set-up for tests that need the test database (skip with a reason when it isn't there)."""

import os
import unittest
import uuid

TEST_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://cafestock:cafestock@localhost:5433/cafestock_test"
)


def connect_or_skip():
    try:
        import pg8000.native  # noqa: F401
    except ImportError:
        raise unittest.SkipTest("pg8000 not installed — run `npm run forecast:setup`")
    from cafestock_forecast.db import connect

    try:
        conn = connect(TEST_URL)
    except Exception as err:  # noqa: BLE001
        raise unittest.SkipTest(f"test database not reachable ({err}) — run `npm run db:up`")
    if conn.run("SELECT to_regclass('public.forecast_runs')")[0][0] is None:
        conn.close()
        raise unittest.SkipTest("test database has no tables — run `npm test` once")
    return conn


def make_org(conn, name="Py Test Café"):
    slug = f"py-test-{uuid.uuid4().hex[:8]}"
    org = conn.run(
        "INSERT INTO organizations (name, slug) VALUES (:n, :s) RETURNING id::text", n=name, s=slug
    )[0][0]
    return org, slug


def drop_orgs(conn, org_ids):
    for table in (
        "reorder_recommendations",
        "forecasts",
        "forecast_runs",
        "demand_history",
        "items",
        "suppliers",
    ):
        conn.run(f"DELETE FROM {table} WHERE org_id = ANY(CAST(:ids AS uuid[]))", ids=org_ids)
    conn.run("DELETE FROM organizations WHERE id = ANY(CAST(:ids AS uuid[]))", ids=org_ids)


def add_item(conn, org, name, *, unit="ml", on_hand=0, lead=None, cap=None):
    supplier = None
    if lead is not None:
        supplier = conn.run(
            "INSERT INTO suppliers (org_id, name, lead_time_days) VALUES (CAST(:o AS uuid), :n, :l) RETURNING id",
            o=org, n=f"{name} supplier", l=lead,
        )[0][0]
    return conn.run(
        """INSERT INTO items (org_id, name, category, unit, on_hand, spoilage_cap, supplier_id)
           VALUES (CAST(:o AS uuid), :n, 'Test', :u, :h, :c, :s) RETURNING id::text""",
        o=org, n=name, u=unit, h=on_hand, c=cap, s=supplier,
    )[0][0]


def add_demand(conn, org, item, start, values, source="IMPORT"):
    import datetime as dt

    days = [start + dt.timedelta(days=i) for i in range(len(values))]
    conn.run(
        """INSERT INTO demand_history (org_id, item_id, date, quantity, source)
           SELECT CAST(:o AS uuid), CAST(:i AS uuid), k.d, k.q, CAST(:s AS demand_source)
           FROM unnest(CAST(:days AS date[]), CAST(:qty AS numeric[])) AS k(d, q)""",
        o=org, i=item, days=days, qty=[float(v) for v in values], s=source,
    )
