# ADR 0020 — Slot hold and schedule reservations

- Status: Accepted for Sprint 4
- Date: 2026-07-15

## Decision

`SlotHold` is a separate aggregate with `ACTIVE → CONSUMED | EXPIRED | RELEASED`. PostgreSQL is authoritative for hold status and staff/resource reservations; a signed hold token is only a scoped capability and is revalidated against the database.

Commands lock in the stable order tenant, branch/local date, sorted staff IDs, sorted resource IDs, hold, appointment. Tenant-scoped transaction advisory locks serialize competing planners. A partial GiST exclusion constraint on active staff reservations is the final double-booking barrier. Resource capacity is checked while holding sorted resource advisory locks; expired holds are ignored immediately even before the sweeper persists expiration.

Hold TTL and abuse limits come from branch/tenant policy snapshots. The default configuration is ten minutes and three active holds per hashed client subject. Expiration workers claim with `FOR UPDATE SKIP LOCKED`, release reservations, bump availability version and write audit/outbox in one transaction.

## Consequences

- Redis is not used for reservation ownership.
- Hold consumption is single-winner and idempotent replay can return the created appointment.
- Resource allocation is all-or-nothing; no partial appointment is produced.
- Expected PostgreSQL exclusion/capacity conflicts map to domain `409` errors.
