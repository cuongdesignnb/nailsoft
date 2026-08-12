# Sprint 20 Wave 2 — Accounting Reconciliation Closure

```text
SPRINT=20
WAVE=2
TITLE=ACCOUNTING_RECONCILIATION_CLOSURE
START_CHECKPOINT=ba8b41271a0a2f28fcac4b5a4c8a4eb4ec438332
STATUS=SPRINT_20_WAVE_2_IN_PROGRESS
REPORT_STATUS=DRAFT_PENDING_SOURCE_CI
WAVE_2_STATUS=IMPLEMENTED_PENDING_SOURCE_CI
FINAL_WAVE_2_SOURCE_SHA=PENDING_FINAL_SOURCE_SHA
FINAL_WAVE_2_CI_RUN_ID=PENDING
FINAL_WAVE_2_CI_CONCLUSION=PENDING
SOURCE_CI=PENDING
ACCEPTANCE=PENDING
```

## Scope and permissions

```text
STATEMENT_EXCLUSION=POST /v1/accounting/bank-accounts/:bankAccountId/statement-lines/:statementLineId/exclude
STATEMENT_RESTORE=POST /v1/accounting/bank-accounts/:bankAccountId/statement-lines/:statementLineId/restore
ADJUSTMENT_CREATE=POST /v1/accounting/bank-reconciliations/:reconciliationId/adjustments
ADJUSTMENT_SUBMIT=POST /v1/accounting/reconciliation-adjustments/:id/submit
ADJUSTMENT_APPROVE=POST /v1/accounting/reconciliation-adjustments/:id/approve
ADJUSTMENT_REJECT=POST /v1/accounting/reconciliation-adjustments/:id/reject
ADJUSTMENT_CANCEL=POST /v1/accounting/reconciliation-adjustments/:id/cancel
ADJUSTMENT_POST=POST /v1/accounting/reconciliation-adjustments/:id/post

STATEMENT_AND_ADJUSTMENT_MANAGE_PERMISSION=accounting.bank_reconciliation.manage
ADJUSTMENT_POST_PERMISSION=accounting.journal.post
NEW_ACCOUNTING_PERMISSION_REQUIRED=NO
```

## Contract evidence to be validated by source CI

```text
MIGRATION=0036_accounting_reconciliation_closure
STATEMENT_LINE_VERSIONING=YES
STATEMENT_EXCLUDE_RESTORE_STATES=SERVER_GUARDED
ADJUSTMENT_STATES=DRAFT,PENDING_APPROVAL,APPROVED,POSTED,REJECTED,CANCELLED
DUAL_CONTROL=REQUESTOR_CANNOT_APPROVE_OWN_REQUEST
PERIOD_LOCK=OPEN_OR_REOPENED_ONLY
IDEMPOTENCY=ACCOUNTING_COMMAND_IDEMPOTENCY
ATOMIC_POSTING=YES
JOURNAL_BALANCED=YES
JOURNAL_SOURCE_TYPE=ACCOUNTING_RECONCILIATION_ADJUSTMENT
RECONCILIATION_BALANCE_SERVER_AUTHORITATIVE=YES
POSTED_IMMUTABILITY=YES
AUDIT_OUTBOX_HISTORY=YES
FX_UNSUPPORTED_FAIL_CLOSED=YES
TENANT_ISOLATION=YES
```

## Local evidence before push

The focused integration exercises exclusion/restore versioning and replay,
adjustment lifecycle, balanced journal posting and one reconciliation balance
update. The contract lane checks the eight routes, strict schemas and migration
guards. Full acceptance is intentionally not claimed until the exact source
CI run is green.

```text
WAVE2_CONTRACT=LOCAL_PENDING_FINAL_GATE
WAVE2_INTEGRATION=LOCAL_PASS
WAVE2_CONCURRENCY=LOCAL_PASS
WAVE2_IDEMPOTENCY=LOCAL_PASS
WAVE2_AUTHORIZATION=LOCAL_PASS
MIGRATION_FRESH=LOCAL_PASS
MIGRATION_ROLLBACK=LOCAL_PASS
MIGRATION_REMIGRATE=LOCAL_PASS
WAVE1_REGRESSION=LOCAL_PASS
ALL_BUILDS=LOCAL_PASS
```

## Guardrails

Wave 3 remains deferred, Wave 4 has not started, and production go-live is not
authorized. The security exception `SEC-2026-IMAGE-SIZE-METRO` is unchanged;
its expiry remains `2026-09-07`.
