# AI use declaration

> **Draft for the team to check.** Correct anything that doesn't match what you actually did,
> fill in the TO FILL parts, and delete this note.

## Tools used

| Tool                                                                             | Used for                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Claude (Anthropic), as an AI coding and writing assistant                        | Implementation plan, most application, infrastructure and test code, documentation drafts, debugging help |
| TO FILL (any other AI tools, e.g. for the report or the team's analysis scripts) | TO FILL                                                                                                   |

## Where AI was used

| Area                                                                                     | What the AI produced                                                         | What the team did                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture and plan                                                                    | A 12-task implementation plan and architecture options                       | Chose the domain, problem and success criteria; approved or changed the plan; made the decisions recorded in the report (TO FILL: examples)                                |
| Web app and API (`src/backend`, `src/frontend`)                                          | Most of the code and its automated tests                                     | Specified features and UI changes (e.g. validation rules, dismissible notices, tab highlighting); ran and checked every step locally; reported bugs, which were then fixed |
| Dataset preparation (`analytics/build_ledger.py`, `forecast.py`, `evaluate_policy.py`)   | TO FILL (e.g. none / some)                                                   | TO FILL (e.g. written by the team)                                                                                                                                         |
| Forecast engine, ML model and evaluation (`src/forecasting`, `analytics/demand_model.*`) | The forecasting library, the LightGBM pipeline, the notebook and their tests | Checked the method against the brief; reviewed the results and limitations                                                                                                 |
| Cloud infrastructure (`src/infra`, `src/deploy`)                                         | CloudFormation templates and the server set-up script                        | Deployed them in the team's Learner Lab account; reported failures (e.g. CloudFront not permitted), which led to design changes; collected the evidence                    |
| Documentation and evidence templates                                                     | Guides in `src/docs`, test-record templates, threat-control map              | Ran the tests and filled in the actual results; wrote the report (TO FILL: say how AI was or wasn't used for the report)                                                   |

## Verification performed

- **Automated tests,** re-run by the team (`npm run evidence:tests`, see
  `evidence/test-runs/SUMMARY.md`):
  - backend API tests with a real PostgreSQL database;
  - web-app tests;
  - forecast engine and Lambda tests;
  - ML reproducibility tests.
- **Hands-on checks:** each implementation step was run and checked on a team member's own
  machine before moving on. Problems were reported and fixed (e.g. Windows-specific test
  failures, a missing database migration).
- **The AWS deployment** was carried out and tested by the team. The results are in `evidence/`.
- **The ML result was checked:** the evaluation reproduces exactly, and the model isn't claimed
  to beat the baseline where it doesn't.
- TO FILL: any code review or other checks the team did.

## Sources, baselines and licences

- **No open-source application was used as a starting point.** The code was written for this
  project with AI assistance, as described above.
- **Dataset:** Coffee Sales Dataset by Navjot Kaushal (Kaggle),
  https://www.kaggle.com/datasets/navjotkaushal/coffee-sales-dataset. Licence: TO FILL (see
  `data/README.md`).
- **Main libraries (used unmodified, from npm/PyPI):**
  - **MIT:** Express, React, React Router, Vite, zod, Helmet, jose, pg, TanStack Query, cors,
    Vitest, Testing Library, Supertest, ESLint, Prettier, LightGBM.
  - **Apache-2.0:** Prisma, aws-jwt-verify, TypeScript.
  - **BSD-3-Clause:** numpy, pandas, scipy, pg8000, Jupyter (nbclient).
  - **Matplotlib licence (PSF-based):** matplotlib.
  - **The Lambda package** also bundles `libgomp` (GCC OpenMP runtime, GPL-3.0 with the GCC
    Runtime Library Exception), taken from scikit-learn's Linux wheel.
- **AWS services** are used under the AWS Academy Learner Lab terms.

## Responsible use

- No personal data is used or collected beyond the users' own sign-in e-mail.
- The forecast advises; a person decides and orders. The page shows how each number was worked
  out, and how accurate the forecast has been.
