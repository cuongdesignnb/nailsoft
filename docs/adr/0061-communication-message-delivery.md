# ADR 0061 — Communication Message Delivery

Status: Accepted for Sprint 11.

## Decision

PostgreSQL owns message intent, status, attempts and generation keys. The API writes business evidence and outbox records in one transaction. The Worker claims due rows with `FOR UPDATE SKIP LOCKED`, commits `PROCESSING`, calls the email provider outside the database transaction, then persists the result. A unique `(tenant_id, generation_key)` prevents duplicate messages.

Customer outbound delivery is email-only. Realtime signals only request a refetch. Retry is bounded and ends in `DEAD_LETTER`; provider success means `SENT`, never fabricated `DELIVERED`.

## Consequences

- PostgreSQL remains recoverable source of truth.
- Worker restarts and duplicate events are safe.
- Provider callbacks may later advance `SENT` to `DELIVERED`, `BOUNCED` or `COMPLAINED`.
- Message bodies, full tokens and provider secrets are excluded from logs.
