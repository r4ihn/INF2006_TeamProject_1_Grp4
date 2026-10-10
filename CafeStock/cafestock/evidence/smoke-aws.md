# Smoke test — 2026-10-07 10:38:41 UTC

Target: `<app-address>` · Node.js v24.16.0 · command: `npm run smoke -- <app-address>`

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| Liveness `GET /health` | 200, status ok | 200 (950 ms) | PASS |
| Database reachable `GET /health/ready` | 200, database up, tables ok | 200, database up, tables ok (1150 ms) | PASS |
| Web app page `GET /stock` | 200, the CafeStock page | 200, CafeStock page | PASS |
| Sign-in method `GET /auth/config` | cognito on AWS (dev locally) | cognito | PASS |
| Anonymous API call is refused `GET /api/items` | 401 AUTH_REQUIRED | 401 AUTH_REQUIRED | PASS |
| Forged "manager" token is refused `GET /api/forecast/latest` | 401 | 401 INVALID_TOKEN | PASS |
| Content-Security-Policy header | script-src 'self', no inline scripts | script-src 'self' | PASS |
| X-Content-Type-Options header | nosniff | nosniff | PASS |
| HTTPS | https:// address | https | PASS |
| Firewall blocks a cross-site-scripting probe `/?q=<script>…` | 403 (AWS WAF on AWS) | 403 | PASS |

**10 passed, 0 failed, 0 not applicable here (INFO).**

INFO = expected to differ on this target (e.g. no HTTPS or WAF when running locally).
