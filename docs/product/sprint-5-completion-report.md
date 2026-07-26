# Sprint 5 Completion Report

## Status

Sprint 5 implementation and local verification are complete. Formal `DONE` requires the GitHub Actions run for the immutable final Sprint 5 commit to succeed; the exact commit and run are recorded in the final handoff because a Git commit cannot contain its own hash.

## Git

- Branch: `main`
- Start checkpoint: `d6df218b24021bfe303300980a73ce493ea18097`
- Final commit: recorded in the final handoff
- Commit message: `feat: complete sprint 5 salon operations`
- Start state: `HEAD = origin/main`, clean
- Migrations 0001-0010: unchanged

## Migration

- Migration: `0011_walkin_checkin_service_execution`
- Fresh migrate: passed
- Rollback: passed to `0010_public_booking_security_hardening`
- Re-migrate: passed
- Existing data preserved: appointment count 45 before rollback and 45 after re-migrate
- Seed: deterministic and idempotent Sprint 5 arrivals, queue states, sessions, pauses, transfers, notes and media metadata

## Walk-in

- Registration: customer reference or contact snapshot with one or more active branch services
- Queue number: PostgreSQL counter row locked by tenant, branch and local date; concurrent test produced unique numbers
- ETA: current Booking Planner/Availability result with generated timestamp and `ESTIMATED_NOT_GUARANTEED`; unavailable estimates remain explicit
- Status machine: command-specific WAITING/READY/CALLED/CONVERTED/CANCELLED/LEFT transitions
- Priority: Owner/Manager permission and mandatory reason; no destructive reorder or delete
- Conversion: preview and hold call the Booking/Reservation Engine; conversion consumes that hold and links the one idempotently-created appointment
- Concurrency: same-key replay returns the same appointment and only one hold consumption/reservation set exists

## Arrival & Check-in

- Arrive/check-in/revert commands implemented with branch, status and version checks
- Early/late minutes are derived in branch timezone; hard-late override requires Manager reason
- Pending deposit blocks check-in
- Repeated same-key check-in replays; concurrent distinct commands produce one arrival and one PENDING session per active item

## Service Execution

- PENDING sessions are created at check-in
- Start/pause/resume/complete/cancel commands implement the approved state machine
- Actual timestamps, pause seconds and work seconds are server-derived
- Appointment operational status is system-derived after every transition
- All completed items derive `COMPLETED`; completed/planned derives `PARTIALLY_COMPLETED`; completed/cancelled terminal mix is checkout-ready

## Staff Contribution

- Every staff contribution is an append-only segment
- Transfer closes the old segment, changes the active assignment/reservation and opens the target segment atomically
- Partial unique indexes prevent two open staff segments and two open primaries per session
- Checkout summary aggregates contribution seconds; no commission calculation exists

## Add Service

- Plan revalidates active service, add-on relation, qualification, resources and future conflicts
- Hold is created by the existing Reservation Engine
- Commit requires current appointment version and customer approval method
- New item/session/snapshots and schedule revision are appended; existing snapshots are unchanged
- Hard conflicts return `ADD_SERVICE_NOT_AVAILABLE`; no silent repricing

## Notes & Media

- Notes are assignment/branch scoped, versioned and sanitized; delete is not exposed
- Media is private metadata with MIME, size, checksum, tenant prefix and soft deletion
- Presigned-upload foundation uses a short-lived HMAC URL only when object-storage environment is configured
- Media returns an explicit disabled state when the provider is not configured; service execution remains available

## Realtime

- Transactional outbox routes operation events to tenant, branch, assigned-staff and authorized appointment rooms
- Appointment room join revalidates PostgreSQL tenant/branch/staff access
- Clients receive `operations.invalidated`, `walkin.updated`, `appointment.updated` and `service_session.updated`, then refetch
- `branch_operational_versions` supplies monotonic invalidation versions; Redis is transport only

## Authorization

- Owner: tenant-wide Sprint 5 permissions
- Manager: complete assigned-branch operations, including priority/revert/transfer/cancel
- Receptionist: queue, arrival/check-in, board, transfer and add-service; no execution completion
- Technician: own Staff Today/session execution, notes and media only
- Cashier: board and checkout-ready summary only
- Accountant/Marketing: no operational grants
- Platform Admin: denied without Support Access Grant
- Tenant, branch and staff isolation: service query checks plus composite database constraints and tests

## UI

- Reception Board: real branch/day API, operational columns, queue strip, optimistic commands and Socket.IO refetch
- Walk-in: live list/create/detail/status/conversion flow with ETA disclaimer
- Check-in: arrive/check-in command with server warnings/conflicts
- Execution: start/pause/resume/complete, contribution history, transfer, notes and media feature state
- Add Service: availability/price preview, explicit verbal approval and hold-backed commit
- Staff Today: real own-scope API, realtime refetch, online-only commands, local note draft, note sync and media availability
- Owner Mobile: live operational counts and walk-in queue with realtime refetch
- Checkout Summary: pricing preview and staff contributions only; no invoice/payment
- Screens provide loading, empty, error, retry, permission, offline, success and version-conflict states

## API

- Walk-ins: list/create/detail/update, queue summary, state commands, priority, conversion plan/hold/convert
- Appointments: arrive, check-in, revert, arrival, add-service plan/hold/commit, checkout summary
- Service sessions: list/detail, lifecycle commands, transfer, notes and media metadata
- Operations: board, summary and Staff Today
- OpenAPI: Sprint 5 paths plus request/response schema foundation, version `0.7.0`

## Tests

- Unit: 55/55 passed, including queue/session/appointment derivation and realtime routing
- Integration: 63/63 passed across Sprint 1-5; 10 Sprint 5 tests cover lifecycle, tenant/branch/staff scope, idempotency and database races
- Contract: 1/1 passed
- E2E: 34/34 passed after deterministic reset, including authenticated Reception board/walk-in and Owner/Staff Mobile scenarios
- Migration: fresh/down/up and existing-data count passed
- Security: Platform denial, technician own scope, cross-tenant opacity, note sanitization and tenant-bound media tested
- Local lint: 13/13 packages passed
- Local typecheck: 13/13 packages passed
- Local build: 13/13 packages passed

## Performance

- Dataset: deterministic local development fixture; not production-scale evidence
- Concurrency 5 p95: board 8.86 ms, walk-in queue 9.55 ms, checkout summary 9.21 ms
- Unexpected errors: 0%; timeouts: 0
- Production-scale and end-to-end realtime percentile: release hardening debt assigned in the technical-debt register

## Architecture Decisions

- ADR 0024: PostgreSQL-backed walk-in queue
- ADR 0025: service-session aggregate separate from booking snapshots
- ADR 0026: append-only staff contribution segments
- ADR 0027: add-service scheduling through Booking/Reservation Engine
- Existing multi-tenancy, idempotency, outbox, realtime and offline ADRs remain authoritative

## Technical Debt / Risks

- Production object-storage provider, private bucket lifecycle and malware/image processing must be configured before media is enabled
- Production-like 100k appointment/300k session load and realtime latency benchmark remains a release blocker, not a local capacity claim
- Native device/camera automation remains deferred; Expo web/API smoke is green
- Production OTP provider and prior long-duration booking contention soak remain carried release items

## Local Run

```bash
docker compose up -d
pnpm install
pnpm db:reset
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm dev
```

## Scope Confirmation

- POS and invoice were not implemented.
- Payment, deposit capture and refund were not implemented.
- Tip, commission and payroll were not implemented.
- Inventory, voucher, membership/package and gift card were not implemented.
- Marketing, review workflow and AI were not implemented.
