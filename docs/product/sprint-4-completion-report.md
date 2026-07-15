# Sprint 4 Completion Report

## Status

Sprint 4 implementation is complete locally. Formal acceptance remains conditional on a successful GitHub Actions run for the exact final commit and BA/Product Owner review of the deferred production-scale performance benchmark.

## Git

- Branch: `main`
- Start checkpoint: `99848b3f3e56e4c7fb256e99e8de6fa16593127c`
- Final commit: immutable commit and matching CI run are reported in the release handoff; this report is included in that commit
- Commit message: `feat: complete sprint 4 booking lifecycle`
- Working tree target: clean

## Migration

- Migration: `0009_booking_appointment_lifecycle`
- Existing appointment backfill: deterministic reference, status, source, versions and cancellation invariants
- Fresh migrate: passed locally
- Rollback: passed locally to `0008`
- Re-migrate: passed locally
- Existing Sprint 1-3 data preserved: passed
- Seed: deterministic booking policies, appointments, items, reservations and holds

## Slot Holds and Reservation Engine

- Hold lifecycle: `ACTIVE -> CONSUMED | EXPIRED | RELEASED`, configurable TTL, signed purpose-bound token and persisted request fingerprint
- Abuse protection: PostgreSQL-backed IP/contact/client-key limits; Redis is not the source of truth
- Idempotency: tenant/actor/route/key plus request hash; same request replays, changed payload conflicts
- Staff exclusion: PostgreSQL range exclusion under transaction
- Resource protection: deterministic lock order, advisory locking, exclusive overlap and shared-capacity validation
- Stale holds: expired inside the reservation transaction and by the durable Worker maintenance loop
- Double booking: concurrent integration coverage proves one winner and a deterministic conflict

## Appointments

- Aggregate: `Appointment` with sequential service items, one active primary staff per item and concrete resource allocations
- Snapshots: service configuration, price/tax, contact, booking/cancellation/deposit policy
- State machine: draft, pending confirmation, pending deposit, confirmed, expired and salon/customer cancellation
- Commands: plan, create, confirm, reschedule, cancel and waive deposit; no generic status patch
- Reschedule: replacement hold is consumed atomically; old schedule remains active on failure; schedule revision/history is append-only
- Cancellation/expiry: reservations are released and slots return to availability
- Deposit: calculation, pending state and audited waiver only; no payment capture was implemented

## Public Booking

- Public salon, branch and service catalog
- Availability search, slot hold and hold-token validation
- Contact verification and generic anti-enumeration booking access response
- Booking create, management detail, replacement hold, reschedule and cancel
- Short-lived signed capabilities are purpose-bound and revalidated against PostgreSQL nonce/version
- OTP attempt limit and public endpoint rate limits are persisted

## Calendar, Availability and Realtime

- PostgreSQL reservations, active holds and appointments participate in availability
- Calendar projects appointment/hold records without duplicating the source of truth
- Outbox events invalidate branch/staff views and emit refetch-only WebSocket signals
- Cancel, expire and release restore the slot

## Authorization

- Owner: tenant-wide branch-authorized operations
- Manager: assigned branches only
- Receptionist: granular booking operations within assigned branches
- Technician: own assigned appointments with contact/internal-note masking
- Customer: signed management capability for the verified booking only
- Platform Admin: denied tenant booking APIs without an explicit support grant
- Tenant and branch isolation: enforced in service queries, reservation constraints and tests
- Session list now identifies/orders the current session deterministically, removing a realtime revoke race

## UI

- Admin Web: appointment list, filters, quick create, detail, confirm, reschedule, cancel and deposit waiver with loading/empty/error/retry/permission/conflict/success states
- Customer Booking Web: mobile-first discovery, service/staff/date/slot, hold countdown, contact verification, review/create, booking management, reschedule and cancel
- Owner Mobile: today/upcoming/detail summaries and booking actions backed by the shared API client/types
- Staff Mobile: own schedule/detail with privacy-safe customer data and offline read cache indicator
- Shared domain types and validation are consumed across API, Web and Mobile

## Tests

- Unit: booking state machine, token purpose/expiry, idempotency and Worker booking routing/maintenance
- Integration: tenant/branch isolation, hold lifecycle, multi-item planning, version conflicts, idempotency, price snapshots, concurrency, reschedule/cancel and Worker expiry
- Contract: OpenAPI contract suite
- E2E: authenticated Sprint 1-4 regression, Admin booking UI, public mobile-first flow and WebSocket authorization
- Mobile: Owner/Staff route and API smoke
- Migration: fresh/up/down/re-up

## Performance

- Local deterministic-seed read smoke: appointment detail p95 10.76 ms, list p95 32.59 ms and calendar day p95 14.32 ms at concurrency 5
- Unexpected read-path error rate: 0%; timeouts: 0
- Expected public `429 PUBLIC_RATE_LIMITED` responses were excluded from error evidence
- Production-scale 100,000 appointment command/load benchmark: deferred to staging and requires BA acceptance; see `docs/quality/performance-sprint4.md`

## Documentation

- ADR 0019-0023: aggregate, holds/reservations, idempotency, public security and resources
- OpenAPI request/response schemas and Sprint 4 API draft
- Sprint 4 ERD, state transition matrix, permission matrix, event catalog and test matrix
- Technical-debt register updated with provider, soak and UI/device follow-ups

## Scope Confirmation

- Walk-in and Check-in were not implemented.
- Service Execution was not implemented.
- POS, Payment and Refund were not implemented.
- Commission, Inventory, Voucher, Marketing and AI were not implemented.
