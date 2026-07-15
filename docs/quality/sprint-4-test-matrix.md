# Sprint 4 test matrix

| Layer                 | Required evidence                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                  | appointment/hold state machines; sequential planner; occupancy; deterministic staff/resource allocation; reference; snapshots; cancellation/deposit; request hash; public token |
| Migration             | fresh `0009`; deterministic legacy appointment backfill; down to `0008`; re-up; Sprint 1–3 preservation                                                                         |
| PostgreSQL            | staff exclusion; shared/exclusive resource capacity; tenant composite FKs; append-only history; revisions; expiry/release/version bump                                          |
| API                   | hold create/get/release/expire; consume/create; confirm; pending states; waiver; reschedule; cancel; history; replay/conflict                                                   |
| Authorization         | owner tenant; manager/reception branch; technician own item/PII mask; public verified token; platform denial                                                                    |
| Concurrency           | 20+ same-slot holds; any-staff distribution; resource cap; consume race; reschedule race; cancel vs reschedule; expiry vs consume                                               |
| Calendar/availability | appointments and active holds projected; reservation reasons; cancel/expire restores slot; realtime refetch only                                                                |
| Web E2E               | internal single/multi-service booking; calendar; confirm/reschedule/cancel/waive; states and conflicts                                                                          |
| Public E2E            | catalog → availability → hold → contact/OTP → review/create → manage/reschedule/cancel                                                                                          |
| Mobile                | owner actions; technician own upcoming/detail; realtime; cached read; offline write blocked                                                                                     |
| Security              | enumeration; invalid/expired/cross-tenant token; OTP brute-force; rate limit; PII/token/log redaction                                                                           |
| Performance           | hold, booking, list/detail, reschedule, cancel, calendar and realtime targets with expected `409` excluded                                                                      |

Sprint 1–3 unit, integration, contract, E2E, migration and build suites remain mandatory regression gates.
