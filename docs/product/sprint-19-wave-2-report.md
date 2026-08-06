# Sprint 19 Wave 2 Report — POS, Payment, Cash & Financial Corrections

## Source and CI evidence

Wave 2 is accepted against the source commit
`83474b1f12c107292b0b4144923b16edff39a720`. That source was validated by full
CI run `31085184446` with conclusion `SUCCESS`; quality job
`92562856325` and visual job `92562856396` also completed successfully. This
report is a documentation-only follow-up and must not be described as the
source commit validated by that CI run.

```text
WAVE_2_START_CHECKPOINT=0c7e259449b18d31e0562f778c7e2772106acad1
WAVE_2_UI_IMPLEMENTATION_SHA=97607950747700331ae3f759a15aea52062e1be3
WAVE_2_CI_LANE_SHA=ac257e967145da058fb22561f499ae47951448ad
POS_FORBIDDEN_SEMANTIC_FIX_SHA=28ec5525d31c64515fe79fffea8f79ad600cc037
LOGIN_STABILITY_FIX_SHA=f80e382687bdeccd70ec4599895446a9f82772b1
POS_FINALIZATION_ASSERTION_SHA=2f4d3f98700ffe7e46e3a618456b218cbe7c9e51
REFUND_ASSERTION_FIX_SHA=928d1464b95489a00cbf9d723570f1c02320cf0c
COMMISSION_ROUTE_OWNERSHIP_FIX_SHA=83474b1f12c107292b0b4144923b16edff39a720
FINAL_WAVE_2_SOURCE_SHA=83474b1f12c107292b0b4144923b16edff39a720
FINAL_WAVE_2_CI_RUN_ID=31085184446
FINAL_WAVE_2_CI_CONCLUSION=SUCCESS
QUALITY_JOB_ID=92562856325
QUALITY_JOB=SUCCESS
VISUAL_JOB_ID=92562856396
VISUAL_JOB=SUCCESS
```

## Scope delivered

Wave 2 delivers the API-backed Admin Web experience for POS sale workspace,
checkout and payment, cash register operations, refund and credit-note review,
and contribution/reversal evidence. Existing Sprint 6–7 API contracts,
idempotency headers, state machines, money semantics and permission guards are
preserved. All screen IDs `19.2.1`–`19.2.18` are separately tracked and
accepted in the screen inventory and acceptance ledger.

## Screen clusters

```text
CLUSTER_1_POS_SALE_WORKSPACE=ACCEPTED
CLUSTER_2_CHECKOUT_PAYMENT_RECEIPT=ACCEPTED
CLUSTER_3_CASH_REGISTER_DRAWER=ACCEPTED
CLUSTER_4_REFUND_CREDIT_NOTE_REVERSALS=ACCEPTED
SCREEN_ROWS_19_2_1_TO_19_2_18=ALL_ACCEPTED
```

The accepted surfaces cover POS home and orders, new sale and cart editing,
customer/appointment linking, discount/tax/tip approval, checkout and split
tender, payment recovery, invoice/receipt, register assignment and opening,
cash movements, blind count and close, variance reconciliation, refund
initiation/review, credit notes, and tip/commission reversal evidence.

## Financial correctness and architecture

```text
SERVER_AUTHORITATIVE_TOTALS=PASS
FLOATING_POINT_AUTHORITATIVE_MONEY=NO
FINALIZED_ORDER_PRICING_IMMUTABLE=PASS
FINALIZED_INVOICE_IMMUTABLE=PASS
PAYMENT_IDEMPOTENCY=PASS
DOUBLE_PAYMENT_PROTECTION=PASS
UNKNOWN_PAYMENT_STATE_HANDLING=PASS
REGISTER_DEVICE_BINDING=PASS
CASH_ATTRIBUTION=PASS
BLIND_COUNT=PASS
DUAL_CONTROL_CLOSE=PASS
VARIANCE_REVIEW=PASS
REFUND_REMAINING_AMOUNT_GUARD=PASS
ORIGINAL_TENDER_ALLOCATION=PASS
DUPLICATE_REFUND_PROTECTION=PASS
CREDIT_NOTE_IMMUTABILITY=PASS
TIP_REVERSAL=PASS
COMMISSION_REVERSAL=PASS
LOCKED_PERIOD_CORRECTNESS=PASS
```

No migration, breaking API, financial business logic, payment/refund/commission
state machine, tenant isolation, branch authorization, role authorization,
device binding, idempotency, audit or outbox behavior was changed as part of
the Wave 2 documentation closure.

```text
MIGRATION_CHANGED=NO
BREAKING_API_CHANGE=NO
FINANCIAL_BUSINESS_LOGIC_CHANGED=NO
PAYMENT_STATE_MACHINE_CHANGED=NO
REFUND_STATE_MACHINE_CHANGED=NO
COMMISSION_STATE_MACHINE_CHANGED=NO
TENANT_ISOLATION_WEAKENED=NO
BRANCH_AUTHORIZATION_WEAKENED=NO
ROLE_AUTHORIZATION_WEAKENED=NO
DEVICE_REGISTER_GUARD_WEAKENED=NO
IDEMPOTENCY_WEAKENED=NO
AUDIT_OUTBOX_WEAKENED=NO
ASSERTION_REMOVED=NO
ASSERTION_WEAKENED=NO
TEST_SKIPPED=NO
BLANKET_RETRY_ADDED=NO
CONTINUE_ON_ERROR_ADDED=NO
```

## Route ownership

Wave 2 owns only the commission evidence and adjustments routes:

```text
/admin/commission
/admin/commission/entries
/admin/commission/adjustments
```

Sprint 7 retains ownership of commission rule and period workflows:

```text
/admin/commission/rules*
/admin/commission/periods*
```

The `19.2.18` row represents contribution/reversal evidence and adjustments;
it does not claim ownership of rule or period configuration.

## State coverage

```text
POS_LOADING_READY_EMPTY_ERROR_RETRY_FORBIDDEN_OFFLINE=PASS
POS_STALE_OR_VERSION_CONFLICT=PASS
POS_SUBMITTING_SUCCESS=PASS
PAYMENT_SERVER_AUTHORITATIVE_TOTALS=PASS
PAYMENT_SPLIT_TENDER=PASS
PAYMENT_DOUBLE_SUBMIT_PROTECTION=PASS
PAYMENT_FAILED=PASS
PAYMENT_UNKNOWN=PASS
PAYMENT_REQUIRES_ACTION=PASS_OR_CONTRACT_NOT_APPLICABLE
REGISTER_ASSIGNMENT_OPEN=PASS
REGISTER_DEVICE_AND_BRANCH_GUARDS=PASS
CASH_MOVEMENTS=PASS
BLIND_COUNT=PASS
DUAL_CONTROL_CLOSE=PASS
VARIANCE_REVIEW=PASS
RECONCILIATION=PASS
REFUND_INITIATION_PARTIAL_AND_ORIGINAL_TENDER=PASS
REFUND_APPROVAL_VERSION_CONFLICT=PASS
CREDIT_NOTE=PASS
TIP_REVERSAL_EVIDENCE=PASS
COMMISSION_REVERSAL_EVIDENCE=PASS
```

Realtime remains a refetch signal. Optimistic state is limited to reversible
UI interactions and rolls back with an explicit conflict or error state.

## Responsive and accessibility evidence

The final visual/accessibility lane passed for POS sale workspace, split tender
checkout, register/cash operations, and refund initiation/review.

```text
SPRINT_19_WAVE_2_VISUAL_AND_ACCESSIBILITY_E2E=SUCCESS
AXE_CRITICAL=0
AXE_SERIOUS=0
DETERMINISTIC_SCREENSHOT_EVIDENCE=PASS
RESPONSIVE_EVIDENCE=PASS
ACCESSIBILITY_EVIDENCE=PASS
PIXEL_BASELINE_ASSERTION=NOT_CLAIMED_UNLESS_TO_HAVE_SCREENSHOT_PRESENT
DESKTOP=PASS
TABLET=PASS
MOBILE=PASS
HORIZONTAL_PAGE_OVERFLOW=0
HIDDEN_PRIMARY_ACTION=0
TOUCH_TARGET_FAILURE=0
MISSING_ACCESSIBLE_NAME=0
KEYBOARD_TRAP=0
FOCUS_NOT_VISIBLE=0
COLOR_ONLY_FINANCIAL_STATUS=0
POS_FORBIDDEN_HEADING_SEMANTICS=PASS
```

The forbidden state continues to use the visible native heading
“Permission denied”. The evidence is deterministic visual/accessibility
evidence, not an unqualified pixel-regression claim.

## Localization

```text
VI_VN=PASS
EN_US=PASS
LOCALE_INFRASTRUCTURE=PASS
DISPLAY_COPY_CURRENT_PRODUCT_CONTRACT=PASS
MOJIBAKE=0
MIXED_LOCALE_BLOCKER=0
```

This records locale infrastructure and the current product copy contract; it
does not claim that every existing product string is translated.

## Local QA

```text
NODE_VERSION=v22.14.0
PNPM_VERSION=11.7.0
PNPM_RECREATE_LOOP=NO
SPRINT7_REFUND_E2E=1_PASSED
SPRINT7_COMMISSION_E2E=1_PASSED
SPRINT7_DEEP_E2E=5_PASSED
WAVE2_POS_E2E=4_PASSED
SPRINT7_REFUND_COMMISSION_INTEGRATION=4_PASSED
LINT=PASS
TYPECHECK=PASS
ADMIN_WEB_BUILD=PASS
DOCKER_COMPOSE_RUNNING_SERVICES=0
ORPHANED_NAILSOFT_NODE_PROCESSES=0
```

Docker was not started for this documentation-only closure and remains stopped.

## CI remediation history

- Run `31022509999` (`ac257e967145da058fb22561f499ae47951448ad`) exposed a
  forbidden-state semantic assertion; the visible native `h2` heading was
  restored.
- Run `31029196681` (`28ec5525d31c64515fe79fffea8f79ad600cc037`) exposed a
  transient legacy login wait; the helper now waits for stable admin redirect
  and main content.
- Run `31072856157` (`f80e382687bdeccd70ec4599895446a9f82772b1`) exposed POS
  finalization copy drift; the assertion uses the canonical
  “Order finalized. Pricing is now immutable.” copy.
- Run `31076344143` (`2f4d3f98700ffe7e46e3a618456b218cbe7c9e51`) exposed refund
  route/copy drift; the evidence uses scoped status KPI locators and the
  current review wording.
- Final source `83474b1f12c107292b0b4144923b16edff39a720` partitions commission
  route ownership explicitly so the Wave 2 matcher cannot capture Sprint 7
  rule/period workflows.

No assertion was removed or weakened, no test was skipped, and no blanket retry
or `continue-on-error` behavior was added.

## Final CI results

```text
FINAL_CI_RUN_ID=31085184446
FINAL_CI_HEAD_SHA=83474b1f12c107292b0b4144923b16edff39a720
FINAL_CI_CONCLUSION=SUCCESS
QUALITY_JOB_ID=92562856325
QUALITY_JOB=SUCCESS
VISUAL_JOB_ID=92562856396
VISUAL_JOB=SUCCESS
AUTHENTICATED_SPRINT_1_TO_4_E2E=SUCCESS
SPRINT_4_BOOKING_WEB_E2E=SUCCESS
SPRINT_3_CLOSURE_E2E=SUCCESS
SPRINT_5_OPERATIONS_E2E=SUCCESS
SPRINT_6_AUTHENTICATED_POS_AND_MOBILE_E2E=SUCCESS
SPRINT_19_WAVE_2_AUTHENTICATED_E2E=SUCCESS
SPRINT_6_CLOSURE_E2E=SUCCESS
SPRINT_7_REFUND_AND_COMMISSION_E2E=SUCCESS
SPRINT_7_FINANCIAL_CORRECTNESS_DEEP_E2E=SUCCESS
SPRINT_19_WAVE_0_VISUAL=SUCCESS
SPRINT_19_WAVE_1_VISUAL=SUCCESS
SPRINT_19_WAVE_2_VISUAL=SUCCESS
BUILD_API=SUCCESS
BUILD_WORKER=SUCCESS
BUILD_ADMIN_WEB=SUCCESS
BUILD_BOOKING_WEB=SUCCESS
BUILD_OWNER_MOBILE=SUCCESS
BUILD_STAFF_MOBILE=SUCCESS
STOP_VISUAL_SERVICES=SUCCESS
STOP_CONTAINERS=SUCCESS
```

## Repository and Docker handoff

The source checkpoint was clean and matched `origin/main` before this report
was created. The documentation commit that follows is a descendant of the
source SHA and is not covered by run `31085184446`; any docs-only CI run is
separate evidence.

```text
SCREEN_INVENTORY_UPDATED=YES
ACCEPTANCE_LEDGER_UPDATED=YES
WAVE_2_REPORT_CREATED=YES
RUNTIME_CODE_CHANGED=NO
TEST_CHANGED=NO
WORKFLOW_CHANGED=NO
API_CHANGED=NO
MIGRATION_CHANGED=NO
DEPENDENCY_CHANGED=NO
VISUAL_BASELINE_CHANGED=NO
DOCKER_COMPOSE_RUNNING_SERVICES=0
WAVE_3_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Acceptance result

```text
WAVE_2_STATUS=COMPLETED
BA_PO_WAVE_2_ACCEPTANCE=PASS
CLUSTER_1=ACCEPTED
CLUSTER_2=ACCEPTED
CLUSTER_3=ACCEPTED
CLUSTER_4=ACCEPTED
SCREEN_ROWS_19_2_1_TO_19_2_18=ALL_ACCEPTED
SPRINT_19_STATUS=IN_PROGRESS
WAVE_3_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Remaining scope

Wave 3–9 screens remain outside this closure and are not authorized. Sprint 19
overall remains `IN_PROGRESS`; this report does not update the Sprint 19
completion report, authorize production go-live, or start Sprint 20.
