# ADR 0045: Benefit settlement and reversal allocation

- Status: Accepted for Sprint 8 closure
- Date: 2026-07-28

## Context

Order-level benefit totals cannot safely answer which service line, points, package units or voucher usage must be reversed after a partial refund. Loyalty also has a different payment boundary from tip, and package consumption is defined by catalog eligibility rather than client input.

## Decision

PostgreSQL records an immutable allocation from each committed benefit application to the covered order and invoice line. Refunds append a second immutable allocation that references that evidence; the original application is never rewritten.

- Loyalty acceptance is capped at eligible service due after package, membership and voucher, before tip. Requested, accepted, applied and unused values are stored together.
- Package units come from the matched eligibility item. Package uniqueness is per covered order line; other benefit types remain unique per order and type.
- Voucher customer capacity is serialized by tenant/campaign/customer and includes active reservations plus net committed usage.
- Loyalty lots are allocated FIFO when points are reserved. Only unreserved lot balance can expire.
- Membership metrics are recomputed from issued paid evidence minus completed service/tax refunds inside the tier's rolling window. Automatic assignments may downgrade; manual assignments are protected.
- Worker claims are committed separately, then every job runs in its own transaction with bounded retry and dead-letter state.

## Consequences

Refund reversal is deterministic across repeated partial refunds and fails closed when historical allocation is ambiguous. The extra rows and locks add bounded write cost, but remove dependence on mutable projections. Realtime remains a refetch signal; PostgreSQL remains authoritative.

Package partial-line refunds are recorded as `MANUAL_REVIEW` until Product approves fractional unit rules. No Sprint 9 behavior is introduced.
