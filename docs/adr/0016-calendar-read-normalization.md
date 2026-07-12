# ADR 0016 — Calendar Read Normalization

- Status: Accepted
- Date: 2026-07-12

## Decision

`CalendarModule` queries published shifts, approved leave and active availability blocks directly, then normalizes them to `CalendarEvent`. No materialized projection table is introduced before profiling demonstrates a need.

Queries always include tenant and branch predicates plus bounded time overlap. Technician queries are forced to the staff profile linked to their membership. Booking events are excluded until Sprint 4.

## Consequences

The read model is simple, immediately consistent and rollback-safe. A later projection can preserve the API contract and use idempotent `(tenant_id, source_entity_type, source_entity_id)` upserts.
