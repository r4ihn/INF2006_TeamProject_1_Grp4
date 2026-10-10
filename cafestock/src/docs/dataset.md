# The café dataset and how it is imported (Task 7)

CafeStock's demand history comes from the team's data/analytics work, kept in [`data/`](../../data)
exactly as the analytics script wrote it. `npm run db:import` loads it into one café
(organisation). This page records where the data came from, what is in it, how it maps onto
the app's tables, and what it can't tell us.

## Provenance

|                     |                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**          | Kaggle coffee-shop point-of-sale export, [`data/raw/Coffe_sales.csv`](../../data/raw/Coffe_sales.csv): 3,547 real drink sales from a single shop                                                                                   |
| **Date range**      | 1 March 2024 – 23 March 2025 (388 days)                                                                                                                                                                                         |
| **Derivation**      | The team's `build_ledger` script (fixed seed 2006, byte-identical output) expands each drink sale through a recipe table into the ingredients it uses, then simulates deliveries, spoilage and stocktakes around the real sales |
| **What is real**    | Every sale: its time, the drink, the price and the payment method                                                                                                                                                               |
| **What is made up** | Recipe quantities (e.g. a latte = 220 ml milk), unit costs, shelf lives, pack sizes, storage locations, deliveries, write-offs and stocktake corrections                                                                        |
| **Licence**         | ⚠️ Still to be confirmed on the Kaggle dataset page before submission (see the team's `DATA_DICTIONARY.md`)                                                                                                                     |
| **Full details**    | [`data/DATA_DICTIONARY.md`](../../data/DATA_DICTIONARY.md): every field, where it comes from, and the limitations                                                                                                                  |

Every import run also stores its own provenance in the `dataset_imports` table: the source text,
each file's name, row count, columns and **SHA-256 checksum**, the date range, any date shift, and
what the run changed. The app shows the latest run under **Stock → History → Where this data came
from**, and `GET /api/imports` returns all of them.

## Files used

| File                  | Rows   | Imported into                                                      |
| --------------------- | ------ | ------------------------------------------------------------------ |
| `ingredients.csv`     | 8      | `items` (+ one supplier per lead time)                             |
| `daily_demand.csv`    | 3,104  | `demand_history` — 388 days × 8 ingredients, zeros included        |
| `stock_movements.csv` | 17,049 | `inventory_movements` — the stock ledger (skip with `--no-ledger`) |

`recipes.csv`, `weekly_demand.csv` and `raw/Coffe_sales.csv` are kept for the analytics work
(Tasks 8/8b) but not imported.

## How it maps onto the app

**Items** (`ingredients.csv`)

| Dataset field                                      | Item field    | Note                                                                                                            |
| -------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `ingredient_name`, `sku`                           | name, SKU     | Existing items are matched by SKU, then by name (any case), and never changed                                   |
| `storage_location`                                 | category      | Chiller, Dry Store 1, Dry Store 2 — the dataset's only grouping                                                 |
| `unit`                                             | unit          | `g`, `ml`; `unit` becomes `pcs`                                                                                 |
| `unit_cost`                                        | unit cost     | Up to 4 decimals (milk is S$0.0021/ml), which is why Task 7 widened the column                                  |
| `reorder_threshold`                                | reorder point | The dataset's own static low-stock trigger for the app                                                          |
| `shelf_life_days` × `avg_daily_demand_derived` ÷ 2 | spoilage cap  | The dataset's ordering rule: never buy more than half a shelf life's worth of demand (rounded down)             |
| `lead_time_days`                                   | supplier      | No supplier names in the data: a _Chilled goods supplier_ (1 day) and _Dry goods supplier_ (3 days) are created |

**Daily demand** (`daily_demand.csv`) → one `demand_history` row per item per day with
`source = IMPORT`, pointing at the import run that wrote it.

**Stock ledger** (`stock_movements.csv`) → `inventory_movements`, in time order, with running
totals. `SELL` → **Used**, `RECEIVE` → **Delivery**, `SPOILAGE` → **Wasted**, `ADJUST` →
**Adjusted**. Notes read _Sale #12 — Latte_, and simulated rows end in _(simulated)_. Times are the
café's local time (Asia/Singapore). The item's **on hand** becomes the ledger's closing balance,
matching `current_stock` in the team's `restocking_recommendations.csv` (e.g. milk 5,700 ml,
beans 1,559 g).

## Checks before anything is written

The import refuses the dataset, and saves nothing, if:

- a file is missing, lacks a required column, or has an unreadable value (the message names the
  file, line and column);
- an ingredient id is unknown, or an item/day appears twice;
- a movement's sign doesn't fit its type (e.g. a negative delivery);
- the ledger ever takes an item **below zero**;
- the ledger's **sales don't add up to `daily_demand.csv`** for every item and day. This check is
  what ties the demand history back to real transactions: all 3,104 item-days match exactly.

## Running it again

Re-running is safe (idempotent), and every run is recorded, so imports are versioned:

- Items that already exist are reused, not duplicated or changed.
- Demand days with the same value are left alone; changed values are updated, and the report says
  how many of each.
- Days the café recorded in the app (`source = MOVEMENTS`) are **never** overwritten.
- The ledger is only added for items with no stock history yet. Items already imported, or already
  being tracked in the app, are skipped and listed in the report.
- `--replace` first removes earlier imported demand and ledger rows. It refuses if the app recorded
  stock changes on top of an imported ledger, because removing the ledger would break those items'
  stock history.

## Options

```bash
npm run db:import                         # real dates, into the demo café
npm run db:import -- --dry-run            # check and report, save nothing
npm run db:import -- --shift-to-recent    # move dates forward so the history ends this week
npm run db:import -- --help               # all options (--dir, --org, --source, --no-ledger, --replace)
```

**Real dates or shifted?** By default the dataset keeps its real dates (ending 23 March 2025), which
is the honest choice for evaluating a model. `--shift-to-recent` moves every date forward by whole
weeks, so weekdays and the weekly pattern are unchanged, until the history ends in the last seven
days. The live demo then looks current, and usage recorded today continues the same series. The
shift is recorded with the import and shown in the app. Switching between the two needs
`--replace`.

## Limitations

From the team's data dictionary, and worth stating in the report:

- **Recipe quantities are estimates.** The sales are real; ingredient amounts per drink are not
  measured, and all ingredient demand inherits that assumption.
- **Deliveries, spoilage and stocktakes are simulated**, so a forecast is partly scored on a
  process whose rules are known. Expect real-world accuracy to be worse.
- **One shop, one year**: seasonality can't be separated from one-off events. Demand roughly
  doubles between March and October 2024.
- **Sparse items**: cocoa powder (64% of days with no demand), drinking chocolate (60%) and 8 oz
  cups (42%) are hard to forecast day by day. Stock → History shows each item's share of such days.
- **Seven days have no sales at all** (including 3–6 May 2024). They appear as zero demand, and
  whether the shop was closed can't be told from the data.
- The dataset has no supplier names, so the two suppliers are placeholders. Rename them on the
  Suppliers page if you like.
