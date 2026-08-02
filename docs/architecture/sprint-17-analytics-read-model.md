# Sprint 17 Analytics Read Model

`analytics_*` tables are a rebuildable projection over PostgreSQL source domains. Every fact row is tenant/branch scoped, carries branch timezone, currency, metric version and projection revision. Source rows remain immutable and authoritative.

Projection identity is `(tenant_id, projector_name, source_type, source_id, source_version)`. Checkpoints publish only a completed revision; consumers receive `asOf`, `lastSuccessfulRefreshAt`, `lagSeconds` and `freshnessStatus`. Rebuild requests are leased by the Worker and never mutate source rows.

Revenue, payment collection, stored-value liability, refunds and accounting revenue are separate measures. Monetary values use PostgreSQL `bigint` minor units. Business dates are calculated in the branch timezone. A zero comparison baseline returns `percentageChange=null` with `ZERO_BASELINE`.

Tenant and branch scope is enforced both by `PermissionGuard` and persisted branch filtering. Staff Mobile uses only `/v1/analytics/staff/me`; finance and cross-staff data are not exposed to the technician permission.
