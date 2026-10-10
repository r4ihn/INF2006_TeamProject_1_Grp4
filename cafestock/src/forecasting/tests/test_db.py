"""Loading items and demand history from PostgreSQL (needs the test database and pg8000).

Skipped, with the reason, when pg8000 isn't installed (run `npm run forecast:setup`) or the
test database isn't there (run `npm run db:up` and `npm test` once, which creates its tables).
"""

import datetime as dt
import os
import unittest
import uuid

try:
    import pg8000.native  # noqa: F401

    HAVE_DRIVER = True
except ImportError:  # pragma: no cover
    HAVE_DRIVER = False

TEST_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://cafestock:cafestock@localhost:5433/cafestock_test"
)


@unittest.skipUnless(HAVE_DRIVER, "pg8000 not installed — run `npm run forecast:setup`")
class LoadFromDatabaseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from cafestock_forecast.db import connect

        try:
            cls.conn = connect(TEST_URL)
        except Exception as err:  # noqa: BLE001
            raise unittest.SkipTest(f"test database not reachable ({err}) — run `npm run db:up`")
        if cls.conn.run("SELECT to_regclass('public.items')")[0][0] is None:
            cls.conn.close()
            raise unittest.SkipTest("test database has no tables — run `npm test` once")

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        run = self.conn.run
        self.slug = f"py-test-{uuid.uuid4().hex[:8]}"
        self.org = run(
            "INSERT INTO organizations (name, slug) VALUES ('Py Test Café', :slug) RETURNING id",
            slug=self.slug,
        )[0][0]
        other = run(
            "INSERT INTO organizations (name, slug) VALUES ('Other', :slug) RETURNING id",
            slug=f"{self.slug}-other",
        )[0][0]
        self.orgs = [self.org, other]
        supplier = run(
            "INSERT INTO suppliers (org_id, name, lead_time_days) VALUES (:o, 'Dairy Co', 3) RETURNING id",
            o=self.org,
        )[0][0]

        def add_item(org, name, **cols):
            return run(
                """INSERT INTO items (org_id, name, category, unit, on_hand, spoilage_cap, supplier_id, is_active)
                   VALUES (:org, :name, 'Test', 'ml', :on_hand, :cap, :supplier, :active) RETURNING id""",
                org=org,
                name=name,
                on_hand=cols.get("on_hand", 0),
                cap=cols.get("cap"),
                supplier=cols.get("supplier"),
                active=cols.get("active", True),
            )[0][0]

        self.milk = add_item(self.org, "Fresh milk", on_hand=5700, cap=3639, supplier=supplier)
        self.syrup = add_item(self.org, "Syrup")  # no supplier, no history
        archived = add_item(self.org, "Old item", active=False)
        theirs = add_item(other, "Their milk")

        def demand(org, item_id, day, qty, source="IMPORT"):
            run(
                "INSERT INTO demand_history (org_id, item_id, date, quantity, source) VALUES (:o, :i, :d, :q, :s)",
                o=org, i=item_id, d=day, q=qty, s=source,
            )

        # 1, 2 (gap on the 3rd), 4 March, plus a day the app recorded
        demand(self.org, self.milk, dt.date(2025, 3, 1), 100)
        demand(self.org, self.milk, dt.date(2025, 3, 2), 200.5)
        demand(self.org, self.milk, dt.date(2025, 3, 4), 50, "MOVEMENTS")
        demand(self.org, archived, dt.date(2025, 3, 5), 9)
        demand(other, theirs, dt.date(2025, 3, 9), 7)

    def tearDown(self):
        for table in ("demand_history", "items", "suppliers"):
            self.conn.run(f"DELETE FROM {table} WHERE org_id = ANY(CAST(:ids AS uuid[]))", ids=self.orgs)
        self.conn.run("DELETE FROM organizations WHERE id = ANY(CAST(:ids AS uuid[]))", ids=self.orgs)

    def load(self, **kw):
        from cafestock_forecast.db import load_items

        return load_items(self.conn, self.slug, **kw)

    def test_loads_active_items_with_zero_filled_daily_history(self):
        org, as_of, items = self.load()
        self.assertEqual(org.name, "Py Test Café")
        # Default: the day after this café's latest demand (5 March, on the archived item);
        # the other café's later demand (9 March) doesn't count
        self.assertEqual(as_of, dt.date(2025, 3, 6))
        by_name = {i.name: i for i in items}
        self.assertEqual(sorted(by_name), ["Fresh milk", "Syrup"])  # active only, this café only

        milk = by_name["Fresh milk"]
        self.assertEqual(milk.item_id, str(self.milk))
        # 1–5 March: the 3rd and 5th had no row, so they're 0
        self.assertEqual(milk.history, [100.0, 200.5, 0.0, 50.0, 0.0])
        self.assertEqual(milk.history_start, dt.date(2025, 3, 1))
        self.assertEqual((milk.on_hand, milk.lead_time_days, milk.spoilage_cap), (5700.0, 3, 3639.0))

        syrup = by_name["Syrup"]
        self.assertEqual((syrup.history, syrup.lead_time_days, syrup.spoilage_cap), ([], None, None))
        self.assertIsNone(syrup.history_start)

    def test_as_of_cuts_history_off_before_that_day(self):
        _, as_of, items = self.load(as_of=dt.date(2025, 3, 3))
        milk = next(i for i in items if i.name == "Fresh milk")
        self.assertEqual(milk.history, [100.0, 200.5])
        # …and zero-fills up to the day before as_of
        _, _, items = self.load(as_of=dt.date(2025, 3, 7))
        milk = next(i for i in items if i.name == "Fresh milk")
        self.assertEqual(milk.history, [100.0, 200.5, 0.0, 50.0, 0.0, 0.0])

    def test_unknown_cafe(self):
        from cafestock_forecast.db import load_items

        with self.assertRaisesRegex(LookupError, "No organisation 'nope'"):
            load_items(self.conn, "nope")


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(HAVE_DRIVER, "pg8000 not installed — run `npm run forecast:setup`")
class CommandTest(LoadFromDatabaseTest):
    """`npm run forecast` end to end, against the same test café."""

    def run_main(self, *args):
        import contextlib
        import io

        from cafestock_forecast.__main__ import main

        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(["--org", self.slug, "--database-url", TEST_URL, *args])
        return code, out.getvalue(), err.getvalue()

    def test_prints_a_recommendation_table(self):
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("CafeStock baseline forecast — Py Test Café", out)
        self.assertIn("Forecast from   Thu 6 Mar 2025 (history up to Wed 5 Mar 2025)", out)
        self.assertIn("Moving average, 14 days [baseline-ma14]", out)
        self.assertRegex(out, r"Fresh milk\s+5,700 ml")
        self.assertIn("Note — Syrup: No supplier lead time: assumed 2 days.", out)

    def test_json_output(self):
        import json

        code, out, _ = self.run_main("--json", "--method", "ma7")
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual((data["model_tag"], data["as_of"], data["org"]), ("baseline-ma7", "2025-03-06", self.slug))
        milk = next(i for i in data["items"] if i["item"]["name"] == "Fresh milk")
        self.assertEqual(len(milk["forecast"]), 7)
        self.assertEqual(milk["recommendation"]["lead_time_days"], 3)

    def test_unknown_cafe_is_explained(self):
        from cafestock_forecast.__main__ import main
        import contextlib
        import io

        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = main(["--org", "nope", "--database-url", TEST_URL])
        self.assertEqual(code, 1)
        self.assertIn("No organisation 'nope'", err.getvalue())

    # The loader tests are inherited; don't run them twice
    test_loads_active_items_with_zero_filled_daily_history = None
    test_as_of_cuts_history_off_before_that_day = None
    test_unknown_cafe = None
