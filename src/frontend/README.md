# CafeStock frontend

React + TypeScript single-page app (Vite). It talks to the CafeStock API in `../backend`.

## Screens

- **Sign in**: paste an access token (development). In the cloud this is replaced by Cognito's hosted sign-in.
- **Stock**: current stock derived from the ledger, with "Reorder now" and "expired stock" flags and a low-stock filter.
- **Record a movement**: receive delivery, record usage/sale (earliest-expiry batch first, or pick one), and, for managers only, write off spoilage or make a stocktake adjustment. Errors from the API (for example "Only 55 in stock") are shown as-is.
- **Reorder plan** (managers only): suggested orders in whole supplier packs from the analytics forecast, recomputed against live stock, with how the number is worked out and how reliable it is, including where the forecast is weak.
- **Recent movements**: the ledger, newest first, with who recorded each entry.

Staff accounts see the manager-only movement types greyed out. That is a convenience only: the API enforces the permissions.

## Run it

Start the API first (see `../backend/README.md`), then:

```bash
cd src/frontend
cp .env.example .env     # VITE_API_URL, default http://localhost:3000
npm ci
npm run dev              # http://localhost:5173
```

Sign in with a token from the backend:

```bash
cd ../backend && npm run --silent token -- manager     # or: staff
```

The API only accepts browser requests from `CORS_ORIGIN` (default `http://localhost:5173`).
The token is kept in `sessionStorage`, so it is forgotten when the tab closes.

## Checks

```bash
npm test          # component tests with a mocked API
npm run lint
npm run typecheck
npm run build
```
