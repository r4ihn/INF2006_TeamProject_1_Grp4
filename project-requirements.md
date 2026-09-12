# Project Requirements: Cloud-Hosted Stock Inventory Service for F&B Small Businesses

## 1. Problem Statement

Small F&B (food & beverage) businesses lack visibility into real-time stock levels, leading to
stockouts, spoilage/wastage, and phantom stock caused by disconnected POS and inventory
tracking. This project designs, builds, tests and justifies a secure, scalable, cloud-hosted
web application that gives an F&B business owner a single source of truth for stock levels,
using an immutable stock-movement ledger rather than an overwritable quantity field (see
`stock-inventory-system-summary.md`, Section 1).

The scope for this project is intentionally the **fundamentals-first build**: a single-location
F&B business (one kitchen/store, not a multi-city chain), one primary user workflow, and one
data-driven feature. Complexity (multi-region, event sourcing, CQRS) is noted as a "stretch"
option only — not required.

## 2. Cloud Provider and Service Model

- **Provider**: AWS (per module requirement).
- **Deployment model**: Public cloud, single region.
- **Service model boundary to justify in the report**:
  - IaaS (EC2) vs PaaS (Elastic Beanstalk / App Runner) vs SaaS (a hosted no-code tool) —
    state which was chosen and why the other two were rejected. (SaaS was chosen)
  - Hint to research: what operational responsibility (patching, scaling, runtime) shifts
    from your team to AWS at each layer.

## 3. Module Concepts to Integrate

The build must visibly demonstrate each of the following (map each to a specific
component in your architecture diagram and README):

| Concept area | Where it must show up in this project |
|---|---|
| Cloud fundamentals | Justification of on-prem vs cloud, and public vs private cloud, for a small F&B business |
| SaaS & deployment choices | Explicit statement of chosen model + 2 alternatives considered |
| VMs, deployment, scaling | Compute choice (EC2 or managed service) + at least one scaling mechanism |
| Cloud storage & databases | Managed relational DB (RDS) for the stock ledger + object storage (S3) for exports/backups |
| Data analytics/AI | One interpretable data-driven feature (see Section 6) |
| Security for cloud data access | IAM least privilege, secrets handling, network restriction, auth on the web app |

## 4. Minimum Technical Requirements

All rows are compulsory. Choose specific technologies, but every row must be satisfiable.

| Area | Minimum requirement | Acceptable evidence |
|---|---|---|
| **Application** | A functioning web application with at least one meaningful user workflow and input validation. Recommended workflow: "record a stock movement" (receive / sell / adjust / transfer), sourced from the ledger model in `stock-inventory-system-summary.md`. | Source code, local run instructions, API test collection or recorded test output. |
| **Compute and deployment** | Cloud deployment using a VM, managed application platform, container service, or equivalent. Explain the chosen SaaS boundary. | Infrastructure/configuration files, deployment record, architecture diagram, redacted provider evidence. |
| **Data layer** | Persistent cloud storage or database with a defined schema/data model. No production credentials or personal data. Minimum tables: `products`, `stock_movements`, and one of `warehouses`/`suppliers`. Explicit input validation rules to be added | Schema/migration file, sample synthetic dataset, storage/database configuration, test output. |
| **Analytics or AI/ML** | One data-driven feature producing an interpretable output — e.g. low-stock dashboard metric, simple reorder-point forecast, or wastage/spoilage trend. | Notebook/script, dataset provenance, evaluation metric or validation result, example inputs/outputs, limitations. |
| **Scalability and resilience** | A documented approach to handling demand or component failure; implement at least one mechanism (horizontal scaling, load balancing, caching, health checks, backup/recovery, or managed availability). | Configuration, test procedure, measured/observed result. |
| **Security** | Authentication/authorisation appropriate to the service, least-privilege access, secure secret handling, restricted network/data access, and validation against one named threat. | Redacted policy/configuration, threat-control mapping, code/configuration, test evidence. |
| **Operations** | Logging/monitoring and one operational test or alert/query. | Dashboard/query export, logs with sensitive fields removed, interpretation. |

## 5. Architecture Design Guidance

Produce **one** architecture diagram. It must show all of the following elements, and every
label must match the filenames/component names used in your repository and evidence:

1. **Users** — who interacts with the system (e.g. store staff recording stock, owner viewing
   dashboard). Distinguish user roles if authorisation differs between them.
2. **Application components** — the web app / API, and any background worker.
3. **Cloud services** — the specific AWS services used for compute, database, storage, and
   (if used) cache/queue.
4. **Trust boundaries** — draw a boundary around what is public-facing (e.g. load balancer/API
   gateway) vs private (e.g. database subnet). This is where your security section connects
   to your architecture.
5. **Data stores** — the stock-movement ledger (source of truth) and any derived
   "current stock" store, if you choose to keep one.
6. **Observability** — where logs/metrics are collected (e.g. CloudWatch) and what is
   monitored.
7. **Data flows** — arrows showing the direction of each request/response and any
   asynchronous event (e.g. a stock movement triggering a low-stock check).

### Suggested starting (fundamentals-first) flow

```
User (browser)
     |
     v
Load balancer / API Gateway  <-- trust boundary: public
     |
     v
App server (single instance or small ASG)
     |
     v
Relational database (stock_movements ledger)  <-- trust boundary: private subnet
     |
     v
Object storage (backups, exports)
```

- Build this single-server, single-database version **first**. Confirm the core workflow
  (recording a stock movement, viewing current stock) works end-to-end before adding
  anything else.
- Only add a cache (e.g. ElastiCache/Redis) or a queue (e.g. SQS) once you can point to a
  specific, observed bottleneck (e.g. dashboard reads slowing down as movement history
  grows). Do not add them by default — justify each addition in the report.
- Hint to research: why is "current stock" typically treated as a *derived* value from the
  movement ledger rather than a value you write directly? What breaks if you only store
  the current quantity?

## 6. Data / AI Feature Guidance (F&B Context)

Pick **one** feature; keep it interpretable rather than a black box. Candidates ranked by
implementation complexity (lowest first):

1. **Low-stock dashboard metric** — flag products below `reorder_threshold`, computed from
   the movement ledger. Lowest complexity; still counts as "data-driven."
2. **Wastage/spoilage trend** — aggregate movements tagged as spoilage/adjustment over time,
   by product or category.
3. **Simple reorder-point forecast** — use historical movement volume (e.g. moving average)
   to suggest a reorder quantity. Requires you to state your method plainly; a moving
   average is acceptable and expected at this level — do not over-build a full ML pipeline
   unless you have time budget for it.

For whichever you choose, the report must state: dataset provenance (synthetic/sample data
only), fields/features used, preprocessing, how to interpret the output, how you evaluated it
(even informally), and its limitations.

## 7. Test Plan

Run and report **at least four tests**. For each, record: objective, setup, command/steps,
expected result, actual result, date, and artefact path. A failed test can still earn credit
if honestly reported with a follow-up improvement plan.

| # | Test type | Suggested scope for this project |
|---|---|---|
| 1 | **Functional workflow test** | Record a stock movement end-to-end (e.g. "receive stock" reduces nothing, "sell stock" decrements current stock) and confirm the resulting stock level is correct. |
| 2 | **Security control test** | Attempt an unauthorised action (e.g. call the stock-movement endpoint without a valid session/token) and confirm it is rejected. Name the threat this defends against (e.g. unauthenticated write access). |
| 3 | **Data/AI validation test** | Feed a known synthetic dataset into your analytics/AI feature and confirm the output matches expectations (e.g. a product below threshold is correctly flagged as low-stock). |
| 4 | **Scalability, resilience or recovery test** | Demonstrate your chosen mechanism from Section 4 — e.g. simulate a second concurrent request to check for a race condition on stock decrement, or demonstrate recovery from a database restart/backup. |

Hint to research: for test #2, look into what "least privilege" means at both the
application layer (roles/permissions) and the infrastructure layer (IAM policies scoped to
only the resources a service needs).

## 8. Explicit Non-Goals for This Round

To keep the first round of requirements fundamentals-focused, the following are **not**
required (but may be noted as future work in the report):

- Multi-region or multi-location deployment.
- Event-sourced or CQRS architecture.
- Real-time WebSocket/SSE updates (polling is sufficient).
- Recipe-based ingredient deduction (one dish → multiple ingredient decrements) — note it as
  a known limitation if your chosen workflow is single-SKU only.
- A trained/custom ML model — a moving average or threshold rule is sufficient for the
  analytics requirement at this stage.

## 9. Deliverable Mapping

This document's requirements map to the module's required submission package
(`README.md`, `project_manifest.yaml`, `report.pdf`, `src/`, `data/`, `analytics/`,
`evidence/`, `tests/`, `TEAM_CONTRIBUTIONS.md`, `AI_USE_DECLARATION.md`). Confirm every
requirement in Sections 4, 5, and 7 above has a corresponding artefact path before packaging
the final ZIP.
