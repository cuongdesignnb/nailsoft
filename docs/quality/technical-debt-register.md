# Technical debt register

| ID | Item | Impact | Next action |
|---|---|---|---|
| TD-014-01 | Existing integration runner can hang in `concurrent-refresh.test.ts` teardown | Blocks full CI evidence | Close app/server handles with bounded teardown diagnostics |
| TD-014-02 | Source posting adapters are foundation-only | No automatic POS/inventory/payroll GL posting claim | Implement adapter contracts and exactly-once worker lanes |
| TD-014-03 | Accounting admin screen is functional but mobile/device E2E is not yet closure evidence | Operational acceptance risk | Add authenticated browser/device E2E in final CI |
| TD-014-04 | Source posting worker currently leases candidates fail-closed; POS/inventory/payroll adapters remain configuration work | No automatic source-to-GL posting claim | Add versioned adapters and mapping fixtures before production enablement |
| TD-014-05 | Bank reconciliation has schema/read foundations; import/match/close command E2E remains | Reconciliation acceptance risk | Complete authenticated bank workflow lane |
| TD-014-06 | Production-scale accounting benchmark is not claimed by local Docker QA | Capacity risk | Run production-like staging dataset and capture p95/p99 before go-live |
