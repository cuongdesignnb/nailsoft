# Sprint 14 performance plan

Benchmarks use a production-like fixture: 10 books, 100k journals, 500k lines, 50k statement lines. Targets are p95 <500ms for trial balance/general ledger branch queries, <700ms for reconciliation views and <900ms for posting commands. No production performance claim is made until the load lane records query plans and timings.
