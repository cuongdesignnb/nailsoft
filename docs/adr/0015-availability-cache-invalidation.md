# ADR 0015 — Availability Cache and Invalidation

- Status: Accepted
- Date: 2026-07-12

## Decision

PostgreSQL is the source of truth for `availability_versions`. Triggers atomically bump tenant branch versions whenever an availability input changes. Cache keys contain tenant, branch, service, staff preference, date range, interval and data version; TTL is 45 seconds.

Redis may cache serialized results and fan out `availability.invalidated`, but a Redis outage must degrade to PostgreSQL calculation. Pattern deletion and `KEYS` are forbidden. Outbox events are the durable realtime source; clients refetch after invalidation or reconnect.

## Trade-off

Sprint 3 conservatively bumps every branch version in the affected tenant. This may reduce cache hit rate but cannot serve stale cross-branch data. Narrower event-specific bumps require benchmark evidence.
