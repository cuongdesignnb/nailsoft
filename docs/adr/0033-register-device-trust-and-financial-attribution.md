# ADR 0033 — Register device trust and financial attribution

- Status: Accepted for Sprint 6 closure
- Date: 2026-07-27

## Context

A client-declared device identifier is not authentication evidence. Cash and external payment reporting also cannot derive register attribution from `cash_session_id`, because external tenders have no cash session.

## Decision

Register authorization resolves the authoritative device exclusively through `auth.sessionId → active device_sessions.device_id`. When a register requires binding, that server-resolved identifier must have an active, non-revoked binding. Owner and Manager roles do not bypass this boundary.

An order may be created as an unassigned draft, but it must be assigned to an active same-branch register before finalization. Assignment is idempotent, audited and allowed only before pricing/payment lock. `payments.register_id` is immutable evidence copied from the locked order; cash additionally requires the cash session and drawer to belong to that same register. Every cash payment for one order uses its first cash session.

Daily reconciliation filters immutable payment register attribution and defines `cashierUserId` as `payments.created_by_user_id`, the capture actor. PostgreSQL remains authoritative; realtime payloads only invalidate clients.

Cashier views of owned `OPEN` and `CLOSING` sessions redact expected cash and variance at the API boundary. Manager/Owner review is a separate permissioned endpoint. Final values become visible to the cashier only after `CLOSED`.

## Consequences

- Migration `0013_sprint6_financial_attribution_hardening` performs deterministic attribution backfill and adds composite constraints and indexes.
- Compatibility `deviceId` input may still parse for old clients, but it is ignored for authorization.
- Register/cashier reports include cash and every external tender without relying on Redis or cash-session joins.
- Production terminal adapters, refunds and credit notes remain outside this decision and Sprint 6.
