# Dataset

CafeStock's demand history, stock ledger and forecast evaluation all come from one dataset: a
real coffee shop's point-of-sale export, turned into the ingredients a café actually stocks.

## Source and licence

| | |
| --- | --- |
| **Name** | Coffee Sales Dataset — Navjot Kaushal, Kaggle |
| **URL** | https://www.kaggle.com/datasets/navjotkaushal/coffee-sales-dataset |
| **File used** | `raw/Coffe_sales.csv` (original spelling kept) — 3,547 drink sales, 1 Mar 2024 – 23 Mar 2025, one shop |
| **Licence** | TO FILL — open the URL, read the **License** shown on the dataset page and write it here. If it doesn't allow redistribution, delete `raw/` from the submission and keep only the derived files below with this URL as the source. |
| **Personal data** | None. Each row is a time, a payment type (cash/card), an amount and a drink name — no customer names, card numbers or identifiers. |

## Files

| File | Rows | What it is | SHA-256 (first 12) |
| --- | ---: | --- | --- |
| `raw/Coffe_sales.csv` | 3,547 | The Kaggle export, unchanged | `d8879243233c` |
| `ingredients.csv` | 8 | The 8 stocked ingredients: unit, cost, shelf life, supplier lead time, pack size | `9a8b65785d32` |
| `recipes.csv` | 36 | How much of each ingredient one drink uses (e.g. a latte: 18 g beans, 220 ml milk, cup, lid, napkin) | `3bd26ffce7a9` |
| `daily_demand.csv` | 3,104 | Ingredient demand per day: 8 ingredients × 388 days (days without sales are 0) | `b6e6e39bc7b1` |
| `stock_movements.csv` | 17,049 | Stock ledger: sales (from the export) plus **simulated** deliveries, write-offs and stocktakes | `faf5a21d5fb1` |
| `weekly_demand.csv` | 448 | Weekly totals, used by the team's weekly analysis | `61c60af83ffc` |
| `validation_report.txt` | — | The generator's own checks (ledger never negative, totals match) | — |
| `DATA_DICTIONARY.md` | — | Every column of every file, and how the files were derived | — |

All derived files are produced by `analytics/build_ledger.py` from `raw/Coffe_sales.csv`,
byte-identically on every run (fixed seed 2006). Check with `npm run analytics:team` (from `src/`).

## How the app uses it

- `npm run db:import` (from `src/`) loads the ingredients, the daily demand and the ledger into
  the database for the Demo Café. It checks that sales add up to the daily demand, and records
  provenance (file names, row counts, checksums) in the `dataset_imports` table. The app shows
  this under **Stock → History → Where this data came from**.
- `--shift-to-recent` moves every date forward by whole weeks, so the history ends in the last
  week and a forecast starts from today. The shift is recorded, and weekdays are unchanged.
- On AWS, the first app server imports it this way automatically.
- The demand model (`analytics/`) is trained and evaluated on a frozen snapshot of the same
  history (`analytics/snapshots/demand_2025-03-23.csv`).

## Limitations

- **One shop, one year:** patterns may not carry over to other cafés.
- **Recipes are assumptions:** the export records drinks, and recipes turn them into
  ingredients. Real recipes vary by barista and cup size.
- **Simulated deliveries and wastage:** they make the ledger realistic. They are not observed
  data, and the forecast is only evaluated on demand, which *is* observed.
- **Sparse items:** cocoa powder has no demand on 64% of days, which limits any daily forecast
  (see `DATA_DICTIONARY.md` and `analytics/README.md`).
