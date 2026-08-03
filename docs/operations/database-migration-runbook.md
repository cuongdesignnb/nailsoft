# Database Migration Runbook

1. Take a checksum-verified backup with `pnpm db:backup`.
2. Verify the release manifest and migration head before applying changes.
3. Run `pnpm db:migrate` from a maintenance-approved release.
4. Run `pnpm db:integrity`, readiness and representative authenticated smoke tests.
5. For a failed migration, stop writes, preserve logs, and follow rollback policy; never edit an applied migration.
6. Record fresh/rollback/re-migrate evidence. Sprint 18 has no new migration.
