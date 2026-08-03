# Sprint 18 Completion Report

STATUS=`READY_FOR_BA_PO_ACCEPTANCE`
SPRINT_18_STATUS=`READY_FOR_BA_PO_ACCEPTANCE`
BA_PO_ACCEPTANCE=`PENDING`

## Repository and CI evidence

```text
REPOSITORY=cuongdesignnb/nailsoft
BRANCH=main
START_CHECKPOINT=f0446e066cf5d7dac50c9039c64d52cd4f643b41
HOTFIX_SHA=6f86e42a67fd3b57aa0a32b2d75ec0cf10573940
FINAL_SUCCESS_RUN_ID=30792950467
FINAL_SUCCESS_SOURCE_SHA=6f86e42a67fd3b57aa0a32b2d75ec0cf10573940
FINAL_SUCCESS_URL=https://github.com/cuongdesignnb/nailsoft/actions/runs/30792950467
CI_STATUS=COMPLETED
CI_CONCLUSION=SUCCESS
QUALITY_JOB_ID=91620176953
```

The CI evidence above belongs to the exact hotfix source SHA. Any documentation-only commit made after this report is separate evidence and is not covered by run `30792950467`.

## Failed run and proven root cause

```text
FAILED_RUN_ID=30785803602
FAILED_SOURCE_SHA=f0446e066cf5d7dac50c9039c64d52cd4f643b41
FAILED_STEP_NUMBER=58
FAILED_STEP_NAME=Authenticated Sprint 1-4 E2E
PRIMARY_CLASSIFICATION=SPRINT18_RUNTIME_REGRESSION
ROOT_CAUSE=Strict Sprint 18 CSP was applied to Next development/test runtime; inline scripts/styles and unsafe-eval required by the Next dev client were blocked, so React did not hydrate and login/booking remained in loading state.
FIX=Scope Next CSP script/style allowances to non-production development/test only; keep production CSP strict.
```

Local reproduction of the exact failed E2E command produced the same four failures. After the two-file CSP fix, the exact command passed three consecutive times on equivalent PostgreSQL/Redis runtime state.

## Targeted verification

```text
FAILED_E2E_REPEAT_1=PASS
FAILED_E2E_REPEAT_2=PASS
FAILED_E2E_REPEAT_3=PASS
LOCAL_LINT=PASS
LOCAL_TYPECHECK=PASS
ADMIN_WEB_BUILD=PASS
BOOKING_WEB_BUILD=PASS
MIGRATION_CHANGED=NO
ASSERTION_REMOVED=NO
TEST_SKIPPED=NO
WORKFLOW_CHANGED=NO
SECURITY_GATE_WEAKENED=NO
```

Changed files:

- `apps/admin-web/next.config.mjs`
- `apps/booking-web/next.config.mjs`

## Required CI lanes

```text
STEPS_1_TO_143=SUCCESS
STEP_58_AUTHENTICATED_SPRINT_1_TO_4_E2E=SUCCESS
SPRINT_16_LANES_112_TO_129=ALL_SUCCESS

STEP_144_SPRINT18_ENVIRONMENT_RUNTIME_SECURITY=SUCCESS
STEP_145_SPRINT18_TENANT_REQUEST_SECURITY=SUCCESS
STEP_146_SPRINT18_HEALTH_MIGRATION_BACKUP=SUCCESS
STEP_147_SPRINT18_RELEASE_MANIFEST_SBOM=SUCCESS
STEP_148_SPRINT18_AUTHENTICATED_SECURITY_E2E=SUCCESS
STEP_149_SPRINT18_PRODUCTION_READINESS_LOAD=SUCCESS
SPRINT_18_LANES_144_TO_149=ALL_SUCCESS

BUILD_API_STEP_165=SUCCESS
BUILD_WORKER_STEP_166=SUCCESS
BUILD_ADMIN_WEB_STEP_167=SUCCESS
BUILD_BOOKING_WEB_STEP_168=SUCCESS
BUILD_OWNER_MOBILE_STEP_169=SUCCESS
BUILD_STAFF_MOBILE_STEP_170=SUCCESS
BUILD_STEPS_165_TO_170=ALL_SUCCESS
STOP_CONTAINERS_STEP_340=SUCCESS
```

## Scope and handoff

```text
SPRINT_19_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
UX_UI_REDESIGN_STARTED=NO
```

Docker was enabled only for local QA and was torn down afterwards. The CI stop-containers step also passed.
