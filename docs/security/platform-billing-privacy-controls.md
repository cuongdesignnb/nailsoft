# Platform billing privacy controls

- Token/provider references only; no raw card/bank data.
- Tax identity is a vault reference; addresses and evidence are redacted JSON.
- Audit/outbox/realtime carry IDs/refetch signals, not contacts or secrets.
- Tenant queries bind `auth.tenantId`; platform views expose SaaS state only.
- Support tokens return once, persist as SHA-256 hashes, recheck tenant/permission/branch scope every use and write a path-safe access audit without query strings.
- Invoice/export storage must remain private with short signed-download TTL.
