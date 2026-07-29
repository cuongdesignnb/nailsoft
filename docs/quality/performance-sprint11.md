# Sprint 11 Performance Report

Status: local capacity smoke completed on 2026-07-29; production-like staging evidence remains required before production claims.

Targets: preference/consent p95 < 300 ms; segment preview < 700 ms; campaign snapshot 10k recipients < 10 s; message claim < 250 ms; review submit < 500 ms; recovery list < 500 ms; realtime invalidation < 1 s.

Indexes cover delivery claims, active frequency reservations, consent/suppression generations, campaign audience generations, delayed review scheduling, recovery branch/SLA and assignee tasks. Worker work is bounded and uses `SKIP LOCKED`; advisory locks serialize the small customer frequency gate and provider latency remains outside database transactions.

Local deterministic fixture, API at `127.0.0.1:3001`, 5-second measured window per scenario, 2-second warm-up and concurrency 5:

| Scenario               | Requests | Throughput/s |      p95 | Error rate |
| ---------------------- | -------: | -----------: | -------: | ---------: |
| Communication messages |    3,229 |        645.8 |  9.45 ms |         0% |
| Marketing campaigns    |    3,124 |        624.8 | 10.07 ms |         0% |
| Verified reviews       |    3,467 |        693.4 |  8.59 ms |         0% |
| Recovery cases         |    3,275 |        655.0 |  9.29 ms |         0% |

Command: `LOAD_DURATION_SECONDS=5 LOAD_WARMUP_SECONDS=2 LOAD_CONCURRENCY=5 LOAD_SCENARIOS=communication-messages,marketing-campaigns,verified-reviews,recovery-cases node scripts/load-smoke.mjs` (PowerShell environment syntax used locally).

These figures are local capacity evidence only. They do not represent the required production-scale dataset or realtime provider latency and must not be presented as production SLA proof.

Closure correctness evidence adds 20 concurrent campaign deliveries with a configured cap of 2; provider invocations remained at or below 2. This verifies the invariant under the deterministic local fixture, not production throughput.
