# Sprint 3 Test Matrix

| Area | Required evidence |
|---|---|
| Algorithm | interval generation; duration/prep/cleanup/buffers; any/specific staff; skills; shifts; leave; block union; resource capacity; price; fingerprint |
| Time | Ho Chi Minh; New York gap/ambiguity; offset-bearing DTOs; cross-midnight |
| Data | migration up/down/re-up; tenant/branch composite FKs; external idempotency; concurrent version bump; deterministic seed |
| Authorization | owner tenant scope; manager/reception branch scope; technician own calendar; accountant/marketing/platform denial |
| API | availability/search/explain; calendar events/summary; block list/create/update/cancel; stable errors |
| UI | loading; empty; error/retry; denied; offline/stale/reconnecting; timezone/DST; version conflict |
| Regression | Sprint 1–2 unit, integration, contract, authenticated E2E and mobile suites remain green |
| Performance | 1/7-day availability, cached path, day/week calendar, explain; query plans recorded |

## Closure hardening evidence

| Area | Automated evidence |
|---|---|
| Shared authorization | HTTP guard delegation; active context; PostgreSQL role/branch reload; tenant mismatch; revoked/expired session; authorization version; membership/user state |
| WebSocket rooms | Owner, Manager/Receptionist branch, Technician own staff, fake `staffId`, Platform denial, unknown origin denial |
| Forced disconnect | current-session revoke and old-token reconnect denial; membership/user/authorization control routing |
| Durable outbox | `SKIP LOCKED` two-worker claim, stale lease, processed timestamp, Redis retry, max attempts, manual retry method, ignored event, cross-tenant rejection |
| Event invalidation | business hours routing plus authenticated shift-publish and leave-approve Worker delivery/refetch |
| Functional closure | inactive branch availability/write denial, inactive historical calendar read, partial maintenance warning, capacity blocking, available/no-blocking invariant |
| Regression | Sprint 1–3 unit, integration, contract, authenticated E2E, mobile smoke, load smoke and all builds |
