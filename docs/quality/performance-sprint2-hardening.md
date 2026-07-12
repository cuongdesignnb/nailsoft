# Sprint 2 hardening performance report

The local smoke dataset exercises tenant-scoped service, staff, shift and leave list endpoints. The latest short run remained below 11 ms p95 per endpoint with zero errors. PostgreSQL exclusion checks are index-backed GiST constraints and execute inside the write transaction; concurrent losers return a 409 domain conflict (`STAFF_BRANCH_ASSIGNMENT_OVERLAP`, `SHIFT_OVERLAP` or `PRICE_OVERLAP`). A full benchmark with production-sized data is still technical debt.
