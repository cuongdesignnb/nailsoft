# Sprint 4 Completion Report

## Status

Sprint 4 is `DONE`. Closure hardening passed the complete local verification pipeline and GitHub Actions for the immutable closure implementation commit. The BA-approved 100k production-like benchmark remains a production release blocker, not a Sprint 4 acceptance blocker; it has an owner, staging environment and deadline in the technical-debt register.

## Closure hardening

- All public booking-management routes are tenant-scoped under `/public/salons/{salonSlug}/bookings`.
- Public booking creation uses a strict request schema and rejects `customerId`, internal notes, missing policy acceptance/version and unknown fields.
- Hold, contact and management capabilities are validated before idempotency replay; replay scopes derive from verified capability subjects and token digests participate in the request hash.
- Public catalog, availability and holds enforce online-bookable services plus branch any/specific-staff and staff-name visibility policies.
- Booking Web uses the branch timezone and live booking window, supports multi-service select/remove/reorder, policy-allowed staff selection and mandatory policy acceptance.
- Contact data is normalized before lookup/hash. Fixed deposits use currency minor-unit rules, including zero-decimal VND.
- Migration `0010_public_booking_security_hardening` adds the durable OTP delivery queue. OTP codes are encrypted at rest, delivered by the Worker with bounded retry, and production public booking fails fast without provider/pepper configuration.
- Public challenge, verification, management detail and management commands use persisted rate limits. Cross-tenant capability use is rejected.

## Git

- Branch: `main`
- Start checkpoint: `abee77f75b4079d6c2039de9516df172952904ee`
- Feature commit: `6bf449617e2528231ddefe60b4f26abb5ba8d4de`
- Closure implementation commit: `f95ac9ff8353adbe19268f563023dec8dd8f5d11`
- Commit messages: `feat: complete sprint 4 booking lifecycle`; `fix: build shared domain types before tests`
- `origin/main` at closure CI: `f95ac9ff8353adbe19268f563023dec8dd8f5d11`
- Working tree: clean after the evidence-only report commit

## GitHub Actions

- Run ID: `30033604088`
- URL: `https://github.com/cuongdesignnb/nailsoft/actions/runs/30033604088`
- Commit: `f95ac9ff8353adbe19268f563023dec8dd8f5d11`
- Status: `SUCCESS`
- Duration: 7m31s

## Migration

- Migrations: `0009_booking_appointment_lifecycle`, `0010_public_booking_security_hardening`
- Existing appointment backfill: deterministic reference, status, source, versions and cancellation invariants
- Fresh migrate: passed locally
- Rollback/re-migrate: passed locally from `0010` down to `0009` and back to `0010`
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

- Admin Web: live branch/customer/service/staff lookup, idempotent audited customer create, appointment list/filter, multi-service-ready quick create, detail, confirm, resource-safe reschedule, cancel and deposit waiver with loading/empty/error/retry/permission/conflict/success states; production UI contains no fixture IDs or dates
- Customer Booking Web: mobile-first discovery, service/staff/date/slot, hold countdown, contact verification, review/create, booking management, reschedule and cancel
- Owner Mobile: today/upcoming/detail summaries and booking actions backed by the shared API client/types
- Staff Mobile: own schedule/detail with privacy-safe customer data and offline read cache indicator
- Shared domain types and validation are consumed across API, Web and Mobile

## Tests

- Unit: 48/48 passed; booking state machine, token purpose/expiry, idempotency, policy/schema enforcement and Worker booking routing/maintenance
- Integration: full suite passed; tenant/branch isolation, hold lifecycle, multi-item planning, version conflicts, idempotency, price snapshots, concurrency, reschedule/cancel, durable OTP delivery and Worker expiry
- Security: 16 focused public policy/capability/schema/token/normalization tests passed, plus tenant-scoped deep integration coverage
- Contract: 1/1 OpenAPI contract test passed
- E2E: 30/30 passed; includes four-step internal lifecycle UI, one public create/manage lifecycle, Sprint 1-3 regression and WebSocket authorization
- Public deep E2E: 1 end-to-end scenario covering multi-service create, OTP, policy, management access, reschedule and cancel
- Internal deep E2E: 4 role-separated lifecycle scenarios plus 1 live-filter surface scenario
- Mobile: Owner/Staff route and API smoke
- Migration: fresh/up/down/re-up

## Performance

- Local deterministic-seed release smoke at concurrency 2: appointment detail p95 7.82 ms, list p95 16.41 ms and calendar day p95 9.02 ms
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
