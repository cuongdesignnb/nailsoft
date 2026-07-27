# ADR 0028 — POS order aggregate

- Status: Accepted for Sprint 6
- Date: 2026-07-27

## Decision

`pos_orders` is the financial checkout aggregate root. An appointment has at most one active order. Creation locks the appointment, requires `checkout_ready`, imports only completed non-cancelled items and preserves appointment price/service/tax/staff-contribution snapshots. It never reads the current catalog price.

Draft pricing mutations are command-specific, versioned and idempotent. Finalize changes `DRAFT` to `READY_FOR_PAYMENT`, while the first captured payment sets `pricing_locked_at`. From that point only additional payment commands are allowed. Paid orders are immutable until Sprint 7 correction documents exist.

## Consequences

- PostgreSQL partial uniqueness protects concurrent creation.
- `bigint` minor units are authoritative; API numbers are bounded to JavaScript's exact integer range.
- Every state transition appends history, audit, financial evidence and transactional outbox signals.
- Refund, credit note, commission, inventory and voucher behavior are explicitly absent.
