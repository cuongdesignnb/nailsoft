# Sprint 8 performance report

Status: local capacity smoke passed with zero transport/domain errors. CI runs two workers for two seconds per scenario and repeats the same read-path guardrails.

| Scenario                | Requests |  Throughput |     p95 |
| ----------------------- | -------: | ----------: | ------: |
| Customer benefit wallet |      702 | 351.0 req/s | 6.85 ms |
| Voucher campaigns       |      789 | 394.5 req/s | 6.20 ms |
| Benefit liability       |      739 | 369.5 req/s | 6.22 ms |
| Expiring benefits       |      758 | 379.0 req/s | 6.47 ms |

Targets: wallet < 500 ms p95, voucher eligibility < 250 ms, reservation < 350 ms, POS revalidation < 500 ms, liability < 800 ms and realtime invalidation < 1 second. The measured read scenarios are within their local thresholds. Local/CI smoke is capacity evidence only and is not a production-scale claim. The production-like dataset/soak remains tracked in the technical-debt register.
