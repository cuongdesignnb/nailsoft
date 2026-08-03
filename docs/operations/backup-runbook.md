# Backup and Restore Runbook

```powershell
$env:DATABASE_URL = '<staging-url>'
pnpm db:backup artifacts/sprint18/staging.dump
pnpm db:integrity
$env:RESTORE_DATABASE_URL = '<isolated-restore-url>'
pnpm db:restore artifacts/sprint18/staging.dump
pnpm db:integrity
```

The restore script verifies the sidecar SHA-256 before invoking `pg_restore`. Never restore over production during a drill. Attach command output and timings to the release evidence.
