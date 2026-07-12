# Sprint 3 Completion Report

## Status

Implementation and all local exit checks are complete. Final acceptance remains gated by GitHub Actions for the final commit; this document must not be interpreted as `DONE` until that run succeeds.

## Git

- Branch: `main`
- Start checkpoint: `2584562f9b836bb9672f04a8c351c436ece406e4`
- Final commit: pending
- Working tree: pending final commit

## Migration

- `0007_availability_calendar.up.sql` / `.down.sql`
- Fresh migrate: passed
- Rollback to `0006_sprint2_hardening`: passed; Sprint 2 service/staff data preserved
- Re-migrate: passed
- Deterministic seed: passed, including Ho Chi Minh/New York, DST, manual/external/maintenance blocks and eligibility fixtures

## Availability Engine

- Branch-local business hours and IANA timezone conversion
- Duration, prep, cleanup and before/after occupancy semantics
- Any/specific staff, effective assignment, bookable flag, skills/proficiency/expiry, published shift, approved leave and active staff blocks
- Active resource capacity, exclusive requirements and maintenance/block filtering
- Effective branch/default price reference, stable reason codes and SHA-256 calculation fingerprint
- Maximum 31 days and 5/10/15/30-minute validation
- PostgreSQL data version plus Redis versioned-key cache, 45-second TTL and database fallback

## Timezone

- `Asia/Ho_Chi_Minh`: passed
- New York DST spring gap: passed
- New York DST fall ambiguity with distinct instants: passed
- Offset-bearing calendar and slot DTOs: passed

## Calendar

- Direct normalized read of published shifts, approved leave, active busy blocks and resource maintenance
- Day/week bounded queries, staff/resource/event filters and daily summary
- Technician query forced to linked own staff profile

## Busy Blocks, Audit and Realtime

- List/read/create/update/cancel; no hard delete
- Database range/target/tenant/branch constraints and optimistic version conflict
- External `(tenant, source, source_reference)` idempotency with advisory serialization
- Transactional audit log and outbox events
- Authenticated Socket.IO rooms and Redis adapter fan-out emit invalidation only; clients refetch PostgreSQL-backed APIs

## Authorization

- Owner tenant scope; Manager/Receptionist branch scope; Technician own-calendar/own-block scope
- Accountant, Marketing and Platform Super Admin denied by default
- Matrix: `docs/security/permission-matrix-sprint3.md`

## UI

- Admin: calendar day/week, availability search/explain and busy-block create/list/cancel with loading, empty, error/retry, denied, offline, timezone, stale-cache and conflict feedback
- Owner Mobile: calendar day/week summary, availability, explain preparation and busy-block routes backed by real APIs
- Staff Mobile: own calendar, own blocks and availability summary backed by own-scoped APIs

## Tests

- Unit: 24 passed
- Integration: 36 passed
- Contract: 1 passed
- Authenticated E2E: 17 passed, including exact explain reason and authenticated realtime invalidation
- Mobile smoke/API: included in unit and authenticated E2E suites
- Migration rollback/re-migrate: passed
- Lint: 13/13 packages passed
- Typecheck: 13/13 packages passed
- Build: 13/13 packages passed

## Performance

Full specified fixture reached 10 branches, 500 staff, 2,000 services, 100,000 shifts, 50,000 leave records, 100,000 blocks and 5,000 resources. All p95 targets passed; details and query plan evidence are in `docs/quality/performance-sprint3.md`.

## Scope Confirmation

- No Booking command, appointment creation, Slot Hold, Walk-in, POS, Payment or other later-sprint write flow was implemented.
- Existing foundation `appointments` data is not queried by Availability or Calendar.
