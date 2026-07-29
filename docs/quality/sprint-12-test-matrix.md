# Sprint 12 Test Matrix

| Layer        | Evidence                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit         | state reducers; UTC/cross-midnight duration; exact BigInt rational earnings/net; fingerprints; redaction; provider fail-closed                                          |
| PostgreSQL   | migration up/down/up; append-only event/history; one open session/break; rate exclusion; finalized immutability; source/provider-event dedupe; paid evidence constraint |
| Concurrency  | 20 clock-ins; 20 break starts; 20 source claims; repeated finalization/provider event                                                                                   |
| API/security | idempotent writes; tenant/branch/own staff; dual control; Platform denial; version conflicts                                                                            |
| E2E          | authenticated staff clock/break/out; timesheet correction/approval/lock; payroll calculate/approve/finalize; payout evidence/reconciliation                             |
| Mobile       | Staff time clock/history/timesheets/statements; Owner alerts and approvals; offline write denial                                                                        |
| Regression   | lint, strict typecheck, unit, PostgreSQL integration, contract, Playwright, build, load smoke for Sprints 1–11                                                          |

Production-scale performance requires staging; local fixtures are capacity evidence only.

## Closure hardening evidence

The required closure suite adds 12 isolated PostgreSQL integration files and 11 authenticated API E2E files. Coverage includes deterministic clock-out projection/replay, correction `APPLIED`, submit/approve/lock guards, hourly/overtime/commission-only and multi-branch rate calculation, FK-safe recalculation, persisted exceptions, database-exact BigInt payout totals, 20-way stable-provider-key concurrency with `UNKNOWN` reconciliation, manual payout authorization/evidence, supplemental correction finalization, and used policy/rate immutability. CI resets and reseeds before every stateful file; no retry, skipped assertion, or `continue-on-error` is used.
