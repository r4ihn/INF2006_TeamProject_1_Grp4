"""`npm run forecast:publish`: decides, then writes one complete run (or a FAILED one)."""

import contextlib
import dataclasses
import datetime as dt
import io
import unittest
from pathlib import Path

from tests.dbtest import add_demand, add_item, connect_or_skip, drop_orgs, make_org, TEST_URL

START = dt.date(2025, 1, 6)  # a Monday
WEEKLY = [10, 10, 10, 10, 10, 20, 30]


class PublishTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.conn = connect_or_skip()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.org, self.slug = make_org(self.conn)
        self.other, _ = make_org(self.conn, "Other café")
        self.milk = add_item(self.conn, self.org, "Fresh milk", on_hand=40, lead=1, cap=500)
        self.syrup = add_item(self.conn, self.org, "Syrup", unit="bottle", on_hand=3)
        # 70 days to 16 Mar 2025: a weekly pattern that drifts a little from week to week
        demand = [v + (w % 3) * 2 for w in range(10) for v in WEEKLY]
        add_demand(self.conn, self.org, self.milk, START, demand)

    def tearDown(self):
        drop_orgs(self.conn, [self.org, self.other])

    def publish(self, **kw):
        from cafestock_forecast.publish import publish

        kw.setdefault("use_model", False)
        return publish(self.conn, self.slug, **kw)

    def rows(self, sql, **params):
        return self.conn.run(sql, org=self.org, **params)

    def test_writes_a_complete_baseline_run(self):
        _, out = self.publish()
        run = self.rows(
            """SELECT model_tag, model_kind::text, is_fallback, status::text, horizon_days, forecast_from,
                      mase_baseline::float, mase_model, baseline_tag, items_processed, eval_weeks, review_days,
                      finished_at IS NOT NULL
               FROM forecast_runs WHERE org_id = CAST(:org AS uuid)"""
        )
        self.assertEqual(len(run), 1)
        tag, kind, fallback, status, horizon, start, mase_b, mase_m, base_tag, n, weeks, review, finished = run[0]
        self.assertEqual((tag, kind, fallback, status), ("baseline-ma14", "BASELINE", False, "SUCCEEDED"))
        self.assertEqual((horizon, start, n, weeks, review, finished), (7, dt.date(2025, 3, 17), 2, 8, 7, True))
        self.assertIsNone(mase_m)  # the model wasn't tried
        self.assertEqual(base_tag, "baseline-ma14")
        self.assertAlmostEqual(mase_b, round(out.baseline.error.mase, 4))

        # 7 forecast days for each item, from the day after the history ends
        days = self.rows(
            """SELECT i.name, f.forecast_date, f.predicted_qty::float, f.lower_qty::float, f.upper_qty::float
               FROM forecasts f JOIN items i ON i.id = f.item_id
               WHERE f.org_id = CAST(:org AS uuid) ORDER BY i.name, f.forecast_date"""
        )
        self.assertEqual(len(days), 14)
        milk = [d for d in days if d[0] == "Fresh milk"]
        self.assertEqual(milk[0][1], dt.date(2025, 3, 17))
        expected = next(r for r in out.run.items if r.item.name == "Fresh milk").forecast
        self.assertEqual([m[2] for m in milk], [d.predicted for d in expected])
        self.assertTrue(all(lo <= p <= hi for _, _, p, lo, hi in milk))

    def test_recommendations_store_every_step_of_the_maths(self):
        _, out = self.publish()
        rows = self.rows(
            """SELECT i.name, r.on_hand::float, r.lead_time_days, r.avg_daily_demand::float,
                      r.demand_std_dev::float, r.lead_time_demand::float, r.safety_stock::float,
                      r.reorder_point::float, r.shortfall::float, r.review_demand::float,
                      r.order_up_to::float, r.recommended_qty::float, r.spoilage_cap_applied,
                      r.status::text, r.history_days, r.notes
               FROM reorder_recommendations r JOIN items i ON i.id = r.item_id
               WHERE r.org_id = CAST(:org AS uuid) ORDER BY i.name"""
        )
        by_name = {r[0]: r for r in rows}
        rec = next(r for r in out.run.items if r.item.name == "Fresh milk").recommendation
        milk = by_name["Fresh milk"]
        self.assertEqual(
            milk[1:14],
            [rec.on_hand, rec.lead_time_days, rec.avg_daily_demand, rec.demand_std_dev,
             rec.lead_time_demand, rec.safety_stock, rec.reorder_point, rec.shortfall,
             rec.review_demand, rec.order_up_to, rec.recommended_qty, rec.spoilage_cap_applied,
             rec.status],
        )
        self.assertEqual(milk[14], 70)
        syrup = by_name["Syrup"]
        self.assertEqual(syrup[13], "OK")
        self.assertEqual(
            syrup[15],
            ["No supplier lead time: assumed 2 days.", "No demand history yet: forecast is 0."],
        )

    def test_a_missing_model_falls_back_to_the_baseline_and_says_so(self):
        _, out = self.publish(use_model=True, model_path=Path("/nowhere/model.txt"))
        self.assertIsNotNone(out.model_problem)
        kind, fallback = self.rows(
            "SELECT model_kind::text, is_fallback FROM forecast_runs WHERE org_id = CAST(:org AS uuid)"
        )[0]
        self.assertEqual((kind, fallback), ("BASELINE", True))

    def test_a_failed_write_leaves_no_half_run_and_records_why(self):
        from cafestock_forecast.db import load_items
        from cafestock_forecast.publish import decide, write

        _, as_of, items = load_items(self.conn, self.slug)
        out = decide(items, as_of=as_of, use_model=False)
        bad = out.run.items[0]
        bad.recommendation = dataclasses.replace(bad.recommendation, on_hand=-1.0)  # breaks a CHECK
        with self.assertRaises(Exception):
            write(self.conn, self.org, out, eval_weeks=8, model_uri=None)
        runs = self.rows(
            "SELECT status::text, error_message FROM forecast_runs WHERE org_id = CAST(:org AS uuid)"
        )
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][0], "FAILED")
        self.assertIn("violates check constraint", runs[0][1])
        self.assertIn("reorder_recommendations", runs[0][1])
        self.assertEqual(self.rows("SELECT count(*) FROM forecasts WHERE org_id = CAST(:org AS uuid)")[0][0], 0)

    def test_dry_run_saves_nothing_and_other_cafes_are_untouched(self):
        self.publish(dry_run=True)
        self.assertEqual(self.rows("SELECT count(*) FROM forecast_runs WHERE org_id = CAST(:org AS uuid)")[0][0], 0)
        self.publish()
        self.assertEqual(
            self.conn.run(
                "SELECT count(*) FROM forecast_runs WHERE org_id = CAST(:o AS uuid)", o=self.other
            )[0][0],
            0,
        )

    def test_command_prints_what_it_decided(self):
        from cafestock_forecast.publish import main

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["--org", self.slug, "--database-url", TEST_URL, "--no-model"])
        self.assertEqual(code, 0)
        text = out.getvalue()
        self.assertIn("Forecast published for Py Test Café", text)
        self.assertIn("Forecast from  Mon 17 Mar 2025 (history up to Sun 16 Mar 2025)", text)
        self.assertIn("Used           baseline-ma14", text)


class SchemaCheckTest(unittest.TestCase):
    """Runs without a database: a stand-in connection answers the column lookup."""

    class FakeConn:
        def __init__(self, columns):
            self.columns = columns

        def run(self, sql, **params):
            return [list(c) for c in self.columns]

    def test_a_database_without_this_steps_migration_gets_the_fix_not_a_traceback(self):
        from cafestock_forecast.publish import check_schema

        before_task9 = [("forecast_runs", "model_tag"), ("reorder_recommendations", "on_hand")]
        with self.assertRaises(LookupError) as caught:
            check_schema(self.FakeConn(before_task9))
        message = str(caught.exception)
        self.assertIn("missing forecast_runs.mase_model", message)
        self.assertIn("npm run db:setup", message)

    def test_an_up_to_date_database_passes(self):
        from cafestock_forecast.publish import REQUIRED_COLUMNS, check_schema

        check_schema(self.FakeConn(REQUIRED_COLUMNS))


if __name__ == "__main__":
    unittest.main()
