# CafeStock — the complete guide

From an empty laptop to the deployed app on AWS and the submitted ZIP: every step of all 12
tasks, in order. Written so a teammate who didn't build it can reproduce all of it.

You need two files:

1. **`setup-cafestock.mjs`**, which creates (or updates) the whole project folder.
2. **This guide.**

> Conventions: commands go in the **VS Code terminal** (PowerShell on Windows), inside the
> `cafestock` folder unless stated. **Expected** tells you what you should see. If you don't
> see it, check [Troubleshooting](#10-troubleshooting) before carrying on.

---

## Contents

0. [What CafeStock is and what you'll end up with](#0-what-cafestock-is-and-what-youll-end-up-with)
1. [Install the tools (once)](#1-install-the-tools-once)
2. [Create the project (Task 1)](#2-create-the-project-task-1)
3. [Run it locally (Tasks 1–5, 7, 13)](#3-run-it-locally-tasks-15-7-13)
4. [The forecast and the ML model (Tasks 8, 8b, 9)](#4-the-forecast-and-the-ml-model-tasks-8-8b-9)
5. [AWS part 1: Learner Lab and Cognito sign-in (Task 6)](#5-aws-part-1-learner-lab-and-cognito-sign-in-task-6)
6. [AWS part 2: the nightly forecast Lambda (Task 10)](#6-aws-part-2-the-nightly-forecast-lambda-task-10)
7. [AWS part 3: the whole app on AWS (Task 11)](#7-aws-part-3-the-whole-app-on-aws-task-11)
8. [Evidence, report and the submission ZIP (Task 12)](#8-evidence-report-and-the-submission-zip-task-12)
9. [Costs and pausing AWS](#9-costs-and-pausing-aws)
10. [Troubleshooting](#10-troubleshooting)
11. [Command reference](#11-command-reference)

---

## 0. What CafeStock is and what you'll end up with

**The problem:** small cafés run out of milk on busy mornings, or bin spoiled stock after
quiet weeks, because stock is tracked on paper and reordered by feel.

**CafeStock:**

- Staff record deliveries, usage, waste and stock counts.
- Every night a demand forecast tells the manager what to order, how much, and why.
- The forecast is a LightGBM model, checked against a 14-day moving average.

**Roles:** **staff** manage suppliers, items and stock. **Managers** can do that and also see
the forecast.

| Layer    | Technology                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app  | React 19 + Vite (`frontend/`)                                                                                                                      |
| API      | Node.js 24, Express 5, Prisma 7, zod validation (`backend/`)                                                                                       |
| Database | PostgreSQL 17: Docker locally, Amazon RDS on AWS                                                                                                   |
| Forecast | Python: forecast engine (`forecasting/`), LightGBM model (`analytics/`)                                                                            |
| Sign-in  | Amazon Cognito (a development sign-in locally)                                                                                                     |
| AWS      | API Gateway, load balancer + WAF, EC2 Auto Scaling, RDS, Lambda, EventBridge, S3, Secrets Manager, CloudWatch, SNS — all CloudFormation (`infra/`) |

**At the end you'll have:**

- the app running on your laptop;
- the app running on AWS with HTTPS and a nightly forecast;
- the evidence collected;
- `Group_Gxxx_INF2006_Project.zip`, ready to submit.

**Time:** about 1 hour for the laptop, 2–2½ hours for AWS (mostly waiting), and 1–2 hours for
evidence and packaging, plus the report.

---

## 1. Install the tools (once)

Windows instructions; macOS notes in brackets.

1. **Node.js 24 LTS**
   - Download it from <https://nodejs.org> ("LTS") and install with the defaults.
   - Open a **new** terminal and run `node --version`. Expected: `v24.x.x`. 22.12 or newer
     also works; **odd** versions (23, 25) do **not**.
2. **Docker Desktop:** it runs the local database.
   1. Download it from <https://www.docker.com/products/docker-desktop/> and install it. Keep
      **Use WSL 2** ticked.
   2. Restart Windows if asked. If Docker says WSL needs updating, run `wsl --update` in
      PowerShell and start Docker Desktop again.
   3. Open Docker Desktop and wait for **Engine running** (bottom left). You can skip the
      Docker sign-in.
   4. Check it in a terminal with `docker --version`.
   5. Docker Desktop must be **running** whenever you use the project.
3. **Python 3.12 or newer:** needed for the forecast and the ML model.
   - Download it from <https://www.python.org/downloads/>.
   - In the installer, **tick "Add python.exe to PATH"**.
   - Check it in a new terminal with `py --version` (macOS: `python3 --version`).
   - If typing `python` opens the Microsoft Store, that's Windows' placeholder: use the
     installer from python.org.
4. **VS Code:** <https://code.visualstudio.com>. When you open the project it offers the
   recommended extensions (ESLint, Prettier, Vitest, Prisma, EditorConfig): click
   **Install All**. For the notebook, also install **Python** and **Jupyter**.
5. **AWS Academy Learner Lab:** you need access through the course (Canvas → AWS Academy →
   Learner Lab). Only needed from part 5.

---

## 2. Create the project (Task 1)

1. Make a folder for it, e.g. `D:\cafeStock`, and put **`setup-cafestock.mjs`** in it.
2. In VS Code: **File → Open Folder… → `D:\cafeStock`**, then **Terminal → New Terminal**.
3. Run:
   ```bash
   node setup-cafestock.mjs
   ```
   **Expected:** `CafeStock … — created D:\cafeStock\cafestock`, a list of new files, then
   `Next: cd cafestock then npm install then npm run dev`.
4. **File → Open Folder… → `D:\cafeStock\cafestock`**. Always work in this folder from now
   on, and open a new terminal there.
5. Install everything (takes a few minutes the first time):
   ```bash
   npm install
   ```
   **Expected:** `added … packages` and `found 0 vulnerabilities`. Warnings are fine; errors
   aren't.

> **Updates:** when a teammate sends a newer `setup-cafestock.mjs`, run it the same way, from
> `D:\cafeStock` or from inside `cafestock`. It updates only changed files and backs up the old
> versions in `cafestock/.backups/`. Then run `npm install` again.
> If you see "Missing script", the update wasn't applied to the folder you're in.

---

## 3. Run it locally (Tasks 1–5, 7, 13)

### 3.1 Start the database and load the dataset (Tasks 2 and 7)

With Docker Desktop running:

```bash
npm run db:setup     # first time: downloads PostgreSQL 17 (~1 min), creates tables, adds "Demo Café"
npm run db:import    # loads the café dataset: 8 ingredients, 388 days of demand, the stock ledger
```

**Expected (`db:import`):**

- Each file's rows and checksum, then `sales match daily demand`.
- Then `8 items created, 3,104 new` demand rows and `17,049 stock changes added`.
- Then a table per item.

Running it again changes nothing ("unchanged", "already imported").

> The dataset keeps its real dates (1 Mar 2024 – 23 Mar 2025). For the forecast demo, part 4.3
> moves them to recent weeks.

### 3.2 Start the app

```bash
npm run dev
```

The browser opens at **http://localhost:5173** (open it yourself if it doesn't).

- **Sign in:** choose **Continue as manager**. This is a development sign-in with no
  password; Cognito comes in part 5.
- Stop the app with <kbd>Ctrl</kbd>+<kbd>C</kbd>. Next time you only need `npm run db:up` (if
  Docker was restarted) and `npm run dev`.

### 3.3 Check each feature

| Task | Try this                                                                                                                  | Expected                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | Link **System status** at the bottom of any page                                                                          | Two green rows: **API healthy**, **Database connected**                                            |
| 3    | **Suppliers → + Add supplier**: fill a name and lead time → **Add supplier**                                              | Green "Added …" notice with a **×** to close it; the supplier appears in the table                 |
| 3    | Add a supplier with phone `abc` or `123`                                                                                  | Letters can't be typed; a short number says "Enter 8 to 15 digits, e.g. +65 6123 4567"             |
| 3    | Add a second supplier with the **same name**                                                                              | "A supplier with this name already exists"                                                         |
| 4    | **Items**                                                                                                                 | The 8 dataset items (Fresh milk, Espresso beans…) with costs, on-hand stock and **Low** badges     |
| 4    | **Items → + Add item** with no name                                                                                       | Red message under the field; nothing saved                                                         |
| 5    | **Stock → Record delivery / usage** → Delivery received, Fresh milk, quantity with the **+** button → **Record delivery** | "Fresh milk \| Delivery recorded: … \| On hand now: …", with a **×** to close it                   |
| 5    | Quantity `-5`                                                                                                             | "Enter a number more than 0"                                                                       |
| 5    | **Stock → Stock count**: type a count for one item → **Save count**                                                       | "Saved count for 1 item \| Recorded as used: …"                                                    |
| 5    | **Stock → Activity**, pick Fresh milk                                                                                     | Your delivery, _By: Mia (manager)_, and the imported ledger (_Sale #… — Latte_)                    |
| 7    | **Stock → History**                                                                                                       | _Where this data came from_ (source, dates, files and checksums), a daily chart, 388 days per item |
| 6    | Sign out → **Continue as staff**                                                                                          | No **Forecast** tab. Going to `/forecast` shows "Only managers can see the forecast."              |
| 13   | **Roster** → Team: add a person → **+ Add** under a day → give them a shift                                               | The shift in that day's column; **Hours this week** counts it (full walk-through: 3.5)             |
| UI   | Any page                                                                                                                  | The current tab is filled in the accent colour                                                     |

### 3.5 Staff scheduling (Task 13)

Managers plan who works when; staff see only their own shifts. Signed in as **manager**:

1. **Roster → Team** (bottom of the page): add _Aisha Tan_ `aisha@demo.cafe` and _Sam Lee_
   `staff@demo.cafe`. Both show **Not signed in yet** (Sam is the development staff user; his
   sign-in links to this entry the first time he signs in).
2. **+ Add** under tomorrow: Who **Aisha Tan**, Position **Barista**, 09:00–15:00 →
   **Add shift**. **Expected:** a green notice, the card in that column, _Aisha Tan 6 h_ under
   **Hours this week**.
3. Add Aisha again the same day, 14:00–18:00. **Expected:** refused under **Who**:
   _Aisha Tan is already working 09:00–15:00 on …_ Nothing is saved.
4. Add a shift with **Who: Open shift** and **Until midnight** ticked. **Expected:** an amber
   **Open shift** card ending 24:00, and **Open shifts: 1**.
5. Give Sam a shift, then **Copy to next week** → **Show that week**. **Expected:** the same
   shifts a week later.
6. **Sign out → Continue as staff → My shifts.** **Expected:** only Sam's shifts; no one
   else's, no open shifts and no buttons to change anything.
7. _(Optional)_ **Team → Remove** someone with upcoming shifts. **Expected:** _N upcoming
   shifts are now open_; their past shifts keep their name.

On AWS the same works once the new release is deployed (7.9); the server applies the new
`shifts` table by itself when it starts. On AWS, add people with the **same e-mail as their
Cognito user** so their first sign-in links them.

### 3.4 Run the automated tests

```bash
npm run check
```

**Expected:** formatting, lint and type checks pass, then **277** backend tests and **123**
web-app tests pass. The database must be running, because the tests use their own database.

---

## 4. The forecast and the ML model (Tasks 8, 8b, 9)

### 4.1 Python set-up (once)

```bash
npm run forecast:setup    # "Python forecasting environment ready" (creates forecasting/.venv)
npm run analytics:setup   # installs LightGBM, numpy, pandas, matplotlib, Jupyter (~2 min)
```

### 4.2 Forecast engine and ML evaluation (Tasks 8 and 8b)

| Command                                        | Expected                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run forecast:test`                        | `Ran 85 tests … OK`: reorder maths, no future data, publishing, the Lambda handler                                        |
| `npm run forecast`                             | A forecast table per item, starting the day after the history ends                                                        |
| `npm run analytics:test`                       | `Ran 19 tests … OK`                                                                                                       |
| `npm run analytics`                            | Over 47 weeks: **14-day average MASE 0.827, LightGBM 0.855**; weekly WAPE 23.4% vs **21.4%**. Writes `analytics/outputs/` |
| `npm run analytics:team`                       | The team's weekly analysis scripts (rebuilds `data/` byte-identically)                                                    |
| Open `analytics/demand_model.ipynb` in VS Code | The narrated notebook with its results, charts and limitations                                                            |

MASE is the forecast's error divided by the error of "same day last week", so below 1 beats
that simple rule. Method and results: `analytics/README.md`.

### 4.3 The manager's Forecast page (Task 9)

1. Move the dataset to recent dates, then save a forecast run:
   ```bash
   npm run db:import -- --shift-to-recent --replace
   npm run forecast:publish
   ```
   **Expected:**
   - `Moving average, 14 days 1.126` and `LightGBM (lgbm-v1) 1.088`, then `Used lgbm-v1 (lower MASE)`.
   - `Items 8 · to order: 0`, because the dataset's stock is healthy.
2. `npm run dev` → **Continue as manager** → **Forecast**:
   - three cards: Items to order, Forecast error (MASE), Forecast by;
   - a table of all 8 items;
   - a chart and a step-by-step breakdown for the selected item.
3. **Make something run low.** In **Stock → Record**, choose **Wasted** and record Fresh milk
   **4500**, then Napkin **20**. Run `npm run forecast:publish` again and refresh.
   **Expected:** **Items to order 2**. Fresh milk is **Urgent, order 3,639.1 ml** (reduced to
   the spoilage cap). Napkin is **Reorder, order 97.4 pcs**.

> If `forecast:publish` says the database "hasn't been updated for this version", run
> `npm run db:setup` first.

---

## 5. AWS part 1: Learner Lab and Cognito sign-in (Task 6)

### 5.1 Using the Learner Lab

- **Start:** Canvas → Learner Lab → **Start Lab**. Wait until the dot next to "AWS" turns
  **green** (1–2 minutes), then click **AWS** to open the console.
- **Region:** always **N. Virginia (us-east-1)** (top right of the console).
- **Budget:** the page shows **Used $x of $50**. A session lasts 4 hours. When it ends, EC2
  servers stop but **RDS databases keep running** (part 9).
- **Permissions:** you can't create IAM roles. The templates use the lab's `LabRole` and
  `LabInstanceProfile`. **CloudFront isn't allowed** in this lab; the templates use API
  Gateway instead.

### 5.2 Create the sign-in (Cognito) stack

1. **CloudFormation** → **Create stack** → **With new resources (standard)** → **Upload a
   template file** → `infra/cognito.yaml` → **Next**.
2. Stack name `cafestock-cognito`, keep `AppName = cafestock` → **Next** → **Next** →
   **Submit**. Wait for **CREATE_COMPLETE** (about 1 minute).
3. **Outputs:** note **UserPoolId** (e.g. `us-east-1_AbC123xyz`) and **ClientId**.

### 5.3 Create users

**Cognito** → **User pools** → `cafestock-users`. For each person (at least one **manager**
and one **staff**):

1. **Users** → **Create user**.
   - Invitation: _Don't send an invitation_. Tell them the password yourself.
   - Email: e.g. `manager@yourteam.example`. Tick **Mark email address as verified**.
   - Temporary password: set one, at least 10 characters with lower-case letters and a number
     (e.g. `Welcome2026x`).
   - Click **Create user**.
2. **Groups** → **manager** (or **staff**) → **Add user to group** → pick the user → **Add**.

The first sign-in asks for a new password.

### 5.4 (Optional) Use Cognito locally

1. Copy `backend/.env.example` to `backend/.env` (PowerShell:
   `Copy-Item backend/.env.example backend/.env`).
2. Set `COGNITO_USER_POOL_ID=` and `COGNITO_CLIENT_ID=` to the stack's outputs.
3. Restart `npm run dev`. The terminal says `Sign-in: Amazon Cognito (…)`, and the login page
   asks for an email and password.
4. To go back to the development sign-in, put `#` in front of those two lines.

**Never** share or submit `backend/.env`.

---

## 6. AWS part 2: the nightly forecast Lambda (Task 10)

### 6.1 On your laptop

```bash
npm run db:up                                   # if it isn't running
npm run lambda:invoke -- --self-test --quiet    # "Self-test passed: LightGBM (lgbm-v1) 1.088 vs 14-day average 1.126"
npm run lambda:build                            # builds the Lambda package (~50 MB)
```

**Expected (`lambda:build`):**

- `Package dist/lambda/forecast-lambda-xxxxxxxxxxxx.zip`, about **50 MB**.
- On Windows, "Local check skipped" is normal.

**Write down the file name.** Also check that `dist/lambda/latest.json` says
`"rdsBundle": true`. If it says `false`, run the build again while online: part 7 needs it.

### 6.2 S3 bucket (CloudFormation)

1. **CloudFormation → Create stack** → `infra/artifacts.yaml`, stack name
   `cafestock-artifacts` → **Submit**.
2. When it's CREATE_COMPLETE: **Outputs → BucketName** (e.g.
   `cafestock-artifacts-123456789012-us-east-1`).

### 6.3 Upload the package and the model

**S3** → your bucket:

1. **Create folder** `lambda` → open it → **Upload** → the `forecast-lambda-….zip` file.
2. At the top level: **Create folder** `models` → open it → **Upload → Add folder** →
   `analytics/models/lgbm-v1`.

You should end up with `lambda/forecast-lambda-….zip`, `models/lgbm-v1/model.txt` and
`models/lgbm-v1/model.json`.

### 6.4 Forecast stack

1. **CloudFormation → Create stack** → `infra/forecast.yaml`, stack name `cafestock-forecast`.
2. Parameters:
   - **ArtifactsBucket**: the bucket name.
   - **CodeKey**: `lambda/` + the exact file name.
   - **AlertEmail**: your e-mail.
   - Leave all **Database** fields empty.
3. **Submit** and wait for **CREATE_COMPLETE**. The **NightlySchedule** output says "OFF
   until…". That's expected.
4. **Confirm the e-mail subscription** from AWS ("AWS Notification - Subscription
   Confirmation" → **Confirm subscription**).

### 6.5 Test it in AWS

1. **Lambda → cafestock-forecast → Test** → new event `selftest`: `{ "selfTest": true }` →
   **Test**.
   **Expected:** succeeded, with `"model": "lgbm-v1"`, **1.088 vs 1.126** (the same as your
   laptop), and a model source of `s3://…`. The first run takes about 10–20 s; run it again and
   it's faster, with `"cached": true` in the log.
2. New event `failtest`: `{ "fail": true }` → **Test**.
   **Expected:** a red failure, and an **ALARM: "cafestock-forecast-failed"** e-mail within
   about 5 minutes (an OK e-mail follows later).
3. **CloudWatch → Log groups → `/aws/lambda/cafestock-forecast`**: one JSON line per step.
   **EventBridge → Rules → `cafestock-forecast-nightly`**: **Disabled** until part 7.

More detail: `docs/aws-forecast-setup.md`.

---

## 7. AWS part 3: the whole app on AWS (Task 11)

About 1½ hours in one lab session. The full version, with a troubleshooting table, is in
`docs/aws-deploy.md`.

### 7.1 On your laptop

```bash
npm run db:up && npm run check     # everything passes
npm run app:build                  # "Release dist/app/cafestock-app-xxxxxxxxxxxx.tgz" (~0.5 MB)
```

Write down the file name.

### 7.2 Upload the release

**S3** → your bucket → **Create folder** `app` → upload the `.tgz` into it.

### 7.3 Network stack (about 3 minutes)

**CloudFormation → Create stack** → `infra/network.yaml`, stack name `cafestock-network`. Leave
`CloudFrontPrefixListId` **empty** → **Submit** → wait for CREATE_COMPLETE.

### 7.4 Database stack (about 15 minutes)

1. Copy **AlertsTopicArn** from `cafestock-forecast` → Outputs.
2. **Create stack** → `infra/database.yaml`, stack name `cafestock-database`. Paste
   **AlertsTopicArn** and leave the rest (db.t3.micro, PostgreSQL 17.11) → **Submit**.
3. When it's CREATE_COMPLETE, note **DatabaseSecretArn** from Outputs.

### 7.5 App stack (15–20 minutes)

**Create stack** → `infra/app.yaml`, stack name `cafestock-app`:

| Parameter           | Value                                            |
| ------------------- | ------------------------------------------------ |
| `ArtifactsBucket`   | `cafestock-artifacts` → Outputs → BucketName     |
| `AppKey`            | `app/cafestock-app-xxxxxxxxxxxx.tgz` (your file) |
| `CognitoUserPoolId` | `cafestock-cognito` → Outputs → UserPoolId       |
| `CognitoClientId`   | `cafestock-cognito` → Outputs → ClientId         |
| `AlertsTopicArn`    | `cafestock-forecast` → Outputs → AlertsTopicArn  |
| `PublicEntry`       | `api-gateway` (default)                          |
| `EnableWaf`         | `true` (default)                                 |

**Submit.** The server sets itself up in about 5 minutes: Node.js, packages, database password,
tables, dataset. The stack waits for its "ready" signal. To watch: **CloudWatch → Log groups →
`/cafestock/app` → `…/bootstrap`**.

When it's CREATE_COMPLETE, **Outputs → AppUrl** is your app:
`https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com`.

### 7.6 Try the app on AWS

1. Open **AppUrl** and sign in with the Cognito **manager** user (first time: choose a new
   password).
2. **Stock → History:** the dataset, ending within the last week. **Items:** 8 items.
3. Record a delivery; it's saved in RDS.
4. **Forecast** says "No forecast has run yet" until step 7.7.
5. Sign in as **staff**: no Forecast tab; **My shifts** instead of Roster.
6. As **manager**, **Roster → Team**: add your staff user with the e-mail you gave it in
   Cognito (5.3), give them a shift, then sign in as staff: it's under **My shifts**.

### 7.7 Connect the forecast Lambda to the database

1. **CloudFormation → `cafestock-forecast` → Update → Use existing template** → change only:
   - **DbSecretArn** = `cafestock-database` → DatabaseSecretArn
   - **SubnetIds** = `cafestock-network` → **PrivateSubnets** (`subnet-…,subnet-…`)
   - **SecurityGroupIds** = `cafestock-network` → **LambdaSecurityGroup**
2. **Submit.** When it's UPDATE_COMPLETE, **NightlySchedule** says **ON** (2:00 am Singapore
   time).
3. **Lambda → Test** with `{ "orgs": ["demo-cafe"] }`. **Expected:** "Forecast published for 1
   café", `lgbm-v1` (20–40 s the first time). Refresh the **Forecast** page.
4. _(Demo)_ Record **Wasted** Fresh milk 4500 and Napkin 20 in the AWS app, then run the test
   with `{ "orgs": ["demo-cafe"], "force": true }`. Milk shows **Urgent**, napkins
   **Reorder**, and an **ALARM: "cafestock-demo-cafe-urgent-items"** e-mail arrives.

### 7.8 Quick checks (these become evidence in part 8)

| Check        | How                                                                                        | Expected                                                      |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| HTTPS        | The padlock in the browser                                                                 | Valid certificate for `*.execute-api.us-east-1.amazonaws.com` |
| Firewall     | AppUrl + `/?q=<script>alert(1)</script>`                                                   | **403 Forbidden** (WAF)                                       |
| Private LB   | **EC2 → Load balancers → cafestock-alb**                                                   | Scheme **Internal**                                           |
| Private DB   | **RDS → cafestock-db → Connectivity & security**                                           | Publicly accessible **No**                                    |
| Self-healing | **EC2 → Auto Scaling groups → cafestock-app** → Desired **2**, then terminate one instance | The app stays up; a replacement appears under **Activity**    |
| Monitoring   | **CloudWatch → Dashboards** `cafestock-app`, `cafestock-forecast`; **Alarms**              | Graphs and alarms with e-mail actions                         |

### 7.9 Releasing a new version

1. `npm run app:build`, then upload the new `.tgz` to `app/`.
2. **CloudFormation → cafestock-app → Update → Use existing template** → change **AppKey**.
3. A new server starts first, then the old one is retired, so there's no downtime (about 10
   minutes).
4. Database changes in the new release (such as Task 13's `shifts` table) are applied by the new
   server when it starts (`prisma migrate deploy` in `bootstrap.sh`). Nothing to run by hand.
   **Already deployed Task 11?** This is how you get the Roster on AWS.

---

## 8. Evidence, report and the submission ZIP (Task 12)

The brief says a marker must be able to check every claim **without** a live AWS account. So:
run the tests, record the results in the evidence files, write the report, then build the ZIP.

### 8.1 What goes in the ZIP (already set up)

| ZIP path                    | Comes from                                                        | Your job                                                 |
| --------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `README.md`                 | `submission/README.md`                                            | Fill in the group id and team table                      |
| `project_manifest.yaml`     | `submission/project_manifest.yaml`                                | Group id and members                                     |
| `report.pdf`                | `submission/report.pdf`                                           | **Write the report**, export it to this path             |
| `TEAM_CONTRIBUTIONS.md`     | `submission/TEAM_CONTRIBUTIONS.md`                                | One row per member                                       |
| `AI_USE_DECLARATION.md`     | `submission/AI_USE_DECLARATION.md`                                | Check the draft, fill in the gaps, delete the draft note |
| `tests/README.md`           | `submission/tests/README.md`                                      | Nothing                                                  |
| `evidence/`                 | `evidence/`                                                       | Run the tests, fill in the records, add screenshots      |
| `data/`, `analytics/`       | the project's folders                                             | Confirm the dataset licence in `data/README.md`          |
| `src/`                      | the whole project, without `node_modules`, builds or `.env` files | Nothing                                                  |
| `video_link.txt` (optional) | `submission/video_link.txt`                                       | Only if you make a video                                 |

Anything still to do is marked **TO FILL**. The packaging command lists every one left.

### 8.2 Record the evidence

Do these on the AWS deployment from part 7, in one lab session if you can. Save screenshots in
`evidence/screenshots/` with the file names the records ask for, and **redact account IDs,
e-mail addresses and the app address** before saving.

1. **Automated tests (on your laptop):**
   ```bash
   npm run db:up
   npm run evidence:tests
   ```
   Creates `evidence/test-runs/<date>/…` and `evidence/test-runs/SUMMARY.md`.
2. **Smoke test against AWS:**
   ```bash
   npm run smoke -- https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com --out evidence/smoke-aws.md
   ```
   **Expected:** every row PASS (health, database, page, 401 for anonymous and forged tokens,
   CSP, HTTPS, WAF 403). The address is replaced with `<app-address>` automatically.
3. **Test 1, functional:** follow `evidence/test-functional.md` step by step and fill in
   **Actual result**.
4. **Test 2, security:** `evidence/test-security.md` (staff blocked from the forecast, WAF
   block, private DB and load balancer, security groups, secret).
5. **Test 3, data/AI:** run `npm run analytics:test` and `npm run analytics`, then fill in the
   date, name and the "Ran 19 tests" line in `evidence/test-data-ai.md`. If the team's own
   weekly analysis has test records, merge them in here.
6. **Test 4, resilience:** in `evidence/test-resilience.md`, set Desired capacity to 2, then
   start
   `npm run smoke -- <AppUrl> --watch 900 --out evidence/availability-aws.md` and terminate one
   server while it runs.
7. **Monitoring:** in `evidence/monitoring.md`, run the `{ "fail": true }` alarm test, the
   Logs Insights query, and take dashboard screenshots.
8. **Deployment record:** `evidence/deployment.md` (stacks, dates, release file names,
   observed cost, problems met). CloudFront being refused is a good one to record.
9. **Dataset licence:**
   - Open <https://www.kaggle.com/datasets/navjotkaushal/coffee-sales-dataset>, read the
     licence and write it in `data/README.md`.
   - If it doesn't allow redistribution, delete `data/raw/` before building the ZIP and keep
     the URL as the source. Say in `data/README.md` that `npm run analytics:team` then needs the
     file downloaded from Kaggle first. Everything else uses the derived files.

`evidence/architecture.png` (the diagram) and `evidence/threat-control-map.md` are complete
already. Read them; the report refers to both.

### 8.3 Write the report (8–12 pages, `submission/report.pdf`)

Use exactly these headings from the brief. The right-hand column says where the material is.

| Heading                                                                 | Draw on                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Problem, users and success criteria                                  | `submission/README.md` (problem), the staff/manager roles                                                                                             |
| 2. Solution overview and architecture                                   | `evidence/architecture.png`, `docs/aws-deploy.md`                                                                                                     |
| 3. Cloud service/deployment choices and trade-offs                      | Manifest `service_model` (alternatives: Elastic Beanstalk, ECS Fargate, DynamoDB), the CloudFront → API Gateway change, no NAT gateway, single-AZ RDS |
| 4. Implementation, data design and security controls                    | `backend/prisma/schema.prisma`, `docs/data-contract.md`, `evidence/threat-control-map.md`                                                             |
| 5. Analytics or AI/ML feature: data, method, evaluation and limitations | `analytics/README.md`, `analytics/demand_model.ipynb`, `evidence/test-data-ai.md`, `data/README.md`                                                   |
| 6. Testing, scalability/resilience and monitoring results               | `evidence/test-*.md`, `evidence/test-runs/SUMMARY.md`, `evidence/monitoring.md`                                                                       |
| 7. Cost, sustainability and operational considerations                  | Part 9 of this guide, `evidence/deployment.md` (observed cost), pausing routine                                                                       |
| 8. Team contribution, ethical considerations and reflection             | `TEAM_CONTRIBUTIONS.md`, `AI_USE_DECLARATION.md`, the known limitations                                                                               |

The report should **explain**, not repeat, the manifest. Link claims to evidence files by path.
State the limitations honestly: the model doesn't beat the baseline on daily MASE over 47 weeks.

### 8.4 Fill in the submission files

- `submission/project_manifest.yaml`: set `group_id` (e.g. `"G012"`), and each member's name,
  student ID and role. Everything else is filled in.
- `submission/README.md`: the group id in the second line and the team table.
- `submission/TEAM_CONTRIBUTIONS.md`: one specific row per member, plus the agreement line.
- `submission/AI_USE_DECLARATION.md`: correct the draft to match what you really did, fill in
  the TO FILL parts, and delete the "Draft for the team to check" note.

### 8.5 Build and check the ZIP

```bash
npm run submission -- --draft          # any time: shows what's left, builds a …-DRAFT.zip
npm run submission -- --group G012     # final: only builds when nothing is left to fix
```

The preflight checks everything in the brief's Appendix A that a script can check:

- the required files, including `report.pdf`;
- every path in the manifest;
- **no TO FILL left**;
- **no credentials** (access keys, private keys, tokens, real `.env` files);
- account IDs and addresses that need redacting;
- screenshots present;
- the dataset licence.

**Expected (final):** `✓ All checks passed.` and
`Built: dist/submission/Group_G012_INF2006_Project.zip`.

Before you upload:

1. Unzip it somewhere new and follow its `README.md` quick start (`cd src`, `npm install`,
   `npm run db:setup`, …). It should work on a clean machine.
2. Open `project_manifest.yaml` and click through a few paths; they must all exist.
3. Ask a teammate who didn't make a given artefact to find it using only the README. That's
   the brief's last checklist item.

Submit by **Sunday 11 October 2026, 11:59 PM**.

---

## 9. Costs and pausing AWS

| While running (us-east-1)                         | Per day     |
| ------------------------------------------------- | ----------- |
| Load balancer (internal)                          | $0.54       |
| 1 app server t3.micro (+ public IPv4, disk)       | $0.39       |
| RDS db.t3.micro + 20 GB                           | $0.51       |
| Secrets Manager endpoint + secret                 | $0.25       |
| WAF                                               | $0.23       |
| API Gateway, Lambda, S3, CloudWatch, SNS, Cognito | ~$0         |
| **Total**                                         | **≈ $1.90** |

- **End of a session** (about $1.10/day):
  - **EC2 → Auto Scaling groups → cafestock-app → Edit** → Desired **0**, Minimum **0**.
  - **RDS → cafestock-db → Actions → Stop temporarily**.
  - To resume: **Start** the database, wait for **Available**, then set the Auto Scaling
    group back to Minimum 1, Desired 1. The server sets itself up in about 5 minutes.
- **Longer breaks** (about $0.35/day): delete the `cafestock-app` stack and stop the
  database. To resume: start the database, then repeat 7.5. The AppUrl will be new.
- **Nightly forecast while the database is stopped:** it fails and e-mails you. Ignore those
  e-mails, or **EventBridge → Rules → cafestock-forecast-nightly → Disable**.
- **Things to remember:**
  - The lab stops EC2 when the session ends, but **not RDS**: stop it yourself.
  - A stopped RDS database starts again by itself after 7 days.
- **At the end of the project:** delete the stacks in this order: `cafestock-app`,
  `cafestock-forecast`, `cafestock-database`, `cafestock-network`, `cafestock-artifacts`
  (empty the bucket first), then `cafestock-cognito`. Also delete the final RDS snapshot under
  **RDS → Snapshots**.

**Only one team member needs to deploy.** Each Learner Lab is a separate account with its
own $50, so agree whose account holds the final deployment the evidence comes from.

---

## 10. Troubleshooting

**Laptop**

| Symptom                                                                 | Fix                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `node` not found, or odd Node version (23/25)                           | Install Node 24 LTS from nodejs.org and open a **new** terminal                                                                |
| `npm error Missing script: "…"`                                         | You're in the wrong folder, or the latest `setup-cafestock.mjs` wasn't applied. `cd` into `cafestock` and run the update again |
| `db:setup` hangs or fails; "Cannot connect to the Docker daemon"        | Start Docker Desktop and wait for **Engine running**. If WSL errors appear: `wsl --update`, then restart Docker                |
| "Can't reach database server at localhost:5433"                         | `npm run db:up`                                                                                                                |
| Port 5433 in use                                                        | Another PostgreSQL is using it: stop it, or change the port in `docker-compose.yml` and `backend/.env`                         |
| "Database connected, but its tables are missing"                        | `npm run db:setup`                                                                                                             |
| `forecast:publish`: "The database hasn't been updated for this version" | `npm run db:setup`, then publish again                                                                                         |
| "Python 3.11+ wasn't found"                                             | Install Python from python.org with **Add python.exe to PATH**, and open a new terminal                                        |
| "Run `npm run analytics:setup` first"                                   | `npm run analytics:setup` (once)                                                                                               |
| Python tests show "skipped" with a reason                               | Usually the database isn't running: `npm run db:up`                                                                            |
| The browser shows "CafeStock failed to start"                           | Copy the message on the page and anything red in the terminal; usually `npm install` wasn't run after an update                |
| `lambda:build` says the RDS certificate bundle couldn't be downloaded   | You were offline or behind a blocking network. Build again on a normal connection                                              |

**AWS**

| Symptom                                                    | Fix                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any failed stack                                           | Stack → **Events** tab → the first red line from the bottom. A failed stack (ROLLBACK_COMPLETE) must be **deleted** before creating one with the same name |
| `not authorized to perform: cloudfront:CreateDistribution` | You used an old `app.yaml`. The current one uses API Gateway; update the project and use `infra/app.yaml` again                                            |
| App stack fails at **VpcLink / HttpApi** (not authorized)  | Recreate it with **PublicEntry = load-balancer**. The app then runs on plain `http://` from the load balancer; record this in the report                   |
| App stack fails at **WebAcl**                              | Recreate it with **EnableWaf = false**, and say so in the report                                                                                           |
| "Set-up failed - see CloudWatch log group /cafestock/app"  | **CloudWatch → /cafestock/app → `<instance>/bootstrap`**: the last lines say which step (1/9–9/9) failed and why                                           |
| Database stack: "Cannot find version 17.11"                | **RDS → Create database → PostgreSQL** → look at the Engine version list (don't create), pick a 17.x, recreate with that **EngineVersion**                 |
| Stack: S3 **NoSuchKey**                                    | **CodeKey/AppKey** doesn't match the uploaded file: it includes the folder (`lambda/…`, `app/…`) and the exact name                                        |
| Anything mentions `LabRole` / not authorized after a while | The lab session expired: **Start Lab** again                                                                                                               |
| App shows 503/502/504                                      | The server is starting or being replaced; wait 5 minutes. **EC2 → Target groups → cafestock-app → Targets** should say healthy                             |
| Sign-in fails on AWS                                       | Use the Cognito users (not the dev sign-in). Reset the password in **Cognito → Users** if needed                                                           |
| Lambda: "Can't reach the database"                         | Step 7.7: **SubnetIds** must be the **Private**Subnets, **SecurityGroupIds** the **Lambda**SecurityGroup. Is the database started?                         |
| Lambda: "DB_SSL=verify-full needs a CA bundle"             | The Lambda package lacks the RDS certificates (6.1): rebuild online, upload, update **CodeKey**                                                            |
| No alert e-mails                                           | Confirm the SNS subscription (6.4 step 4); check spam                                                                                                      |

---

## 11. Command reference

Run all of these in the `cafestock` folder.

| Command                                                    | What it does                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `node setup-cafestock.mjs`                                 | Create or update the project (run next to or inside `cafestock`)                |
| `npm install`                                              | Install dependencies (again after each update)                                  |
| `npm run dev`                                              | Start the API (:3000) and the web app (:5173)                                   |
| `npm run db:up` / `db:down`                                | Start / stop the local database (Docker)                                        |
| `npm run db:setup`                                         | Database + tables (migrations) + demo café; safe to re-run                      |
| `npm run db:import`                                        | Load the dataset (`-- --shift-to-recent --replace` for recent dates)            |
| `npm run db:reset`                                         | Wipe the local database and start again                                         |
| `npm run check`                                            | Format + lint + type checks + all JavaScript/TypeScript tests                   |
| `npm test`                                                 | Backend + frontend tests only                                                   |
| `npm run forecast:setup` / `forecast:test`                 | Python environment / forecast engine tests                                      |
| `npm run forecast`                                         | Print a forecast for the demo café                                              |
| `npm run forecast:publish`                                 | Save a forecast run for the Forecast page (LightGBM vs baseline)                |
| `npm run analytics:setup` / `analytics` / `analytics:test` | ML packages / model evaluation / its tests                                      |
| `npm run analytics:notebook`                               | Re-run and save the notebook                                                    |
| `npm run lambda:invoke`                                    | Run the nightly Lambda locally (`-- --self-test`, `-- --dry-run`, `-- --force`) |
| `npm run lambda:build`                                     | Build the Lambda package → `dist/lambda/`                                       |
| `npm run app:build`                                        | Build the app release for AWS → `dist/app/`                                     |
| `npm run smoke -- <address>`                               | Repeatable checks against local or AWS (`--out file`, `--watch seconds`)        |
| `npm run evidence:tests`                                   | Run every suite, save dated output to `evidence/test-runs/`                     |
| `npm run submission -- --draft` / `--group G012`           | Preflight + build the submission ZIP → `dist/submission/`                       |

Other documents in the project: `README.md` (developer guide, per-task details),
`docs/cognito-setup.md`, `docs/aws-forecast-setup.md`, `docs/aws-deploy.md`, `docs/dataset.md`,
`docs/data-contract.md`, `analytics/README.md`, `forecasting/README.md`.
