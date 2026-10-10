# Monitoring and an operational alert test

|            |            |
| ---------- | ---------- |
| **Date**   | 2026-10-01 |
| **Run by** | Jason Woo  |

## What is monitored

| Signal                                                                    | Where                                                             | Alert                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| App and set-up logs (every server)                                        | CloudWatch Logs `/cafestock/app` (`<instance>/app`, `/bootstrap`) |                                                                                              |
| Requests, response time (p95), 5xx, servers in service, CPU, WAF blocks   | Dashboard `cafestock-app`                                         | `cafestock-app-5xx`, `cafestock-app-unhealthy`                                               |
| Forecast runs: items to order, urgent items, MASE of each model, run time | Dashboard `cafestock-forecast`, metrics `CafeStock/Forecast`      | `cafestock-forecast-failed`, `cafestock-forecast-missed`, `cafestock-demo-cafe-urgent-items` |
| Database CPU and free storage                                             | RDS metrics                                                       | `cafestock-db-cpu-high`, `cafestock-db-storage-low`                                          |

All alarms e-mail the team through the SNS topic `cafestock-forecast-alerts`.

## Operational test: a failed forecast run raises an alarm

1. **Lambda → cafestock-forecast → Test** with the event `{ "fail": true }`. The function fails intentionally to verify the monitoring and alerting setup.
2. Wait for the **ALARM: "cafestock-forecast-failed"** e-mail.
3. **CloudWatch → Alarms**: verify that the alarm history shows OK → ALARM → OK.

**Expected:** an ALARM e-mail within about 5 minutes, followed by the alarm returning to OK once no further errors occur.

**Actual:** The deliberate failed forecast test occurred at `2026-09-30 04:15:37 UTC`. The `cafestock-forecast-failed` alarm changed from OK to ALARM at `2026-09-30 04:16:05 UTC`, approximately 28 seconds after the test failure. The alarm returned from ALARM to OK at `2026-09-30 04:31:05 UTC`.

The alarm therefore detected the deliberate forecast failure successfully and later returned to its normal OK state once no additional failures were recorded.

## Log query (CloudWatch Logs Insights)

Log group `/aws/lambda/cafestock-forecast`:

```text
fields @timestamp, event, message, model, maseModel, maseBaseline
| filter ispresent(event)
| sort @timestamp desc
| limit 20
```
