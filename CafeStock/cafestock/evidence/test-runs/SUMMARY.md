# Automated test runs

Recorded 2026-10-07 14:25 UTC with `npm run evidence:tests`.
Environment: Windows_NT 10.0.26200 · Node.js v24.16.0 · Python ?

| Command | What it covers | Result | Tests | Time | Full output |
| --- | --- | --- | --- | --- | --- |
| `npm run check` | Formatting, lint, type checks, backend + frontend tests | PASS | 277/277 passed; 123/123 passed | 77 s | [2026-10-07/check.txt](2026-10-07/check.txt) |
| `npm run forecast:test` | Python forecast engine, publish, Lambda handler | PASS | 85 ran, OK | 12 s | [2026-10-07/forecast-test.txt](2026-10-07/forecast-test.txt) |
| `npm run analytics:test` | Demand model (LightGBM) evaluation and reproducibility | PASS | 19 ran, OK | 25 s | [2026-10-07/analytics-test.txt](2026-10-07/analytics-test.txt) |

All suites passed.

Where the tests are: `src/backend/tests/` (API + database), `src/frontend/src/**/*.test.tsx`
(web app), `src/forecasting/tests/` (forecast engine, Lambda), `src/analytics/tests/` (ML model).
