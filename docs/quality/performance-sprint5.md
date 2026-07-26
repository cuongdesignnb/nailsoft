# Sprint 5 performance report

## Evidence policy

Local and CI load runs are regression smokes over deterministic development fixtures. They are not production-capacity claims. The required 10-branch/100,000-appointment/300,000-session benchmark remains assigned to production-like staging before go-live.

## Scenarios and targets

| Scenario                   |  Sprint target |
| -------------------------- | -------------: |
| Operational board          |   p95 < 700 ms |
| Walk-in list/queue summary |   p95 < 300 ms |
| Staff Today                |   p95 < 500 ms |
| Checkout summary           |   p95 < 400 ms |
| Realtime refetch signal    | p95 < 1 second |

The CI smoke uses a short warm-up, authenticated branch-scoped reads and fails on unexpected errors/timeouts. Command latency and hot-row contention correctness are covered separately by PostgreSQL integration and concurrency tests.

## Local deterministic-fixture result

Date: 2026-07-26. Warm-up: 1 second. Measurement: 3 seconds per scenario. This is a local regression smoke, not a production claim.

| Scenario          | Concurrency | Requests | Throughput |     p95 |      p99 | Error rate | Timeouts |
| ----------------- | ----------: | -------: | ---------: | ------: | -------: | ---------: | -------: |
| Operational board |           2 |    1,001 | 333.67 rps | 6.86 ms |  7.47 ms |         0% |        0 |
| Walk-in queue     |           2 |    1,050 | 350.00 rps | 6.65 ms |  7.44 ms |         0% |        0 |
| Checkout summary  |           2 |      910 | 303.33 rps | 7.71 ms |  8.78 ms |         0% |        0 |
| Operational board |           5 |    1,957 | 652.33 rps | 8.86 ms |  9.54 ms |         0% |        0 |
| Walk-in queue     |           5 |    1,898 | 632.67 rps | 9.55 ms | 13.26 ms |         0% |        0 |
| Checkout summary  |           5 |    1,861 | 620.33 rps | 9.21 ms | 10.92 ms |         0% |        0 |

## Closure hardening regression smoke

Date: 2026-07-27. Deterministic reset, concurrency 5, one-second warm-up and two-second measurement per scenario. Docker infrastructure and QA services were stopped immediately afterward.

| Scenario          | Requests | Throughput |      p95 |      p99 | Error rate | Timeouts |
| ----------------- | -------: | ---------: | -------: | -------: | ---------: | -------: |
| Operational board |      692 |  346.0 rps | 19.95 ms | 30.42 ms |         0% |        0 |
| Walk-in queue     |    1,257 |  628.5 rps |  9.31 ms | 10.29 ms |         0% |        0 |
| Checkout summary  |    1,025 |  512.5 rps | 11.45 ms | 12.18 ms |         0% |        0 |

All measured read paths are below their Sprint 5 local targets. Realtime delivery is tested functionally through authenticated Socket.IO/outbox tests; a production-like end-to-end latency percentile remains part of the staging benchmark debt.
