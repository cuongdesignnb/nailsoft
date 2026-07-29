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
