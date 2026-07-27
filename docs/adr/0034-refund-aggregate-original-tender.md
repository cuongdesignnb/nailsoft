# ADR 0034 — Refund aggregate and original tender

- Status: Accepted for Sprint 7
- Date: 2026-07-27

## Context

Customer refunds are new financial movements. They must not mutate issued invoices, captured payments, payment allocations, tips, or use the technical reversal state as a business refund.

## Decision

`refunds` owns an explicit command state machine. A plan is recalculated from immutable invoice lines, completed refund balances, and captured payment balances. Creation snapshots policy, line components and original-tender allocations. All sensitive commands use tenant-scoped idempotency and row locks; database uniqueness prevents over-refund races.

Cash execution requires an active same-branch cash session, server-authenticated register device, sufficient expected cash, and creates `CASH_REFUND`. External execution records a unique safe provider reference or uses a provider adapter with an idempotency key derived from immutable refund/allocation IDs. A timeout becomes `UNKNOWN`, never an assumed success. `COMPLETED` requires confirmed money movement for every allocation.

## Consequences

- PostgreSQL is authoritative; realtime is a refetch signal.
- Original tender substitution is denied unless an explicit snapshotted policy allows it.
- Refund history and provider attempts are append-only.
- Customer refunds never write `payments.status = REVERSED_TECHNICAL`.
