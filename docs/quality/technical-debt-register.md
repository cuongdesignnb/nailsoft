# Technical debt register

| Item | Status | Impact | Follow-up |
|---|---|---|---|
| SMS/email production provider | Deferred | Notifications remain adapter-level | Select production provider before release hardening |
| Production-scale 100k-shift performance benchmark | Deferred | Local smoke uses a small deterministic dataset | Run benchmark with production-like data and capture CPU/RAM/pool metrics |
| Safe reseed of an already populated database | Deferred | `db:reset` is deterministic; additive seed is not yet idempotent for arbitrary existing data | Add non-destructive seed mode |
| Native-device UI automation for Expo apps | Deferred | Mobile API contracts are covered; device UI gestures are not | Add Maestro/device lane when mobile release testing begins |
