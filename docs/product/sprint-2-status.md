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

## Deferred debt

SMS/email production provider, deeper business E2E coverage and safe reseeding of an already-populated database remain tracked technical debt and do not expand Sprint 2 scope.
