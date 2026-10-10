# CafeStock — guide to testing and evidence

Everything to run and record so the submission meets the brief's testing and evidence rules.
It takes one afternoon: Part A on your laptop (no AWS cost), Part B in **one** Learner Lab
session (about 2 hours, roughly $0.50), Part C to tidy up.

## What the brief asks for

- **Section 5.2:** at least four tests: (1) functional workflow, (2) security control,
  (3) data/AI validation, (4) scalability, resilience or recovery. Each records **objective,
  setup, command/steps, expected result, actual result, date and artefact path**. A failed
  test still earns credit if it is reported honestly, diagnosed, and followed by an
  improvement plan.
- **Section 4, Operations:** logging/monitoring plus **one operational test or alert/query**,
  with an interpretation.
- **Section 9, Evidence rules:** "include commands, inputs and result summaries in text files";
  use screenshots **only when text or config exports aren't available**. Redact account IDs,
  public IPs, URLs with tokens and sensitive values.

The record files already exist in `evidence/` with the objective, setup, steps and expected
result written. For each one you run the test, then fill in **Date** (YYYY-MM-DD), **Run by**,
**Actual result** and **Analysis**.

| #   | What                                     | Record file                       | Where        |
| --- | ---------------------------------------- | --------------------------------- | ------------ |
| A1  | Automated test run (supporting evidence) | `evidence/test-runs/SUMMARY.md`   | Laptop       |
| A2  | **Test 3, data/AI**                      | `evidence/test-data-ai.md`        | Laptop       |
| B1  | Deployment record                        | `evidence/deployment.md`          | AWS          |
| B2  | Smoke test (feeds Tests 1 and 2)         | `evidence/smoke-aws.md` (created) | Laptop → AWS |
| B3  | **Test 1, functional** (incl. roster)    | `evidence/test-functional.md`     | AWS          |
| B4  | **Test 2, security**                     | `evidence/test-security.md`       | AWS          |
| B5  | **Operations:** alert test + log query   | `evidence/monitoring.md`          | AWS          |
| B6  | **Test 4, resilience**                   | `evidence/test-resilience.md`     | AWS          |

---

## Part A: on your laptop (any time, free)

### A1. Automated tests

```powershell
cd D:\cafeStock\cafestock
npm run db:up
npm run evidence:tests
```

**Creates:** `evidence/test-runs/<today>/…` and `evidence/test-runs/SUMMARY.md`.
**Expected:** every suite passes: 277 backend, 123 web app, 85 forecast, 19 analytics.

### A2. Test 3, data/AI (`test-data-ai.md`)

```powershell
npm run forecast:setup      # only if you haven't before
npm run analytics:setup     # only if you haven't before
npm run analytics:test
npm run analytics
```

**Expected:**

- `analytics:test` ends with `Ran 19 tests in …s` and `OK`.
- `analytics` prints the comparison table: 14-day moving average **MASE 0.827**, LightGBM
  **0.855**, weekly WAPE 23.4% vs 21.4%.

**Record:** fill in Date and Run by, and replace the `TO FILL` line under _Actual result_ with
the exact `Ran 19 tests …` line from your run. The rest of the record is already written.

---

## Part B: on AWS (one lab session)

### Before you start

- The latest release is deployed (see `docs/COMPLETE-GUIDE.md` 7.9: build, upload, change
  **AppKey** on `cafestock-app`).
- **RDS → `cafestock-db`** shows **Available**; **EC2 → Auto Scaling groups → `cafestock-app`**
  has 1 instance **InService**.
- Have ready: your **AppUrl**, the Cognito **manager** and **staff** logins, and a way to take
  screenshots (Windows: **Win + Shift + S**).
- Open the **terminal on the Learner Lab page** (the AWS CLI there is already signed in), or
  **CloudShell** in the AWS console, and run once:

  ```bash
  export AWS_DEFAULT_REGION=us-east-1
  ```

> **Redaction:** the commands below are written to leave out account IDs and ARNs. Still check
> every output for a 12-digit number, an ARN or an address before you paste it into
> `evidence/`. `npm run submission -- --draft` (Part C) warns about any it finds.

### B1. Deployment record (`deployment.md`)

1. Stack list as text (paste into the **Stacks** table):

   ```bash
   aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName,'cafestock')].[StackName,StackStatus,CreationTime]" --output table
   ```

2. **Release versions:** on your laptop (PowerShell), for the app release and the Lambda
   package you deployed:

   ```powershell
   certutil -hashfile dist\app\cafestock-app-xxxxxxxxxxxx.tgz SHA256
   ```

   Write the file name and the first 12 characters of the hash.

3. **Parameters used:** the non-default ones, e.g. `PublicEntry = api-gateway`,
   `EnableWaf = true`, `AppKey = app/cafestock-app-….tgz`. No pool IDs, secret ARNs or account
   numbers.
4. **Observed cost:** note "Used $x of $50" from the Learner Lab page now; add the "after"
   figure at the end (B7).
5. **Problems met:** e.g. "CloudFront isn't permitted in the Learner Lab
   (`cloudfront:CreateDistribution` denied), so the app stack uses API Gateway (HTTP API)."

### B2. Smoke test (evidence for Tests 1 and 2)

On your laptop:

```powershell
npm run smoke -- https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com --out evidence/smoke-aws.md
```

**Expected:** every row **PASS**: health, database, web page, 401 for anonymous and forged
tokens, security headers (CSP), HTTPS, WAF probe blocked (403). The address is written as
`<app-address>` automatically.

### B3. Test 1, functional (`test-functional.md`)

| Step | Do this                                                                                                                                                                                                                  | Screenshot                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| 1    | Sign in as **staff** → **Stock → Record delivery / usage** → _Delivery received_, **Fresh milk**, **2000**, note `Invoice 1001` → **Record delivery**. **Write down on hand before and after** (after = before + 2,000). | `functional-1-delivery.png`   |
| 2    | **Stock → Stock count** → count **Napkin** 5 fewer than expected → **Save count**                                                                                                                                        | `functional-2-count.png`      |
| 3    | **Stock → Activity**: both changes show _By: &lt;staff name&gt;_                                                                                                                                                         | `functional-3-activity.png`   |
| 4    | Quantity **-5** → refused with a message                                                                                                                                                                                 | `functional-4-validation.png` |
| 5    | **Lambda → cafestock-forecast → Test** with `{"orgs": ["demo-cafe"], "force": true}` → sign in as **manager** → **Forecast**: new "Updated" time; Fresh milk's on hand includes the delivery                             | `functional-5-forecast.png`   |
| 6    | **Roster → Team**: add the staff user with the **same e-mail as their Cognito account** → **+ Add** under tomorrow: that person, _Barista_, 09:00–15:00 → **Add shift**                                                  | `functional-6-roster.png`     |
| 7    | Add the same person the same day, 14:00–18:00 → refused: _… is already working 09:00–15:00 on …_                                                                                                                         | `functional-7-clash.png`      |
| 8    | Sign in as **staff** → **My shifts**: the shift is there                                                                                                                                                                 | `functional-8-my-shifts.png`  |

**Record:** one line per step with the numbers you saw, plus the smoke test's summary line from
B2.

### B4. Test 2, security (`test-security.md`)

| Step | Do this                                                                              | Expected                                                                   |
| ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1    | Done in B2 (smoke test)                                                              | Anonymous and forged-token requests 401; CSP; HTTPS; WAF 403               |
| 2    | As **staff**, open `<AppUrl>/forecast`; **F12 → Network**, refresh                   | "Only managers can see the forecast."; the forecast request is **403**     |
| 2b   | Still as staff → **My shifts** → click the `shifts?from=…` request → **Response**    | Only this person's shifts; no colleagues', no open shifts. Write the count |
| 3    | Open `<AppUrl>/?q=<script>alert(1)</script>` (screenshot `security-3-waf-block.png`) | **403 Forbidden** from AWS WAF                                             |
| 4–7  | The text exports below (instead of screenshots)                                      | See below                                                                  |
| 8    | Done in A1                                                                           | Auth tests pass                                                            |

Text exports for steps 4–7 (paste each output into _Actual result_):

```bash
# 4. Database not public, encrypted
aws rds describe-db-instances --db-instance-identifier cafestock-db --query "DBInstances[0].{Public:PubliclyAccessible,Encrypted:StorageEncrypted,Engine:Engine,Version:EngineVersion}" --output table

# 5. Load balancer is internal
aws elbv2 describe-load-balancers --names cafestock-alb --query "LoadBalancers[0].{Scheme:Scheme,Type:Type}" --output table

# 6. Security groups: who may connect to what
aws ec2 describe-security-groups --filters "Name=group-name,Values=*cafestock*" --query "SecurityGroups[].{Name:GroupName,Inbound:IpPermissions[].{Port:FromPort,FromGroup:UserIdGroupPairs[].GroupId,FromCidr:IpRanges[].CidrIp}}" --output json

# 7. The database secret exists (its value is never shown)
aws secretsmanager describe-secret --secret-id cafestock/database --query "{Name:Name,Rotation:RotationEnabled}" --output table
```

**Expected:**

- Database: Public **False**, Encrypted **True**.
- Load balancer: Scheme **internal**.
- Security groups: port **5432** only from the app and Lambda groups; port **3000** only from
  the load balancer's group; **no port 22**.
- Secret: exists. Rotation is off (None/False) — a known gap; say so.

**Analysis:** did each control block its threat? Mention the known gaps from
`evidence/threat-control-map.md` (shared `LabRole`, no password rotation).

### B5. Operations: alert test and log query (`monitoring.md`)

Start this before Test 4, because it includes a 5-minute wait.

1. **Lambda → cafestock-forecast → Test** with `{"fail": true}`. **Note the time.**
2. Wait for the **ALARM: "cafestock-forecast-failed"** e-mail (about 5 minutes). Screenshot it
   with your e-mail address hidden: `monitoring-1-alarm-email.png`.
3. When the alarm is back to OK, export its history as text:

   ```bash
   aws cloudwatch describe-alarm-history --alarm-name cafestock-forecast-failed --history-item-type StateUpdate --max-items 4 --query "AlarmHistoryItems[].[Timestamp,HistorySummary]" --output table
   ```

4. **CloudWatch → Logs Insights** → log group `/aws/lambda/cafestock-forecast` → paste the query
   from `monitoring.md` → **Run query** → **Export results → Copy table to clipboard
   (Markdown)** → paste under **Output**.
5. Screenshot both dashboards: `monitoring-3-dashboard-app.png`,
   `monitoring-4-dashboard-forecast.png`.
6. **Interpretation** (2–3 sentences), e.g. _"Nightly runs used lgbm-v1 (MASE 1.088 vs 1.126);
   runs take about X s; the only failure was the deliberate test at HH:MM, and the alarm
   e-mailed within N minutes, then returned to OK."_

### B6. Test 4, resilience (`test-resilience.md`)

1. **EC2 → Auto Scaling groups → cafestock-app → Edit** → Desired **2** → **Update**. Wait
   (about 5 minutes) until **Instance management** shows 2 × **InService**.
2. On your laptop, start measuring (runs for 15 minutes):

   ```powershell
   npm run smoke -- https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com --watch 900 --out evidence/availability-aws.md
   ```

3. Within a minute: **EC2 → Instances** → select one `cafestock-app` instance →
   **Instance state → Terminate**. **Note the time.**
4. When the replacement is InService, export as text:

   ```bash
   aws autoscaling describe-scaling-activities --auto-scaling-group-name cafestock-app --max-items 4 --query "Activities[].[StartTime,StatusCode,Description]" --output table

   aws elbv2 describe-target-health --target-group-arn $(aws elbv2 describe-target-groups --names cafestock-app --query "TargetGroups[0].TargetGroupArn" --output text) --query "TargetHealthDescriptions[].TargetHealth.State" --output text
   ```

   The second command should print `healthy healthy`.

5. When the 15-minute watch finishes, paste into **Actual result**: the availability % and
   longest outage from `evidence/availability-aws.md`, the time you terminated the server, and
   the time the replacement was InService.
6. **Set Desired back to 1.**
7. **Analysis:** explain any few seconds of failures (requests that were in flight to the
   terminated server) and what would reduce them (more servers, a longer deregistration
   delay).

**Expected:** no failed requests, or only a few seconds of them; a replacement starts by itself
and becomes healthy within about 10 minutes.

### B7. Finish the session

1. Note "Used $x of $50" again → `deployment.md` (**Observed cost**).
2. Pause AWS:
   - **EC2 → Auto Scaling groups → cafestock-app → Edit** → Desired **0**, Minimum **0**.
   - **RDS → cafestock-db → Actions → Stop temporarily.**

---

## Part C: afterwards, on your laptop

1. Put the screenshots in `evidence/screenshots/` with the names above. Crop out account IDs,
   e-mail addresses and the AppUrl.
2. Fill in every remaining **TO FILL** in the record files (Date, Run by, Actual result,
   Analysis).
3. Copy the results into the report's **[TO FILL]** places: section 6 (the four tests, Test 4
   figures, monitoring) and 7.1 (observed cost).
4. Check what's left:

   ```powershell
   npm run submission -- --draft
   ```

   It lists every remaining `TO FILL` and warns about anything in `evidence/` that looks like an
   account ID, ARN or live address. Fix what it flags until the list is empty.

**If a test doesn't behave as expected**, don't redo it until it passes. Record what happened,
why, and what you would change. The brief gives credit for that.
