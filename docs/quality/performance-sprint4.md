# Sprint 4 Performance Report

## Scope and environment

- Date: 2026-07-15
- Environment: local Windows workstation, Node.js production API, PostgreSQL 16 and Redis 7 in Docker
- CPU: 16 logical cores
- Window: 2 seconds warm-up plus 5 seconds measured per scenario
- Concurrency: 2 and 5
- Dataset: deterministic development seed (40 booking fixtures), not the production-scale 100,000 appointment baseline

The local run is a regression smoke, not evidence for production capacity. The production-scale dataset and long-duration hot-slot contention soak remain release hardening technical debt.

## Read-path results

| Scenario           | Concurrency | Requests | Throughput |      p95 |      p99 | Unexpected errors | Timeouts |
| ------------------ | ----------: | -------: | ---------: | -------: | -------: | ----------------: | -------: |
| Calendar day       |           2 |    1,164 |  232.8 rps | 10.51 ms | 12.78 ms |                0% |        0 |
| Appointment list   |           2 |      619 |  123.8 rps | 21.71 ms | 26.20 ms |                0% |        0 |
| Appointment detail |           2 |    1,419 |  283.8 rps |  8.49 ms | 12.28 ms |                0% |        0 |
| Calendar day       |           5 |    2,221 |  444.2 rps | 14.32 ms | 17.22 ms |                0% |        0 |
| Appointment list   |           5 |    1,116 |  223.2 rps | 32.59 ms | 40.62 ms |                0% |        0 |
| Appointment detail |           5 |    2,922 |  584.4 rps | 10.76 ms | 16.03 ms |                0% |        0 |

These deterministic-seed results are below the Sprint 4 local targets of 700 ms for calendar day, 500 ms for appointment list and 300 ms for appointment detail.

## Public rate-limit observation

The public availability scenario intentionally crossed its PostgreSQL-backed limit of 120 searches per tenant/IP/10-minute window. Requests beyond that boundary were rejected with `429 PUBLIC_RATE_LIMITED`; there were no network timeouts. These expected abuse-control responses are excluded from application error-rate evidence and are not treated as availability throughput.

## Command and concurrency evidence

The integration suite covers hold create/consume, internal create, confirm, reschedule, cancel, idempotent replay, concurrent hold conflict, staff exclusion and resource allocation. Command latency was not benchmarked against the 100,000-appointment dataset in this local run, so no production-capacity claim is made.

## Conclusion

- Local read-path smoke: passed.
- Local concurrency correctness: covered by PostgreSQL integration tests.
- Production-scale performance acceptance: pending staging benchmark/BA acceptance, tracked in the technical-debt register.
