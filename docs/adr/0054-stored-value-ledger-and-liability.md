# ADR 0054: Stored-value ledger and liability

- Status: Accepted for Sprint 10
- Decision: PostgreSQL append-only ledger entries are the financial evidence; `stored_value_accounts` is a guarded projection updated only in the same transaction after `app.stored_value_posting=on`.
- Liability: available plus reserved value, grouped by tenant and currency. Pending funding is reported separately and cannot be redeemed.
- Invariants: integer minor units, currency equality, no negative bucket, unique generation keys, immutable settlement/refund allocations, and no direct balance edits.
- Recovery: reconciliation compares every projection bucket with ledger deltas and opens an exception. It never silently repairs or rewrites evidence.
- Consequence: Redis/realtime can invalidate reads but cannot authorize or reconstruct a balance.
