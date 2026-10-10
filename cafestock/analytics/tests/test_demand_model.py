"""Task 8b: the model evaluation is fair, leak-free, deterministic and reproduces the reported
results. (Takes about half a minute: it reruns the full walk-forward evaluation.)"""

import copy
import csv
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analytics"))

import demand_model as dm  # noqa: E402
import lightgbm as lgb  # noqa: E402
import numpy as np  # noqa: E402

from cafestock_forecast import ml  # noqa: E402

REPORTED = ROOT / "analytics" / "outputs" / "results.json"
TOLERANCE = 0.001  # results are reported to 3 decimals; allows for platform float differences


class ProvenanceTest(unittest.TestCase):
    """The snapshot is the imported dataset: Kaggle → build_ledger → daily_demand.csv → app → snapshot."""

    def test_snapshot_matches_daily_demand_csv(self):
        series = dm.load_snapshot()
        with (ROOT / "data" / "daily_demand.csv").open(encoding="utf-8", newline="") as f:
            rows = list(csv.DictReader(f))
        expected: dict[str, list[float]] = {}
        for r in sorted(rows, key=lambda r: r["date"]):
            expected.setdefault(r["ingredient_name"], []).append(float(r["units"]))
        self.assertEqual(sorted(series), sorted(expected))
        for name, s in series.items():
            self.assertEqual(s.values, expected[name], name)
            self.assertEqual(s.first_date.isoformat(), "2024-03-01")

    def test_snapshot_checksum_matches_its_description(self):
        meta = json.loads(dm.SNAPSHOT.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertEqual(meta["sha256"], dm.file_sha256(dm.SNAPSHOT))
        self.assertEqual((meta["items"], meta["rows"]), (8, 3104))


class EvaluationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.series = dm.load_snapshot()
        cls.rows = dm.build_rows(cls.series)
        cls.results = dm.evaluate(cls.series, cls.rows)

    def test_model_and_baseline_are_scored_on_identical_days(self):
        model, baseline, ref = (self.results[k] for k in ("model", "baseline", "reference"))
        for name in self.series:
            key = lambda pts: [(p.origin, p.offset, p.actual) for p in pts]  # noqa: E731
            self.assertEqual(key(model.points[name]), key(baseline.points[name]))
            self.assertEqual(key(model.points[name]), key(ref.points[name]))
        self.assertEqual(model.summary["points"], 8 * 47 * 7)

    def test_reproduces_the_reported_results(self):
        reported = json.loads(REPORTED.read_text(encoding="utf-8"))
        for key in ("reference", "baseline", "model"):
            for metric in ("mase", "wape", "mape", "weekly_wape"):
                with self.subTest(method=key, metric=metric):
                    self.assertAlmostEqual(
                        self.results[key].summary[metric], reported["summary"][key][metric], delta=TOLERANCE
                    )
        for name in self.series:
            self.assertAlmostEqual(
                self.results["model"].items[name].mase,
                reported["per_item"][name]["model"]["mase"],
                delta=TOLERANCE,
            )
        self.assertEqual(dm.head_to_head(self.results), reported["head_to_head"])

    def test_the_model_never_sees_the_week_it_is_scored_on(self):
        # Rewrite every day from 1 Feb 2025 on; forecasts made on or before then must not change
        cutoff = 337  # index of 2025-02-01
        changed = copy.deepcopy(self.series)
        for s in changed.values():
            s.values[cutoff:] = [v * 5 + 100 for v in s.values[cutoff:]]
        results = dm.evaluate(changed)
        compared = 0
        for name in self.series:
            for before, after in zip(self.results["model"].points[name], results["model"].points[name]):
                if before.origin <= cutoff:
                    self.assertEqual(before.predicted, after.predicted)
                    compared += 1
        self.assertEqual(compared, 8 * 40 * 7)  # 40 of the 47 weeks start on or before the cutoff


class ModelFileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.series = dm.load_snapshot()
        cls.rows = dm.build_rows(cls.series)

    def test_training_is_deterministic(self):
        a = dm.final_model(self.rows).model_to_string()
        b = dm.final_model(self.rows).model_to_string()
        self.assertEqual(a, b)

    def test_saved_model_loads_and_gives_the_same_forecast(self):
        path = dm.MODEL_DIR / "model.txt"
        meta = json.loads((dm.MODEL_DIR / "model.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["features"], ml.FEATURES)
        self.assertEqual(meta["trained_on"]["sha256"], dm.file_sha256(dm.SNAPSHOT))
        saved = lgb.Booster(model_file=str(path))
        fresh = dm.final_model(self.rows)
        milk = self.series["Fresh milk"]
        np.testing.assert_allclose(
            ml.predict(saved, milk.values, milk.first_date, 7),
            ml.predict(fresh, milk.values, milk.first_date, 7),
            rtol=1e-6,
        )

    def test_example_output_is_explained_by_its_inputs(self):
        ex = dm.example(self.series, dm.final_model(self.rows))
        self.assertEqual(list(ex["inputs"]), ml.FEATURES)
        self.assertEqual(ex["forecast_day"], "2025-03-24")
        self.assertAlmostEqual(ex["prediction"], ex["model_output_scaled"] * ex["level"], delta=0.2)


if __name__ == "__main__":
    unittest.main()
