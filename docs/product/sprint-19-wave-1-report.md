# Sprint 19 Wave 1 Report — Booking & Daily Salon Operations

## Source and CI evidence

```text
WAVE_1_STATUS=COMPLETED
WAVE_1_VALIDATED_SOURCE_SHA=0d470031caacbd4e244854dae8d71cb7e9468414
WAVE_1_FULL_CI_RUN_ID=30920412831
WAVE_1_FULL_CI_STATUS=SUCCESS
WAVE_1_VISUAL_LANE=SUCCESS
FINAL_ACCEPTANCE_DOCUMENTATION_SHA=<set after documentation commit>
WAVE_2_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

The CI result above belongs to the validated source SHA. If this report is
committed afterwards, that documentation-only SHA must not be described as the
SHA tested by run `30920412831`.

## Delivered screens

- Today dashboard backed by operations summary and board APIs.
- Day/week booking calendar backed by calendar events.
- Appointment list with branch-aware filters and loading/empty/error/forbidden
  states.
- Availability search with explicit estimate/disclaimer and availability API.
- Existing booking create/detail/reschedule/cancel, busy-block, walk-in,
  check-in, execution, add-service and staff-assignment surfaces were retained
  and included in the Wave 1 route/scope inventory.
- Booking Web reschedule now excludes the current appointment from its own
  availability calculation while preserving PostgreSQL reservation integrity.

## Contract and architecture decisions

- No migration was added or modified.
- PostgreSQL remains the source of truth; realtime remains a refetch signal.
- Tenant isolation, branch scope, permission guards, idempotency, audit and
  outbox behavior were not weakened.
- The public reschedule fix is additive: an authenticated management token and
  booking reference identify the current appointment; availability and cache
  keys carry `excludeAppointmentId`; the booking transaction rehydrates the
  current appointment reservations when a same-slot hold intentionally skips
  an overlapping self-reservation.
- No change was made to appointment state machines, currency semantics or
  booking hold contracts.

## QA and tests

Local Docker QA was used only for reset/seed and targeted verification, then
`docker compose down` was run. Targeted results:

```text
Wave 1 operations + Sprint 3/4 regression E2E = 4 passed
Public booking reschedule E2E = 1 passed
API typecheck = PASS
Admin Web typecheck/build/lint = PASS
Booking Web typecheck/build = PASS
API lint = PASS
```

Full CI run `30920412831` on the source SHA completed SUCCESS. Required CI
steps verified SUCCESS:

```text
Sprint 19 Wave 0 localization and navigation contracts
Sprint 19 Wave 0 mobile shell smoke
Build API
Build Worker
Build Admin Web
Build Booking Web
Build Owner Mobile
Build Staff Mobile
Stop containers
```

## Docker and repository handoff

```text
DOCKER_COMPOSE_RUNNING_SERVICES=0
HEAD_EQUALS_ORIGIN_MAIN=YES (at source validation)
WORKING_TREE_CLEAN=YES (at source validation)
```

Docker is intentionally left stopped after QA to reduce RAM usage. No Wave 2,
Sprint 20 or production go-live work was started.

## Evidence limitations and follow-up

Wave 1 acceptance currently relies on deterministic route/API/E2E evidence.
No new screenshot baseline is claimed for screens that do not have a committed
deterministic visual artifact. The existing Wave 0 mojibake and visual-baseline
acceptance records remain governed by the Wave 0 report; no unrelated redesign
was started in this wave.
