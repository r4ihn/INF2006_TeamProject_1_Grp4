"""Walk-forward evaluation: the method only ever sees the past."""

import unittest

from cafestock_forecast.backtest import compare_methods, walk_forward
from cafestock_forecast.methods import get_method, naive


class WalkForwardTest(unittest.TestCase):
    def test_forecasts_from_each_origin_using_only_earlier_days(self):
        # Origins are counted back from the end, so the most recent days are always scored
        series = list(range(20))
        points = walk_forward(series, naive, horizon=3, step=5, min_history=10)
        self.assertEqual(
            [(p.origin, p.offset, p.actual, p.predicted) for p in points],
            [
                (12, 0, 12, 11), (12, 1, 13, 11), (12, 2, 14, 11),
                (17, 0, 17, 16), (17, 1, 18, 16), (17, 2, 19, 16),
            ],
        )

    def test_keeps_only_the_most_recent_origins(self):
        points = walk_forward(list(range(20)), naive, horizon=3, step=5, min_history=10, max_origins=1)
        self.assertEqual({p.origin for p in points}, {17})

    def test_too_little_history_gives_no_points(self):
        self.assertEqual(walk_forward([1, 2, 3], naive, horizon=7, step=7, min_history=28), [])

    def test_a_method_never_sees_the_day_it_predicts(self):
        seen = []

        def spy(history, horizon):
            seen.append(len(history))
            return [0.0] * horizon

        walk_forward(list(range(30)), spy, horizon=7, step=7, min_history=14)
        self.assertEqual(seen, [16, 23])


class CompareMethodsTest(unittest.TestCase):
    # Four weeks of a strict weekly pattern: "same day last week" is perfect
    WEEKLY = [5, 5, 5, 5, 10, 20, 30] * 12

    def test_scores_each_method_against_same_day_last_week(self):
        result = compare_methods(
            {"latte": self.WEEKLY},
            [get_method("snaive"), get_method("ma7")],
            horizon=7,
            step=7,
            min_history=28,
        )
        snaive, ma7 = result["snaive"], result["ma7"]
        self.assertEqual(snaive.items["latte"].mae, 0.0)
        self.assertEqual(snaive.items["latte"].mase, 1.0)  # the reference itself
        self.assertGreater(ma7.items["latte"].mae, 0.0)
        self.assertIsNone(ma7.items["latte"].mase)  # reference error 0: can't scale
        self.assertEqual(snaive.points, 8 * 7)  # 8 weekly origins × 7 days

    def test_pooled_and_averaged_scores(self):
        noisy = [4, 6] * 42
        result = compare_methods(
            {"a": noisy, "b": [0] * 84},
            [get_method("ma14")],
            horizon=7,
            step=7,
            min_history=28,
        )
        ma14 = result["ma14"]
        self.assertEqual(ma14.items["b"].wape, None)  # no demand at all
        self.assertAlmostEqual(ma14.items["a"].mae, 1.0)
        self.assertAlmostEqual(ma14.wape, 0.2)  # all error / all demand, across items
        self.assertAlmostEqual(ma14.mase, 0.5)  # item a: MAE 1 vs same-day-last-week MAE 2


if __name__ == "__main__":
    unittest.main()
