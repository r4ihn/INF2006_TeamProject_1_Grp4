# CafeStock — stock inventory for small F&B businesses

INF2006 Cloud Computing and Big Data, Team Project 1 (Group 4).

**Problem.** Small food-and-beverage businesses lack a reliable, real-time view of stock, which leads to stockouts,
spoilage and "phantom stock". CafeStock gives a single-location café one source of truth: an immutable stock-movement
ledger (current stock is always derived, never overwritten), batch and expiry tracking, low-stock flags, and an
interpretable reorder recommendation built from a moving-average demand forecast.

> **Project status and full context for contributors (human or AI agent): [`docs/implementation-plan.md`](docs/implementation-plan.md).**
> Read it first: it records what is built, the decisions taken, how the work maps to the assessment brief, and the
> ordered list of what remains (AWS deployment, resilience, monitoring, evidence, report).

## Status

Working locally: ledger database and API, JWT authentication with `staff` / `manager` roles, web UI, manager-only reorder plan.
Not yet done: cloud deployment, scalability mechanism, monitoring, evidence and report. See the plan.

## Quick start (local)

Needs Node 22+ and PostgreSQL 16 (or Docker).

```bash
docker run -d --name cafestock-pg -p 5432:5432 -e POSTGRES_USER=cafestock \
  -e POSTGRES_PASSWORD=cafestock -e POSTGRES_DB=cafestock postgres:16
docker exec cafestock-pg createdb -U cafestock cafestock_test

cd src/backend && cp .env.example .env && npm ci
npm run db:migrate && npm run db:seed
npm run dev                                   # API on http://localhost:3000

cd ../frontend && cp .env.example .env && npm ci
npm run dev                                   # UI on http://localhost:5173
```

Sign in by pasting a token from `cd src/backend && npm run --silent token -- manager` (or `staff`).
Run the tests with `npm test` in `src/backend` (91 tests) and `src/frontend` (31 tests).
Details: [`src/backend/README.md`](src/backend/README.md), [`src/frontend/README.md`](src/frontend/README.md).

## Technology

React 19 + Vite + TypeScript · Node.js 22 + Express 5 + TypeScript · PostgreSQL 16 (SQL migrations, `pg`) ·
zod validation · JWT (`jose`; Amazon Cognito in the cloud) · Vitest + Supertest + Testing Library.
Target cloud: AWS (EC2 Auto Scaling behind an ALB, RDS, Cognito, S3, Secrets Manager, CloudWatch).

## Known limitations

- Demo data only: sales are from a public coffee-shop export; recipes, deliveries, spoilage, pack sizes and shelf lives are simulated.
- The forecast is a static moving average as of 23 Mar 2025; only the stock part of the reorder calculation is live.
- Not yet deployed; the Cognito sign-in path has not been exercised against a real user pool.

## TODO for the submission package

Team members and student IDs, architecture diagram (`evidence/architecture.png`), and the remaining items in the plan.
