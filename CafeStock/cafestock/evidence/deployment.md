# Deployment record (AWS)

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Date**         | 2026-10-01                                                                              |
| **Deployed by**  | Jason Woo                                                                               |
| **Account**      | AWS Academy Learner Lab, us-east-1 (830670673303)                                       |
| **Instructions** | `src/docs/aws-deploy.md`, `src/docs/aws-forecast-setup.md`, `src/docs/cognito-setup.md` |

## Stacks

| Stack                 | Template                   | Status (e.g. CREATE_COMPLETE) | Created on |
| --------------------- | -------------------------- | ----------------------------- | ---------- |
| `cafestock-cognito`   | `src/infra/cognito.yaml`   | CREATE_COMPLETE               | 2026-09-30 |
| `cafestock-artifacts` | `src/infra/artifacts.yaml` | CREATE_COMPLETE               | 2026-09-30 |
| `cafestock-forecast`  | `src/infra/forecast.yaml`  | CREATE_COMPLETE               | 2026-09-30 |
| `cafestock-network`   | `src/infra/network.yaml`   | CREATE_COMPLETE               | 2026-09-30 |
| `cafestock-database`  | `src/infra/database.yaml`  | CREATE_COMPLETE               | 2026-09-30 |
| `cafestock-app`       | `src/infra/app.yaml`       | CREATE_COMPLETE               | 2026-09-30 |

Screenshot of the CloudFormation stack list: `evidence/screenshots/deployment-1-stacks.png`,`evidence/screenshots/deployment-2-stacks.png`, `evidence/screenshots/deployment-3-stacks.png`.

## Release versions

| Piece           | File (from `npm run app:build` / `npm run lambda:build`) | SHA-256 (first 12) |
| --------------- | -------------------------------------------------------- | ------------------ |
| App release     | TO FILL                                                  | TO FILL            |
| Forecast Lambda | TO FILL                                                  | TO FILL            |
| Model `lgbm-v1` | `analytics/models/lgbm-v1/model.txt`                     | see `model.json`   |

## Observed cost

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

## Problems met and fixes

- The `cafestock-network` CloudFormation stack initially failed and rolled back because one EC2 security group rule description contained an unsupported apostrophe character (`CloudFront's`). AWS rejected the rule with `Invalid rule description`. The description was changed to a supported format without the apostrophe, the failed stack was deleted, and the network stack was recreated successfully.

- After deploying the updated application release, the new Roster feature did not appear immediately in the browser even though the CloudFormation update completed successfully. The browser was still using cached frontend files. A hard refresh (`Ctrl + Shift + R`) forced the latest React bundle to load, after which the Roster tab appeared.

- During local evidence testing, `npm run check` failed because `infra/app.yaml` and `infra/database.yaml` did not match the project's Prettier formatting rules. Running `npm run format` corrected the formatting, after which the checks could be rerun.

- A local development run initially failed because port 5173 was already in use by another Vite process. The old process was stopped before restarting the frontend.

- A backend command also failed once because it was run from the parent folder instead of the generated `cafestock` project folder, so npm could not find `package.json`. Changing into the correct project directory resolved the issue.
