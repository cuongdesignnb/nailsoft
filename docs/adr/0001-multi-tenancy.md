# ADR 0001: Multi-tenancy

- Status: Accepted
- Decision: Shared PostgreSQL schema with mandatory `tenant_id`, composite tenant foreign keys, request-scoped tenant context verified against authenticated membership, repository APIs requiring that context, and PostgreSQL RLS as defense-in-depth when module tables mature.
- Consequences: No unscoped business query is allowed. Platform administration uses an explicit privileged path and is audited. Tests must attempt cross-tenant reads and writes.
