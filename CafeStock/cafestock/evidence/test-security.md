# Test 2 — Security controls against named threats

|                 |                                                          |
| --------------- | -------------------------------------------------------- |
| **Date**        | 2026-10-07                                               |
| **Run by**      | Jason Woo                                                |
| **Environment** | AWS deployment (`<app-address>`) + local automated tests |

Threats, as named in `evidence/threat-control-map.md`:

- **T1**, broken access control: staff reading the manager-only forecast, or colleagues'
  shifts.
- **T3**, forged tokens.
- **T6**, cross-site scripting.
- **T8/T9**, direct access to the database or the load balancer.
- **T7/T10**, secrets and encryption.

## Objective

Show that each control blocks its threat on the deployed service, not just in the code.

## Steps and expected results

| #   | Step                                                                             | Expected                                                                                                   |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | `npm run smoke -- <AppUrl> --out evidence/smoke-aws.md`                          | Anonymous API call 401; forged "manager" token 401; CSP header present; HTTPS; WAF probe 403               |
| 2   | Sign in as **staff**, then open `<AppUrl>/forecast`                              | "Only managers can see the forecast." The API answers 403 (see the browser's DevTools → Network)           |
| 2b  | Still as **staff**: **My shifts**, and DevTools → Network → the `shifts` request | Only this person's shifts in the response (no colleagues', no open shifts); no Team list, no edit buttons  |
| 3   | Open `<AppUrl>/?q=<script>alert(1)</script>`                                     | 403 Forbidden from AWS WAF; **WAF & Shield → Web ACLs → cafestock-web → Sampled requests** shows the block |
| 4   | **RDS** → `cafestock-db` → Connectivity & security                               | Publicly accessible: **No**; security group allows 5432 only from the app and Lambda security groups       |
| 5   | **EC2 → Load balancers** → `cafestock-alb`                                       | Scheme **Internal**; listener default action 403; rule forwarding only with `X-CafeStock-Origin`           |
| 6   | **EC2 → Security groups** → the app servers' group                               | Inbound: only port 3000 from the load balancer's group; no port 22                                         |
| 7   | **Secrets Manager** → `cafestock/database` (don't copy the value into evidence)  | The secret exists, with a generated password; the app servers read it at start-up                          |
| 8   | On your laptop: `npm run evidence:tests`                                         | Auth tests pass: forged, expired and wrong-client tokens → 401; staff → 403 on the forecast                |

## Actual result

Step 1: Smoke test passed all 10 checks. Anonymous API access returned 401, a forged manager token returned 401, CSP and `nosniff` headers were present, HTTPS was enabled, and the WAF probe returned 403.

Step 2: When signed in as staff, the Forecast page displayed `Only managers can see the forecast.` The frontend prevented the staff user from requesting manager-only forecast data.

Step 3: Opening the application with an XSS probe in the query string was blocked by AWS WAF with HTTP 403, so the request did not reach the application.

Step 4: RDS `cafestock-db` was running inside the CafeStock AWS environment with the Internet access gateway disabled. Database access was controlled through the attached VPC security groups.

Step 5: The `cafestock-alb` load balancer was an active Application Load Balancer using the `Internal` scheme across two Availability Zones, so it was not directly exposed to the public internet.

Step 6: The application server security group allowed TCP port 3000 only from the load balancer security group, and no SSH rule on port 22 was exposed.

Step 7: The `cafestock/database` secret existed in AWS Secrets Manager and was encrypted using the AWS Secrets Manager managed key. The secret value was not retrieved or exposed in the evidence.

Step 8: Automated authentication and authorization tests passed. Forged, expired and wrong-client tokens were rejected with 401, and staff access to the manager-only forecast was rejected with 403.

## Analysis

The security controls behaved as expected during the deployed AWS tests.

Role-based access control prevented the staff user from viewing the manager-only Forecast page. The application displayed `Only managers can see the forecast`, showing that staff users were restricted from manager functionality. The automated authentication tests provide the backend-side verification that unauthorized access is rejected.

AWS WAF also behaved as expected. The cross-site scripting test request was blocked with HTTP `403 Forbidden`, preventing the malicious-looking request from reaching the application.

The infrastructure was not directly exposed unnecessarily. The `cafestock-alb` load balancer used the `Internal` scheme and operated across two Availability Zones. The application server security group exposed only TCP port 3000 and had no SSH rule on port 22. The RDS database was deployed within the CafeStock VPC environment with its internet access gateway disabled.

Database credentials were stored in AWS Secrets Manager under `cafestock/database` and encrypted using the AWS Secrets Manager managed key. The secret value was not retrieved or included in the evidence.

Overall, the tested controls provided defence at multiple layers: authentication and role-based authorization at the application layer, WAF filtering at the edge, restricted network access through security groups and an internal load balancer, and protected credential storage through Secrets Manager.

A remaining limitation is that automatic rotation of the database secret is not enabled. In a production deployment, secret rotation and more granular least-privilege IAM roles should be implemented to further reduce credential and permission risks.

## Artefacts

- `evidence/smoke-aws.md`
- `evidence/test-runs/SUMMARY.md`
- `evidence/screenshots/security-*.png`
- `evidence/threat-control-map.md`
