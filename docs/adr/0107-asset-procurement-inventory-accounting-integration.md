# ADR 0107 — Asset integration contracts

Procurement receipts/bills and Inventory parts are consumed through source identifiers and fingerprints. Accounting receives `FIXED_ASSET_*` source candidates through the Sprint 14 adapter contract. No direct journal, procurement or inventory table mutation is allowed.
