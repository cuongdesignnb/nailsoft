# ADR 0068 — Delivery Lease, Campaign Finalization and Compensation Sync

Status: Accepted for Sprint 11 closure.

## Context

A durable message row alone does not prevent a consent change, campaign pause or frequency-cap race after a Worker claims the row. Recovery compensations also need an authoritative signal from the owning financial/benefit domain before a recovery case may be resolved.

## Decision

- A Worker claim is a bounded lease containing a claim token/expiry and snapshots of consent-state version, communication-preference version and suppression generation.
- Marketing sends reserve frequency capacity atomically in PostgreSQL. The invariant is `SENT + ACTIVE reservations <= configured limit`; provider calls never hold a database transaction. Expired claims and reservations are recoverable.
- Immediately before the provider call the Worker revalidates the lease, consent, preference, suppression, campaign state and review-visit eligibility. Failed revalidation suppresses the message and releases its reservation.
- `PAUSED` campaigns cannot be claimed. `CANCELLED` campaigns terminalize unsent messages and audience evidence. A replay-safe finalizer derives `COMPLETED` and immutable terminal counters only while the campaign is `RUNNING` and every current-generation recipient is terminal.
- Customer-credit and loyalty recovery compensation remains pending until the existing owning-domain adjustment is independently approved and posted. Database-owned synchronization then moves the compensation to `POSTED` or a terminal failure state and emits an outbox event. Voucher issuance and non-monetary compensation become `POSTED` only after their durable operation succeeds.

## Provider-call boundary

Withdrawal committed before provider invocation wins and prevents the call. Once a provider invocation has begun, it cannot be transactionally recalled; its resulting `SENT` or failure evidence remains truthful and no database state is rewritten to imply otherwise.

## Consequences

PostgreSQL remains authoritative. Worker crashes consume lease time rather than frequency capacity forever, re-grant never resurrects an old audience generation, paused campaigns stay resumable, and recovery resolution can require all compensation rows to be durably posted or otherwise accepted as terminal.
