"""Model inputs (cafestock_forecast.ml): correct values, and never any look at the future."""

import datetime as dt
import unittest

import numpy as np

from cafestock_forecast.ml import FEATURES, MIN_HISTORY, level, origin_features, predict, training_rows

MONDAY = dt.date(2024, 3, 4)
# 6 weeks: weekdays 10, Saturday 20, Sunday 40
SERIES = [10, 10, 10, 10, 10, 20, 40] * 6


def col(name):
    return FEATURES.index(name)


class OriginFeaturesTest(unittest.TestCase):
    def test_values_for_a_known_series(self):
        history = SERIES[:35]  # 5 full weeks, next day is a Monday
        X, scale = origin_features(history, MONDAY, horizon=7)
        self.assertAlmostEqual(scale, 110 / 7)  # weekly total 110 over 7 days
        self.assertEqual(X.shape, (7, len(FEATURES)))
        self.assertEqual(list(X[:, col("days_ahead")]), [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(list(X[:, col("weekday")]), [0, 1, 2, 3, 4, 5, 6])
        # Saturday (row 5): 20 a week earlier, divided by the level
        self.assertAlmostEqual(X[5, col("same_weekday_1w")], 20 / scale)
        self.assertAlmostEqual(X[6, col("weekday_avg_4w")], 40 / scale)
        self.assertAlmostEqual(X[0, col("last_day")], 40 / scale)  # the Sunday before
        self.assertAlmostEqual(X[0, col("mean_7")], 1.0)
        self.assertEqual(X[0, col("zero_share_28")], 0.0)

    def test_needs_four_weeks_of_history(self):
        with self.assertRaisesRegex(ValueError, "at least 28 days"):
            origin_features(SERIES[:27], MONDAY)

    def test_an_item_with_no_demand_has_level_1(self):
        self.assertEqual(level([0] * 30), 1.0)
        X, scale = origin_features([0] * 30, MONDAY, horizon=1)
        self.assertEqual(scale, 1.0)
        self.assertEqual(X[0, col("zero_share_28")], 1.0)

    def test_scaling_makes_milk_and_cups_look_alike(self):
        cups, _ = origin_features(SERIES[:35], MONDAY)
        milk, _ = origin_features([x * 150 for x in SERIES[:35]], MONDAY)
        np.testing.assert_allclose(cups, milk)


class NoLeakageTest(unittest.TestCase):
    def test_features_ignore_everything_from_the_forecast_day_on(self):
        rng = np.random.default_rng(1)
        series = rng.poisson(12, 90).astype(float)
        X1, y1, origin, ahead, _ = training_rows(series, MONDAY)
        for t in (30, 50, 80):
            changed = series.copy()
            changed[t:] = 999  # rewrite the future
            X2, _, origin2, _, _ = training_rows(changed, MONDAY)
            np.testing.assert_array_equal(X1[origin == t], X2[origin2 == t])

    def test_training_rows_match_what_is_used_at_forecast_time(self):
        series = [float(x) for x in SERIES]
        X, y, origin, ahead, scale = training_rows(series, MONDAY)
        Xt, st = origin_features(series[:30], MONDAY, horizon=7)
        np.testing.assert_array_equal(X[origin == 30], Xt)
        self.assertTrue(np.all(scale[origin == 30] == st))
        # targets are the real next days ÷ level
        np.testing.assert_allclose(y[origin == 30] * st, series[30:37])
        self.assertEqual(origin.min(), MIN_HISTORY)
        # near the end the horizon is cut short: only answers that exist
        self.assertEqual(list(ahead[origin == len(series) - 2]), [0, 1])


class PredictTest(unittest.TestCase):
    class Constant:
        """Stands in for a LightGBM booster: always predicts 1.5 × the level."""

        def predict(self, X):
            return np.full(len(X), 1.5)

    def test_prediction_is_scaled_back_and_extended_past_a_week(self):
        history = SERIES[:35]
        out = predict(self.Constant(), history, MONDAY, horizon=10)
        self.assertEqual(len(out), 10)
        self.assertAlmostEqual(out[0], 1.5 * 110 / 7)
        self.assertEqual(out[7:], out[:3])  # days 8–10 repeat days 1–3

    def test_never_negative(self):
        class Negative:
            def predict(self, X):
                return np.full(len(X), -2.0)

        self.assertEqual(predict(Negative(), SERIES[:35], MONDAY, horizon=3), [0.0, 0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
