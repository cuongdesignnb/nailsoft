# Sprint 2 hardening completion report

## Scope delivered

- Tenant-scoped catalog, staff, resource, shift and leave CRUD surfaces in Admin Web.
- Owner Mobile service/staff/shift/leave review data flows and Staff Mobile profile, branches, skills, shifts and leave request flows.
- PostgreSQL exclusion constraints protect active staff assignment ranges, primary branch ranges and published shift ranges. Add-on cycles are rejected by a database trigger.
- Granular permission cleanup and role matrix coverage; platform support identities cannot cross tenant boundaries.
- Idempotency keys are sent by operational clients and audit/outbox writes remain in the same transaction.
- Authenticated Playwright deep E2E: 12 tests passed against a real API and PostgreSQL, including role/branch authorization and concurrent publish.
- Mobile API integration: Owner and Staff flows passed through the same authenticated API session.

## Verification

Migration `0006_sprint2_hardening` was reset, rolled back and re-applied locally. Integration coverage includes overlap concurrency, permissions and add-on cycle protection. The final commit and CI run are recorded in the release handoff after the authenticated E2E lane completes.

## Out of scope

Availability Engine, operational Calendar, Booking, Walk-in, service execution, POS, Payment, Commission, Inventory and advanced Marketing remain blocked until Sprint 2 is accepted.
