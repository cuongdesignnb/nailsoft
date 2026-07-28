# Sprint 10 Performance Evidence

Targets: masked lookup and balance p95 < 250 ms; reserve/release < 350 ms; paid redemption < 500 ms; liability/reconciliation reads < 700 ms; realtime invalidation < 1 second.

## Local capacity smoke

Environment: local Docker PostgreSQL/Redis, short authenticated read smoke, 1 second warm-up, 2 second measurement and concurrency 2. These figures demonstrate local capacity and regression safety only; they are not production or staging claims.

| Scenario                    | Requests | Throughput | p50 (ms) | p95 (ms) | p99 (ms) | Errors/timeouts |
| --------------------------- | -------: | ---------: | -------: | -------: | -------: | --------------: |
| Gift Card list              |      596 |    298.0/s |     6.62 |     8.53 |     9.76 |              0% |
| Stored-value liability      |      751 |    375.5/s |     5.10 |     6.92 |     8.01 |              0% |
| Stored-value reconciliation |      648 |    324.0/s |     6.05 |     7.65 |     8.51 |              0% |
| Customer Credit list        |      732 |    366.0/s |     5.08 |     7.13 |    12.44 |              0% |

Total: 2,727 requests with zero errors and zero timeouts.

## Implementation evidence

- PostgreSQL indexes cover tenant/account ledger chronology, active reservation expiry and unique account/order claims.
- Commands lock the relevant order, account and reservation and use optimistic versions plus database uniqueness protection.
- Worker jobs use bounded batches and `SKIP LOCKED`; PostgreSQL remains authoritative.
- CI runs a short authenticated smoke for Gift Card list, Customer Credit, liability and reconciliation.

## Remaining production gate

Before production go-live, execute the SRS dataset in production-like staging: one million ledger entries, 100,000 cards, 10,000 hot-account concurrent operations and a long-running Worker/reconciliation soak. Capture p95/p99, error rate, database CPU/IO, lock waits, pool saturation, Worker lag and realtime latency.
