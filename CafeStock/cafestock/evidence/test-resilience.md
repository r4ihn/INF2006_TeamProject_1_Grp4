# Test 4 — Resilience: a server fails and the service stays up

|                 |                                                         |
| --------------- | ------------------------------------------------------- |
| **Date**        | 2026-10-07                                              |
| **Run by**      | Jason Woo                                               |
| **Environment** | AWS deployment (`<app-address>`), stack `cafestock-app` |

## Objective

Show that the Auto Scaling group and the load balancer's health checks keep CafeStock available
when an app server dies, and that a replacement starts by itself.

## Setup

- Mechanisms under test:
  - Auto Scaling group `cafestock-app` across two Availability Zones;
  - load balancer health checks on `/health` every 15 s (3 failures = unhealthy);
  - health check type `ELB` (unhealthy servers are replaced).
- Before starting: **EC2 → Auto Scaling groups → cafestock-app → Edit → Desired capacity 2** →
  wait until **Instance management** shows 2 × InService and **Target groups → cafestock-app →
  Targets** shows 2 × healthy (about 5 minutes).

## Steps

1. On your laptop, start measuring (keeps running for 15 minutes):
   `npm run smoke -- <AppUrl> --watch 900 --out evidence/availability-aws.md`
2. **EC2 → Instances** → select one `cafestock-app` instance → **Instance state → Terminate**.
   Note the time.
3. Watch **Auto Scaling groups → cafestock-app → Activity**: a new instance is launched.
   Screenshot (`evidence/screenshots/resilience-1-activity.png`).
4. When the watch finishes, screenshot **Target groups → Targets** showing 2 healthy again
   (`resilience-2-targets.png`) and the `cafestock-app` dashboard (`resilience-3-dashboard.png`).
5. Set Desired capacity back to **1**.

## Expected result

- The terminated instance stops receiving traffic quickly.
- The service remains available, or has only a very brief interruption.
- Auto Scaling launches a replacement automatically.
- The replacement becomes healthy within about 10 minutes.

## Actual result

Requests: 882
Answered 200: 828
Failed: 54
Availability: 93.88%
Longest outage: 46 s
Slowest answer: 2319 ms

## Analysis

The Auto Scaling group successfully detected the failed EC2 instance and automatically launched a replacement, showing that the self-healing mechanism worked as intended.

However, the service experienced 54 failed requests, resulting in 93.88% availability and a longest outage of 46 seconds. This was worse than the expected result of no failures or only a few seconds of disruption.

A major contributing factor was the CPU target-tracking scaling policy, which reduced the desired capacity from 2 back to 1 while the resilience test was still in progress. This meant the Auto Scaling group was simultaneously recovering from the terminated instance and scaling the environment down, reducing the amount of healthy capacity available during recovery.

Some failed requests may also have occurred because requests were still being routed while an instance was being removed or while the replacement instance had not yet become healthy.

To improve resilience, the minimum and desired capacities should be temporarily kept at 2 during the failure test, or scale-in should be suspended so that the CPU scaling policy cannot reduce capacity during recovery. A longer deregistration delay and maintaining more than one healthy spare instance could also reduce the chance of failed requests during instance replacement.

## Artefacts

- `evidence/availability-aws.md`
- `evidence/screenshots/resilience-*.png`
