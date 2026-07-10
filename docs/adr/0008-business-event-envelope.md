# ADR 0008: Business event envelope

- Status: Accepted by CR-0001
- Decision: Domain/outbox events use the envelope in `docs/events/event-catalog.md`. Consumers deduplicate on `eventId`, track aggregate versions and support explicit payload versions.
- Consequences: Events are immutable and exclude secrets/sensitive payloads. Incompatible schema changes increment `eventVersion`. Sprint 1 extends the outbox compatibly; no Sprint 0 destructive migration is permitted.
