# Analytics — demand forecasting for CafeStock

Everything behind CafeStock's data-driven feature: forecasting each ingredient's demand so the
manager knows what to reorder, and when. It all runs **offline** from files in this repo — no
database, cloud account or internet connection is needed to reproduce the results.

There are two parts:

| Part                      | Question it answers                                                                             | Files                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **A. Team analysis**      | Which simple weekly forecast is most accurate, and does forecasting actually prevent stockouts? | `build_ledger.py`, `forecast.py`, `evaluate_policy.py`, `evaluation.md`      |
| **B. ML model (Task 8b)** | Does a machine-learning model (LightGBM) forecast daily demand better than the app's baseline?  | `demand_model.ipynb`, `demand_model.py`, `snapshots/`, `models/`, `outputs/` |

The app's own forecasting library (`forecasting/`, Task 8) provides the baseline, the reorder
maths and the model's input code (`forecasting/cafestock_forecast/ml.py`), so the notebook and the
nightly forecast use exactly the same code.

## Reproduce

Needs **Python 3.12+** (Windows: from python.org, tick "Add python.exe to PATH") and Node.js for
the `npm run` shortcuts. From the repo root:

```bash
npm run forecast:setup       # once: creates forecasting/.venv
npm run analytics:setup      # once: installs the pinned packages in requirements.txt (~2 min)

npm run analytics            # B: evaluation + final model (~10 s) → outputs/, models/lgbm-v1/
npm run analytics:notebook   # B: reruns demand_model.ipynb and saves it with its outputs (~15 s)
npm run analytics:test       # B: 16 tests — results reproduce, no future data leaks, deterministic
npm run analytics:team       # A: build_ledger.py → forecast.py → evaluate_policy.py
```

Without npm, activate `forecasting/.venv` and run the scripts directly, e.g.
`python analytics/demand_model.py`, `python analytics/forecast.py`.

**Deterministic.** Fixed seeds (2006), single-threaded deterministic LightGBM and pinned package
versions: rerunning produces byte-identical files, the notebook included. Rebuilding the data with
`build_ledger.py` reproduces `data/*.csv` exactly (the checksums it prints match
`data/validation_report.txt`).

## Data

| Stage               | File                                                                                 | Made by                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Source (real sales) | `data/raw/Coffe_sales.csv` — 3,547 Kaggle POS transactions, 1 Mar 2024 – 23 Mar 2025 | Kaggle coffee-shop sales export (licence: to confirm before submission)                 |
| Ingredient ledger   | `data/stock_movements.csv`, `data/daily_demand.csv`, …                               | `build_ledger.py` (recipes expand sales into ingredients; deliveries/wastage simulated) |
| In the app          | PostgreSQL `demand_history`                                                          | `npm run db:import` (Task 7) — checks the ledger's sales add up to daily demand         |
| Frozen snapshot     | `snapshots/demand_2025-03-23.csv` (+ `.json` with its SHA-256)                       | `npm run analytics:snapshot` — exports the app's table                                  |

Every field, its provenance and the dataset's limitations: [`data/DATA_DICTIONARY.md`](../data/DATA_DICTIONARY.md).
A test checks the snapshot equals `data/daily_demand.csv` value for value.

## B. ML model — method and results

**Method.** One global LightGBM model for all 8 ingredients. Inputs are recent demand divided by
the item's 28-day average (so milk in ml and cups in pieces look alike) plus the weekly rhythm:
weekday, same weekday 1 and 2 weeks back, 4-week weekday average, last day, 7- and 14-day
averages, 28-day spread and share of zero days. Settings were fixed in advance, not tuned on the
test weeks.

**Evaluation.** Walk-forward over the same 47 weeks per item used to choose the baseline: before
each week the model is retrained on everything known by then, forecasts the next 7 days, and is
compared with what happened — on exactly the same 2,632 days as the baseline and the reference.

| Method                               | MASE ↓    | Weekly WAPE ↓ | WAPE  | MAPE  |
| ------------------------------------ | --------- | ------------- | ----- | ----- |
| Same day last week (reference)       | 1.000     | 22.4%         | 56.7% | 81.8% |
| **14-day moving average (baseline)** | **0.827** | 23.4%         | 46.4% | 62.9% |
| LightGBM `lgbm-v1`                   | 0.855     | **21.4%**     | 47.9% | 64.3% |

MASE = error ÷ error of "same day last week" on the same days (below 1 beats it); weekly WAPE
scores each 7-day total; MAPE skips days with no demand, so it is unstable for sparse items.

**Result.** Day by day, the baseline is more accurate on all 8 items. Week by week, the model is
slightly better (weekly WAPE 21.4% vs 23.4%; closer in 192 vs 184 item-weeks), mostly thanks to
fresh milk (20.0% vs 22.5%). On one year of one café's data, **the ML model does not beat a
well-chosen moving average**, so the moving average stays the app's default and the model is kept
as a challenger that the nightly forecast (Task 10) can switch to if it starts scoring better.
Full discussion, per-item results, feature importance, a worked example, limitations and
responsible use: [`demand_model.ipynb`](demand_model.ipynb).

| Output                                    | Contents                                                          |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `outputs/results.json`                    | All metrics (overall, per item, head-to-head), settings, versions |
| `outputs/backtest_predictions.csv`        | Every scored day: actual, model, baseline, same day last week     |
| `outputs/model_vs_baseline.png`           | Weekly actual vs forecasts for 4 items                            |
| `outputs/feature_importance.csv`/`.png`   | What the model relies on                                          |
| `outputs/example_forecast.json`           | Worked example: inputs → prediction (fresh milk, 24 Mar 2025)     |
| `outputs/next_week_forecast.csv`          | The week after the data: model vs baseline, per item per day      |
| `models/lgbm-v1/model.txt` + `model.json` | The final model (LightGBM text format) and what it was trained on |

## A. Team analysis — results

`forecast.py` compares weekly moving averages over 47 walk-forward weeks (headline MASE, same
reasoning as above): **MA-2 scores 0.963** against the naive "last week" baseline (1.000) — a small
gain. `evaluate_policy.py` replays the whole year day by day under each ordering policy: forecasting
raises the service level from **91.7%** (fixed reorder level) to about **95.5%**, roughly 100 fewer
stockout days a year, and ordering milk twice weekly matters more than the choice of method. Details:
[`evaluation.md`](evaluation.md), `method_comparison*.csv`, `policy_comparison.csv`,
`forecast_plot.png`, `policy_tradeoff.png`.

The app's daily 14-day moving average is the same forecast as the team's weekly MA-2 (7 × the
14-day average = the average of the last two weekly totals); `forecasting/tests/test_team_analysis.py`
checks they agree for all 8 ingredients.
