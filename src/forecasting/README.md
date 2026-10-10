# Baseline forecast engine (Task 8)

A small Python library that turns a café's daily demand history into:

- a **7-day daily forecast** per item, with a confidence band;
- a **reorder recommendation** per item (safety stock, reorder point, how much to order, status);
- the method's **forecast error** on recent weeks (walk-forward), so every number can be judged.

It needs only the Python standard library. `pg8000`, a pure-Python PostgreSQL driver, reads the
café's data. It is the **baseline** the ML model is measured against (Task 8b) and the nightly
Lambda's **fallback** when the model can't be loaded (Task 10). The Node API never imports it.
It only reads the results the Lambda writes to the forecast tables
([`docs/data-contract.md`](../docs/data-contract.md)).

## Run it

```bash
npm run forecast:setup     # once: creates forecasting/.venv and installs pg8000
npm run forecast:test      # the Python tests (85)
npm run forecast           # recommendations for the demo café
npm run forecast -- --compare   # …plus every method scored on the whole history
npm run forecast -- --help      # --method, --as-of, --z, --horizon, --json, --org, …
```

It reads the same database as the API (`DATABASE_URL` in `backend/.env`, default local Docker).
By default it forecasts from the **day after the history ends**. With the imported dataset's real
dates, that is Monday 24 March 2025.

## The forecasting methods

Each method takes daily history (oldest first) and returns the next _n_ days.

| Key                 | Method                                  | Idea                                                |
| ------------------- | --------------------------------------- | --------------------------------------------------- |
| `naive`             | Yesterday repeats                       | Simplest possible                                   |
| `snaive`            | Same day last week                      | **Reference** for MASE (captures the weekly rhythm) |
| `ma7` `ma14` `ma28` | Moving average of the last 7/14/28 days | Smooths out day-to-day noise                        |
| `wd4` `wd8`         | Same weekday, last 4/8 weeks            | Average of past Mondays for a Monday, etc.          |
| `ses10` `ses30`     | Exponential smoothing, α 0.1 / 0.3      | Recent days weigh more, older days fade             |

**Default: `ma14` (the 14-day moving average).** It scored best on the café dataset (below), and
it is the daily version of the team analysis's weekly **MA-2**: 7 × the 14-day average equals the
average of the last two weekly totals. The engine reproduces the team's `forecast_next_week` for
all 8 ingredients exactly (`tests/test_team_analysis.py`).

## Results on the café dataset

Walk-forward: from each week after the first 8 (47 weeks per item, as in the team's analysis),
forecast the next 7 days using only earlier days, then compare with what happened. That gives
8 items × 47 weeks × 7 days = 2,632 scored days per method.

| Method                         | MASE     | MAPE | WAPE | Weekly WAPE |
| ------------------------------ | -------- | ---- | ---- | ----------- |
| **Moving average, 14 days**    | **0.83** | 63%  | 46%  | 23%         |
| Exponential smoothing, α 0.1   | 0.83     | 62%  | 46%  | 24%         |
| Moving average, 7 days         | 0.84     | 64%  | 47%  | 22%         |
| Moving average, 28 days        | 0.85     | 64%  | 48%  | 27%         |
| Exponential smoothing, α 0.3   | 0.85     | 64%  | 47%  | 25%         |
| Same weekday, last 4 weeks     | 0.85     | 67%  | 49%  | 27%         |
| Same weekday, last 8 weeks     | 0.87     | 67%  | 49%  | 31%         |
| Same day last week (reference) | 1.00     | 82%  | 57%  | 22%         |
| Yesterday repeats              | 1.08     | 81%  | 62%  | 51%         |

How to read it:

- **MASE** (headline) is the method's error divided by the error of "same day last week" on the
  same days, averaged over items so that milk (ml) and cups (pcs) count equally. 0.83 means 17%
  less error than the reference.
- **MAPE** only uses days that had demand, because a percentage of zero is undefined. Sparse
  items (cocoa powder has no demand on 64% of days) leave it few days and make it jumpy. This is
  why the team analysis avoided MAPE, and why MASE is the headline here.
- **WAPE** is total error ÷ total demand, and stays defined on zero days.
- **Weekly WAPE** scores each 7-day total. Single days are noisy (daily WAPE 46%), but the week as a
  whole is predicted within about 23%. That weekly figure is what matters for ordering.

Honest caveats: the differences between the smoothing methods are small (0.83–0.87). On the most
recent 8 weeks alone, "same day last week" does better than MA-14 for several items. `npm run
forecast` shows those recent-week scores per item. As the team's evaluation found, the choice of
method matters much less than the ordering policy.

## How a recommendation is worked out

For each item, with Z = 1.65 (≈ 95% service level), σ = standard deviation of the last 28 days'
demand, L = the supplier's lead time in days (2 if the item has no supplier) and R = 7 review days:

| Value             | Formula                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| lead-time demand  | forecast summed over the next L days                                                                                               |
| safety stock      | Z × σ × √L                                                                                                                         |
| reorder point     | lead-time demand + safety stock                                                                                                    |
| shortfall         | max(0, reorder point − on hand)                                                                                                    |
| order up to       | reorder point + forecast over the following R days                                                                                 |
| recommended order | order up to − on hand, **only when below the reorder point**, capped by the item's spoilage cap                                    |
| cover days        | on hand ÷ average daily demand                                                                                                     |
| status            | `URGENT` if on hand < lead-time demand (it runs out before a delivery can arrive), `REORDER` if on hand < reorder point, else `OK` |

The order covers the week after it arrives. Ordering only the shortfall would leave the item
back at its reorder point the next day.

**Why milk says OK here but the team's file says "order 5 packs".** The team's policy orders every
Monday for the coming week (periodic review). This engine runs every night (Task 10), so it can
wait until an item actually drops below its reorder point (continuous review). With 5,700 ml on
hand, a 1-day lead time and about 1,500 ml a day, milk reaches its reorder point (about 2,750 ml)
in two days. The nightly run then recommends an order of about 3,640 ml. That is the spoilage cap:
half the milk's 7-day shelf life's worth of demand, as the team's policy also caps it. Pack sizes
aren't stored in the app yet, so quantities aren't rounded up to whole packs.

## Machine-learning model (Task 8b)

`cafestock_forecast/ml.py` builds the LightGBM model's inputs, and is shared by training
(`analytics/demand_model.py`) and the nightly forecast (Task 10), so both compute identical inputs.
`cafestock_forecast/snapshot.py` exports the app's demand history to a dated CSV for training
(`npm run analytics:snapshot`). Both need the analytics packages (`npm run analytics:setup`); the rest
of this library still needs only the standard library. Results: [`analytics/README.md`](../../analytics/README.md).

## Publishing a run for the app (Task 9)

`npm run forecast` only prints. `npm run forecast:publish` (`cafestock_forecast/publish.py`)
saves a run to the forecast tables, which the manager's **Forecast** page reads:

1. Load every active item's history and stock (`db.load_items`).
2. **Champion / challenger:** score the LightGBM model (`analytics/models/lgbm-v1/model.txt`) and
   the 14-day average on the last 8 weeks, each week forecast only from the days before it. The
   lower MASE wins. Items with under 28 days of history use the baseline (with a note).
3. Work out each item's recommendation with the winner's forecast (same formulas as above).
4. Write the run, 7 forecast days per item and the recommendations in **one transaction**. If
   anything fails, nothing is kept and a `FAILED` run records the error.

If LightGBM isn't installed or the model file is missing, the baseline runs and the run is marked
as a fallback. Options: `--org`, `--as-of`, `--method`, `--no-model`, `--model`, `--eval-weeks`,
`--dry-run` (print, save nothing), `--database-url`. The nightly Lambda (Task 10) will call the
same `publish()`. Table layout: [`docs/data-contract.md`](../docs/data-contract.md).

## The nightly Lambda (Task 10)

`cafestock_forecast/aws_lambda.py` is the same job as `forecast:publish`, packaged for AWS
Lambda and started every night by EventBridge. For each café with active items it takes a
PostgreSQL advisory lock (two runs never write the same café), skips the café if it was
published in the last hour (EventBridge and Lambda can deliver the same night twice), then
publishes. One café failing doesn't stop the others. The job then fails as a whole so Lambda
counts an error, the CloudWatch alarm e-mails the team, and after one retry the failure also
goes to SNS.

- **Model:** downloaded from S3 (`MODEL_S3_URI`) and cached in `/tmp` per version (ETag). If
  it can't be downloaded, the run uses the baseline and logs why.
- **Database:** username and password from Secrets Manager (`DB_SECRET_ARN`), address from
  `DB_HOST`, TLS verified against the RDS certificate bundle (`DB_SSL=verify-full`). Locally
  `DATABASE_URL` is used instead.
- **Observability:** one JSON log line per step, and CloudWatch metrics (items to order, urgent
  items, MASE of each candidate, cafés published / skipped / failed, run time) written as
  embedded-metric log lines, so no extra AWS calls or network routes are needed.
- **Self-test** (`{"selfTest": true}`): no database; forecasts the packaged Task 8b snapshot, so
  the result must equal the laptop's (LightGBM 1.088 vs 14-day average 1.126).

`npm run lambda:invoke` runs it locally (`-- --self-test`, `-- --dry-run`, `-- --force`,
`-- --event file.json`); sample events are in `lambda/events/`. `npm run lambda:build`
(`lambda/build.py`) makes the deployment zip from the pinned Linux wheels in
`lambda/requirements.txt`, adds `libgomp` (OpenMP, which LightGBM needs), and on Linux with
Python 3.13 runs the self-test from the unzipped package alone. Deploying:
[`docs/aws-forecast-setup.md`](../docs/aws-forecast-setup.md).

## Layout

```
forecasting/
├─ requirements.txt          # pg8000 (only for reading the database)
├─ cafestock_forecast/
│  ├─ methods.py             # the forecasting methods
│  ├─ reorder.py             # safety stock, reorder point, recommendation, status
│  ├─ metrics.py             # MAE, MAPE, WAPE, bias, MASE
│  ├─ backtest.py            # walk-forward evaluation and method comparison
│  ├─ engine.py              # one run for a café: forecasts + recommendations + errors
│  ├─ db.py                  # reads items and demand history from PostgreSQL
│  ├─ ml.py                  # LightGBM inputs, training and walk-forward (Task 8b)
│  ├─ snapshot.py            # `npm run analytics:snapshot`
│  ├─ publish.py             # `npm run forecast:publish`: choose a model, save a run (Task 9)
│  ├─ aws_lambda.py          # the nightly job as an AWS Lambda handler (Task 10)
│  └─ __main__.py            # `npm run forecast`
├─ lambda/
│  ├─ requirements.txt       # the Lambda's packages, pinned (Linux wheels)
│  ├─ build.py               # `npm run lambda:build`
│  └─ events/                # sample events: scheduled, self-test, dry run, fail
└─ tests/                    # unittest; the database tests skip (with the reason) when it is not running
```

The tests were written before the code, with the expected numbers worked out by hand. For
example, σ of 8, 12, 8, 12, … is 2.138, so safety stock for a 2-day lead time is
1.65 × 2.138 × √2 = 4.989. In VS Code, the **Testing** panel runs them once the Python extension
is installed.
