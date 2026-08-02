# Sprint 17 Analytics API

All routes are under `/v1/analytics`, require authentication, tenant context and the granular permission listed in the metric catalog. Query filters are shared date/branch/staff/service filters; the server ignores any request `tenantId`.

Core reads: `command-center`, `kpis`, `trends`, `branches/compare`, `bookings`, `staff`, `staff/:staffId`, `staff/me`, `services`, `customers`, `customers/retention`, `benefits`, `inventory`, `procurement`, `finance`, `workforce`, `assets`, `data-quality`.

Governed commands: projection refresh/rebuild, targets, alert rules/occurrences, saved views and background exports. Mutating commands accept `Idempotency-Key`, record audit/outbox evidence and return the standard `{success,data,meta}` envelope. Export and rebuild status is queryable and does not expose a public storage bucket.
