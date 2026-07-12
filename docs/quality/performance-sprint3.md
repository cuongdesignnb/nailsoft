# Sprint 3 Performance Report

## Environment

- Date: 2026-07-12
- PostgreSQL: 16 Alpine; Redis: 7 Alpine
- Host: Windows, 16 logical CPUs
- Capacity fixture: 10 branches, 500 staff, 2,000 services, 100,000 shifts, 50,000 leave records, 100,000 blocks, 5,000 resources
- Load: concurrency 10, two-second warm-up, five-second measured window per scenario; separate 20-sample forced-cold availability run

| Scenario | Throughput | p50 | p95 | p99 | Error rate |
|---|---:|---:|---:|---:|---:|
| Availability 1 day, cached | 841.6 req/s | 11.50 ms | 15.43 ms | 18.12 ms | 0% |
| Availability 7 days, cached | 882.6 req/s | 11.10 ms | 13.90 ms | 16.71 ms | 0% |
| Availability 1 day, forced cold | sequential | 67.26 ms | 85.52 ms | 166.23 ms | 0% |
| Availability 7 days, forced cold | sequential | 572.01 ms | 765.33 ms | 893.62 ms | 0% |
| Calendar day | 350.6 req/s | 27.75 ms | 38.43 ms | 47.11 ms | 0% |
| Calendar week | 112 req/s | 89.74 ms | 111.39 ms | 121.98 ms | 0% |
| Availability explain | 655.6 req/s | 14.99 ms | 18.43 ms | 20.64 ms | 0% |

Process RSS during scheduling scenarios was 84–99 MB; no timeout occurred. All specified p95 targets passed on the full capacity fixture. Warm runs reached effectively 100% cache hits after warm-up; forced-cold runs incremented the PostgreSQL data version before every request.

`EXPLAIN (ANALYZE, BUFFERS)` for the busy-block overlap source selected `availability_blocks_branch_time_idx` through a bitmap index scan (58 rows, planning 2.294 ms, execution 0.532 ms). Cache keys include PostgreSQL `availability_versions`. The reproducible fixture is managed by `scripts/sprint3-capacity-fixture.mjs` and was removed after measurement.
