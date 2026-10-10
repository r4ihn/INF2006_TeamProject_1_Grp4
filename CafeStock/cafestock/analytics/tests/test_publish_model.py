"""The publish command with the LightGBM model available: both candidates are scored on the
same recent weeks, the lower MASE wins, and the choice is recorded. Needs the test database."""

import datetime as dt
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analytics"))

# The database helpers live with the forecasting tests
_spec = importlib.util.spec_from_file_location("dbtest", ROOT / "src" / "forecasting" / "tests" / "dbtest.py")
dbtest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dbtest)

import demand_model as dm  # noqa: E402


class PublishWithModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.conn = dbtest.connect_or_skip()
        cls.org, cls.slug = dbtest.make_org(cls.conn)
        cls.ids = {}
        for name, s in dm.load_snapshot().items():
            item = dbtest.add_item(cls.conn, cls.org, name, unit=s.unit, on_hand=100, lead=2)
            dbtest.add_demand(cls.conn, cls.org, item, s.first_date, s.values)
            cls.ids[name] = item
        # A new item with only 10 days of history: too little for the model
        cls.ids["New syrup"] = dbtest.add_item(cls.conn, cls.org, "New syrup", unit="bottle", on_hand=4)
        dbtest.add_demand(cls.conn, cls.org, cls.ids["New syrup"], dt.date(2025, 3, 14), [1] * 10)

        from cafestock_forecast.publish import publish

        _, cls.out = publish(cls.conn, cls.slug)

    @classmethod
    def tearDownClass(cls):
        dbtest.drop_orgs(cls.conn, [cls.org])
        cls.conn.close()

    def test_both_candidates_are_scored_and_the_lower_mase_is_used(self):
        out = self.out
        self.assertIsNone(out.model_problem)
        self.assertIsNotNone(out.model)
        model_mase, base_mase = out.model.error.mase, out.baseline.error.mase
        self.assertEqual(out.chosen, "model" if model_mase < base_mase else "baseline")
        tag, kind, mase_m, mase_b, uri = self.conn.run(
            """SELECT model_tag, model_kind::text, mase_model::float, mase_baseline::float, model_uri
               FROM forecast_runs WHERE org_id = CAST(:o AS uuid) AND status = 'SUCCEEDED'""",
            o=self.org,
        )[0]
        self.assertAlmostEqual(mase_m, round(model_mase, 4))
        self.assertAlmostEqual(mase_b, round(base_mase, 4))
        if out.chosen == "model":
            self.assertEqual((tag, kind, uri), ("lgbm-v1", "ML", "analytics/models/lgbm-v1/model.txt"))
        else:
            self.assertEqual((tag, kind, uri), ("baseline-ma14", "BASELINE", None))

    def test_scored_on_the_same_recent_weeks(self):
        # 8 weeks × 7 days for each of the 8 dataset items; the new item can't be scored
        self.assertEqual(self.out.model.error.points, 8 * 8 * 7)
        self.assertEqual(self.out.baseline.error.points, 8 * 8 * 7 + 0)

    def test_an_item_with_too_little_history_uses_the_baseline_and_says_so(self):
        syrup = next(r for r in self.out.model.items if r.item.name == "New syrup")
        self.assertIn(
            "Under 28 days of history: the baseline forecast was used for this item.", syrup.notes
        )
        self.assertEqual([d.predicted for d in syrup.forecast], [1.0] * 7)  # 14-day average of 1s


if __name__ == "__main__":
    unittest.main()
