# ADR 0093 — AP payment, vendor credit and reconciliation boundary

## Decision

Payment proposals reserve AP open-item amounts under row locks. Vendor payments require independent approval before processing, use a stable provider key, and record attempts and unknown outcomes for reconciliation. The processor claims a payment intent in a short transaction, performs the external call outside that transaction, then records success/failure/unknown in a second transaction. Unknown outcomes block retries until reconciled.

Vendor credit notes are line-level allocations against bill lines. Their cumulative active/finalized amount cannot exceed the eligible amount. Issuance and application are separate append-only AP allocations so the AP balance is derived rather than overwritten.

## Consequences

- No request payload can impersonate an approver.
- Direct database updates cannot bypass amount/currency/cap checks without violating constraints.
- External provider outages fail closed and leave a recoverable manual-review trail.

