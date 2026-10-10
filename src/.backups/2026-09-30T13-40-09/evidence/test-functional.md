# Test 1 — Functional workflow: record stock and see it everywhere it matters

|                 |                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- |
| **Date**        | TO FILL (YYYY-MM-DD)                                                                               |
| **Run by**      | TO FILL (name)                                                                                     |
| **Environment** | AWS deployment (stack `cafestock-app`, AppUrl redacted as `<app-address>`) + local automated tests |

## Objective

A café worker signs in, records a delivery and a stock count, and the new stock level, the
activity log and the manager's reorder forecast all reflect it. This is the service's core
workflow, and the one the reorder forecast depends on.

## Setup

- The AWS deployment from `src/docs/aws-deploy.md` parts A–G, including the dataset import
  (Demo Café, 8 ingredients).
- One Cognito user in the **staff** group and one in **manager**.
- Automated tests: `npm run evidence:tests` (see `evidence/test-runs/SUMMARY.md`).

## Steps

1. `npm run smoke -- <AppUrl> --out evidence/smoke-aws.md` → saves the smoke-test report.
2. Open the AppUrl and sign in as **staff**. **Stock → Record delivery / usage** →
   _Delivery received_, item **Fresh milk**, quantity **2000**, note `Invoice 1001` → **Record
   delivery**. Screenshot the green notice (`evidence/screenshots/functional-1-delivery.png`).
3. **Stock → Stock count** → type a count for **Napkin** (e.g. 5 fewer than expected) → **Save
   count**. Screenshot the notice (`functional-2-count.png`).
4. **Stock → Activity** → Fresh milk shows the delivery _By: <staff name>_; Napkin shows the
   count. Screenshot (`functional-3-activity.png`).
5. Try invalid input: quantity **-5** → the form refuses it with a message. Screenshot
   (`functional-4-validation.png`).
6. Sign in as **manager** → **Lambda** console → `cafestock-forecast` → Test
   `{"orgs": ["demo-cafe"], "force": true}` → **Forecast** page: new "Updated" time, and Fresh
   milk's **On hand** includes the delivery. Screenshot (`functional-5-forecast.png`).

## Expected result

- Smoke test: every check PASS.
- The notices show the new on-hand values (delivery: +2,000 ml).
- The activity log records both changes with the staff member's name.
- Negative quantities are rejected, both in the browser and by the API (400).
- The forecast run uses the new on-hand value.

## Actual result

TO FILL — what happened at each step, with the numbers you saw. Paste the smoke test's summary
line, e.g. "10 passed, 0 failed".

## Automated coverage (repeatable offline)

`npm run evidence:tests` runs the backend API tests with a real database. They cover stock
movements, counts, validation (400) and the activity log, in
`src/backend/tests/db/stock-api.test.ts`, `items-api.test.ts` and `suppliers-api.test.ts`.
The web-app tests (`src/frontend/src/**/*.test.tsx`) cover the same workflow in the browser UI.
Results: `evidence/test-runs/SUMMARY.md`.

## Artefacts

- `evidence/smoke-aws.md`
- `evidence/test-runs/SUMMARY.md`
- `evidence/screenshots/functional-*.png`
