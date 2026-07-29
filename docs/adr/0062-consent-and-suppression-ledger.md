# ADR 0062 — Consent and Suppression Ledger

Status: Accepted for Sprint 11.

## Decision

Consent is an append-only event ledger plus a rebuildable current-state projection. Every grant references the active definition version and text hash. Absence means `NOT_GRANTED`; marketing consent is never inferred from bookings, accounts or previous purchases.

Withdrawal appends evidence, updates the projection and creates an active purpose-specific suppression in one transaction. Pending and claimed-before-provider messages are revalidated against consent, preference and suppression generations. Transactional messages use a separate purpose and cannot be disabled by marketing withdrawal. Public marketing unsubscribe derives its idempotency key from the verified token hash, so it does not depend on a client header; invalid tokens return a generic response, while persistence failures for valid tokens remain observable.

## Consequences

- Consent history cannot be updated or deleted.
- Unsubscribe takes effect immediately even when campaign audience was snapshotted earlier.
- New customers receive explicit `NOT_GRANTED` projections through a database trigger.
