# Sprint 6 performance evidence

Status: local deterministic QA evidence captured 2026-07-27.

Targets: create order <500 ms, recalculate <250 ms, finalize/cash payment <400 ms, final payment plus invoice <700 ms, order/receipt <300 ms, cash close <500 ms, daily reconciliation <1200 ms, realtime <1 second p95.

Local deterministic smoke is capacity evidence only. The specified 100k-order/200k-payment dataset requires production-like staging and remains a release blocker if unavailable.

| Scenario             | Concurrency |     p95 | Error rate |
| -------------------- | ----------: | ------: | ---------: |
| POS order list       |           2 | 6.56 ms |         0% |
| Financial summary    |           2 | 8.93 ms |         0% |
| Daily reconciliation |           2 | 9.22 ms |         0% |
| Invoice list         |           2 | 5.98 ms |         0% |

This short local run validates the query paths and regression thresholds only. It is not a production performance claim and does not close the production-scale benchmark debt.
