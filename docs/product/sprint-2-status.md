# Sprint 2 – Service Catalog & Staff Foundation

## Scope

Sprint 2 adds catalog, branch pricing, resource configuration, operational staff profiles, staff skills, shifts and leave foundation. Availability, booking, walk-in, service execution, POS, payment, inventory, marketing and AI are explicitly out of scope.

## Architecture decisions

- `membership_branches` remains authorization scope; `staff_branch_assignments` is the operational workplace assignment.
- All new tables carry `tenant_id` and composite foreign keys where a tenant boundary can be crossed.
- PostgreSQL is authoritative. Active price overlap is protected by a PostgreSQL exclusion constraint and a transaction-level overlap check.
- Mutating aggregates carry `version`; stale writes return `VERSION_CONFLICT`.
- Mutations write audit log and outbox event in the same transaction.
- Branch manager writes are restricted to membership branch scope; platform super admin is denied without an explicit support grant.

## Closure checkpoint

Authenticated Playwright E2E now exercises real login and PostgreSQL-backed API flows for catalog, pricing, skills, resources, staff assignments, shifts, leave, role/branch authorization and Owner/Staff Mobile API journeys. The suite uses unique data and tenant-filtered cleanup; no access token is injected or backend mocked.

## Deferred debt

SMS/email production provider, production-scale performance benchmarking and safe reseeding of an already-populated database remain tracked technical debt. They do not expand Sprint 2 scope.
