"""Forecast error measures."""

import unittest

from cafestock_forecast.metrics import bias, mae, mape, relative_mae, wape


class MetricsTest(unittest.TestCase):
    actual = [10, 0, 20, 10]
    predicted = [12, 2, 15, 10]  # errors: 2, 2, 5, 0

    def test_mae(self):
        self.assertEqual(mae(self.actual, self.predicted), 2.25)

    def test_wape_divides_total_error_by_total_demand(self):
        self.assertEqual(wape(self.actual, self.predicted), 9 / 40)

    def test_mape_skips_days_with_zero_demand(self):
        # (2/10 + 5/20 + 0/10) / 3 — the zero day can't be divided by
        self.assertAlmostEqual(mape(self.actual, self.predicted), 0.15)

    def test_bias_shows_over_forecasting(self):
        self.assertEqual(bias(self.actual, self.predicted), (39 - 40) / 40)

    def test_undefined_when_there_is_no_demand(self):
        self.assertIsNone(wape([0, 0], [1, 1]))
        self.assertIsNone(mape([0, 0], [1, 1]))
        self.assertIsNone(bias([0, 0], [1, 1]))
        self.assertIsNone(mae([], []))

    def test_relative_mae_against_a_reference(self):
        self.assertEqual(relative_mae(1.5, 2.0), 0.75)
        self.assertEqual(relative_mae(0.0, 0.0), 1.0)  # both perfect: as good as the reference
        self.assertIsNone(relative_mae(1.0, 0.0))
        self.assertIsNone(relative_mae(None, 2.0))

    def test_lengths_must_match(self):
        with self.assertRaises(ValueError):
            mae([1, 2], [1])


if __name__ == "__main__":
    unittest.main()
