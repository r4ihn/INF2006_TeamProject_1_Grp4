# Data contract: forecast tables

The Node API and the Python forecasting code (training notebook, Task 8b; nightly Lambda,
Task 10) share **no code**. They share these three PostgreSQL tables. The Lambda **writes**
them and the API **reads** them for the manager's forecast page (Task 9).

Source of truth: `backend/prisma/schema.prisma` and the migrations in
`backend/prisma/migrations/`. If you change a column here, change it there too (and the
other way round).

## Rules for every writer

- **Always set `org_id`.** It's `NOT NULL` and references `organizations.id`. Every
  `item_id` / `run_id` you write must belong to **the same org**. Composite foreign keys
  enforce this, so a mismatch is rejected with error `23503`.
- **Leave `id` and `created_at` out.** Postgres fills them in (`gen_random_uuid()`, `now()`).
- **Dates:** `forecast_date` is a plain `DATE` (no time). Treat days in the org's
  `organizations.timezone` (`Asia/Singapore` for the demo).
- **Fractions, not percentages:** MAPE `0.164` means 16.4%.
- **Numbers are never negative.** CHECK constraints reject negative quantities (error `23514`).
- Write one run inside **one transaction**: the run row, its `forecasts` and its
  `reorder_recommendations` are saved together or not at all. If anything fails, roll back and
  record a `FAILED` run with `error_message` instead. The API only shows the latest `SUCCEEDED`
  run. (`RUNNING` is for a writer that commits the run row first, e.g. a long Lambda.)

## `forecast_runs` — one row per nightly job

| Column            | Type         | Notes                                                     |
| ----------------- | ------------ | --------------------------------------------------------- |
| `id`              | uuid         | auto                                                      |
| `org_id`          | uuid         | required                                                  |
| `model_tag`       | text         | shown in the UI, e.g. `lgbm-v1`, `baseline-ma14`          |
| `model_kind`      | enum         | `ML` or `BASELINE`                                        |
| `is_fallback`     | boolean      | `true` if the ML model couldn't load and the baseline ran |
| `status`          | enum         | `RUNNING` → `SUCCEEDED` / `FAILED`                        |
| `baseline_tag`    | text         | the baseline it was compared with, e.g. `baseline-ma14`   |
| `forecast_from`   | date         | first forecast day; the history used ends the day before  |
| `horizon_days`    | int          | default 7, allowed 1–90                                   |
| `review_days`     | int          | default 7 (0–90): days an order must last after delivery  |
| `eval_weeks`      | int          | default 8 (1–104): recent weeks the errors were scored on |
| `mase_model`      | numeric(6,4) | MASE of the ML model on those weeks (the headline)        |
| `mase_baseline`   | numeric(6,4) | MASE of the baseline on the same weeks and items          |
| `mape_model`      | numeric(6,4) | hold-out MAPE of the model (fraction)                     |
| `mape_baseline`   | numeric(6,4) | hold-out MAPE of the moving-average baseline              |
| `service_level_z` | numeric(4,2) | default 1.65 (≈ 95% service level)                        |
| `model_uri`       | text         | e.g. `s3://<bucket>/models/lgbm-v1/model.txt`             |
| `items_processed` | int          | ≥ 0                                                       |
| `error_message`   | text         | set when `FAILED`                                         |
| `started_at`      | timestamptz  | default now                                               |
| `finished_at`     | timestamptz  | must be ≥ `started_at`                                    |

## `forecasts` — predicted demand per item per future day

| Column          | Type          | Notes                                                             |
| --------------- | ------------- | ----------------------------------------------------------------- |
| `org_id`        | uuid          | required                                                          |
| `run_id`        | uuid          | → `forecast_runs` (same org). Deleting the run deletes these rows |
| `item_id`       | uuid          | → `items` (same org)                                              |
| `forecast_date` | date          | unique per (`run_id`, `item_id`, `forecast_date`)                 |
| `predicted_qty` | numeric(12,3) | ≥ 0, in the item's `unit`                                         |
| `lower_qty`     | numeric(12,3) | optional confidence band, 0 ≤ lower ≤ predicted                   |
| `upper_qty`     | numeric(12,3) | optional, ≥ predicted                                             |

## `reorder_recommendations` — per item, per run

One row per (`run_id`, `item_id`). These columns also feed the "how this number was
reached" panel, so store the intermediate values, not only the answer.

| Column                 | Type          | Formula / meaning                                                                                                                                                                                                    |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on_hand`              | numeric(12,3) | `items.on_hand` when the run read it                                                                                                                                                                                 |
| `lead_time_days`       | int           | the supplier's `lead_time_days`                                                                                                                                                                                      |
| `avg_daily_demand`     | numeric(12,3) | mean daily demand over the history window                                                                                                                                                                            |
| `demand_std_dev`       | numeric(12,3) | σ of daily demand                                                                                                                                                                                                    |
| `lead_time_demand`     | numeric(12,3) | sum of the daily forecast over the lead-time window                                                                                                                                                                  |
| `safety_stock`         | numeric(12,3) | Z × σ × √(lead time)                                                                                                                                                                                                 |
| `reorder_point`        | numeric(12,3) | lead-time demand + safety stock                                                                                                                                                                                      |
| `shortfall`            | numeric(12,3) | max(0, reorder point − on hand)                                                                                                                                                                                      |
| `review_demand`        | numeric(12,3) | sum of the daily forecast over the review period after the lead time                                                                                                                                                 |
| `order_up_to`          | numeric(12,3) | reorder point + review demand                                                                                                                                                                                        |
| `recommended_qty`      | numeric(12,3) | when below the reorder point: reorder point + forecast over the next 7 days (review period) − on hand, capped by `items.spoilage_cap` when set; otherwise 0. See [`forecasting/README.md`](../forecasting/README.md) |
| `spoilage_cap_applied` | boolean       | true if the cap reduced the quantity                                                                                                                                                                                 |
| `cover_days`           | numeric(8,2)  | on hand ÷ avg daily demand; NULL when demand is 0                                                                                                                                                                    |
| `item_mape`            | numeric(6,4)  | this item's hold-out MAPE (fraction), optional                                                                                                                                                                       |
| `item_mase`            | numeric(6,4)  | this item's MASE on the run's `eval_weeks`; NULL when there's too little history                                                                                                                                     |
| `history_days`         | int           | days of demand history the item had                                                                                                                                                                                  |
| `notes`                | text[]        | plain-English caveats shown under the breakdown (lead time assumed, short history, no recent demand, baseline used for this item)                                                                                    |
| `status`               | enum          | `OK` (on hand ≥ reorder point), `REORDER` (below reorder point), `URGENT` (on hand < lead-time demand: it runs out before a delivery could arrive)                                                                   |

The formulas are implemented and tested in the Python engine
([`forecasting/`](../forecasting), Task 8).

**Error measures:** the forecast page's headline is **MASE** (error ÷ error of "same day last
week"; below 1 beats it), because it works on items with many zero days. `mape_*` and `item_mape`
hold MAPE over days that had demand and are kept for reference; on sparse items MAPE is unstable.

**Which model a run uses (Task 9):** `npm run forecast:publish` scores the LightGBM model
(`lgbm-v1`) and the baseline (`baseline-ma14`) on the same last `eval_weeks` weeks — each week
forecast only from the days before it — and uses whichever has the lower MASE. `model_kind` /
`model_tag` record the winner and `mase_model` / `mase_baseline` both scores. If LightGBM or the
model file is missing, the baseline runs with `is_fallback = true`. Items with under 28 days of
history always use the baseline (with a note).

## Example: what a writer does (Python + psycopg)

The real writer is `write()` in [`forecasting/cafestock_forecast/publish.py`](../forecasting/cafestock_forecast/publish.py)
(pg8000), used by `npm run forecast:publish` and by the nightly Lambda
(`aws_lambda.py`, Task 10), which also holds a PostgreSQL advisory lock per café so two runs never
write the same café at once. In outline:

```python
with conn.transaction():
    run_id = conn.execute(
        """INSERT INTO forecast_runs (org_id, model_tag, model_kind, model_uri)
           VALUES (%s, %s, 'ML', %s) RETURNING id""",
        (org_id, "lgbm-v1", "s3://cafestock-ml/models/lgbm-v1/model.txt"),
    ).fetchone()[0]

    conn.cursor().executemany(
        """INSERT INTO forecasts (org_id, run_id, item_id, forecast_date, predicted_qty, lower_qty, upper_qty)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        [(org_id, run_id, item_id, day, qty, lo, hi) for (item_id, day, qty, lo, hi) in rows],
    )

    # … INSERT INTO reorder_recommendations (…) likewise …

    conn.execute(
        """UPDATE forecast_runs
           SET status = 'SUCCEEDED', finished_at = now(), items_processed = %s,
               mape_model = %s, mape_baseline = %s
           WHERE id = %s""",
        (n_items, 0.164, 0.241, run_id),
    )
```

## Reading side (the API, Task 9)

`GET /api/forecast/latest` (managers only) returns the latest successful run, a count per status,
and per item its recommendation, 7-day forecast and the 28 days of actual demand before
`forecast_from` (days with none as 0), most urgent first. `GET /api/forecast/latest-run` returns
just the run.

"Latest run" means:
`SELECT * FROM forecast_runs WHERE org_id = $1 AND status = 'SUCCEEDED' ORDER BY started_at DESC LIMIT 1`.
The index `forecast_runs(org_id, started_at DESC)` makes this cheap.
