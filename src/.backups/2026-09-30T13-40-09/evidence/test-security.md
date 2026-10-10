# Test 2 — Security controls against named threats

|                 |                                                          |
| --------------- | -------------------------------------------------------- |
| **Date**        | TO FILL (YYYY-MM-DD)                                     |
| **Run by**      | TO FILL (name)                                           |
| **Environment** | AWS deployment (`<app-address>`) + local automated tests |

Threats, as named in `evidence/threat-control-map.md`:

- **T1**, broken access control: staff reading the manager-only forecast.
- **T3**, forged tokens.
- **T6**, cross-site scripting.
- **T8/T9**, direct access to the database or the load balancer.
- **T7/T10**, secrets and encryption.

## Objective

Show that each control blocks its threat on the deployed service, not just in the code.

## Steps and expected results

| #   | Step                                                                            | Expected                                                                                                   |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | `npm run smoke -- <AppUrl> --out evidence/smoke-aws.md`                         | Anonymous API call 401; forged "manager" token 401; CSP header present; HTTPS; WAF probe 403               |
| 2   | Sign in as **staff**, then open `<AppUrl>/forecast`                             | "Only managers can see the forecast." The API answers 403 (see the browser's DevTools → Network)           |
| 3   | Open `<AppUrl>/?q=<script>alert(1)</script>`                                    | 403 Forbidden from AWS WAF; **WAF & Shield → Web ACLs → cafestock-web → Sampled requests** shows the block |
| 4   | **RDS** → `cafestock-db` → Connectivity & security                              | Publicly accessible: **No**; security group allows 5432 only from the app and Lambda security groups       |
| 5   | **EC2 → Load balancers** → `cafestock-alb`                                      | Scheme **Internal**; listener default action 403; rule forwarding only with `X-CafeStock-Origin`           |
| 6   | **EC2 → Security groups** → the app servers' group                              | Inbound: only port 3000 from the load balancer's group; no port 22                                         |
| 7   | **Secrets Manager** → `cafestock/database` (don't copy the value into evidence) | The secret exists, with a generated password; the app servers read it at start-up                          |
| 8   | On your laptop: `npm run evidence:tests`                                        | Auth tests pass: forged, expired and wrong-client tokens → 401; staff → 403 on the forecast                |

## Actual result

TO FILL — one line per step with what you saw. Put screenshots in `evidence/screenshots/`
(`security-2-staff-forecast.png`, `security-3-waf-block.png`, `security-4-rds.png`,
`security-5-alb.png`, `security-6-app-sg.png`). **Redact account IDs and addresses before
saving.**

## Analysis

TO FILL — did every control behave as expected? If anything failed, say why and what you'd
change.

## Artefacts

- `evidence/smoke-aws.md`
- `evidence/test-runs/SUMMARY.md`
- `evidence/screenshots/security-*.png`
- `evidence/threat-control-map.md`
