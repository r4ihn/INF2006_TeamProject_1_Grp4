# Test 3 — Data / AI validation: demand model vs baseline

| **Date** | 2026-10-01 |
| **Component** | Demand forecast behind the reorder recommendations (`analytics/`, `forecasting/`) |
| **Run by** | Jason Woo |
| **Environment** | Local, offline. Python 3.11/3.12, packages pinned in `analytics/requirements.txt` (LightGBM 4.7.0) |

## Objective

Show that the ML demand model (LightGBM `lgbm-v1`) is evaluated **fairly and reproducibly**
against the app's baseline forecast (14-day moving average), without using future data, and
record which one is more accurate.

## Setup

- Data: frozen snapshot `analytics/snapshots/demand_2025-03-23.csv` (8 ingredients × 388 days,
  1 Mar 2024 – 23 Mar 2025; SHA-256 `7d8dc7b498ba901b…`, see the `.json` beside it), exported from
  the app's `demand_history` table after `npm run db:import`.
- Evaluation: walk-forward over 47 weeks per item, 7-day horizon, model retrained before each week
  on data known by then; baseline and reference ("same day last week") scored on the same days.
- Headline measure: MASE (error ÷ "same day last week" error); also weekly WAPE, WAPE, MAPE.

## Command / steps

```bash
npm run forecast:setup && npm run analytics:setup   # once
npm run analytics:test     # 19 tests, ~20 s
npm run analytics          # prints the comparison, writes analytics/outputs/
```

## Expected result

1. The snapshot equals `data/daily_demand.csv` value for value, and its checksum matches its description.
2. Model, baseline and reference are scored on identical days (8 × 47 × 7 = 2,632).
3. Rewriting all demand after 1 Feb 2025 does not change any forecast made on or before that date
   (no future data used).
4. Training twice gives an identical model; the saved `model.txt` reloads and predicts the same.
5. Rerunning reproduces the reported metrics in `analytics/outputs/results.json` (within 0.001).
6. A clear, recorded answer to "which forecast is more accurate?" — whichever way it comes out.

## Actual result

```
Ran 19 tests in 19.584s — OK

Walk-forward over 47 weeks × 8 items, 7 days ahead (lower is better):
  Method                                      MASE  Weekly WAPE   WAPE   MAPE
  Same day last week                         1.000        22.4%  56.7%  81.8%
  Moving average, 14 days                    0.827        23.4%  46.4%  62.9%
  LightGBM (global model, retrained weekly)  0.855        21.4%  47.9%  64.3%

Weekly totals: model closer in 192 weeks, baseline in 184 (ties 0).
Items where the model's MASE is lower: none
```

Checks 1–5 **passed**. For check 3 a mutation was also tried: letting the model train on 30 days
of future data made the leakage test and the reproduction test fail, confirming they detect it.

**Outcome (check 6):** the baseline is more accurate day by day on all 8 items (MASE 0.827 vs
0.855); the model is slightly better on weekly totals (21.4% vs 23.4% weekly WAPE), mainly for
fresh milk. The ML model **did not** beat the baseline overall.

## Diagnosis and next step

With one year of single-cafe data and no outside information (holidays, weather, promotions), the model sees little the moving average doesn't already capture — its most important inputs are the recent level, spread and weekday pattern (`analytics/outputs/feature_importance.csv`). Decision:
keep the 14-day moving average as the default for reorder recommendations; keep `lgbm-v1` as a
challenger that the nightly forecast scores on recent weeks and switches to only if it wins.
Improvement plan: add calendar/holiday inputs and retrain as more months of the café's own data
accumulate; re-run this test after each change.

## Artefacts

- `analytics/demand_model.ipynb` — method, results, worked example, limitations, responsible use
- `analytics/outputs/results.json`, `backtest_predictions.csv`, `model_vs_baseline.png`,
  `feature_importance.csv`, `example_forecast.json`, `next_week_forecast.csv`
- `analytics/models/lgbm-v1/model.txt`, `model.json`
- `analytics/tests/test_demand_model.py`, `analytics/tests/test_features.py`
