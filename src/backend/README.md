# CafeStock backend

Express + TypeScript API over PostgreSQL. Stock is held as an **append-only ledger of movements**;
current stock is always derived from it, never stored (see `project-requirements.md`, sections 1 and 5).

## Run it locally

Needs Node 22+ and PostgreSQL 16 (any recent version should work).

```bash
# one-off: create a role and two databases (dev + test)
psql -U postgres -c "CREATE USER cafestock WITH PASSWORD 'cafestock' CREATEDB;"
psql -U postgres -c "CREATE DATABASE cafestock OWNER cafestock;"
psql -U postgres -c "CREATE DATABASE cafestock_test OWNER cafestock;"

cd src/backend
cp .env.example .env          # database, auth and CORS settings
npm ci
npm run db:migrate            # apply migrations/*.sql
npm run db:seed               # load the demo dataset from ../../data (add -- --reset to wipe and reload)
npm run dev                   # http://localhost:3000
```

Tests use the separate `cafestock_test` database (override with `TEST_DATABASE_URL`) and refuse to
run against any database whose name does not end in `_test`:

```bash
npm test
npm run lint
npm run typecheck
```

## Data model (`migrations/001_init.sql`)

| Table / view | Purpose |
|---|---|
| `suppliers`, `products` | Catalogue. Products carry unit, shelf life, reorder threshold and supplier. |
| `stock_movements` | The ledger. Signed `quantity`; types `RECEIVE` (+), `SELL` (−), `SPOILAGE` (−), `ADJUST` (±). Every row belongs to a `batch_id`, which carries the expiry date. |
| `batch_stock` (view) | Remaining quantity per batch. |
| `current_stock` (view) | On hand per product, low-stock flag, earliest expiry, quantity already past expiry. |

Rules enforced **in the database**, so they hold for every writer and not only this API:

- **Append-only**: `UPDATE`/`DELETE` on `stock_movements` are rejected. Fix mistakes with an `ADJUST`.
- **No negative stock**, per product and per batch.
- **Concurrency**: a movement that removes stock locks the product row first, so simultaneous sales
  queue up and each one sees the previous one's result. Two sales can never spend the same stock.
- Sign must match the type, a batch is created by exactly one `RECEIVE`, stock cannot be received already
  expired, and non-`RECEIVE` rows must reference an existing batch.

## Authentication and roles

Every route except `GET /health` needs `Authorization: Bearer <token>`. There are two roles, carried in
the token's `cognito:groups` claim:

| Role | Can do |
|---|---|
| `staff` | Read everything; record `RECEIVE` and `SELL` movements. |
| `manager` | Everything staff can, plus `SPOILAGE` write-offs and `ADJUST` stocktake corrections. |

Both environments use the same verifier and the same claims, selected by `AUTH_MODE` (there is no
default, so the API will not start unprotected):

- `local`: tokens signed with `AUTH_LOCAL_SECRET`; mint one with `npm run token -- staff` or
  `npm run token -- manager [--sub alice] [--ttl 3600]`. Needs no cloud account, so anyone can reproduce
  the security tests. Refused when `NODE_ENV=production`.
- `cognito`: tokens are Cognito **access** tokens, verified against the user pool's published keys
  (RS256, issuer and app client checked). Set `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`.

```bash
TOKEN=$(npm run --silent token -- manager)
curl -H "Authorization: Bearer $TOKEN" localhost:3000/stock
```

Responses: `401` missing/invalid/expired token (`WWW-Authenticate: Bearer`), `403` valid token but no
role, or a staff user attempting a manager-only movement. Each movement records who made it
(`recordedBy`). Every request gets an `X-Request-Id` and produces one JSON log line; failed logins and
denied actions are logged with a reason but never the token or request body.

## API

All bodies are JSON; errors look like `{ "error": "CODE", "message": "..." }`.

| Method & path | Notes |
|---|---|
| `GET /health` | Liveness. |
| `GET /suppliers`, `GET /products`, `GET /products/:id` | Catalogue. |
| `GET /products/:id/batches` | Batches with stock remaining, earliest expiry first. |
| `GET /stock[?lowOnly=true]` | Derived current stock; `isLow` means strictly below `reorderThreshold`. |
| `GET /movements[?productId&movementType&beforeId&limit]` | Ledger, newest first, cursor paging with `beforeId`. |
| `POST /movements` | Record a movement (below). |
| `GET /recommendations` | **Manager only.** The reorder plan: the analytics run's forecast and safety stock per item, plus a suggested order recomputed from stock as it is now (see below). |

`POST /movements` body: `{ productId, movementType, quantity, batchId?, expiryDate?, reason? }`

- `quantity` is a positive amount for `RECEIVE`, `SELL` and `SPOILAGE` (the API applies the sign). For
  `ADJUST` it is signed: positive adds stock, negative removes it.
- `RECEIVE`: batch id is generated (`B000253`, ...) and expiry defaults to today + the product's shelf life.
- `SELL` without `batchId` uses first-expiry-first-out and may produce several ledger rows.
- `SPOILAGE` and `ADJUST` require `batchId` and `reason`.
- `SPOILAGE` and `ADJUST` need a manager token (403 otherwise).
- The server sets the timestamp, `source: "app"` and `recordedBy`; clients cannot back-date or forge provenance.

Responses: `201 { movements: [...], onHand }`, `400` validation, `404` unknown product,
`409` insufficient stock, `422` unknown batch / already expired / constraint violation.

## Reorder recommendations

The analytics work produced a weekly forecast per ingredient (moving average of the last two complete weeks),
a safety stock (1.65 x the spread of the last 8 weeks) and a suggested order. The seed loads those published
results from `data/restocking_recommendations.csv` into `forecast_runs` / `reorder_recommendations`, together
with the headline evaluation (`method_comparison*.csv`, `policy_comparison.csv`).

`GET /recommendations` returns the forecast and safety stock as published, and **recomputes the order quantity
against live stock** with the same rule (`src/analytics/reorder.ts`):

```
need  = forecast x cover weeks + safety stock
packs = ceil(max(0, need - on hand) / pack size), at most half a shelf life's worth of forecast sales
```

`tests/reorder.test.ts` feeds that rule the analytics team's inputs and checks it reproduces their published order
for every ingredient (this is the data/AI validation test), plus hand-checkable cases. The forecast itself is not
recomputed here; it is as of the last day of sales history (`run.asOf`, 23 Mar 2025 for the demo data).

## Demo data

`../../data/` holds the synthetic ledger produced by the data/analytics work (real sales expanded through
recipes into ingredient movements, plus simulated deliveries, spoilage and stocktakes; see
`data/DATA_DICTIONARY.md`). Suppliers do not exist in that dataset, so the seed invents three marked "(demo)".
