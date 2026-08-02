# Sprint 17 Preflight Audit

Checkpoint verified: `18f9ad957e0109f8220879523f02dd6e2958e2fc` on `main`, with a clean worktree and no running compose services.

The audit found no analytics module or analytics read model in Sprints 1–16. The authoritative sources are the existing PostgreSQL tables (`appointments`, `invoices`, `invoice_lines`, `payments`, `service_sessions`, `walk_in_entries`, workforce, inventory, accounting, procurement and assets). Redis is only a delivery/cache mechanism. The implementation therefore adds an additive `0034` read model and a tenant-scoped projector; no source aggregate is mutated by analytics.

Existing patterns reused:

- `AuthGuard` and `PermissionGuard` for tenant/branch authorization.
- PostgreSQL transactions, audit logs and durable outbox for commands.
- Worker leasing for rebuild/export work.
- Existing design tokens and Next/Expo shells for functional UI.

Known data-quality conditions are surfaced through projection checkpoints and freshness metadata. A metric without a mapped authoritative source is returned as `NO_DATA`/empty, never fabricated.
