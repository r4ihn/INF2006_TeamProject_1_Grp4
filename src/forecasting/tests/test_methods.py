"""Forecasting methods: each takes daily history (oldest first) and a horizon."""

import unittest

from cafestock_forecast.methods import (
    METHODS,
    exponential_smoothing,
    get_method,
    moving_average,
    naive,
    seasonal_naive,
    weekday_average,
)

# Two weeks with a weekend bump (history starts on a Monday)
TWO_WEEKS = [10, 10, 10, 10, 10, 20, 30, 12, 12, 12, 12, 12, 24, 36]


class MethodsTest(unittest.TestCase):
    def test_naive_repeats_the_last_day(self):
        self.assertEqual(naive([1, 2, 3], 3), [3, 3, 3])

    def test_seasonal_naive_repeats_last_week(self):
        self.assertEqual(seasonal_naive(TWO_WEEKS, 9), [12, 12, 12, 12, 12, 24, 36, 12, 12])

    def test_seasonal_naive_with_less_than_a_week_uses_the_average(self):
        self.assertEqual(seasonal_naive([2, 4], 2), [3, 3])

    def test_moving_average(self):
        self.assertEqual(moving_average(3)([1, 2, 3, 4, 5], 2), [4, 4])
        self.assertEqual(moving_average(28)([2, 4], 1), [3])  # shorter history: all of it

    def test_weekday_average_averages_the_same_weekday(self):
        # Next day is a Monday: Mondays were 10 and 12
        self.assertEqual(
            weekday_average(4)(TWO_WEEKS, 7), [11, 11, 11, 11, 11, 22, 33]
        )
        # Only the last week
        self.assertEqual(weekday_average(1)(TWO_WEEKS, 2), [12, 12])

    def test_weekday_average_without_that_weekday_falls_back_to_the_mean(self):
        self.assertEqual(weekday_average(4)([3, 6], 3), [4.5, 4.5, 4.5])

    def test_exponential_smoothing(self):
        # level: 10 → 0.5×20 + 0.5×10 = 15 → 0.5×10 + 0.5×15 = 12.5
        self.assertEqual(exponential_smoothing(0.5)([10, 20, 10], 2), [12.5, 12.5])
        with self.assertRaises(ValueError):
            exponential_smoothing(1.5)

    def test_every_method_handles_no_history_and_never_goes_negative(self):
        for key, method in METHODS.items():
            with self.subTest(method=key):
                self.assertEqual(method.forecast([], 3), [0.0, 0.0, 0.0])
                self.assertTrue(all(v >= 0 for v in method.forecast(TWO_WEEKS, 10)))
                self.assertEqual(len(method.forecast(TWO_WEEKS, 10)), 10)

    def test_methods_have_tags_for_the_ui(self):
        self.assertEqual(get_method("ma28").tag, "baseline-ma28")
        self.assertEqual(get_method("wd4").label, "Same weekday, last 4 weeks")
        with self.assertRaisesRegex(ValueError, "Unknown method 'lstm'. Choose from"):
            get_method("lstm")


if __name__ == "__main__":
    unittest.main()
