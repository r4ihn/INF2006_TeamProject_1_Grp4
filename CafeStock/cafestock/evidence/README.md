# Evidence

Everything a marker needs to check our claims without a live AWS account. Paths are relative to
the ZIP root.

| File                                    | What it is                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `architecture.png` (`architecture.svg`) | Architecture diagram: components, trust boundaries, data flows           |
| `threat-control-map.md`                 | Threats → controls → where implemented → tests                           |
| `test-functional.md`                    | Test 1 — functional workflow                                             |
| `test-security.md`                      | Test 2 — security controls                                               |
| `test-data-ai.md`                       | Test 3 — demand model vs baseline (data/AI validation)                   |
| `test-resilience.md`                    | Test 4 — server failure and replacement                                  |
| `monitoring.md`                         | Monitoring set-up, alarm test, log query                                 |
| `deployment.md`                         | What was deployed on AWS, when, with which versions                      |
| `test-runs/SUMMARY.md`                  | Recorded output of every automated test suite (`npm run evidence:tests`) |
| `smoke-aws.md`, `availability-aws.md`   | Output of `npm run smoke` against the deployed service                   |
| `screenshots/`                          | Redacted console screenshots cited by the records above                  |
