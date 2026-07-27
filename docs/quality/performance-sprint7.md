# Sprint 7 performance plan

Targets: refund plan `<500 ms`, create `<500 ms`, cash execution `<700 ms`, external confirmation `<900 ms` excluding provider latency, credit-note detail `<350 ms`, commission period detail `<700 ms`, financial reports `<1 s`, realtime refetch signal `<1 s` at p95.

Capacity fixture: 100,000 invoices, 300,000 lines, 150,000 payments, 50,000 refunds, 500,000 commission entries and 1,000 staff. Local results are capacity evidence only, not production claims. Indexes target invoice/status, original payment, branch/date, staff/date, period/staff and unresolved conflict access paths.

## CI load-smoke evidence

GitHub Actions run `30261748456` used concurrency `2`, a one-second warm-up and a two-second measurement window against the deterministic CI fixture. Error rate and timeouts were zero for every scenario.

| Scenario | Requests | Throughput/sec | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Refund list | 815 | 407.5 | 6.41 ms | 8.08 ms |
| Net-sales report | 753 | 376.5 | 6.54 ms | 7.59 ms |
| Commission entries | 874 | 437.0 | 5.89 ms | 8.42 ms |
| Credit-note list | 845 | 422.5 | 6.15 ms | 8.67 ms |

These results prove the CI smoke path only. The production-scale dataset and contention benchmark remain a release blocker in the technical-debt register.
