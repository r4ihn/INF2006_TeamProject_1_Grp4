# CafeStock

Stock inventory management for small F&B businesses — INF2006 Cloud Computing & Big Data MVP.

| Folder         | What it is                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `backend/`     | Node.js API — Express 5 + TypeScript + Prisma 7 (PostgreSQL), tested with Vitest                         |
| `frontend/`    | React 19 SPA — Vite + TypeScript, tested with Vitest + Testing Library                                   |
| `docs/`        | Design notes — start with [`data-contract.md`](docs/data-contract.md)                                    |
| `forecasting/` | Python baseline forecast engine (Task 8) — see [`forecasting/README.md`](forecasting/README.md)          |
| `../analytics/`| Demand-model notebook (Task 8b) + the team's analysis (beside `src/`) — see [`analytics/README.md`](../analytics/README.md) |
| `../data/`     | The team's café dataset (beside `src/`) (Kaggle sales → ingredient demand) — see [`docs/dataset.md`](docs/dataset.md)    |

It's one repo with **npm workspaces**: a single `npm install` at the root sets up both apps, and root scripts run them together.

## Progress

- [x] **Task 1** — Project skeleton, local run, lint/format/test tooling, `GET /health`
- [x] **Task 2** — Database schema + migrations (Prisma + PostgreSQL in Docker), demo org seed
- [x] **Task 3** — Suppliers: org-scoped CRUD API + Suppliers page
- [x] **Task 4** — Items catalogue: org-scoped CRUD, supplier-in-same-org rule, archive, filters
- [x] **Task 5** — Stock: deliveries, usage, waste, adjustments, stocktakes, activity log, daily demand history
- [x] **Task 6** — Sign-in: Amazon Cognito (or development sign-in), staff / manager roles, café from the user's account
- [x] **Task 7** — Dataset import: 8 ingredients, 388 days of demand and the stock ledger, with provenance; Stock → History
- [x] **Task 8** — Baseline forecast engine (Python, test-first): 7-day forecasts, reorder recommendations, walk-forward error
- [x] **Task 8b** — ML demand model (LightGBM) + evaluation notebook, compared fairly with the baseline; team analysis merged into `analytics/`
- [x] **Task 9** — Manager forecast page: what to order, why (step-by-step maths), actual vs forecast chart with its likely range; `npm run forecast:publish` picks LightGBM or the baseline by recent error
- [x] **Task 10** — Nightly forecast on AWS: Python Lambda + EventBridge schedule, model from S3, alarms and alert e-mails (SNS), CloudWatch logs, metrics and dashboard — all CloudFormation
- [x] **Task 11** — On AWS: API Gateway (HTTPS) → private load balancer + WAF → Auto Scaling EC2 app servers across two zones → private RDS PostgreSQL (TLS, password in Secrets Manager); forecast Lambda connected; alarms, logs, dashboards — all CloudFormation
- [x] **Task 12** — Submission package: ZIP in the brief's exact layout (`npm run submission`), manifest, evidence records and templates, architecture diagram, threat-control map, smoke test and recorded test runs
- [x] **Task 13** — Staff scheduling: managers plan the week's shifts (who, when, position), see hours per person and copy a week forward; staff see only their own shifts under **My shifts**; nobody can be double-booked
- [ ] …see the implementation plan

## Prerequisites

- **Node.js 24 LTS** (recommended) or 22.12+. Odd-numbered versions (23.x, 25.x) are **not** supported by Prisma and Vitest. Check with `node --version`.
  Get it from <https://nodejs.org> if needed.
- **Python 3.12+** (from Task 8) — for the forecast engine. Windows: install from
  <https://www.python.org/downloads/> and tick **"Add python.exe to PATH"**. Check with
  `py --version` (or `python --version`).
- **Docker Desktop** — runs PostgreSQL for you. See [One-time Docker setup](#one-time-docker-setup-windows).
- **VS Code**. When you open the folder it will suggest the recommended extensions
  (ESLint, Prettier, Vitest, Prisma, EditorConfig) — click **Install All**.

## One-time Docker setup (Windows)

1. Download **Docker Desktop for Windows** from <https://www.docker.com/products/docker-desktop/>
   and run the installer. Keep **"Use WSL 2 instead of Hyper-V"** ticked.
2. Restart Windows if the installer asks. If Docker says WSL needs updating, open PowerShell
   and run `wsl --update`, then start Docker Desktop again.
3. Open **Docker Desktop** and wait until the bottom-left says **Engine running** (green).
   You can skip the sign-in — an account isn't needed.
4. In a VS Code terminal, check it works: `docker --version`

Docker Desktop has to be **running** (whale icon in the system tray) whenever you work on
the project. If you want, turn on _Settings → General → Start Docker Desktop when you sign in_.

## Run it locally (VS Code)

1. **File → Open Folder…** and choose the `cafestock` folder (the one containing this README).
2. Open a terminal: **Terminal → New Terminal** (or <kbd>Ctrl</kbd>+<kbd>`</kbd>).
3. Install dependencies (once, and again whenever `package.json` changes):
   ```bash
   npm install
   ```
4. Start the database, create the tables and add the demo organisation (first time only;
   the first run downloads PostgreSQL, ~1 minute):
   ```bash
   npm run db:setup
   ```
   Then load the café dataset (about 10 seconds, safe to run again):
   ```bash
   npm run db:import
   ```
5. Start both apps:
   ```bash
   npm run dev
   ```
   The browser opens at **http://localhost:5173** on the **Sign in** page — pick
   _Continue as staff_ or _Continue as manager_ (development sign-in, no AWS needed). The
   **System status** tab should show two green rows: **API healthy** and **Database connected**.

Stop the apps with <kbd>Ctrl</kbd>+<kbd>C</kbd>. The database keeps running in Docker in the
background (it uses little memory) — stop it with `npm run db:down` if you like. Next time you
only need `npm run db:up` (if it's stopped) and `npm run dev`.

_(Optional)_ To change settings, copy `backend/.env.example` to `backend/.env`
(PowerShell: `Copy-Item backend/.env.example backend/.env`). The defaults already work.

### What to try (Task 13: staff scheduling)

Sign in as **manager** and open **Roster**. (Run `npm run db:setup` once first: it applies the
new `shifts` table.)

| Try this                                                                            | Expected                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Team** (bottom of the page) → add _Aisha Tan_, `aisha@demo.cafe`                  | She appears with **Not signed in yet**; she can now be given shifts                             |
| Also add _Sam Lee_, `staff@demo.cafe` (the development staff user's email)          | Sam's sign-in links to this entry the first time he signs in                                    |
| **+ Add** under a day → Who: Aisha, Position _Barista_, 09:00–15:00 → **Add shift** | Green notice; the shift sits in that day's column; **Hours this week** shows Aisha 6 h          |
| Add Aisha again that day, 14:00–18:00                                               | Refused next to **Who**: _Aisha Tan is already working 09:00–15:00 on …_                        |
| Add a shift with **Who: Open shift** and tick **Until midnight**                    | An amber **Open shift** card ending 24:00; **Open shifts: 1**                                   |
| Give someone more than 44 hours in the week                                         | **Over 44 h** next to their name (normal weekly hours under Singapore's Employment Act)         |
| **Copy to next week** → **Show that week**                                          | The same shifts one week later; anything that would double-book someone is listed as not copied |
| **Team** → **Remove** someone who has upcoming shifts                               | _Removed … N upcoming shifts are now open._ Their past shifts keep their name                   |
| Give Sam a shift, **Sign out** → **Continue as staff** → **My shifts**              | Only Sam's own shifts; no colleagues, no open shifts, no buttons to change anything             |

#### Scheduling API

| Method & path                                   | Who      | Does                                                                                                                                     |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/shifts?from=&days=`                   | Everyone | A week (default: this week, café time). Managers: every shift + hours per person. Staff: only their own                                  |
| `POST /api/shifts`                              | Managers | `{date, start, end, position, userId, note}`; `end` may be `24:00`; `userId: null` = open shift; 409 `SHIFT_CLASH` if the person is busy |
| `PATCH` / `DELETE /api/shifts/:id`              | Managers | Change or remove a shift (same checks)                                                                                                   |
| `POST /api/shifts/copy-week`                    | Managers | `{from}`: copies that week into the next; skips duplicates and clashes; people who left → open shifts                                    |
| `GET` / `POST /api/team`, `PATCH /api/team/:id` | Managers | The roster's people: add by name + email, rename, remove (their upcoming shifts become open)                                             |

How double-booking is prevented: every change that books someone runs in one transaction that
first locks that person's `users` row (`SELECT … FOR UPDATE`), then checks for an overlapping
shift. Two managers booking the same person at the same moment queue up; one wins, the other
gets the clash message (`backend/tests/db/shifts-api.test.ts`).

### What to try (Task 12: the submission)

The complete step-by-step guide, from a new laptop to the submitted ZIP, is
[`docs/COMPLETE-GUIDE.md`](docs/COMPLETE-GUIDE.md) (part 8 covers the submission).

| Try this                                 | Expected                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run smoke -- http://localhost:3000` | A Markdown report: health, database, 401 for anonymous and forged tokens, security headers (INFO rows = no HTTPS/WAF locally)        |
| `npm run evidence:tests`                 | Runs every suite and saves `evidence/test-runs/<date>/*.txt` + `evidence/test-runs/SUMMARY.md`                                       |
| `npm run submission -- --draft`          | Preflight list (group id, report, "TO FILL" places, secrets, redaction), then `dist/submission/Group_Gxxx_INF2006_Project-DRAFT.zip` |
| `npm run submission -- --group G012`     | The final ZIP, only when nothing is left to fix                                                                                      |

The project folder already has the ZIP layout: the README, manifest, declarations, `tests/`,
`report.pdf`, `evidence/`, `data/` and `analytics/` sit beside this `src/` folder, which is zipped as `src/`.

### What to try (Task 11 demo)

The whole app on AWS, step by step: **[`docs/aws-deploy.md`](docs/aws-deploy.md)** (about 1½
hours in the Learner Lab, ~$1.90/day while running; pause it between sessions). Locally:

| Try this                          | Expected                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run app:build`               | `dist/app/cafestock-app-<hash>.tgz` (~0.5 MB): the built web app + API + migrations + dataset + the server set-up script |
| `npm test`                        | Includes serving the built web app (pages, cached assets, security headers) and `db:import -- --if-empty`                |
| `npm run db:import -- --if-empty` | "Demo Café already has 1 dataset import — nothing to do": how each new AWS server avoids importing twice                 |

On AWS, each new app server downloads the release from S3 and runs `deploy/ec2/bootstrap.sh`:
Node.js 24, `npm ci`, the database password from Secrets Manager, RDS certificates (every
database connection is TLS with the certificate checked), `prisma migrate deploy`, the demo
café (and the dataset, once), then a hardened systemd service. Its log is in CloudWatch
(`/cafestock/app`). In production the API also serves the web app, with a strict
Content-Security-Policy.

### What to try (Task 10 demo)

After updating: `npm install` (nothing else changes locally). The nightly job is the same code
as `npm run forecast:publish`, wrapped as an AWS Lambda function. Try it here first:

| Try this                                                               | Expected                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lambda:invoke`                                                | Runs the handler with the nightly EventBridge event: JSON log lines (`job.started`, `cafe.published`, metric lines), then the result: **Forecast published for 1 café**, lgbm-v1   |
| `npm run lambda:invoke` again                                          | **skipped** — _already published at … (within 60 min)_: a retried or duplicated night doesn't publish twice                                                                        |
| `npm run lambda:invoke -- --force`                                     | Publishes again                                                                                                                                                                    |
| `npm run lambda:invoke -- --self-test --quiet`                         | No database used: forecasts the packaged Task 8b snapshot → **LightGBM (lgbm-v1) 1.088 vs 14-day average 1.126**, Fresh milk 10,562.7 ml over the next 7 days                      |
| `npm run lambda:invoke -- --event forecasting/lambda/events/fail.json` | Fails on purpose (exit code 1) — in AWS this triggers the alarm e-mail                                                                                                             |
| `npm run lambda:build`                                                 | `dist/lambda/forecast-lambda-<hash>.zip`, about 50 MB (161 MB unzipped, limit 250 MB): Linux builds of LightGBM, numpy, scipy + the code + OpenMP                                  |
| `npm run forecast:test`                                                | Includes the Lambda tests: one café failing doesn't stop the others, the one-hour guard, a café already being forecast is skipped, S3 model caching and fallback, credentials, SSL |

**Then deploy it:** follow [`docs/aws-forecast-setup.md`](docs/aws-forecast-setup.md) (about
20 minutes in the Learner Lab, ~$0). You create the S3 bucket and the function with
CloudFormation, run the **self-test** in the Lambda console (same numbers as above), and
trigger a test failure to receive the alarm e-mail. The nightly schedule stays **off** until
Task 11 puts the database on AWS.

| Piece                  | What it does                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `infra/artifacts.yaml` | Private, encrypted, versioned S3 bucket for the Lambda package and the models (old versions kept 30 days)               |
| `infra/forecast.yaml`  | The Lambda (Python 3.13, runs as `LabRole`), EventBridge rule (2:00 am SGT), SNS alert e-mails, alarms, dashboard, logs |
| Lambda handler         | `forecasting/cafestock_forecast/aws_lambda.py` — every café, model from S3, credentials from Secrets Manager (Task 11)  |
| Alarms                 | Any failed run; no forecast in 24 h; urgent items for the demo café (the last two once the database is on AWS)          |

### What to try (Task 9 demo)

After updating: `npm install`, then `npm run db:setup` (adds this step's columns). Python set-up
from Tasks 8 and 8b (`npm run forecast:setup`, `npm run analytics:setup`) is reused.

**1. Put the dataset on recent dates.** The dataset ends on 23 Mar 2025, so a forecast would start
in March 2025. Move it forward by whole weeks so its last day is last Sunday (weekdays stay the
same; your own recorded stock changes are kept):

```bash
npm run db:import -- --shift-to-recent --replace
npm run forecast:publish
```

| Try this                                                        | Expected                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run forecast:publish`                                      | _Forecast from_ the Monday after the history ends; **Moving average, 14 days 1.126 · LightGBM (lgbm-v1) 1.088**; _Used lgbm-v1 (lower MASE)_; **Items 8 · to order: 0** — the dataset's stock is healthy      |
| `npm run dev` → continue as **manager** → **Forecast**          | Three cards: **Items to order 0** (Urgent: 0 \| Reorder: 0 \| OK: 8), **Forecast error (MASE) 1.09** (LightGBM: 1.09 \| 14-day average: 1.13), **Forecast by LightGBM model (lgbm-v1)**                       |
| The table                                                       | 8 items with status in words (and colour), on hand, days of cover, a 4-week + forecast trend line, amount to order                                                                                            |
| Click an item's name                                            | Its chart (4 weeks of actual demand as bars, then 7 forecast days as a line with a shaded likely range) and **How this number was reached**                                                                   |
| Hover the chart, or click it and press ← → (Home / End)         | Reads out the day: _Day: … \| Forecast: … \| Likely range: …_ (or _Actual_ for past days). **Show as a table** lists every day                                                                                |
| **2. Make something run low:** Stock → Record → **Wasted**      | _Fresh milk_ **4500** (note: _Spoiled_) → "Fresh milk \| Waste recorded: 4,500 ml \| On hand now: 1,200 ml". Then _Napkin_ **20** → "On hand now: 45 pcs". _(Wasted lowers stock without counting as demand)_ |
| `npm run forecast:publish` again, then refresh **Forecast**     | **Items to order 2** (Urgent: 1 \| Reorder: 1). Fresh milk first: **Urgent, order 3,639.1 ml**; then Napkin: **Reorder, order 97.4 pcs**                                                                      |
| Fresh milk's breakdown                                          | 1,474.6 ml a day → lead time 1 day: 1,901.2 ml → safety stock 1.65 × 759.9 × √1 = 1,253.8 → reorder point 3,155 → on hand 1,200 (urgent) → order up to 13,717.7 → **limited to the spoilage cap: 3,639.1 ml** |
| Continue as **staff**, open http://localhost:5173/forecast      | "Only managers can see the forecast." — `/api/forecast/latest` answers **403**                                                                                                                                |
| `npm run forecast:publish -- --no-model`                        | Baseline only: the page shows **14-day average (baseline-ma14)**                                                                                                                                              |
| `npm run forecast:publish -- --dry-run`                         | Prints the same summary, saves nothing                                                                                                                                                                        |
| `npm test` · `npm run forecast:test` · `npm run analytics:test` | API: managers only, one café's data only, urgent first, 28 days of history · publish: one transaction, a failed run is recorded, baseline fallback · page: cards, order, breakdown, chart readout             |

Your numbers can differ a little if you recorded other stock changes for these items earlier.
A forecast whose data is more than a week old shows a note saying so, and an item with no demand
for 4+ weeks gets a note asking whether it's still sold.

**How the model is chosen:** each run scores LightGBM and the 14-day average on the last 8 weeks
(each week forecast only from the days before it) and keeps whichever has the lower MASE. If
LightGBM or its model file is missing, the baseline runs and the page says **Fallback**. Items with
under 28 days of history always use the baseline. Details: [`forecasting/README.md`](forecasting/README.md).

**Also in this step (whole app):**

| Where                    | What changed                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top menu, Stock tabs     | The page you're on is filled in the accent colour (brown with white text; light tan with dark text in dark mode), and the Stock tabs sit on an accent line |
| Numbers shown together   | Labelled and separated by pipes: _Total: 12 L \| Average a day: 1.7 L_; when a line wraps, the new line never starts with a pipe                           |
| Stock count, Record form | **−** and **+** are their own buttons outside the box (no arrows inside it); **+** on an empty count starts from the expected amount; − stops at 0         |
| Suppliers → phone        | Digits only — letters are ignored as you type; spaces and a leading **+** are allowed; 8–15 digits (e.g. _+65 6123 4567_). The API checks the same rule    |

#### Forecast API

| Method & path                  | Who          | Does                                                                                                                          |
| ------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/forecast/latest`     | **managers** | Latest successful run, a status count, and per item: recommendation (every step of the maths), 7-day forecast, 28 days actual |
| `GET /api/forecast/latest-run` | **managers** | Just the run: model, baseline, MASE of each, first forecast day                                                               |

### What to try (Task 8b demo)

Needs the Python set-up from Task 8 (`npm run forecast:setup`). No database or AWS is needed —
everything runs from files in the repo.

| Try this                                       | Expected                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run analytics:setup`                      | "Analytics environment ready" — installs LightGBM, numpy, pandas, matplotlib and Jupyter support (pinned, ~2 minutes the first time)                                        |
| `npm run analytics`                            | The comparison over 47 weeks: **baseline MASE 0.827, LightGBM 0.855** (baseline better day by day), weekly WAPE 23.4% vs **21.4%** (model slightly better on weekly totals) |
| `npm run analytics:test`                       | **19 tests OK**: the snapshot equals the dataset, model and baseline are scored on the same days, no future data is used, training is deterministic, results reproduce      |
| Open `analytics/demand_model.ipynb` in VS Code | The narrated notebook with its saved outputs: data provenance, preparation, inputs, results, charts, a worked example, limitations and responsible use                      |
| `npm run analytics:notebook`                   | Reruns the notebook and saves it — the file comes out identical                                                                                                             |
| `npm run analytics:team`                       | Your team's scripts: rebuilds `data/` (same checksums), weekly backtest (MA-2 MASE 0.963), policy replay (service level 91.7% → ~95.5%)                                     |
| `npm run analytics:snapshot`                   | Re-exports the app's demand history to `analytics/snapshots/` (needs the database)                                                                                          |

Method, results and how to reproduce them: [`analytics/README.md`](../analytics/README.md). The test
record in the brief's format: [`evidence/test-data-ai.md`](../evidence/test-data-ai.md).

### What to try (Task 8 demo)

Install **Python 3.12+** first (see [Prerequisites](#prerequisites)), open a **new** terminal,
then run `npm run forecast:setup` once. The database must be running (`npm run db:up`) and have
the dataset imported (`npm run db:import`).

| Try this                                                 | Expected                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run forecast:setup`                                 | "Python forecasting environment ready" (creates `forecasting/.venv`, installs one package)                                                                                                                                                                                   |
| `npm run forecast:test`                                  | **85 tests OK**: reorder formulas against hand-worked numbers, edge cases (no history, zero demand, one day), walk-forward never sees the future, database loading                                                                                                           |
| `npm run forecast`                                       | Forecast from **Mon 24 Mar 2025** (later if you shifted the dates in Task 9), method _Moving average, 14 days [baseline-ma14]_, a table per item (on hand, average a day, next 7 days, safety stock, reorder point, status, order) and each item's error on the last 8 weeks |
| `npm run analytics`                                      | Demand model vs baseline evaluation + final model (Python, Task 8b)                                                                                                                                                                                                          |
| `npm run forecast -- --compare`                          | Every method scored over 47 weeks: **MA-14 has the lowest MASE (0.83)** — 17% less error than "same day last week"                                                                                                                                                           |
| `npm run forecast -- --as-of 2025-03-20`                 | Forecast as if it were 20 March (only earlier history is used)                                                                                                                                                                                                               |
| `npm run forecast -- --json`                             | The same run as JSON                                                                                                                                                                                                                                                         |
| Compare with the team's `restocking_recommendations.csv` | "Next 7 days" matches their `forecast_next_week` for all 8 ingredients (milk 10,460 ml, beans 1,080 g) — a test checks this                                                                                                                                                  |

Method, formulas, results and caveats: [`forecasting/README.md`](forecasting/README.md).

### What to try (Task 7 demo)

After updating, run `npm install`, then `npm run db:setup` (adds this step's table), then
`npm run db:import`. _Optional:_ for a demo with only the dataset's items, first run
`npm run db:reset` to clear what you added while testing earlier steps.

| Try this                                   | Expected                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:import`                        | Reads `data/`, prints each file's rows and checksum, "sales match daily demand", then **8 items created, 3,104 demand rows, 17,049 stock changes** and a per-item table       |
| Run it **again**                           | **0 new, 3,104 unchanged**, ledger skipped (_already imported_) — nothing duplicated                                                                                          |
| `npm run db:import -- --dry-run`           | Same checks and report, "nothing was saved"                                                                                                                                   |
| `npm run dev` → **Stock → History**        | _Where this data came from_ (source, 1 Mar 2024 – 23 Mar 2025, files + checksums), a daily-demand chart, and 388 days of history for each of the 8 items                      |
| Hover the chart, or click it and press ← → | Reads out that day's demand and 7-day average; **Show as a table** gives weekly totals                                                                                        |
| Pick **Cocoa powder** in the table         | Much spikier chart: 64% of days have no demand (a limitation to mention in the report)                                                                                        |
| **Items** page                             | Fresh milk, Espresso beans, … with the dataset's SKUs, costs (S$0.0021 per ml), reorder points and on-hand stock from the ledger (milk 5,700 ml). 3 items are flagged **Low** |
| **Stock → Activity**, pick Fresh milk      | The imported ledger: _Sale #3547 — Latte_ … _By: Dataset import_; deliveries and write-offs are marked _(simulated)_                                                          |
| `npm test`                                 | Import tests: exact row counts, per-item daily series, closing stock, re-run is idempotent, never overwrites app-recorded days, other cafés untouched, broken files refused   |

Where the data came from, how it maps onto the tables, and its limitations:
[`docs/dataset.md`](docs/dataset.md).

#### History API

| Method & path                                          | Who       | Does                                                                         |
| ------------------------------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `GET /api/stock/history`                               | signed in | Per item: days of history, first/last date, average a day, zero days, source |
| `GET /api/stock/demand?itemId=…&days=90&to=2025-03-23` | signed in | Daily demand ending on `to` (default today), up to 731 days                  |
| `GET /api/imports`                                     | signed in | Dataset import runs (provenance), newest first                               |

### What to try (Task 6 demo)

| Try this                                                               | Expected                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open the app                                                           | **Sign in** page. Without Cognito set up it offers _Continue as staff_ / _as manager_                                                                                          |
| Continue as **staff**                                                  | Top right: _Sam (staff) · Demo Café · Staff_. No **Forecast** tab                                                                                                              |
| Go to http://localhost:5173/forecast as staff                          | "Only managers can see the forecast." (the API also answers **403**)                                                                                                           |
| Record a delivery, then **Sign out** and continue as **manager**       | **Forecast** tab appears; Stock → Activity shows the delivery _By: Sam (staff)_                                                                                                |
| Open http://localhost:3000/api/items directly                          | **401** `AUTH_REQUIRED` — every `/api` call needs a signed-in user                                                                                                             |
| Refresh the page                                                       | Still signed in (session kept until the tab closes)                                                                                                                            |
| Set up real accounts: [`docs/cognito-setup.md`](docs/cognito-setup.md) | Login page switches to email + password; first sign-in asks for a new password                                                                                                 |
| `npm test`                                                             | Tests with real signed tokens: manager reaches the manager route, staff **403**, missing / forged / expired / wrong-client tokens **401**, café taken from the Cognito account |

#### How sign-in works

- **Cognito mode** (when `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` are set in
  `backend/.env`): the web app signs in directly with Amazon Cognito and sends the access
  token as `Authorization: Bearer …`. The API verifies it with AWS's `aws-jwt-verify`
  (signature, expiry, issuer, `token_use=access`, `client_id`).
- **Roles** come from Cognito groups on every request: `manager` (everything + forecast)
  or `staff` (suppliers, items, stock). Nobody else gets in.
- **Café (tenant)** comes from the user's Cognito attribute `custom:org` (default: Demo
  Café) and is stored on their `users` row — never from anything the browser sends.
- **Development mode** (no Cognito settings): the API signs Cognito-shaped tokens with its
  own key and checks them with the same verifier. Refuses to run with `NODE_ENV=production`.
- Full setup and design notes: [`docs/cognito-setup.md`](docs/cognito-setup.md);
  CloudFormation template: [`infra/cognito.yaml`](infra/cognito.yaml) (Lite plan, $0).

#### Auth API

| Method & path                     | Who                          | Does                                                        |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `GET /auth/config`                | anyone                       | How to sign in (`mode`, Cognito region / pool / client ids) |
| `POST /auth/dev/login` `{ role }` | anyone, dev mode only        | A token for the staff or manager dev user                   |
| `GET /api/me`                     | signed in                    | The user (email, name, role) and their café                 |
| `GET /api/forecast/latest-run`    | **managers**                 | Latest successful forecast run (see Task 9)                 |
| every other `/api/…`              | signed in (staff or manager) | 401 without a valid token                                   |

### What to try (Task 5 demo)

Set-up: have a few items (Task 4). Then on the **Stock** page:

| Try this                                                                         | Expected                                                                                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Record** → _Delivery received_ → pick _Whole milk_, `24`, note `Invoice #4411` | "Recorded delivery of 24 L — Whole milk now 24 L"                                                                                       |
| **Record** → _Used_ → `6.5`                                                      | Now 17.5 L. This usage is demand the forecast learns from                                                                               |
| **Record** → _Wasted_ → `50`                                                     | Refused: "Only 17.5 L on hand" — stock can never go negative                                                                            |
| **Stock count** → type `15` next to Whole milk                                   | Difference shows **−2.5 L used / missing** live                                                                                         |
| **Save count**                                                                   | "Recorded as used: 2.5 L Whole milk" — a count's shortfall is unlogged usage                                                            |
| **Activity** → pick _Whole milk_                                                 | Every change, newest first, plus **Daily usage** (9 L today = 6.5 used + 2.5 shortfall)                                                 |
| **Items** page                                                                   | On-hand numbers and **Low** badges now reflect real stock; click a number to see its history                                            |
| `npm test`                                                                       | Includes a test where 12 people record usage **at the same moment** against 10 L — exactly 10 succeed, stock ends at 0, nothing is lost |

**What counts as demand** (the forecast's input): recorded usage, plus shortfalls found by
stock counts (usage nobody logged). Deliveries, waste, manual adjustments and counts that
find _extra_ stock are not demand. Demand is booked on the café's calendar day
(Asia/Singapore), even for changes recorded just after midnight.

**How stock stays correct:** each change runs in one database transaction that locks the
item's row, updates `items.on_hand`, appends an `inventory_movements` row with the new
total, and adds to `demand_history` — all saved together or not at all. A stocktake of many
items is one transaction too.

#### Stock API

| Method & path                                     | Does                                                                                | Success                          | Errors                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| `POST /api/stock/movements`                       | `{ itemId, type: RECEIVE\|USAGE\|WASTE\|ADJUSTMENT, quantity, note?, occurredAt? }` | 201 with before / change / after | 400 invalid, 409 not enough stock or archived item |
| `POST /api/stock/counts`                          | `{ counts: [{ itemId, counted }], note?, occurredAt? }` — all or nothing            | 201 with each item's change      | 400, 409                                           |
| `GET /api/stock/movements?itemId=&type=&limit=50` | Change log, newest first                                                            | 200                              |                                                    |
| `GET /api/stock/demand?itemId=&days=14`           | Daily demand, zero-filled, with total and average                                   | 200                              | 404                                                |

### What to try (Task 4 demo)

| Try this                                                                        | Expected                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Suppliers** → add 2–3 suppliers first (e.g. _Bean Bros_, 3 days)              | They appear in the Items form's _Supplier_ list                                                               |
| **Items** → **+ Add item**: name, category, unit, supplier, cost, reorder point | Row appears with a red **Low** badge (new items start at 0 on hand)                                           |
| Add an item with cost `-3`, or `1.005`, or no category                          | Messages under those fields; nothing saved                                                                    |
| Type category `dairy` when `Dairy` exists                                       | Saved as `Dairy` — categories never split by capitalisation                                                   |
| Search `cof`, pick a category, pick a supplier                                  | List filters instantly; **Clear filters** resets                                                              |
| **Suppliers** page → click a supplier's item count                              | Opens Items filtered to that supplier                                                                         |
| **Archive** an item → **Undo**                                                  | Hidden, then back. Archived items keep their history; tick **Show archived** to see/restore/delete them       |
| `npm test`                                                                      | Includes tests proving an item can't use another café's supplier (400) and cafés can't see each other's items |

#### Items API

| Method & path                                                       | Does                                                              | Success | Errors                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| `GET /api/items?search=&category=&supplierId=&includeArchived=true` | List (by category, then name), with `supplier`, `isLow`           | 200     |                                                                |
| `GET /api/items/categories`                                         | Categories in use                                                 | 200     |                                                                |
| `GET /api/items/:id`                                                | One item                                                          | 200     | 404                                                            |
| `POST /api/items`                                                   | Create — `name`, `category`, `unit` required; starts at 0 on hand | 201     | 400 invalid / other café's supplier, 409 duplicate name or SKU |
| `PATCH /api/items/:id`                                              | Change fields; `{ "isActive": false }` archives                   | 200     | 400, 404, 409                                                  |
| `DELETE /api/items/:id`                                             | Delete (only if it has no stock/forecast history)                 | 204     | 404, 409 → archive instead                                     |

Money is sent as numbers with up to 2 decimals, quantities with up to 3 (e.g. `2.5` kg).
`onHand` can't be set here — only stock counts and deliveries change it (Task 5).

### What to try (Task 3 demo)

| Try this                                                           | Expected                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **+ Add supplier**, fill in a name and lead time, **Add supplier** | Green "Added …" message; the supplier appears in the table (A–Z)                   |
| Add one with no name, or email `oops`, or lead time `-1`           | Red messages under those fields; nothing is saved                                  |
| Add a second supplier with the **same name**                       | "A supplier with this name already exists" under _Name_                            |
| **Edit** a supplier, change the lead time, **Save changes**        | Table updates                                                                      |
| **Delete** → **Delete**                                            | Asks first; then removed                                                           |
| Narrow the browser window (or phone-size in DevTools)              | Table turns into one card per supplier                                             |
| Open http://localhost:3000/api/suppliers                           | The same data as JSON (the API the page uses)                                      |
| `npm test`                                                         | Includes tests proving one café can't see, edit or delete another café's suppliers |

#### Suppliers API

All routes act for **one organisation** (for now always _Demo Café_; from Task 6 the
logged-in user's). Errors always look like `{ "error": { "code", "message", "fields"? } }`.

| Method & path                    | Does                                                        | Success | Errors                          |
| -------------------------------- | ----------------------------------------------------------- | ------- | ------------------------------- |
| `GET /api/suppliers?search=bean` | List (A–Z, with `itemCount`)                                | 200     |                                 |
| `GET /api/suppliers/:id`         | One supplier                                                | 200     | 404                             |
| `POST /api/suppliers`            | Create — only `name` required, `leadTimeDays` defaults to 2 | 201     | 400 invalid, 409 duplicate name |
| `PATCH /api/suppliers/:id`       | Change only the fields sent                                 | 200     | 400, 404, 409                   |
| `DELETE /api/suppliers/:id`      | Delete                                                      | 204     | 404, 409 still has items        |

### What to try (Task 2 demo)

| Try this                                         | Expected                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:studio`                              | Prints a link (e.g. `http://localhost:51212`) — <kbd>Ctrl</kbd>+click it to browse every table; **Demo Café** is in _Organization_ |
| Open http://localhost:3000/health/ready          | `{"status":"ok","database":"up",…}`                                                                                                |
| `npm run db:down`, then **Re-check** on the page | API still green, **Database unreachable** in red                                                                                   |
| `npm run db:up`, then **Re-check**               | Both green again                                                                                                                   |
| `npm test`                                       | All tests pass, including ones that prove rows without a valid `org_id` are rejected                                               |

To see the raw tables without Prisma Studio, use Docker's built-in `psql`:

```bash
docker exec -it cafestock-db psql -U cafestock -d cafestock -c "\dt" -c "SELECT * FROM organizations;"
```

## Database commands

| Command                    | What it does                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run db:up`            | Start PostgreSQL (Docker) and wait until it's ready                                               |
| `npm run db:down`          | Stop it — your data is kept                                                                       |
| `npm run db:setup`         | `db:up` + apply all migrations + seed. Safe to re-run                                             |
| `npm run db:migrate`       | **After editing `schema.prisma`**: creates a new migration and applies it                         |
| `npm run db:seed`          | Add the demo data (idempotent)                                                                    |
| `npm run forecast`         | Baseline forecast + reorder recommendations for the demo café (Python, Task 8)                    |
| `npm run forecast:publish` | Forecast with the better of LightGBM / baseline and save it for the **Forecast** page (Task 9)    |
| `npm run lambda:invoke`    | Run the nightly Lambda handler locally (`-- --self-test`, `-- --dry-run`, `-- --force`) (Task 10) |
| `npm run lambda:build`     | Build the Lambda's deployment package in `dist/lambda/` (Task 10)                                 |
| `npm run app:build`        | Build the web app + API release for the AWS servers in `dist/app/` (Task 11)                      |
| `npm run db:import`        | Load the café dataset from `data/` (idempotent; `-- --help` for options)                          |
| `npm run db:studio`        | Browse and edit data in the browser (Prisma Studio)                                               |
| `npm run db:reset`         | Drop everything in the dev database, re-apply migrations, re-seed                                 |
| `npm run db:wipe`          | Stop the container **and delete its data volume** (next `db:setup` starts fresh)                  |

PostgreSQL listens on **localhost:5433** (not the default 5432, so it can't clash with a
PostgreSQL you installed for another module). User / password / database: `cafestock`.

### How the schema is organised

- Every business table has a required **`org_id`** (→ `organizations`). One org for the demo;
  multiple cafés later without changing the tables.
- Links between tables include `org_id` too (composite foreign keys), so the **database**
  refuses e.g. an item that points at another café's supplier, even if the API had a bug.
- CHECK constraints reject impossible values (negative stock, negative lead times, …).
- `shifts` belong to a café and (optionally) a person in the same café — also a composite key.
  A CHECK keeps every shift between 15 minutes and 16 hours long.
- The forecast tables are the contract with the Python Lambda:
  [`docs/data-contract.md`](docs/data-contract.md).

## Tests, lint, format

```bash
npm test              # all tests (needs the database: npm run db:up)
npm run test:unit     # only tests that don't need the database
npm run lint          # ESLint across the repo
npm run format        # Prettier: rewrite files
npm run typecheck     # TypeScript, no emit
npm run check         # everything above, the way CI would run it
npm run forecast:test # the Python forecast engine's tests (Task 8)
npm run analytics:test # the demand model's tests (Task 8b)
```

Database tests run against a **separate `cafestock_test` database** that is wiped and rebuilt
from the migrations on every run, so they never touch your dev data. They also double as the
"migrations apply cleanly" check.

In VS Code, the **Testing** panel (flask icon, from the Vitest extension) lists every
test with a ▶ button next to each, and files are auto-formatted on save.

### Debugging the API

**Run and Debug** panel (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>) → **Debug API (backend)** → ▶.
Set breakpoints in `backend/src/**/*.ts`. (Stop `npm run dev` first so port 3000 is free.)

## How the pieces talk

```
Browser ──► Vite dev server :5173 ──(proxy /health, /api)──► Express API :3000 ──► PostgreSQL :5433 (Docker)
```

The frontend always calls **relative** URLs (`/health`, later `/api/suppliers`…). In
development Vite forwards them to the API; in AWS the load balancer will do the same
job, so the frontend code doesn't change between environments.

- `GET /health` — _liveness_: is the Node process up? Never touches the database, so the AWS
  load balancer won't restart healthy servers just because the database blipped.
- `GET /health/ready` — _readiness_: can this server reach the database?

## Project layout

```
cafestock/
├─ package.json            # workspaces + root scripts (dev, test, db:*)
├─ docker-compose.yml      # local PostgreSQL 17
├─ docker/postgres-init/   # creates the cafestock_test database on first start
├─ docs/data-contract.md   # forecast tables shared with the Python Lambda
├─ docs/cognito-setup.md   # Amazon Cognito set-up (Learner Lab) + how sign-in works
├─ docs/aws-forecast-setup.md # deploying the nightly forecast Lambda (Learner Lab)
├─ docs/aws-deploy.md      # deploying the whole app on AWS, step by step (Task 11)
├─ docs/COMPLETE-GUIDE.md  # everything from a new laptop to the submitted ZIP (for teammates)
├─ submission/             # ZIP-root files: README, project_manifest.yaml, declarations, tests/README
├─ evidence/               # test records, architecture diagram, threat-control map, screenshots
├─ deploy/ec2/             # app server set-up: bootstrap.sh, systemd unit, CloudWatch agent, logrotate
├─ docs/dataset.md         # the café dataset: provenance, mapping, checks, limitations
├─ data/                   # the team dataset, byte-for-byte (see DATA_DICTIONARY.md)
├─ forecasting/            # Python forecast engine (Task 8), publish (Task 9), nightly Lambda (Task 10)
├─ analytics/              # demand-model notebook (Task 8b) + the team's analysis scripts
├─ evidence/               # test records for the submission (e.g. test-data-ai.md)
├─ scripts/py.mjs          # runs the Python parts the same way on Windows / macOS / Linux
├─ scripts/build-app.mjs   # `npm run app:build`: the release file for the AWS servers
├─ scripts/smoke-test.mjs  # `npm run smoke`: repeatable checks against local or AWS
├─ scripts/record-tests.mjs # `npm run evidence:tests`: dated test output as evidence
├─ scripts/package-submission.mjs # `npm run submission`: the submission ZIP + preflight
├─ infra/cognito.yaml      # CloudFormation: user pool, staff/manager groups, web client
├─ infra/artifacts.yaml    # CloudFormation: S3 bucket for the Lambda package and models
├─ infra/forecast.yaml     # CloudFormation: forecast Lambda, nightly rule, alarms, SNS, dashboard
├─ infra/network.yaml      # CloudFormation: VPC, subnets, VPC endpoints, security groups
├─ infra/database.yaml     # CloudFormation: RDS PostgreSQL 17 + Secrets Manager password
├─ infra/app.yaml          # CloudFormation: API Gateway, load balancer + WAF, Auto Scaling app servers
├─ eslint.config.js · .prettierrc.json · .vscode/
├─ backend/
│  ├─ prisma.config.ts     # Prisma CLI config (DB URL, migrations, seed)
│  ├─ prisma/
│  │  ├─ schema.prisma     # ← the data model
│  │  ├─ migrations/       # SQL applied in order (commit these!)
│  │  └─ seed.ts
│  ├─ src/
│  │  ├─ app.ts            # createApp(): middleware + routes (no port — testable)
│  │  ├─ server.ts         # starts the HTTP server, loads .env, graceful shutdown
│  │  ├─ config.ts         # reads environment variables
│  │  ├─ db/               # Prisma client, seed data, Postgres error helpers
│  │  ├─ generated/        # Prisma client code — generated by `npm install`, not committed
│  │  ├─ http/             # error responses, organisation context (tenant) middleware
│  │  ├─ validation/       # zod schemas for request bodies
│  │  ├─ auth/             # token verification, sign-in modes, roles, user provisioning
│  │  ├─ services/stock.ts # the one place stock levels change (locking, demand)
│  │  ├─ services/demand.ts # per-item demand history summary
│  │  ├─ import/           # reads + checks the dataset, writes it in one transaction
│  │  ├─ cli/              # `npm run db:import`
│  │  ├─ lib/dates.ts      # café-calendar-day helpers (time zones)
│  │  └─ routes/           # health, suppliers, items, stock, imports, …
│  └─ tests/
│     ├─ unit/             # no database needed
│     └─ db/               # real PostgreSQL (cafestock_test)
└─ frontend/
   ├─ vite.config.ts       # dev proxy + test config
   └─ src/
      ├─ api.ts            # API client
      ├─ App.tsx           # top bar, navigation, routes
      ├─ SystemStatus.tsx
      ├─ auth/             # AuthProvider, LoginPage, Cognito client, session (+ tests)
      ├─ forecast/         # ForecastPage, ForecastChart, Breakdown (managers only, Task 9)
      ├─ stock/            # StockPage: CountSheet, RecordForm, Activity, History + chart (+ tests)
      ├─ items/            # ItemsPage, ItemForm, validation (+ tests)
      ├─ suppliers/        # SuppliersPage, SupplierForm, validation (+ tests)
      ├─ components/       # shared form Field
      └─ test/             # test helpers, fake suppliers API
```

## Updating to a newer version

Each step ships a new `setup-cafestock.mjs`. Put it in the folder that _contains_
`cafestock/` and run `node setup-cafestock.mjs`. It overwrites the project files, removes
files that are no longer part of the project, and copies anything it replaces or removes into
`cafestock/.backups/<date>/` first. It never touches `node_modules` or your `.env` files.
Then run `npm install` again (dependencies may have changed).

## Troubleshooting

- **"Python 3.11+ wasn't found"** (`npm run forecast:setup`) — install Python from python.org with
  "Add python.exe to PATH" ticked, then open a **new** VS Code terminal. If typing `python` opens the
  Microsoft Store, that's Windows' placeholder; the installer from python.org fixes it.
- **"Run `npm run forecast:setup` first"** — `npm run forecast` needs the Python environment
  (`forecasting/.venv`). Tests can run without it but skip the database tests.
- **`npm run forecast:test` says "OK (skipped=2)"** — the 6 database tests (in 2 groups) didn't run;
  the lines under _Skipped_ say why. Usually Docker isn't running (`npm run db:up`), or
  `npm run forecast:setup` hasn't been run yet. (The test database's tables are created
  automatically.) `npm run forecast:test -- -v` lists every test.
- **"Run `npm run analytics:setup` first"** — the analytics commands need LightGBM and friends;
  that command installs them into the same Python environment (once).
- **The notebook in VS Code asks for a kernel** — choose _Python Environments…_ →
  `forecasting/.venv`. (Install the recommended Jupyter extension if VS Code offers it.)
- **`npm run forecast` says it can't reach the database** — start it with `npm run db:up`.

- **`npm run db:import` says "There's no organisation demo-cafe"** — run `npm run db:setup` first.
- **"Import stopped: …"** — the message names the file, line and problem, and nothing was saved.
  The dataset in `data/` must stay as the analytics script wrote it; if the team regenerates it,
  copy the new files in and run `npm run db:import -- --replace`.
- **Stock → History is empty** — run `npm run db:import`, then refresh the page.

- **Login page says "Development sign-in" but I set up Cognito** — check both
  `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` are filled in `backend/.env`, then restart
  `npm run dev`. The terminal prints which sign-in mode is active.
- **"Incorrect email or password" with Cognito** — the account must exist in the
  `cafestock-users` pool; an admin can reset the password in the Cognito console.
- **"Your account has no role yet"** — add the user to the `staff` or `manager` group in
  the Cognito console, then sign in again.

- **`npm run db:up` fails with "error during connect" / "The system cannot find the file
  specified" / "docker is not recognized"** — Docker Desktop isn't running (or isn't
  installed). Start it, wait for **Engine running**, try again. If you just installed it,
  close and reopen VS Code so the terminal picks up the `docker` command.
- **`Bind for 0.0.0.0:5433 failed: port is already allocated`** — something else uses port 5433. Change `'5433:5432'` in `docker-compose.yml` to e.g. `'5434:5432'`, and put the same
  port in `DATABASE_URL` / `TEST_DATABASE_URL` in `backend/.env`.
- **"…tables are missing. Run: npm run db:setup"** (on the page, in the terminal, or as a
  503 from the API) — the database is running but was never set up. Run `npm run db:setup`
  (safe to repeat).
- **"Database unreachable" on the page** — run `npm run db:up`. If it's up, check the
  `[api]` lines in the terminal.
- **Tests fail with "Cannot reach the test database"** — same fix: `npm run db:up`. If you
  created the container before Task 2 existed, run `npm run db:wipe` then `npm run db:setup`.
- **`Cannot find module '../generated/prisma/client.js'`** — the Prisma client wasn't
  generated. Run `npm run db:generate -w backend` (or `npm install` again).
- **Blank or white page at localhost:5173** — the page reports its own startup errors in a
  red box. If you still see nothing, press <kbd>F12</kbd> → **Console**. Also try a hard
  refresh (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).
- **`Port 5173 is already in use`** — another dev server is running. Stop it
  (<kbd>Ctrl</kbd>+<kbd>C</kbd> in its terminal) and run `npm run dev` again.
- **`EADDRINUSE: address already in use :::3000`** — something else is on port 3000
  (maybe an old `npm run dev`). Close other terminals, or set `PORT=3001` in
  `backend/.env` _and_ start the frontend with `API_PROXY_TARGET=http://localhost:3001`.
- **`Unsupported engine` / odd syntax errors on install** — Node is too old; install 22 LTS or newer.
- **`npm warn install-scripts … not covered by allowScripts`** — npm 12+ asks before
  running packages' setup scripts. The three this project needs (Prisma, esbuild) are
  approved in `package.json` → `allowScripts`, so you shouldn't see this any more.
- **Windows: `npm` scripts blocked in PowerShell** — run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use the
  Command Prompt terminal profile.
