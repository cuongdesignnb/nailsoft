# Sprint 9 Performance Report

Status: local Docker capacity smoke completed on 2026-07-28.

Targets: branch stock p95 < 500 ms; barcode lookup < 200 ms; ledger query < 600 ms; PO create < 500 ms; receipt post < 900 ms; transfer ship/receive < 900 ms; service reserve/consume < 500 ms; POS product reserve < 400 ms; realtime signal < 1 second. Local Docker results are capacity evidence only and must not be represented as production measurements.

The schema includes branch/item/location balance indexes, ledger time ordering, active-reservation indexes and SKIP LOCKED worker claims.

Fixture: deterministic Sprint 1-9 seed, one active tenant, two branches; Windows host with 16 logical CPUs; PostgreSQL and Redis in Docker; API on host; 10 concurrent clients; 1 second warm-up and 5 second measured window per scenario.

| Scenario       | Requests |  Throughput |      p95 | Error rate |
| -------------- | -------: | ----------: | -------: | ---------: |
| Branch stock   |    3,628 | 725.6 req/s | 16.80 ms |         0% |
| Barcode lookup |    4,211 | 842.2 req/s | 13.95 ms |         0% |
| Ledger query   |    3,967 | 793.4 req/s | 14.88 ms |         0% |
| Valuation      |    4,456 | 891.2 req/s | 12.93 ms |         0% |

These are local capacity results, not production or staging performance claims. The transactional PO/receipt/transfer/service/POS paths are covered by deterministic integration and deep E2E; production-scale p95 remains a staging follow-up.
