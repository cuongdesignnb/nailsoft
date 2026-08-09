# Sprint 19 Wave 6 Report — Accounting, Platform Billing & Analytics

```text
STATUS=SPRINT_19_WAVE_6_IN_PROGRESS
REPORT_STATUS=DRAFT_PENDING_SOURCE_CI
START_CHECKPOINT=290e9ae24775ad89ffc9af9e982dad161878633a

WAVE6_SUPPORT_SCOPE_SHA=0544882
WAVE6_READ_FOUNDATION_SHA=c8039a5
ACCOUNTING_UI_SHA=PENDING
TENANT_BILLING_UI_SHA=PENDING
PLATFORM_UI_SHA=PENDING
ANALYTICS_UI_SHA=PENDING
WAVE6_CI_LANE_SHA=PENDING
FINAL_WAVE_6_SOURCE_SHA=PENDING
FINAL_WAVE_6_CI_RUN_ID=PENDING
FINAL_WAVE_6_CI_CONCLUSION=PENDING
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

The rows `19.6.1–19.6.34` are `IMPLEMENTED_PENDING_QA` until Cluster 1–4
functional, responsive, accessibility and visual QA pass, the Wave 6 targeted
E2E lanes pass, legacy Sprint 13/14/17/18 regressions pass, all six builds are
green, and an exact final source SHA receives successful full CI. Wave 7,
Sprint 20 and production go-live remain unauthorized.

```text
FULLY_ACCEPTED_SCREEN_ROWS_READY=29
ACCEPTED_WITH_DEFERRED_SCOPE_ROWS_READY=4
ACCEPTED_AS_DISABLED_FOUNDATION_ROWS_READY=1
WAVE_7_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## QA policy

Docker PostgreSQL and Redis are started only for reset/seed/integration or
authenticated UI QA, then stopped with `docker compose down`. No Docker
service is part of the source or acceptance evidence unless the corresponding
QA run is recorded.
