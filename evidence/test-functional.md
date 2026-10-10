# Test 1 — Functional workflow: record stock and see it everywhere it matters

| **Date** | 2026-10-01 |
| **Run by** | Jason Woo |
| **Environment** | AWS deployment (stack `cafestock-app`, AppUrl `https://g87sf7fcc6.execute-api.us-east-1.amazonaws.com/`) + local automated tests |

## Objective

A cafe worker signs in, records a delivery and a stock count, and the new stock level, the
activity log and the manager's reorder forecast all reflect it. This is the service's core
workflow, and the one the reorder forecast depends on. Second part: the manager rosters a
staff member, and the shift appears in that person's own **My shifts** view.

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
7. As **manager** → **Roster** → **Team**: add your staff user with the e-mail their Cognito
   account uses. **+ Add** under tomorrow → Who: that person, Position _Barista_, 09:00–15:00 →
   **Add shift**. Screenshot the week (`functional-6-roster.png`).
8. Add the same person again that day, 14:00–18:00 → refused with _… is already working
   09:00–15:00 on …_. Screenshot (`functional-7-clash.png`).
9. Sign in as that **staff** user → **My shifts**: the shift is there. Screenshot
   (`functional-8-my-shifts.png`).

## Expected result

- Smoke test completes successfully with all checks passing.
- Recording a 2,000 ml Fresh milk delivery increases its on-hand quantity by exactly 2,000 ml and displays a success confirmation.
- Saving a Napkin stock count adjusts the recorded stock to the counted value and records the difference correctly.
- The Activity page shows both the Fresh milk delivery and the Napkin stock-count adjustment, including the staff user who performed them.
- Entering an invalid negative quantity such as `-5` is rejected and no stock movement is saved.
- After rerunning the forecast Lambda, the Forecast page shows a newer update time and reflects the latest Fresh milk on-hand quantity.
- A manager can create a `Barista` shift for the staff user from 09:00–15:00, and the shift appears in the weekly roster.
- Attempting to create an overlapping shift for the same staff member on the same day is rejected and the second shift is not saved.
- When the staff user signs in, the created shift appears in `My shifts` with the correct date, time, position and duration.

## Actual Results

Step 1:
Fresh milk | Delivery recorded: 2,000 ml | On hand now: 7,701 ml

Step 2:
Delivery: Fresh milk increased from 5,701 ml to 7,701 ml after recording a 2,000 ml delivery with note `Invoice 1001`.

Step 3:
Stock count: Napkin was counted at 5 pieces fewer than expected. The count was saved successfully and the system recorded 5 pcs Napkin as used.

Step 4:
Activity log: the Fresh milk delivery of +2,000 ml and the Napkin stock-count adjustment of -5 pcs both appeared in the activity log and were attributed to `staff@gmail.com`.

Step 5:
Forecast: after running `cafestock-forecast`, the Forecast page reflected the updated inventory state. Fresh milk showed an on-hand quantity of 7,701 ml, matching the 2,000 ml delivery recorded earlier.

Step 6:
Roster: the manager successfully added the staff user as `Barista` on 7 Oct 2026 from 09:00–15:00. The shift appeared in the weekly roster and contributed 6 hours for the staff member.

Step 7:
Clash prevention: attempting to add another shift for the same staff member on 7 Oct 2026 was rejected. The system displayed `staff is already working 09:00–15:00 on Wed 7 Oct.` and did not allow the overlapping shift to be saved.

Step 8:
My shifts: after signing in as the staff user, the 09:00–15:00 Barista shift for Wed 7 Oct appeared correctly in `My shifts`, with a duration of 6 hours.

## Automated coverage (repeatable offline)

`npm run evidence:tests` runs the backend API tests with a real database. They cover stock
movements, counts, validation (400) and the activity log, in
`src/backend/tests/db/stock-api.test.ts`, `items-api.test.ts` and `suppliers-api.test.ts`;
scheduling in `shifts-api.test.ts` (including "a shift created by the manager appears in the
employee's own view", with real development sign-in).
The web-app tests (`src/frontend/src/**/*.test.tsx`) cover the same workflow in the browser UI.
Results: `evidence/test-runs/SUMMARY.md`.

## Artefacts

- `evidence/smoke-aws.md`
- `evidence/test-runs/SUMMARY.md`
- `evidence/screenshots/functional-*.png`
