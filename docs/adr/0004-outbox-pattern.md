# ADR 0004: Transactional outbox

- Status: Accepted
- Decision: Aggregate mutation and `outbox_events` insert share one PostgreSQL transaction. Worker claims rows with `FOR UPDATE SKIP LOCKED`, publishes at-least-once, then marks them published. Consumers deduplicate by event id.
- Consequences: Redis/pub-sub may transport hints but cannot be the sole event record. Retries, backoff, dead-letter status and observability are required before production.
