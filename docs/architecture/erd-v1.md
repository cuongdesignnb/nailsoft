# ERD v1

Sprint 0 establishes shared isolation and reliability tables plus deterministic fixtures. Later sprint migrations extend aggregates without bypassing tenant foreign keys.

```mermaid
erDiagram
  TENANTS ||--o{ BRANCHES : owns
  TENANTS ||--o{ USERS : contains
  USERS ||--o{ SESSIONS : authenticates
  USERS ||--o{ USER_ROLES : assigned
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : grants
  TENANTS ||--|| TENANT_SETTINGS : configures
  BRANCHES ||--|| BRANCH_SETTINGS : configures
  BRANCHES ||--o{ BUSINESS_HOURS : opens
  TENANTS ||--o{ SERVICES : catalogs
  SERVICE_CATEGORIES ||--o{ SERVICES : groups
  TENANTS ||--o{ CUSTOMERS : contains
  BRANCHES ||--o{ APPOINTMENTS : schedules
  CUSTOMERS ||--o{ APPOINTMENTS : books
  TENANTS ||--o{ AUDIT_LOGS : records
  TENANTS ||--o{ IDEMPOTENCY_KEYS : deduplicates
  TENANTS ||--o{ OUTBOX_EVENTS : publishes
```

All business tables carry `tenant_id`; branch-scoped tables carry `branch_id`. Composite tenant foreign keys prevent accidental cross-tenant references. PostgreSQL is authoritative.

Sprint 1 adds rotating device sessions, permission mappings, tenant/branch settings and effective business hours. Platform support has only a policy boundary; no support-grant or impersonation table is created before the SaaS Administration sprint.
