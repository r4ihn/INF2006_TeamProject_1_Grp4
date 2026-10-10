# Nightly forecast on AWS (Task 10)

The Forecast page shows whatever `npm run forecast:publish` last saved. In production nobody runs
that by hand: an **AWS Lambda** function runs it every night, started by an **EventBridge**
schedule. This guide deploys that function in the AWS Academy Learner Lab and checks it works.

```
EventBridge rule ──(2:00 am SGT)──▶ Lambda "cafestock-forecast" (Python 3.13)
                                      │  reads the model   ◀── S3: models/lgbm-v1/model.txt
                                      │  reads/writes      ◀─▶ RDS PostgreSQL (Task 11)
                                      │  logs + metrics    ──▶ CloudWatch (dashboard, alarms)
                                      └─ fails twice       ──▶ SNS ──▶ e-mail to the team
```

**Until Task 11 there is no database on AWS**, so this step deploys everything with the nightly
schedule **switched off**, and you test the function with its **self-test**. The self-test
forecasts the demand snapshot inside the package (the Task 8b data), using the model from S3,
exactly as a nightly run would. It should print the same numbers as your laptop
(`npm run lambda:invoke -- --self-test`): **LightGBM 1.088 vs 14-day average 1.126**. In Task 11 you fill in the database settings and
the schedule switches itself on.

**Cost: about $0.** Nothing here runs by the hour. The Lambda free tier covers far more than a
nightly run. The package and models are ~55 MB in S3 (a fraction of a cent). The dashboard,
alarms and e-mails are within CloudWatch's and SNS's free allowances.

**What gets created:** one S3 bucket; one Lambda function (runs as the Learner Lab's
`LabRole`, so no IAM roles are created); one EventBridge rule (disabled for now); one SNS topic
with your e-mail; two CloudWatch alarms and a dashboard; one log group (kept 14 days).

---

## 1. Build the package (on your laptop)

In the VS Code terminal, in the `cafestock` folder:

```bash
npm run lambda:build
```

The first time it downloads the Linux versions of LightGBM, numpy and scipy (~55 MB, about a
minute). Expected ending:

```
  Package   dist/lambda/forecast-lambda-xxxxxxxxxxxx.zip
  Size      49.8 MB zipped, 161 MB unzipped (limit 250 MB), 1,461 files
  SHA-256   …
  Local check skipped (needs Linux with Python 3.13) — run the self-test in Lambda instead.
```

Note the file name. `xxxxxxxxxxxx` is part of the file's fingerprint. It changes whenever the
code changes, which is how CloudFormation knows there's a new version.

> On Windows the build uses the **Linux** packages on purpose: that's what Lambda runs. Nothing
> is compiled, so no extra tools are needed.

## 2. Create the bucket (CloudFormation)

1. Open the Learner Lab, **Start Lab**, wait for the green dot, click **AWS**.
2. Check the region (top right) is **N. Virginia (us-east-1)**.
3. **CloudFormation** → **Create stack** → **With new resources (standard)** →
   **Upload a template file** → `infra/artifacts.yaml` → **Next**.
4. Stack name: `cafestock-artifacts` → **Next** → **Next** → **Submit**.
5. When it says **CREATE_COMPLETE** (under a minute), open **Outputs** and copy **BucketName**
   (like `cafestock-artifacts-123456789012-us-east-1`).

The bucket is private, encrypted and HTTPS-only. It keeps old versions of files for 30 days,
so every model you upload is kept (a simple model registry).

## 3. Upload the package and the model (S3)

1. **S3** → open your `cafestock-artifacts-…` bucket.
2. **Create folder** → `lambda` → open it → **Upload** → **Add files** →
   `dist/lambda/forecast-lambda-xxxxxxxxxxxx.zip` → **Upload**. (It's ~50 MB; give it a minute.)
3. Back at the bucket's top level: **Create folder** → `models` → open it → **Upload** →
   **Add folder** → choose `analytics/models/lgbm-v1` → **Upload**.

You should now have exactly these three files:

| Key                                       |
| ----------------------------------------- |
| `lambda/forecast-lambda-xxxxxxxxxxxx.zip` |
| `models/lgbm-v1/model.txt`                |
| `models/lgbm-v1/model.json`               |

## 4. Create the forecast stack (CloudFormation)

1. **CloudFormation** → **Create stack** → **With new resources (standard)** →
   **Upload a template file** → `infra/forecast.yaml` → **Next**.
2. Stack name: `cafestock-forecast`.
3. Parameters:
   - **ArtifactsBucket:** the BucketName from step 2.
   - **CodeKey:** `lambda/forecast-lambda-xxxxxxxxxxxx.zip` (your exact file name).
   - **AlertEmail:** your e-mail (or the team's).
   - Leave everything under **Database (Task 11)** empty, and the rest as it is.
4. **Next** → **Next** → **Submit**. Wait for **CREATE_COMPLETE** (about a minute).
5. **Outputs** should say **NightlySchedule: OFF until the database parameters are set (Task 11)**.
6. Check your inbox for **AWS Notification - Subscription Confirmation** and click
   **Confirm subscription**. Without it, no alert e-mails arrive.

## 5. Run the self-test (Lambda)

1. **Lambda** → **Functions** → **cafestock-forecast** → **Test** tab.
2. **Create new event** → Event name `selftest` → Event JSON:
   ```json
   { "selfTest": true }
   ```
   → **Save** → **Test**.
3. Expected: a green **Executing function: succeeded**. Open **Details**:
   ```json
   {
     "ok": true,
     "mode": "self-test",
     "forecastFrom": "2025-03-24",
     "items": 8,
     "model": "lgbm-v1",
     "maseModel": 1.0878,
     "maseBaseline": 1.1261,
     "modelSource": "s3://cafestock-artifacts-…/models/lgbm-v1/model.txt",
     "message": "Self-test passed: LightGBM (lgbm-v1) 1.088 vs 14-day average 1.126 → used lgbm-v1.",
     "nextSevenDays": [ … { "item": "Fresh milk", "unit": "ml", "total": 10562.7 } … ],
     "python": "3.13.x",
     …
   }
   ```
   The first run takes longer (roughly 10–20 s): Lambda starts a fresh container and downloads
   the model. **Test** again: it's quicker, and the log shows `"cached": true`, because the warm
   container keeps the model.

The summary under the result shows **Duration** and **Max memory used** (a few hundred MB of the
1,024 MB). Both are useful numbers for the report.

## 6. Check the alert e-mail

1. Still on **Test**: **Create new event** → `failtest` → `{ "fail": true }` → **Save** → **Test**.
2. Expected: red **failed**, `"errorMessage": "Test failure requested …"`.
3. Within about 5 minutes you get **ALARM: "cafestock-forecast-failed"**. About 5–10
   minutes later, with no more errors, an **OK** e-mail follows.

## 7. Look at the logs and the dashboard

- **CloudWatch** → **Log groups** → `/aws/lambda/cafestock-forecast`: one JSON line per step
  (`job.started`, `model.ready`, `selftest.finished` …).
- **CloudWatch** → **Logs Insights** → choose that log group → run:
  ```
  fields @timestamp, event, message, model, maseModel, maseBaseline
  | filter ispresent(event)
  | sort @timestamp desc
  ```
- **CloudWatch** → **Dashboards** → **cafestock-forecast** (or the stack's **DashboardUrl**
  output). Invocations and errors show now. Items to order and MASE start appearing once
  nightly runs happen (Task 11).
- **EventBridge** → **Rules** → `cafestock-forecast-nightly`: **Disabled** for now.

That's Task 10 done on AWS. Screenshots of steps 5–7 make good evidence for the report.

---

## Updating later

- **New code:** `npm run lambda:build` → upload the new zip to `lambda/` → **CloudFormation**
  → `cafestock-forecast` → **Update** → **Use existing template** → change **CodeKey** to the
  new file name → **Next** … **Submit**.
- **New model:** `npm run analytics` retrains it → upload the new `model.txt` and `model.json`
  to `models/lgbm-v1/` (same names). The next run downloads it; the bucket keeps the old
  version. A different folder (e.g. `models/lgbm-v2/`) needs **ModelKey** changed.
- **Database (Task 11):** update the stack with **DbSecretArn**, **DbHost**, **SubnetIds** and
  **SecurityGroupIds**. The schedule then switches on and runs at 2:00 am Singapore time.

## Cleaning up

Nothing here costs money while idle, so you can leave it until the project is marked. To
remove it: delete the `cafestock-forecast` stack; then empty the bucket (**S3** → bucket →
**Empty**) and delete the `cafestock-artifacts` stack.

## If something goes wrong

| What you see                                                       | Why / what to do                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Stack fails: _S3 Error Code: NoSuchKey_                            | **CodeKey** doesn't match the uploaded file. Check the exact name under `lambda/` (it includes `lambda/`).                         |
| Stack fails: _CodeKey … must look like lambda/forecast-lambda-…_   | Type the key as `lambda/forecast-lambda-` + the 12 characters + `.zip`.                                                            |
| Stack fails mentioning `iam:PassRole` or `LabRole`                 | The Learner Lab session may have expired. **Start Lab** again. **LabRoleName** must stay `LabRole`.                                |
| Self-test: _LightGBM not used — Couldn't download the model … 404_ | The model isn't at `models/lgbm-v1/model.txt`. Re-upload the `lgbm-v1` folder inside `models/`. The rest of the test still passed. |
| Self-test: _Task timed out_                                        | Rare on a cold start. Test again. If it keeps happening, check **Configuration → General** shows 1024 MB and 5 min.                |
| A test with the nightly event: _No database configured …_          | Expected until Task 11 — there's no database on AWS yet.                                                                           |
| No alert e-mails                                                   | Confirm the subscription (step 4.6) and check spam. **SNS** → **Subscriptions** should show **Confirmed**.                         |
