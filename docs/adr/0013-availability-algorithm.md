# ADR 0013 — Availability Algorithm

- Status: Accepted
- Date: 2026-07-12

## Decision

Availability is calculated synchronously in `AvailabilityModule` from PostgreSQL-authoritative service, business-hour, staff, shift, leave, busy-block, resource and price records. Clients never derive slots. A realtime query is limited to 31 local dates and intervals of 5, 10, 15 or 30 minutes.

```text
staff:    start - bufferBefore → start + duration + cleanup + bufferAfter
resource: start - prep - bufferBefore → start + duration + cleanup + bufferAfter
```

Each accepted slot contains qualified staff, resource capacity, effective price and a SHA-256 fingerprint over authoritative versions. Empty days contain stable reason codes. Appointments are intentionally not an input until Sprint 4.

## Consequences

Sprint 4 can revalidate the fingerprint before a booking command. The first implementation favors transparent set-based reads and deterministic evaluation; global allocation optimization remains out of scope.
