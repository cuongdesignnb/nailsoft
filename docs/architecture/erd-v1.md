# ERD v1

Sprint 0 establishes shared isolation and reliability tables plus deterministic fixtures. Later sprint migrations extend aggregates without bypassing tenant foreign keys.

```mermaid
erDiagram
  TENANTS ||--o{ BRANCHES : owns
  TENANTS ||--o{ USERS : contains
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
