# ADR 0024: Walk-in queue

- Status: Accepted for Sprint 5
- Date: 2026-07-26

## Decision

The walk-in queue is a tenant/branch-local aggregate stored in PostgreSQL. Queue numbers are allocated from a locked `walk_in_queue_counters` row keyed by tenant, branch, and local date. Position is derived from priority, readiness, creation time, and queue number; it is never an authoritative stored value.

Every transition is command-specific, versioned, idempotent, audited, appended to `walk_in_status_history`, and emitted through the durable outbox. Entries are never hard-deleted. ETA is advisory and records both `estimateGeneratedAt` and a not-guaranteed disclaimer.

Walk-in conversion uses Booking Planner -> Slot Hold -> Booking Service. A conversion locks the walk-in and consumes exactly one existing hold. The queue module never inserts appointments, staff reservations, or resource reservations.

## Consequences

- PostgreSQL remains the source of truth; realtime messages only request a refetch.
- Concurrent registrations receive distinct queue numbers.
- Concurrent conversions resolve to one appointment or a domain conflict/replay.
- Priority override requires `walkin.priority` and a recorded reason.
