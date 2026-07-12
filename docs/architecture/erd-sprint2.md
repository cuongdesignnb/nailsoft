# Sprint 2 ERD additions

```text
service_categories 1---N services 1---N service_prices
services N---N skills       (service_skill_requirements)
services N---N resource_types (service_resource_requirements)
resource_types 1---N resources --- branches
staff_profiles --- tenant_memberships
staff_profiles N---N branches (staff_branch_assignments)
staff_profiles N---N skills (staff_skills)
staff_profiles 1---N shifts --- branches
staff_profiles 1---N leave_requests --- branches
```

Every relationship is tenant-scoped. `membership_branches` is intentionally not reused for staff scheduling.
## Hardening additions (migration 0006)

`staff_branch_assignments.effective_range` and `shifts.published_range` are generated PostgreSQL ranges. GiST exclusion constraints prevent overlapping active assignments, overlapping primary assignments for one staff member, and overlapping published shifts. `service_addon_cycle_guard` rejects transitive service add-on cycles before commit.
