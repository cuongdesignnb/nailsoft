# ADR 0010: Platform support access

- Status: Accepted by CR-0001
- Decision: Platform administrators have no implicit tenant business-data access. Sprint 1 creates an explicit policy boundary. A later SaaS Administration sprint implements owner-granted, scoped, time-bound, read-only-by-default and immediately revocable Support Access Grants.
- Break glass: Severe incidents may use very short access with internal approval, mandatory reason, owner notification and a separate security audit.
- Prohibitions: Support never exposes passwords/tokens/raw card data, performs payment/refund by default, bulk-exports customers without explicit scope or deletes audit logs.
