# ADR 0060: Stored-value reconciliation

- Status: Accepted for Sprint 10
- The Worker creates daily tenant/currency liability snapshots, compares ledger totals with account projections and records durable exceptions.
- Claims use bounded batches/leases or idempotent daily/generation keys; retries cannot duplicate snapshots, exports, releases or exceptions.
- Reconciliation is read/evidence work only. Exceptions require an approved correction entry; balance rows and ledgers are never rewritten.
- Reports separate gift card from customer credit, pending funding from active liability, and issuance/redemption/refund flows from service revenue.
