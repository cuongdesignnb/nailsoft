# Sprint 4 test matrix

| Layer                 | Required evidence                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                  | Appointment/hold state machines; sequential planner; occupancy; deterministic staff/resource allocation; reference; currency-aware deposit; snapshots; cancellation; request hash; purpose-bound public token |
| Migration             | Fresh migration through `0010`; deterministic legacy backfill; down/up for `0010`; Sprint 1–3 preservation                                                                                                    |
| PostgreSQL            | Staff exclusion; shared/exclusive resource capacity; tenant composite FKs; append-only history; revisions; expiry/release/version bump; durable encrypted OTP queue                                           |
| API                   | Hold create/get/release/expire; consume/create; confirm; pending states; waiver; reschedule; cancel; history; replay/conflict                                                                                 |
| Authorization         | Owner tenant; manager/reception branch; technician own item/PII mask; public verified token; platform denial                                                                                                  |
| Concurrency           | 20+ same-slot holds; any-staff distribution; resource cap; consume race; reschedule race; cancel vs reschedule; expiry vs consume                                                                             |
| Calendar/availability | Appointments and active holds projected; reservation reasons; cancel/expire restores slot; realtime refetch only                                                                                              |
| Web E2E               | Internal single/multi-service booking; calendar; confirm/reschedule/cancel/waive; loading/empty/error/retry/permission/conflict/success states                                                                |
| Public E2E            | Catalog → real branch date window → multi-service/staff selection → hold → contact/OTP → mandatory policy acceptance/create → tenant-scoped manage/reschedule/cancel                                          |
| Mobile                | Owner actions; technician own upcoming/detail; realtime; cached read; offline write blocked                                                                                                                   |
| Security              | Strict public schema/customerId rejection; online-service/staff policy; capability-before-replay; invalid/expired/cross-tenant token; OTP brute-force/rate limit/encrypted queue; PII/token/log redaction     |
| Performance           | Hold, booking, list/detail, reschedule, cancel, calendar and realtime targets with expected `409` excluded                                                                                                    |

Sprint 1–3 unit, integration, contract, E2E, migration and build suites remain mandatory regression gates.
