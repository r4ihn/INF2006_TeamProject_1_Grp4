"""Reorder maths: known inputs → the numbers the formulas in docs/data-contract.md give."""

import unittest

from cafestock_forecast.reorder import ReorderInputs, recommend

# Demand alternating 8 / 12 a day: mean 10, sample σ = √(32/7) = 2.138…
RECENT = [8, 12, 8, 12, 8, 12, 8, 12]
FLAT_10 = [10.0] * 9  # forecast: 10 a day for lead time (2) + review period (7)


def inputs(on_hand, **overrides):
    values = dict(
        on_hand=on_hand,
        lead_time_days=2,
        daily_forecast=FLAT_10,
        recent_demand=RECENT,
        service_level_z=1.65,
        review_days=7,
    )
    values.update(overrides)
    return ReorderInputs(**values)


class ReorderFormulaTest(unittest.TestCase):
    def test_intermediate_values(self):
        r = recommend(inputs(on_hand=30))
        self.assertEqual(r.avg_daily_demand, 10.0)
        self.assertEqual(r.demand_std_dev, 2.138)
        # lead-time demand = forecast summed over the 2 lead-time days
        self.assertEqual(r.lead_time_demand, 20.0)
        # safety stock = Z × σ × √L = 1.65 × 2.138 × √2
        self.assertEqual(r.safety_stock, 4.989)
        # reorder point = lead-time demand + safety stock
        self.assertEqual(r.reorder_point, 24.989)
        # the order covers the review period (next 7 days) on top of the reorder point
        self.assertEqual(r.review_demand, 70.0)
        self.assertEqual(r.order_up_to, 94.989)
        self.assertEqual(r.cover_days, 3.0)

    def test_enough_stock_is_ok_and_orders_nothing(self):
        r = recommend(inputs(on_hand=30))
        self.assertEqual(r.status, "OK")
        self.assertEqual(r.shortfall, 0.0)
        self.assertEqual(r.recommended_qty, 0.0)
        self.assertFalse(r.spoilage_cap_applied)

    def test_below_reorder_point_orders_up_to_a_week_ahead(self):
        r = recommend(inputs(on_hand=22))
        self.assertEqual(r.status, "REORDER")
        self.assertEqual(r.shortfall, 2.989)  # 24.989 − 22
        self.assertEqual(r.recommended_qty, 72.989)  # 94.989 − 22

    def test_exactly_at_the_reorder_point_is_ok(self):
        r = recommend(inputs(on_hand=24.989131043721798))
        self.assertEqual(r.status, "OK")

    def test_running_out_before_a_delivery_is_urgent(self):
        r = recommend(inputs(on_hand=15))  # lead-time demand is 20
        self.assertEqual(r.status, "URGENT")
        self.assertEqual(r.recommended_qty, 79.989)

    def test_spoilage_cap_limits_the_order(self):
        r = recommend(inputs(on_hand=15, spoilage_cap=50))
        self.assertEqual(r.recommended_qty, 50.0)
        self.assertTrue(r.spoilage_cap_applied)
        # a cap above the order changes nothing
        r = recommend(inputs(on_hand=15, spoilage_cap=500))
        self.assertEqual(r.recommended_qty, 79.989)
        self.assertFalse(r.spoilage_cap_applied)

    def test_longer_lead_time_needs_more_safety_stock(self):
        r = recommend(inputs(on_hand=30, lead_time_days=3, daily_forecast=[10.0] * 10))
        self.assertEqual(r.lead_time_demand, 30.0)
        self.assertEqual(r.safety_stock, 6.110)  # 1.65 × 2.138 × √3
        self.assertEqual(r.status, "REORDER")

    def test_uses_the_forecast_not_the_average_for_lead_time_demand(self):
        # A rising forecast: 20, 30 over the lead time, then 5 a day
        r = recommend(inputs(on_hand=40, daily_forecast=[20, 30] + [5] * 7))
        self.assertEqual(r.lead_time_demand, 50.0)
        self.assertEqual(r.review_demand, 35.0)
        self.assertEqual(r.status, "URGENT")


class ReorderEdgeCaseTest(unittest.TestCase):
    def test_zero_demand(self):
        r = recommend(inputs(on_hand=0, daily_forecast=[0.0] * 9, recent_demand=[0.0] * 28))
        self.assertEqual(
            (r.avg_daily_demand, r.demand_std_dev, r.safety_stock, r.reorder_point), (0, 0, 0, 0)
        )
        self.assertEqual(r.status, "OK")
        self.assertEqual(r.recommended_qty, 0.0)
        self.assertIsNone(r.cover_days)  # can't divide by zero demand

    def test_no_history_at_all(self):
        r = recommend(inputs(on_hand=5, daily_forecast=[0.0] * 9, recent_demand=[]))
        self.assertEqual((r.avg_daily_demand, r.demand_std_dev), (0.0, 0.0))
        self.assertEqual(r.status, "OK")

    def test_a_single_day_of_history_has_no_spread(self):
        r = recommend(inputs(on_hand=5, recent_demand=[12]))
        self.assertEqual(r.demand_std_dev, 0.0)
        self.assertEqual(r.safety_stock, 0.0)

    def test_zero_lead_time(self):
        r = recommend(inputs(on_hand=0, lead_time_days=0, daily_forecast=[10.0] * 7))
        self.assertEqual((r.lead_time_demand, r.safety_stock, r.reorder_point), (0, 0, 0))
        self.assertEqual(r.status, "OK")

    def test_rejects_impossible_inputs(self):
        with self.assertRaisesRegex(ValueError, "forecast must cover"):
            recommend(inputs(on_hand=1, daily_forecast=[10.0] * 3))
        with self.assertRaisesRegex(ValueError, "on_hand"):
            recommend(inputs(on_hand=-1))
        with self.assertRaisesRegex(ValueError, "lead_time_days"):
            recommend(inputs(on_hand=1, lead_time_days=-1))
        with self.assertRaisesRegex(ValueError, "negative"):
            recommend(inputs(on_hand=1, recent_demand=[3, -1]))
        with self.assertRaisesRegex(ValueError, "spoilage_cap"):
            recommend(inputs(on_hand=1, spoilage_cap=-5))


if __name__ == "__main__":
    unittest.main()
