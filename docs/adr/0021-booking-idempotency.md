# ADR 0021 — Booking command idempotency

- Status: Accepted for Sprint 4
- Date: 2026-07-15

## Decision

Every hold and appointment command requires `Idempotency-Key`. A key is scoped by tenant, verified actor or public client subject, and command name. The canonical SHA-256 request hash covers the normalized payload and relevant path identity.

The idempotency row is acquired in the same PostgreSQL transaction as the command. Same scope/key/hash replays the completed response; the same key with a different hash returns `409 IDEMPOTENCY_KEY_REUSED`. Concurrent in-flight use serializes on the database row. Tokens and OTP values are not written to logs or generic cached response bodies; capability tokens are deterministically re-issued from persisted IDs and versions where replay requires one.

## Consequences

- Idempotency is independent of Redis and survives process restart.
- Business event/audit rows are created once per successful command.
- Retryable serialization/deadlock failures use a bounded transaction retry and never create a second aggregate.
