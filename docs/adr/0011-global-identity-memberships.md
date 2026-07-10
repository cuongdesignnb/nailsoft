# ADR 0011: Global identity and tenant memberships

- Status: Accepted by Sprint 1 BA review
- Decision: `users` represents a global identity. `tenant_memberships` owns independent tenant status and `authorization_version`; roles and branches belong to the membership. Device sessions bind to one membership.
- Authentication: Verify identity first. One active membership is selected automatically; multiple memberships require a short-lived workspace-selection token. Access tokens are tenant-specific.
- Authorization freshness: Guards validate the active user, tenant, membership, device session and authorization version on every request, then reload role/branch scope. Access changes increment the version and revoke membership sessions.
- Migration: `0003_tenant_memberships_security_hardening` migrates legacy assignments. Down migration refuses a destructive rollback after a global user has acquired multiple memberships.
