# ADR 0038 — Refund effects on tips and commission

- Status: Accepted for Sprint 7
- Date: 2026-07-27

## Decision

A completed refund appends tip refund allocations and commission reversal entries. It never edits original tip allocations or earnings. Tip reversals use remaining original allocations and deterministic pro-rata remainder ordering. Commission reversal is proportional to the refunded immutable invoice line.

If the original commission period is unlocked, the reversal may be associated with that period. If it is locked, the system creates `LOCKED_PERIOD_REFUND_ADJUSTMENT` for a later open posting period and retains original entry, refund, and credit-note references.

Manual adjustments require request/decision evidence and dual control. They post as a new entry; they do not rewrite a statement.

## Consequences

Staff net tips and commission liability remain reproducible. Repeated refund completion or adjustment approval is protected by unique generation keys and command idempotency.
