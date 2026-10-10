# Setting up Amazon Cognito sign-in (AWS Academy Learner Lab)

Until you do this, CafeStock uses **development sign-in**: the login page lets you pick
_staff_ or _manager_ with no password. Everything else works the same. When you're ready for
real accounts, follow these steps (about 15 minutes).

**Cost:** $0. The pool uses Cognito's **Lite** plan — 10,000 monthly active users free,
with no time limit. Cognito's built-in email (for invitations) is also free, capped at
about 50 emails a day. Nothing here runs by the hour, so it doesn't eat your Learner Lab
budget while idle.

**What gets created:** one user pool (`cafestock-users`), two groups (`manager`, `staff`)
and one app client (`cafestock-web`). No IAM roles — the Learner Lab doesn't allow creating
them, and Cognito doesn't need any here.

---

## 1. Create the user pool (CloudFormation)

1. Open the Learner Lab, click **Start Lab**, wait for the dot to turn green, then click
   **AWS** to open the console.
2. Check the region (top right) is **N. Virginia (us-east-1)** — the Learner Lab only
   allows us-east-1 and us-west-2.
3. Search for **CloudFormation** → **Create stack** → **With new resources (standard)**.
4. **Upload a template file** → choose `infra/cognito.yaml` from the project → **Next**.
5. Stack name: `cafestock-cognito`. Leave `AppName` as `cafestock` → **Next** → **Next**.
6. Tick nothing else, click **Submit**. Wait about a minute until the status is
   **CREATE_COMPLETE**.
7. Open the **Outputs** tab. You'll need **UserPoolId** (looks like `us-east-1_AbC123xyz`)
   and **ClientId** (a long string of letters and numbers).

> If CloudFormation says you're not authorised to create Cognito resources, tell your
> lecturer/teammates — the Learner Lab's service list (in the Learner Lab **Readme**) shows
> whether Cognito is enabled for your class. The app keeps working in development sign-in
> mode meanwhile.

## 2. Create accounts for the demo

In the console, search for **Cognito** → **User pools** → **cafestock-users**.

For each person (make at least one **manager** and one **staff**):

1. **Users** tab → **Create user**.
2. **Invitation message:** _Send an email invitation_ (Cognito emails a temporary
   password) — or _Don't send an invitation_ if you'll tell them the password yourself.
3. **Email address:** e.g. `manager@yourdomain.com`. Tick **Mark email address as verified**.
4. **Temporary password:** _Set a password_ (at least 10 characters with lower-case letters
   and a number, e.g. `Welcome2026x`) or let Cognito generate one.
5. **Create user**.
6. Open the **Groups** tab → **manager** (or **staff**) → **Add user to group** → pick the
   user → **Add**.

The first time they sign in to CafeStock they'll be asked to choose their own password.

**Roles:** `manager` can do everything including the forecast; `staff` can manage
suppliers, items and stock. Someone in neither group can sign in but will see
"Your account has no role yet". Moving someone between groups takes effect the next time
their session refreshes (within an hour) or when they sign in again.

**Which café (optional):** everyone joins the default café (_Demo Café_) unless their
account has the attribute `custom:org` set to another café's slug. To set it: **Users** →
the user → **User attributes** → **Edit** → **custom:org**. This is how the app becomes
multi-tenant later without changing any code.

## 3. Connect the app

1. In the project, copy `backend/.env.example` to `backend/.env` if you haven't already
   (PowerShell: `Copy-Item backend/.env.example backend/.env`).
2. Open `backend/.env` and fill in the two values from step 1:
   ```
   COGNITO_USER_POOL_ID=us-east-1_AbC123xyz
   COGNITO_CLIENT_ID=4abc123def456ghi789jkl0mn
   ```
3. Restart the app (<kbd>Ctrl</kbd>+<kbd>C</kbd>, then `npm run dev`). The terminal says
   `Sign-in: Amazon Cognito (us-east-1_AbC123xyz)` and the login page now asks for an
   email and password.

To go back to development sign-in, comment those two lines out (put `#` in front) or set
`AUTH_MODE=dev`.

**Does it keep working when the Learner Lab session ends?** Yes — the user pool stays when
the lab stops, and signing in only talks to Cognito's public endpoints, which don't need
your lab session. (EC2 instances do stop; that matters from Task 11.)

---

## How it works (for the report)

```
Browser ──(email + password)──► Cognito  ──► access token (JWT, 1 h) + refresh token (12 h)
Browser ──(Authorization: Bearer <access token>)──► CafeStock API
API: verify signature with the pool's public keys (JWKS) · check expiry, issuer,
     token_use = access, client_id · role from "cognito:groups" · café from users table
```

- **Tokens:** the web app signs in with Cognito's `USER_PASSWORD_AUTH` flow over HTTPS and
  keeps the tokens in `sessionStorage` (cleared when the tab closes). It refreshes the
  access token before it expires and revokes the refresh token on sign-out.
- **Verification:** the API uses AWS's `aws-jwt-verify` library. It downloads the pool's
  public signing keys once and verifies every request locally — no call to AWS per request.
- **Authorisation:** the role comes from the token's `cognito:groups` claim on every
  request (manager wins if someone is in both groups). Forecast endpoints require `manager`
  (staff get **403**); a missing, forged or expired token gets **401**.
- **Tenancy:** on someone's first request the API calls Cognito's `GetUser` (authorised by
  their own token) to learn their email and `custom:org`, creates their `users` row in that
  café, and from then on every query is scoped to that café's `org_id`.
- **Development sign-in** uses the very same verifier: at start-up the API makes its own
  key pair, gives the public key to the verifier, and signs Cognito-shaped tokens with the
  private key. It refuses to run when `NODE_ENV=production`.

### Command-line alternative (optional)

If you've set up the AWS CLI with your Learner Lab credentials (**AWS Details** →
**AWS CLI** → copy into `~/.aws/credentials`):

```bash
aws cloudformation deploy --stack-name cafestock-cognito --template-file infra/cognito.yaml --region us-east-1
aws cloudformation describe-stacks --stack-name cafestock-cognito --region us-east-1 --query "Stacks[0].Outputs"

# a manager account (repeat with --group-name staff for staff)
aws cognito-idp admin-create-user --region us-east-1 --user-pool-id <UserPoolId> \
  --username manager@example.com --temporary-password Welcome2026x --message-action SUPPRESS \
  --user-attributes Name=email,Value=manager@example.com Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --region us-east-1 --user-pool-id <UserPoolId> \
  --username manager@example.com --group-name manager
```

To remove everything: CloudFormation → `cafestock-cognito` → **Delete**.
