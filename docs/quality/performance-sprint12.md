# Sprint 12 Performance Report

Status: local deterministic QA passed; production-like staging evidence remains a release gate.

Local deterministic targets: clock command p95 < 350 ms; staff status < 250 ms; attendance branch report < 700 ms; timesheet list < 500 ms; payroll calculation < 2 seconds for local fixture; payout claim < 500 ms; realtime invalidation < 1 second. Indexes cover staff/time, branch/time, open exceptions, source claims and active constraints. Worker jobs use short `SKIP LOCKED` claims and bounded polling.

Any local result is explicitly not a production claim. Production-scale payroll/provider latency needs staging with representative branches, staff, events, timesheets, source allocations and provider sandbox.

## Local closure smoke evidence — 2026-07-30

Environment: Windows development workstation, PostgreSQL/Redis Docker Compose, ten concurrent authenticated workers, one-second warm-up and 60-second measured window per read scenario.

| Scenario | Requests | Throughput/s | p95 ms | Error rate |
| --- | ---: | ---: | ---: | ---: |
| Attendance sessions | 52,191 | 869.85 | 13.11 | 0% |
| Timesheet list | 52,504 | 875.07 | 12.83 | 0% |
| Payroll run list | 52,637 | 877.28 | 12.80 | 0% |
| Payout batch list | 55,923 | 932.05 | 12.13 | 0% |

These local results validate read-path and index regressions only. They do not substantiate production p95, sustained write contention, provider latency, or the production-scale dataset requested by the SRS.
