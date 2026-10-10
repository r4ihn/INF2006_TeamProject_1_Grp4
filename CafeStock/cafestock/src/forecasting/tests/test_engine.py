"""The whole baseline run for a café: forecasts, recommendations and error per item."""

import datetime as dt
import unittest

from cafestock_forecast.engine import ItemInput, run_baseline
from cafestock_forecast.methods import get_method
from cafestock_forecast.reorder import ReorderInputs, recommend

AS_OF = dt.date(2025, 3, 24)  # a Monday; history ends Sunday 23 March
# 12 weeks of a weekly pattern (weekdays 10, Saturday 20, Sunday 30), starting on a Monday
WEEKLY = [10, 10, 10, 10, 10, 20, 30] * 12


def item(**overrides):
    values = dict(
        item_id="milk",
        name="Fresh milk",
        unit="ml",
        on_hand=50.0,
        lead_time_days=1,
        spoilage_cap=None,
        history=list(WEEKLY),
    )
    values.update(overrides)
    return ItemInput(**values)


class RunBaselineTest(unittest.TestCase):
    def test_forecasts_the_next_7_days_from_as_of(self):
        run = run_baseline([item()], as_of=AS_OF, method="wd4")
        result = run.items[0]
        self.assertEqual(
            [(d.date.isoformat(), d.predicted) for d in result.forecast],
            [
                ("2025-03-24", 10.0),
                ("2025-03-25", 10.0),
                ("2025-03-26", 10.0),
                ("2025-03-27", 10.0),
                ("2025-03-28", 10.0),
                ("2025-03-29", 20.0),
                ("2025-03-30", 30.0),
            ],
        )

    def test_confidence_band_is_z_sigma_either_side_and_never_negative(self):
        run = run_baseline([item()], as_of=AS_OF, method="wd4", service_level_z=1.65)
        sigma = run.items[0].recommendation.demand_std_dev
        first = run.items[0].forecast[0]
        self.assertEqual(first.lower, max(0.0, round(10 - 1.65 * sigma, 3)))
        self.assertEqual(first.upper, round(10 + 1.65 * sigma, 3))
        self.assertLessEqual(first.lower, first.predicted)

    def test_recommendation_matches_the_reorder_formulas(self):
        run = run_baseline([item(spoilage_cap=100)], as_of=AS_OF, method="wd4")
        wd4 = get_method("wd4")
        expected = recommend(
            ReorderInputs(
                on_hand=50.0,
                lead_time_days=1,
                daily_forecast=wd4.forecast(WEEKLY, 8),
                recent_demand=WEEKLY[-28:],
                spoilage_cap=100,
                service_level_z=1.65,
                review_days=7,
            )
        )
        self.assertEqual(run.items[0].recommendation, expected)

    def test_run_describes_itself(self):
        run = run_baseline([item()], as_of=AS_OF, method="ma28")
        self.assertEqual(run.model_tag, "baseline-ma28")
        self.assertEqual(run.method_label, "Moving average, 28 days")
        self.assertEqual((run.horizon_days, run.review_days, run.service_level_z), (7, 7, 1.65))
        self.assertEqual(run.as_of, AS_OF)

    def test_scores_each_item_on_recent_weeks(self):
        run = run_baseline([item()], as_of=AS_OF, method="wd4", eval_weeks=8)
        r = run.items[0]
        # A perfectly repeating week: the weekday average is exact
        self.assertEqual((r.error.mape, r.error.wape, r.error.points), (0.0, 0.0, 56))
        self.assertEqual(run.error.mape, 0.0)

    def test_missing_supplier_uses_the_default_lead_time_and_says_so(self):
        run = run_baseline([item(lead_time_days=None)], as_of=AS_OF, default_lead_time=2)
        r = run.items[0]
        self.assertEqual(r.recommendation.lead_time_days, 2)
        self.assertIn("No supplier lead time: assumed 2 days.", r.notes)

    def test_items_with_no_history(self):
        run = run_baseline([item(item_id="new", name="New syrup", history=[], on_hand=3)], as_of=AS_OF)
        r = run.items[0]
        self.assertEqual([d.predicted for d in r.forecast], [0.0] * 7)
        self.assertEqual(r.recommendation.status, "OK")
        self.assertIsNone(r.error.mape)
        self.assertIn("No demand history yet: forecast is 0.", r.notes)

    def test_short_history_is_flagged(self):
        run = run_baseline([item(history=[5, 6, 7])], as_of=AS_OF)
        self.assertIn("Only 3 days of history: treat this forecast with care.", run.items[0].notes)

    def test_sparse_demand_is_flagged(self):
        sparse = [0, 0, 0, 0, 0, 0, 40] * 12  # demand on 1 day in 7
        run = run_baseline([item(history=sparse)], as_of=AS_OF)
        self.assertIn("No demand on 86% of recent days: daily forecasts are rough.", run.items[0].notes)

    def test_an_item_whose_demand_stopped_long_ago_is_flagged(self):
        stopped = WEEKLY[:56] + [0] * 40  # nothing for the last 40 days
        run = run_baseline([item(history=stopped)], as_of=AS_OF)
        self.assertIn(
            "No demand recorded in the last 40 days, so the forecast is close to 0. "
            "Is it still sold, and is its usage being recorded?",
            run.items[0].notes,
        )
        self.assertEqual(run.items[0].forecast[0].predicted, 0.0)

    def test_rejects_bad_settings(self):
        with self.assertRaisesRegex(ValueError, "horizon_days"):
            run_baseline([item()], as_of=AS_OF, horizon_days=0)
        with self.assertRaisesRegex(ValueError, "Unknown method"):
            run_baseline([item()], as_of=AS_OF, method="magic")


if __name__ == "__main__":
    unittest.main()
