# Technical debt register

| Item                                              | Status   | Impact                                                                                                        | Follow-up                                                                                           |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SMS/email production provider                     | Deferred | Notifications remain adapter-level                                                                            | Select production provider before release hardening                                                 |
| Production-scale 100k-shift performance benchmark | Deferred | Local smoke uses a small deterministic dataset                                                                | Run benchmark with production-like data and capture CPU/RAM/pool metrics                            |
| Safe reseed of an already populated database      | Deferred | `db:reset` is deterministic; additive seed is not yet idempotent for arbitrary existing data                  | Add non-destructive seed mode                                                                       |
| Native-device UI automation for Expo apps         | Deferred | Mobile API contracts are covered; device UI gestures are not                                                  | Add Maestro/device lane when mobile release testing begins                                          |
| Booking SMS/email production delivery             | Deferred | Development/test notification delivery is deterministic; production provider is not selected                  | Select provider, configure retry/DLQ alerting and complete delivery-compliance review before launch |
| Long-duration booking reservation soak            | Deferred | Concurrent integration tests prove conflict safety; sustained production-scale contention is not yet measured | Run 100k-appointment and hot-slot contention soak in staging before launch                          |
| Customer booking multi-service editor polish      | Deferred | API supports sequential multi-service plans; current public UI completes the single-service happy path        | Add multi-select/reorder interaction without changing aggregate or pricing rules                    |

# Sprint 3 carried risks

- Extend the full Sprint 3 capacity benchmark from the current local/CI smoke window to a long-duration production-like soak before launch; the required p95 dataset targets pass locally, but long-run cache-hit and CPU trends still need staging evidence.
- Replace the conservative tenant-wide PostgreSQL version bump with branch-specific event routing only after production cache-hit metrics justify the complexity.
- Add a production operations UI for failed outbox rows; Sprint 3 provides structured metrics/logs and the repository-level manual retry method.
- Persist metrics in the selected production telemetry backend; the current implementation emits structured Nest logs and in-process counters.
