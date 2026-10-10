# Deploying CafeStock on AWS (Task 11)

This puts the whole app on AWS:

- the web app and API on EC2 behind a load balancer, with a WAF firewall;
- HTTPS through Amazon API Gateway;
- the database on RDS;
- the Task 10 forecast Lambda connected to the real database, so it runs every night.

```
Browser ──https──▶ API Gateway (HTTP API: valid HTTPS certificate, throttling)
                      │  VPC link (inside the VPC), adds a secret header
                      ▼
            Application Load Balancer, internal (private subnets) + AWS WAF
                      │  403 for anything without the header
                      │
          ┌───────────┴───────────┐        Auto Scaling group, 1–2 servers,
          ▼                       ▼        two Availability Zones (public subnets,
     EC2 app server          EC2 app server   no SSH; only the load balancer can reach them)
          └───────────┬───────────┘
                      │ TLS (certificate verified)
                      ▼
            RDS PostgreSQL 17  ◀── TLS ── Forecast Lambda (nightly, Task 10)
            private subnets, not          private subnets; S3 + Secrets Manager
            reachable from the internet    through VPC endpoints

  Password: Secrets Manager · Logs, metrics, alarms, dashboards: CloudWatch · Alerts: SNS e-mail
```

Everything is created by CloudFormation from the templates in `infra/`. In total there are six
stacks, including the two from Task 10 and the Cognito one from Task 6:

| Stack                 | Template               | What it is                                            | Task |
| --------------------- | ---------------------- | ----------------------------------------------------- | ---- |
| `cafestock-cognito`   | `infra/cognito.yaml`   | Sign-in (user pool, staff/manager groups)             | 6    |
| `cafestock-artifacts` | `infra/artifacts.yaml` | S3 bucket: Lambda package, models, **app release**    | 10   |
| `cafestock-forecast`  | `infra/forecast.yaml`  | Forecast Lambda, schedule, alerts (updated in step G) | 10   |
| `cafestock-network`   | `infra/network.yaml`   | VPC, subnets, VPC endpoints, security groups          | 11   |
| `cafestock-database`  | `infra/database.yaml`  | RDS PostgreSQL + its password in Secrets Manager      | 11   |
| `cafestock-app`       | `infra/app.yaml`       | API Gateway, load balancer, WAF, app servers, alarms  | 11   |

**Time:** about 1½ hours, mostly waiting for AWS. Do it in one Learner Lab session (4 hours).

## What it costs

Everything is in us-east-1, with approximate on-demand prices:

| While running                                     | Per day       |
| ------------------------------------------------- | ------------- |
| Load balancer (internal: no public IPv4 charges)  | $0.54         |
| 1 app server, t3.micro (+ public IPv4, 8 GB disk) | $0.39         |
| RDS db.t3.micro + 20 GB storage                   | $0.51         |
| Secrets Manager endpoint + the secret             | $0.25         |
| WAF (web ACL + 2 rule groups)                     | $0.23         |
| API Gateway, Lambda, CloudWatch, SNS              | ~$0 (pennies) |
| **Total**                                         | **≈ $1.90**   |

At about $1.90 a day, two weeks of running around the clock costs about $27. **Pause it
between sessions** (part I): with the app stack deleted and the database stopped, it costs
about **$0.35 a day**. Check your spend at the top of the Learner Lab page ("Used $x of $50").

---

## Before you start

Tick all four:

- [ ] **Task 10 is done:** `cafestock-artifacts` and `cafestock-forecast` exist in CloudFormation.
- [ ] **Cognito (Task 6):** `cafestock-cognito` exists, with at least one user in the
      **manager** group and one in **staff**. If not, do steps 1–2 of
      [`docs/cognito-setup.md`](cognito-setup.md) first. The app on AWS only allows Cognito
      sign-in, not the development sign-in.
- [ ] You know the **passwords** of those users. If they were never used, the first sign-in
      asks for a new password; that's fine.
- [ ] Docker Desktop is running (for the local checks in part A).

---

## A. On your laptop (10 minutes)

1. Put `setup-cafestock.mjs` where you ran it last time and run `node setup-cafestock.mjs`,
   then `cd cafestock` (if you're not there already) and `npm install`.
2. Run `npm run db:up`, then `npm run check`. Expected: every test passes (238 backend, 108
   frontend).
3. Build the release:
   ```bash
   npm run app:build
   ```
   Expected ending:
   ```
   Release   dist/app/cafestock-app-xxxxxxxxxxxx.tgz
   Size      0.5 MB (3.6 MB unpacked), 132 files
   ```
   **Write down the file name.**
4. Check that the forecast Lambda package includes the RDS certificates. Open
   `dist/lambda/latest.json` in VS Code and look for `"rdsBundle": true`.
   - `true`: nothing to do.
   - `false`, or the file is missing: run `npm run lambda:build`, upload the new zip to the
     bucket's `lambda/` folder as in Task 10, and note its name for step G.

## B. Upload the release (S3, 3 minutes)

1. Learner Lab → **Start Lab** → wait for the green dot → **AWS**. Check the region is
   **N. Virginia (us-east-1)**.
2. **S3** → your `cafestock-artifacts-…` bucket → **Create folder** → `app` → **Create folder**.
3. Open `app/` → **Upload** → **Add files** → `dist/app/cafestock-app-xxxxxxxxxxxx.tgz` →
   **Upload**.

## C. Network (5 minutes)

1. _(Optional, left over from the first design.)_ **CloudFrontPrefixListId** can stay empty.
   The app stack now opens the load balancer to API Gateway's VPC link only. If you already
   created the network stack with a prefix list ID, keep it as it is.
2. **CloudFormation** → **Create stack** → **With new resources (standard)** → **Upload a
   template file** → `infra/network.yaml` → **Next**.
3. Stack name: `cafestock-network` → **Next** → **Next** → **Submit**.
4. Wait for **CREATE_COMPLETE** (2–3 minutes). Keep this stack's **Outputs** tab open in a
   browser tab; you need two values from it in step G.

## D. Database (15 minutes, mostly waiting)

1. In a new tab: **CloudFormation** → `cafestock-forecast` → **Outputs** → copy
   **AlertsTopicArn**.
2. **Create stack** → `infra/database.yaml` → **Next**.
3. Stack name: `cafestock-database`. **AlertsTopicArn**: paste it. Leave everything else as it
   is (db.t3.micro, PostgreSQL 17.11, single-AZ) → **Next** → **Next** → **Submit**.
4. Wait for **CREATE_COMPLETE** (about 10–15 minutes; RDS is the slow part).
5. **Outputs:** you'll need **DatabaseSecretArn** in step G.
6. _(Optional look)_ **Secrets Manager** → `cafestock/database` → **Retrieve secret value**
   shows the generated password and the database address. Nobody has to type it anywhere.

## E. App servers, load balancer, API Gateway, WAF (15–20 minutes)

1. Collect these values:

   | Parameter           | Where to find it                                                   |
   | ------------------- | ------------------------------------------------------------------ |
   | `ArtifactsBucket`   | `cafestock-artifacts` → Outputs → **BucketName**                   |
   | `AppKey`            | `app/` + your file name, e.g. `app/cafestock-app-2c458cd421ac.tgz` |
   | `CognitoUserPoolId` | `cafestock-cognito` → Outputs → **UserPoolId**                     |
   | `CognitoClientId`   | `cafestock-cognito` → Outputs → **ClientId**                       |
   | `AlertsTopicArn`    | `cafestock-forecast` → Outputs → **AlertsTopicArn**                |

2. **Create stack** → `infra/app.yaml` → **Next**. Stack name: `cafestock-app`. Fill in the
   five values above and leave the rest as it is (**PublicEntry** = `api-gateway`, **EnableWaf**
   = `true`) → **Next** → **Next** → **Submit**.
3. Wait for **CREATE_COMPLETE** (15–20 minutes). Meanwhile, the **Events** tab shows progress:
   - The **VPC link** for API Gateway takes a few minutes.
   - The **app server** starts and sets itself up: it installs Node.js, installs the API's
     packages, reads the database password, creates the tables and loads the café dataset.
     This takes about 5 minutes. The stack waits for the server's "I'm ready" signal.
   - To watch the server's set-up live: **CloudWatch** → **Log groups** → `/cafestock/app` →
     the stream ending in `/bootstrap`.
4. **Outputs:** **AppUrl** is your app (`https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com`).

If the stack fails, see [If something goes wrong](#if-something-goes-wrong).

## F. Try the app (10 minutes)

1. Open **AppUrl** and sign in with your **manager** account.
2. **Stock → History:** the café dataset, 388 days, ending within the last week. On the first
   start the dates were moved forward, as with `--shift-to-recent` locally.
3. **Items:** 8 items. **Stock → Record:** record a delivery; it's saved in RDS.
4. **Forecast:** "No forecast has run yet". Step G fixes that.
5. Sign out and sign in as **staff**: no Forecast tab.

## G. Connect the forecast Lambda to the database (10 minutes)

1. **CloudFormation** → `cafestock-forecast` → **Update** → **Use existing template** → **Next**.
2. Change only these parameters:

   | Parameter          | Value                                                                    |
   | ------------------ | ------------------------------------------------------------------------ |
   | `DbSecretArn`      | `cafestock-database` → Outputs → **DatabaseSecretArn**                   |
   | `SubnetIds`        | `cafestock-network` → Outputs → **PrivateSubnets** (`subnet-…,subnet-…`) |
   | `SecurityGroupIds` | `cafestock-network` → Outputs → **LambdaSecurityGroup**                  |
   | `CodeKey`          | only if you rebuilt the Lambda in step A4: the new file name             |

   Leave `DbHost` empty: the secret already holds the address.

3. **Next** → **Next** → **Submit**. Wait for **UPDATE_COMPLETE** (2–5 minutes). **Outputs**
   → **NightlySchedule** now says **ON - cron(0 18 \* \* ? \*) (UTC)**, which is 2:00 am
   Singapore time.
4. **Lambda** → `cafestock-forecast` → **Test** → **Create new event** → name `publish` →
   ```json
   { "orgs": ["demo-cafe"] }
   ```
   → **Save** → **Test**. Expected: "Forecast published for 1 café (0 skipped, 0 failed)",
   with `"model": "lgbm-v1"`. The first run inside the VPC takes 20–40 seconds.
5. Refresh the app's **Forecast** page: the cards, the table and the chart, now from AWS.
6. _(Demo)_ In the app, record **Wasted** Fresh milk **4500** and Napkin **20**. Then run the
   Lambda test with `{ "orgs": ["demo-cafe"], "force": true }` and refresh the page: milk shows
   **Urgent** and napkins **Reorder**. Within a few minutes you get an **ALARM:
   "cafestock-demo-cafe-urgent-items"** e-mail.

From now on it runs by itself every night.

## H. Check the security and resilience features (15 minutes, good report evidence)

1. **HTTPS only:** the browser's padlock shows a valid certificate for
   `*.execute-api.us-east-1.amazonaws.com`. API Gateway doesn't serve plain HTTP at all.
2. **No way around API Gateway:**
   - **EC2** → **Load balancers** → `cafestock-alb` shows **Scheme: Internal**, in the private
     subnets. Its address (**LoadBalancerAddress** output) resolves to 10.20.x.x private IPs
     that the internet can't reach.
   - Its security group accepts port 80 only from the VPC link.
   - Its listener answers 403 to anything without API Gateway's secret header.
3. **Firewall:** open your AppUrl with `/?q=<script>alert(1)</script>` added.
   - Expected: **403 Forbidden**, because WAF blocked it.
   - To see it logged: **WAF & Shield** → **Web ACLs**. The region selector on that page must
     be **US East (N. Virginia)** → `cafestock-web` → **Sampled requests**.
   - **Throttling:** **API Gateway** → `cafestock-web` → **Throttling** shows 50 requests/s
     (bursts of 100).
4. **Private database:** **RDS** → `cafestock-db` → **Connectivity & security**.
   **Publicly accessible: No**. Its security group allows port 5432 only from the app servers
   and the Lambda.
5. **Self-healing and scaling:**
   - **EC2** → **Auto Scaling groups** → `cafestock-app` → **Edit** → Desired capacity **2**
     → **Update**. After about 5 minutes, **Instance management** shows 2 **InService**, one
     per Availability Zone.
   - **Instances** → select one → **Instance state** → **Terminate**.
   - Keep reloading the app: it stays up. **Activity** shows Auto Scaling launching a
     replacement.
   - Afterwards set Desired capacity back to **1**.
6. **Monitoring:**
   - **CloudWatch** → **Dashboards** → `cafestock-app` (requests, response time, servers,
     errors) and `cafestock-forecast`.
   - **Log groups:** `/cafestock/app` (each server's `app` and `bootstrap` streams) and
     `/aws/lambda/cafestock-forecast`.
   - **Alarms:** all of them, with their e-mail actions.

## I. Pausing to save money

- **At the end of a work session**, keeping everything (about $1.10/day):
  - **EC2** → **Auto Scaling groups** → `cafestock-app` → **Edit** → Desired **0**, Minimum
    **0**.
  - **RDS** → `cafestock-db` → **Actions** → **Stop temporarily**.
  - To resume: **Start** the database, wait for **Available** (5–10 minutes), then set the
    Auto Scaling group back to Minimum 1, Desired 1. The server sets itself up again in
    about 5 minutes.
- **For longer breaks** (about $0.35/day): **delete the `cafestock-app` stack** and stop the
  database.
  - Your data stays in RDS.
  - To resume: start the database, then repeat part E. The new app address (AppUrl) will be
    different.
- **While the database is stopped** the nightly forecast fails and e-mails "ALARM:
  cafestock-forecast-failed". That's expected. To avoid it: **EventBridge** → **Rules** →
  `cafestock-forecast-nightly` → **Disable**.
- **Things that keep running:**
  - When the Learner Lab session ends, AWS stops the EC2 servers but **not** RDS. Stop the
    database yourself.
  - A stopped database starts again by itself after 7 days.

## J. Releasing a new version of the app

1. `npm run app:build`, then upload the new `.tgz` to `app/`.
2. **CloudFormation** → `cafestock-app` → **Update** → **Use existing template** → change
   **AppKey**.
3. The update starts a new server with the new release, waits for it to be ready, and only
   then retires the old one, so there's no downtime (about 10 minutes).

## Cleaning up at the end of the project

Delete the stacks in this order. Each must finish before the next.

1. `cafestock-app`
2. `cafestock-forecast`: releasing the Lambda's network interfaces can take up to 20 minutes.
3. `cafestock-database`: this keeps a final snapshot. Delete it under **RDS** →
   **Snapshots** if you don't need it.
4. `cafestock-network`
5. `cafestock-artifacts`: empty the bucket first (**S3** → bucket → **Empty**).
6. `cafestock-cognito`

## If something goes wrong

**First place to look for any failed stack:** the stack's **Events** tab, the first red line
from the bottom.

| What you see                                                                                   | Why / what to do                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cafestock-app`: **Set-up failed - see CloudWatch log group /cafestock/app …**                 | The server couldn't set itself up. Open the log group → the `…/bootstrap` stream → the last 20 lines say which step (1/9 … 9/9) failed and why. Send me those lines. Delete the stack and create it again after the fix.                   |
| `cafestock-app`: **Received 0 SUCCESS signal(s) out of 1** (after ~25 min)                     | The server never reported back. Check the `…/bootstrap` stream as above. If there is none, check **EC2** → the instance → **Actions** → **Monitor** → **Get system log**.                                                                  |
| `cafestock-app` fails at **VpcLink**, **HttpApi** or another API Gateway part (not authorized) | The Learner Lab may not allow API Gateway. Delete the stack and create it again with **PublicEntry = load-balancer**: the load balancer becomes public and serves plain **http://**. Everything else works the same. Say so in the report. |
| **ROLLBACK_COMPLETE** / "stack already exists" when creating again                             | A failed stack must be deleted before one with the same name can be created: **Delete**, wait until it disappears, then create it again.                                                                                                   |
| `cafestock-app` fails at **WebAcl** (not authorized / not supported)                           | The Learner Lab may not allow WAF. Delete the stack and create it again with **EnableWaf = false**, and say so in the report.                                                                                                              |
| `cafestock-database` fails: **Cannot find version 17.11**                                      | **RDS** → **Create database** → **PostgreSQL** → open the **Engine version** list (don't create anything) and pick a 17.x from it. Delete the failed stack and create it again with that **EngineVersion**.                                |
| `cafestock-network` fails at **LoadBalancerSecurityGroup** / prefix list                       | The prefix list ID is wrong. Delete the stack and create it again with it empty.                                                                                                                                                           |
| Stack fails with `LabRole` / `LabInstanceProfile` / **not authorized**                         | The lab session probably expired. **Start Lab** again and retry.                                                                                                                                                                           |
| App page: **503 Service Unavailable**, **504** or **502**                                      | The server is still starting or was replaced. Wait 5 minutes. **EC2** → **Target groups** → `cafestock-app` → **Targets** should show **healthy**.                                                                                         |
| Sign-in says the password is wrong / **user doesn't exist**                                    | Use the Cognito users from Task 6. **Cognito** → `cafestock-users` → **Users** → reset the password if needed.                                                                                                                             |
| Lambda test: **Can't reach the database** / timeout                                            | Step G values: **SubnetIds** must be the **Private**Subnets and **SecurityGroupIds** the **Lambda**SecurityGroup. Is the database running?                                                                                                 |
| Lambda test: **DB_SSL=verify-full needs a CA bundle**                                          | The Lambda package was built without the RDS certificates (step A4). Rebuild, upload and update **CodeKey**.                                                                                                                               |

## Design notes for the report

- **Security:**
  - HTTPS through API Gateway, with a valid AWS certificate.
  - API Gateway throttling.
  - WAF on the load balancer: common exploits and known bad inputs.
  - The load balancer is internal (no internet address). It only accepts API Gateway's VPC
    link, plus a secret header.
  - App servers only accept the load balancer, and have no SSH.
  - The database is in private subnets and only accepts the app servers and the Lambda.
  - TLS with certificate verification on every database connection.
  - Encrypted at rest (RDS, S3).
  - Passwords are generated and stored in Secrets Manager. On the servers the password sits
    in a root-only file, and the app runs as an unprivileged user with systemd hardening.
  - IMDSv2 only.
- **Scalability and availability:**
  - An Auto Scaling group across two Availability Zones, scaling on CPU (target 60%).
  - The load balancer's health checks replace failed servers.
  - Rolling updates with no downtime.
  - Stateless servers, each rebuilt from the release in S3.
  - Hashed static files are cached by browsers for a year.
- **Cost-driven trade-offs (Learner Lab, $50):**
  - No NAT gateway: the app servers live in public subnets but accept no traffic except from
    the load balancer. The private subnets use VPC endpoints instead.
  - The database is single-AZ; `MultiAZ=true` would add a standby.
  - **CloudFront isn't allowed in the Learner Lab** (`cloudfront:CreateDistribution` is
    denied). API Gateway provides the HTTPS address instead.
    - Trade-off: there's no CDN edge cache.
    - Trade-off: WAF's per-visitor rules (rate limit, IP reputation) can't see visitors' own IP
      addresses behind the VPC link, so API Gateway's throttling limits floods instead. With
      `PublicEntry=load-balancer` both rules are switched on.
  - API Gateway reaches the load balancer over HTTP inside the VPC. A certificate on the load
    balancer itself needs a custom domain, which the Learner Lab doesn't have.
  - The database password isn't rotated automatically.
