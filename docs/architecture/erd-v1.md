# ERD v1

Sprint 0 establishes shared isolation and reliability tables plus deterministic fixtures. Later sprint migrations extend aggregates without bypassing tenant foreign keys.

```mermaid
erDiagram
  TENANTS ||--o{ BRANCHES : owns
  USERS ||--o{ TENANT_MEMBERSHIPS : joins
  TENANTS ||--o{ TENANT_MEMBERSHIPS : contains
  TENANT_MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : assigned
  TENANT_MEMBERSHIPS ||--o{ MEMBERSHIP_BRANCHES : scoped
  TENANT_MEMBERSHIPS ||--o{ DEVICE_SESSIONS : authenticates
  TENANTS ||--o{ INVITATIONS : issues
  INVITATIONS ||--o{ INVITATION_ROLES : proposes
  INVITATIONS ||--o{ INVITATION_BRANCHES : scopes
  USERS ||--o{ PASSWORD_RESET_TOKENS : recovers
  USERS ||--o{ MFA_METHODS : secures
  USERS ||--o{ MFA_RECOVERY_CODES : recovers
  USERS ||--o{ MFA_CHALLENGES : verifies
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

Sprint 1 migration `0003` converts legacy per-tenant identities into global users with independently controlled tenant memberships, membership roles/branches, authorization versions and device sessions. Platform support has only a policy boundary; no support-grant or impersonation table is created before the SaaS Administration sprint.

Migration `0004_identity_recovery_mfa` safely renames `users.phone_normalized` to `phone_e164` and adds durable invitation, reset-token, OTP, TOTP, recovery-code and MFA-challenge state. Raw tokens, OTP values, TOTP secrets and recovery codes are never stored. Composite invitation/branch foreign keys preserve tenant isolation; PostgreSQL remains authoritative even when disposable infrastructure is unavailable.
