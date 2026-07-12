# Technical debt register

| Item | Status | Impact | Follow-up |
|---|---|---|---|
| SMS/email production provider | Deferred | Notifications remain adapter-level | Select production provider before release hardening |
| Production-scale 100k-shift performance benchmark | Deferred | Local smoke uses a small deterministic dataset | Run benchmark with production-like data and capture CPU/RAM/pool metrics |
| Safe reseed of an already populated database | Deferred | `db:reset` is deterministic; additive seed is not yet idempotent for arbitrary existing data | Add non-destructive seed mode |
| Native-device UI automation for Expo apps | Deferred | Mobile API contracts are covered; device UI gestures are not | Add Maestro/device lane when mobile release testing begins |
# Sprint 3 carried risks

- Extend the full Sprint 3 capacity benchmark from the current local/CI smoke window to a long-duration production-like soak before launch; the required p95 dataset targets pass locally, but long-run cache-hit and CPU trends still need staging evidence.
- Replace the conservative tenant-wide PostgreSQL version bump with branch-specific event routing only after production cache-hit metrics justify the complexity.
- Add durable consumer checkpoints for every upstream Sprint 2 event when the worker grows beyond the current transactional outbox/realtime path.
