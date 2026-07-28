# Sprint 9 Test Matrix

| Layer | Coverage |
|---|---|
| Unit | exact quantity/UOM conversion, bigint line totals, moving average, PO/transfer states |
| Migration | fresh up, `0018` down to `0017`, re-up, seed replay, prior data preservation |
| PostgreSQL | tenant/branch isolation, ledger immutability, available invariant, FEFO, receipt, transfer, blind count, return decision |
| Concurrency | PO numbering, receipt post, transfer ship/receive, reservations, service consume, POS paid commitment, count post |
| API/security | granular roles, cost redaction, blind-count redaction, Platform denial, idempotency and version conflicts |
| Authenticated E2E | receive-to-stock, transfer, service material consumption, retail sale/inspection return, blind count |
| Mobile | Owner alerts/approval/valuation and Staff own-material scope/offline write blocking |
| Load smoke | stock list, barcode lookup, ledger, valuation and low-stock alerts |
