# Sprint 19 Wave 6 Report — Accounting, Platform Billing & Analytics

```text
STATUS=SPRINT_19_WAVE_6_CLOSED
REPORT_STATUS=FINAL
START_CHECKPOINT=290e9ae24775ad89ffc9af9e982dad161878633a

WAVE6_SUPPORT_SCOPE_SHA=05448823e33231c83a02f4c029746105e990a436
WAVE6_READ_FOUNDATION_SHA=c8039a5bdb2c213e5af12e504a4386d850c5fbc4
ACCOUNTING_UI_SHA=3a67a4568d984a2309a6681139129a7abef47419
TENANT_BILLING_UI_SHA=340d87786728ce6acce96b689c5b23eba792327a
PLATFORM_UI_SHA=7e8f2f6a4863c20da1ff811c1192e3efa91a113c
ANALYTICS_UI_SHA=f92d648a64e234c32d9bdcdc5c90b7a21a49536d
WAVE6_CI_LANE_SHA=c3c46ab5e7cbf9b970e2fcd52836c7025c60cccc
FINAL_WAVE_6_SOURCE_SHA=c3c46ab5e7cbf9b970e2fcd52836c7025c60cccc
FINAL_WAVE_6_CI_RUN_ID=31302322332
FINAL_WAVE_6_CI_URL=https://github.com/cuongdesignnb/nailsoft/actions/runs/31302322332
FINAL_WAVE_6_CI_CONCLUSION=SUCCESS
SOURCE_CI=SUCCESS
ACCEPTANCE=PASS
SCREEN_ROWS_19_6_1_TO_19_6_34=ALL_ACCEPTED
WAVE_6_STATUS=COMPLETED
SPRINT_19_STATUS=IN_PROGRESS
WAVE_7_STARTED=NO
WAVE_7_AUTHORIZED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Scope and architecture

Wave 6 keeps the approved 34-screen mapping. The Admin Web renderer is split
into accounting, banking, tenant billing, platform catalog/tenants/payments,
support access and analytics modules under
`apps/admin-web/lib/sprint19-wave6/`. Existing business state machines,
tenant isolation, permission guards, idempotency, audit/outbox and server
authoritative money semantics are unchanged.

Phase 0A hardens Platform Super Admin Support Access to the granted target
tenant. A support session cannot read global tenant-bearing lists or mutate
global platform catalog configuration. Phase 0B adds exactly the 12 approved
read-only projections and documents them in OpenAPI.

## Deferred scope

```text
DEFERRED_SCOPE_1=BANK_STATEMENT_LINE_EXCEPTION_EXCLUSION
DEFERRED_SCOPE_2=RECONCILIATION_MANUAL_EXCEPTION_ADJUSTMENT
DEFERRED_SCOPE_3=PLATFORM_DISCOUNT_MUTATION_LIFECYCLE
DEFERRED_SCOPE_4=MANUAL_DUNNING_ACTIONS
BREAK_GLASS=INTENTIONALLY_DISABLED_FOUNDATION
```

No new permission, migration, state machine or mutation contract was created
for these deferred items. Break-glass remains a disabled safety surface and
the existing POST continues to fail closed.

## Phase 0 evidence

```text
SUPPORT_ACCESS_BOUNDARY=LOCAL_TESTED
MISSING_READ_API_COUNT=0
NEW_PERMISSION_REQUIRED_COUNT=0
MIGRATION_REQUIRED_COUNT=0
ACCOUNTING_READ_CONTRACT=PASS
PLATFORM_SCOPE_CONTRACT=PASS
API_LINT=PASS
API_TYPECHECK=PASS
API_BUILD=PASS
```

## Wave 6 acceptance gate

The rows `19.6.1–19.6.34` are accepted after Cluster 1–4 functional,
responsive, accessibility and visual QA, targeted Wave 6 E2E, legacy
regressions, all six builds and the exact full CI run passed on source
`c3c46ab5e7cbf9b970e2fcd52836c7025c60cccc`. Wave 7, Sprint 20 and production
go-live remain unauthorized.

```text
FULLY_ACCEPTED_SCREEN_ROWS=29
ACCEPTED_WITH_DEFERRED_SCOPE_ROWS=4
ACCEPTED_AS_DISABLED_FOUNDATION_ROWS=1
WAVE6_ROUTE_OWNERSHIP=SUCCESS
WAVE6_AUTHENTICATED_E2E=SUCCESS
WAVE6_VISUAL_E2E=SUCCESS
QUALITY_JOB_ID=93216996647
QUALITY_JOB=SUCCESS
VISUAL_JOB_ID=93216996571
VISUAL_JOB=SUCCESS
WAVE0_VISUAL=SUCCESS
WAVE1_VISUAL=SUCCESS
WAVE2_VISUAL=SUCCESS
WAVE3_VISUAL=SUCCESS
WAVE4_VISUAL=SUCCESS
WAVE5_VISUAL=SUCCESS
WAVE6_VISUAL=SUCCESS
SPRINT18_SUPPLY_CHAIN=SUCCESS
BUILD_API=SUCCESS
BUILD_WORKER=SUCCESS
BUILD_ADMIN_WEB=SUCCESS
BUILD_BOOKING_WEB=SUCCESS
BUILD_OWNER_MOBILE=SUCCESS
BUILD_STAFF_MOBILE=SUCCESS
STOP_CONTAINERS=SUCCESS
DOCKER_COMPOSE_RUNNING_SERVICES=0
ORPHANED_NAILSOFT_NODE_PROCESSES=0
MIGRATION_CHANGED=NO
SEED_CHANGED=NO
PERMISSION_CHANGED=NO
WAVE_7_STARTED=NO
SPRINT_19_STATUS=IN_PROGRESS
WAVE_7_AUTHORIZED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## QA policy

Docker PostgreSQL and Redis are started only for reset/seed/integration or
authenticated UI QA, then stopped with `docker compose down`. No Docker
service is part of the source or acceptance evidence unless the corresponding
QA run is recorded.
