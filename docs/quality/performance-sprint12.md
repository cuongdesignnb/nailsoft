# Sprint 12 Performance Report

Status: local deterministic QA passed; production-like staging evidence remains a release gate.

Local deterministic targets: clock command p95 < 350 ms; staff status < 250 ms; attendance branch report < 700 ms; timesheet list < 500 ms; payroll calculation < 2 seconds for local fixture; payout claim < 500 ms; realtime invalidation < 1 second. Indexes cover staff/time, branch/time, open exceptions, source claims and active constraints. Worker jobs use short `SKIP LOCKED` claims and bounded polling.

Any local result is explicitly not a production claim. Production-scale payroll/provider latency needs staging with representative branches, staff, events, timesheets, source allocations and provider sandbox.

## Local smoke evidence — 2026-07-29

Environment: Windows development workstation, PostgreSQL/Redis Docker Compose, two concurrent authenticated workers, one-second warm-up and two-second measured window per read scenario.

| Scenario | Requests | Throughput/s | p95 ms | Error rate |
| --- | ---: | ---: | ---: | ---: |
| Attendance sessions | 634 | 317.0 | 7.61 | 0% |
| Timesheet list | 634 | 317.0 | 7.57 | 0% |
| Payroll run list | 699 | 349.5 | 6.61 | 0% |
| Payout batch list | 698 | 349.0 | 6.96 | 0% |

These short local results validate query/index regressions only. They do not substantiate production p95, sustained write contention, provider latency, or the production-scale dataset requested by the SRS.
