# Sprint 3 Closure Report

## Status

Sprint 3: `DONE`

- Accepted closure commit: `99848b3f3e56e4c7fb256e99e8de6fa16593127c`
- Accepted CI run: [29425123706](https://github.com/cuongdesignnb/nailsoft/actions/runs/29425123706)
- Accepted by BA/Product Owner as the Sprint 4 start checkpoint.

## Git

- Branch: `main`
- Sprint 3 start checkpoint: `2584562f9b836bb9672f04a8c351c436ece406e4`
- Closure start checkpoint: `f708fc8850283f42b009a886fd09a2e13669d630`
- Closure commit: `99848b3f3e56e4c7fb256e99e8de6fa16593127c`
- Commit message: `feat: close sprint 3 realtime security and outbox`
- `origin/main`: `99848b3f3e56e4c7fb256e99e8de6fa16593127c`
- Working tree target: clean

## GitHub Actions

- Run ID: `29425123706`
- URL: https://github.com/cuongdesignnb/nailsoft/actions/runs/29425123706
- Commit: `99848b3f3e56e4c7fb256e99e8de6fa16593127c`
- Status: `SUCCESS`
- Required steps: WebSocket authorization integration, durable outbox Worker integration, Sprint 3 closure authenticated E2E
- Acceptance rule: only the successful run for the final closure commit qualifies

## Migration

- Migration required: yes
- Migration: `0008_realtime_outbox_delivery`
- Reason: existing outbox lacked delivery status, schedule, lease, processing/failure timestamps and redacted error
- Existing migrations modified: no (`0001–0007` unchanged)
- Backfill: legacy pending/published/failed state and attempt count preserved
- Fresh migrate, rollback to `0007`, re-migrate and existing Sprint 1–3 data preservation: passed locally
- Data preservation verification: 30 services, 15 staff records and 3 availability blocks remained after rollback/re-migrate

## Shared Authorization

- HTTP and WebSocket call `SessionAuthorizationService.authorize()`.
- JWT signature/expiry, active device session, membership, authorization version, user and tenant are checked.
- Roles and branches are reloaded from PostgreSQL; JWT lists are not final authority.
- Own staff is resolved by tenant plus membership.

## WebSocket Security

- Handshake authorization fields other than token are ignored.
- Control rooms: session, membership and user; salon data is never emitted there.
- Business rooms: Owner tenant/active branches, Manager/Receptionist assigned active branches, Technician linked own staff only.
- Platform Admin is denied without Support Access Grant.
- Token expiry timer and durable event-driven forced disconnect are active.
- HTTP and Socket.IO share an explicit allowlist; Engine.IO rejects unknown origins and production config fails closed.

## Durable Outbox

- Claim: PostgreSQL `FOR UPDATE SKIP LOCKED`, default batch 50.
- Lease: default 60 seconds with stale processing recovery.
- Delivery: at-least-once; `eventId` makes duplicate refetch signals safe.
- Retry: 5s, 15s, 60s, 5m; fifth failure becomes visible `FAILED`; manual repository retry is available.
- `PROCESSED` is written only after Redis emitter/control publish succeeds.
- Redis outage retries without data loss; Worker restart recovers the lease; two-worker claim is integration tested.
- Unknown events are acknowledged and counted; cross-tenant targets are failed before emit.

## Event Invalidation

- Covered sources: branch/business hours, service/price/skill/resource requirements, staff/assignment/skill, shift, leave, resource and availability blocks.
- Worker resolves affected branches/staff and reads the latest PostgreSQL availability data version per branch.
- Authenticated E2E proves shift publish to Manager branch room and leave approval to Technician own staff room, followed by PostgreSQL API refetch.

## Functional Corrections

- Inactive branch returns `409 AVAILABILITY_BRANCH_INACTIVE` and rejects new/updated busy blocks; authorized historical calendar reads remain available; cancellation cleanup remains allowed.
- Explain separates `blockingReasons` and `warnings` while retaining `reasons` as a backward-compatible blocking alias.
- Partial resource maintenance with enough capacity is a warning and keeps `available=true` / `rules.resources=true`.
- Insufficient capacity is blocking and can identify maintenance as the cause.
- Invariant enforced: `available=true` has no blocking reasons and all blocking rules are true.

## Tests and Quality Gates

- New unit: shared HTTP authorization wiring, production CORS fail-closed, Worker Redis retry/max-attempt/ignored behavior.
- New PostgreSQL integration: active authorization state matrix, two-worker claim, stale lease recovery, retry scheduling, processed timestamp, routing and cross-tenant prevention.
- New authenticated E2E: session revoke, fake staff isolation, origin/Platform denial, shift and leave durable invalidation, inactive branch, resource warning/blocking.
- Unit: 13 files / 28 tests passed.
- PostgreSQL integration: 11 files / 45 tests passed.
- API contract: 1 test passed.
- Authenticated browser E2E: 24 tests passed, including all 7 Sprint 3 closure scenarios.
- Lint, TypeScript strict typecheck and build: 13/13 workspaces passed.
- Migration fresh/rollback/re-migrate: passed with Sprint 1–3 seed data preserved.
- Load smoke: all 9 scenarios passed with 0% errors and 0 timeouts; representative p95 was 0.52 ms for health, 154.65 ms for login and 7.88 ms for service list at concurrency 2.

## Scope Confirmation

- Booking command, appointment creation, Slot Hold, confirmation, reschedule/cancellation, Walk-in, service execution, POS, Payment, Refund, Commission, Inventory, Voucher, Membership, Marketing and AI were not implemented.
