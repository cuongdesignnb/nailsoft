# ADR 0039: Benefit reservation and redemption

Status: Accepted for Sprint 8.

## Decision

Benefits are applied in the fixed order `PACKAGE -> MEMBERSHIP -> VOUCHER -> LOYALTY -> tax -> tip`. Mutable availability is reserved under a locked PostgreSQL aggregate before payment and committed only in the transaction that makes the order paid. Void, expiry and booking cancellation release active reservations. Every command uses the shared idempotency store, tenant key, version/conditional update, audit and transactional outbox.

## Consequences

Redis and realtime payloads only trigger refetch. Checkout revalidates reservations under lock; stale or mismatched customer/order state fails closed. Ledger entries are append-only and compensations never edit history.
