# ADR 0018: Durable outbox delivery for scheduling realtime

## Status

Accepted for Sprint 3 closure.

## Decision

Migration `0008_realtime_outbox_delivery` extends the existing transactional outbox with delivery status, attempts, availability time, lock lease, processing/failure timestamps and a redacted final error. It backfills existing rows without modifying migrations `0001–0007`.

Workers claim ordered pending rows inside a PostgreSQL transaction with `FOR UPDATE SKIP LOCKED`, mark them `PROCESSING`, commit, then route and emit. A stale processing lease is recoverable. A row becomes `PROCESSED` only after Redis succeeds. Failures retry after 5, 15, 60 and 300 seconds; the fifth failure becomes `FAILED`. `manualRetry` provides operational recovery without a Sprint 3 UI.

The Worker uses `@socket.io/redis-emitter` against the `/scheduling` namespace. Payloads contain only event ID, tenant, branch, optional staff, latest PostgreSQL availability data version, source event type, timestamp and `refetch: true`. Business events resolve affected branches and staff from PostgreSQL and validate tenant ownership before fan-out. Security events publish minimal disconnect commands to `nailsoft:realtime:control`.

## Delivery semantics

- At-least-once; duplicate invalidation is safe because clients refetch.
- Multiple workers cannot claim the same lease concurrently.
- Unknown non-realtime events are deliberately acknowledged and counted.
- Invalid cross-tenant targets are failed, logged and counted rather than emitted.
- Redis is not a source of truth and an outage cannot mark an event processed.
