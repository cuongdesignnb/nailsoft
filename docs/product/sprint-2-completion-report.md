# Sprint 2 hardening completion report

## Scope delivered

- Tenant-scoped catalog, staff, resource, shift and leave CRUD surfaces in Admin Web.
- Owner Mobile service/staff/shift/leave review data flows and Staff Mobile profile, branches, skills, shifts and leave request flows.
- PostgreSQL exclusion constraints protect active staff assignment ranges, primary branch ranges and published shift ranges. Add-on cycles are rejected by a database trigger.
- Granular permission cleanup and role matrix coverage; platform support identities cannot cross tenant boundaries.
- Idempotency keys are sent by operational clients and audit/outbox writes remain in the same transaction.

## Verification

Migration `0006_sprint2_hardening` was reset, rolled back and re-applied locally. Integration coverage includes overlap concurrency, permissions and add-on cycle protection. Commit `99c180ff70ba8ccb63b31eb47da3129c6a9cb47d` passed GitHub Actions run `29181620160` (success).

## Out of scope

Availability Engine, operational Calendar, Booking, Walk-in, service execution, POS, Payment, Commission, Inventory and advanced Marketing remain blocked until Sprint 2 is accepted.
