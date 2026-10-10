"""Cross-checks against the team's own analysis of the same dataset (data/, see
data/DATA_DICTIONARY.md). Runs on data/daily_demand.csv, so no database is needed.
"""

import csv
import datetime as dt
import unittest
from pathlib import Path

from cafestock_forecast.backtest import compare_methods
from cafestock_forecast.engine import DEFAULT_METHOD
from cafestock_forecast.methods import METHODS, get_method

DATA = Path(__file__).resolve().parents[3] / "data" / "daily_demand.csv"

# forecast_next_week from the team's restocking_recommendations.csv (weekly MA-2 as of the
# end of the data, 23 March 2025)
TEAM_NEXT_WEEK = {
    "Espresso beans": 1080.0,
    "Fresh milk": 10460.0,
    "Drinking chocolate": 162.5,
    "Cocoa powder": 237.5,
    "Paper cup 8oz": 4.5,
    "Paper cup 12oz": 97.0,
    "Cup lid 12oz": 97.0,
    "Napkin": 101.5,
}


def load_series():
    with DATA.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    by_item: dict[str, dict[dt.date, float]] = {}
    for r in rows:
        by_item.setdefault(r["ingredient_name"], {})[dt.date.fromisoformat(r["date"])] = float(r["units"])
    return {name: [days[d] for d in sorted(days)] for name, days in by_item.items()}


@unittest.skipUnless(DATA.exists(), "data/daily_demand.csv not found")
class TeamAnalysisTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.series = load_series()

    def test_dataset_shape(self):
        self.assertEqual(sorted(self.series), sorted(TEAM_NEXT_WEEK))
        self.assertTrue(all(len(s) == 388 for s in self.series.values()))

    def test_14_day_average_matches_the_teams_weekly_ma2(self):
        # The last 14 days are the last two complete weeks (Mon 10 – Sun 23 March), so
        # 7 × (14-day average) equals the team's average of the last two weekly totals.
        ma14 = get_method("ma14")
        for name, expected in TEAM_NEXT_WEEK.items():
            with self.subTest(item=name):
                self.assertAlmostEqual(sum(ma14.forecast(self.series[name], 7)), expected, places=6)

    def test_default_method_is_the_best_baseline_over_the_year(self):
        # Walk-forward over every week after the first 8 (47 weeks per item, like the team's)
        results = compare_methods(self.series, METHODS.values(), horizon=7, step=7, min_history=56)
        self.assertEqual(results[DEFAULT_METHOD].points, 8 * 47 * 7)
        best = min(results.values(), key=lambda c: c.mase)
        self.assertEqual(best.method.key, DEFAULT_METHOD)
        self.assertLess(results[DEFAULT_METHOD].mase, 1.0)  # beats "same day last week"


if __name__ == "__main__":
    unittest.main()
