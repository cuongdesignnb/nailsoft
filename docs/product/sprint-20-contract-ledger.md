# Sprint 20 Contract Ledger — Wave 0

```text
SPRINT=20
WAVE=0
START_CHECKPOINT=a8246ccc1c14804a675bda6c45792cfc7595368b
WAVE_0_STATUS=COMPLETE_WITH_BA_PO_DECISION_REQUIRED
HISTORICAL_IMPLEMENTATION_AUTHORIZED_FOR_WAVE_1_TO_4=NO
```

The opening sections preserve the historical Wave 0 contract freeze. Current
Wave 2 acceptance is recorded below and supersedes the historical blocker rows
without rewriting their provenance.
`BLOCKED` means the contract is identified but requires BA/PO or infrastructure
decision before the corresponding wave can start.

| ID | Contract | Current evidence | Permission status | Migration status | Privacy/security status | Implementation authorized |
|---|---|---|---|---|---|---|
| 20.CUSTOMER_UPDATE | `PATCH /v1/customers/:customerId` implemented for display name, phone, email and preferred locale; duplicate phone/email rejects; optimistic concurrency and idempotency required | Read/detail/create plus additive update route; customer version and contact verification increment are server-controlled | `customer.update`; default rollout to SALON_OWNER, BRANCH_MANAGER and RECEPTIONIST | `0035_customer_update`; additive customer version and role-permission rollout | PII values are normalized, excluded from audit/outbox payloads and represented by fingerprints; tenant scope and strict field allowlist enforced | ACCEPTED — source `1f8700cdb1aa92ee4950292a102d5088d9de3f93`, CI `31511983133 / SUCCESS` |
| 20.STATEMENT_EXCLUSION | Exclude only an eligible unmatched or eligible suggested statement line; restore only `EXCLUDED` to `UNMATCHED` | Exclude/restore commands, row versioning and server guards implemented | `accounting.bank_reconciliation.manage` | `0036_accounting_reconciliation_closure`; statement-line version column and append-only guard | Tenant isolation, row lock, period, finalized-reconciliation, audit and outbox guards implemented | ACCEPTED — source `c45f9d51cadf5ab9f93f25dda85229fe20993a33`, CI `31605026356 / SUCCESS` |
| 20.RECONCILIATION_ADJUSTMENT | `DRAFT` → `PENDING_APPROVAL` → `APPROVED` → `POSTED`; `REJECTED` and `CANCELLED` terminal paths | Create/submit/approve/reject/cancel/post commands, versioning, history and atomic journal posting implemented | Manage: `accounting.bank_reconciliation.manage`; post: `accounting.journal.post`; no new permission | `0036_accounting_reconciliation_closure`; version, updated-at, posting context and history | Dual control, period, same-book offset, balanced journal, posted immutability, audit/outbox/history and tenant isolation implemented | ACCEPTED — source `c45f9d51cadf5ab9f93f25dda85229fe20993a33`, CI `31605026356 / SUCCESS` |
| 20.STAFF_MEDIA | Presign → private upload → complete → read → soft delete; native client remains conditional | Backend endpoints and constraints exist; native picker/camera and retention are absent | Existing `service_session.media`; assigned-session scope | NO current migration required for backend foundation | **BLOCKED**; retention, object deletion, native permissions and storage soak missing | NO |
| 20.RELEASE_READINESS | Evidence-only gate for staging and production approval | Runbooks, probes, security evidence and local drills exist; staging/operator evidence absent | N/A | N/A | **BLOCKED** until release matrix rows pass | NO |

## Customer field contract

| Field | Ordinary update | Normalization | Audit | Version conflict | Notes |
|---|---|---|---|---|---|
| `display_name` | Implemented | trim, max 200 | redacted/fingerprint before/after | required | no merge behavior |
| `phone_normalized` | Implemented | existing phone normalizer; null clears | redacted/fingerprint | required | duplicate conflict; increments contact verification version |
| `email_normalized` | Implemented | lowercase/email normalizer; null clears | redacted/fingerprint | required | duplicate conflict; increments contact verification version |
| `preferred_locale` | Implemented | `vi-VN`/`en-US` | yes | required | no mixed locale state |
| `status` | No | lifecycle-owned | domain audit | domain-owned | includes `MERGED`; not a normal edit |
| `is_guest` | No | booking-owned | domain audit | domain-owned | not client-controlled |
| `contact_verification_version` | No | server increment | security audit | required | contact change invalidates stale verification |
| `id`, `tenant_id`, `created_at`, `updated_at` | No | server-owned | provenance | n.a./server | never client-controlled |
| birth date, address, notes, external IDs | No | absent from schema | n.a. | n.a. | separate approved contract required |
| consent/preferences/balances/history | No | owning domain | owning domain | owning domain | not duplicated by Customer Update |

## Accounting permission matrix

| Operation | Existing permission evidence | Wave 0 proposal | Decision |
|---|---|---|---|
| Read statement lines/exceptions | `accounting.bank_reconciliation.read` | retain | Defined |
| Exclude statement line | `accounting.bank_reconciliation.manage` exists | reuse | Accepted |
| Create/submit adjustment | `accounting.bank_reconciliation.manage` exists | reuse | Accepted |
| Approve adjustment | `accounting.bank_reconciliation.manage` exists | reuse; independent actor required | Accepted |
| Post adjustment | `accounting.journal.post` exists in accounting permission family | owning journal permission plus period guard | Accepted |

```text
NEW_ACCOUNTING_PERMISSION_REQUIRED_COUNT=0_EXPECTED_IF_EXISTING_PERMISSIONS_ARE_ACCEPTED
BA_PO_DECISION_REQUIRED=YES
```

## Historical Wave 0 accounting state and posting contract

```text
STATEMENT_LINE_STATES=UNMATCHED,SUGGESTED,MATCHED,PARTIALLY_MATCHED,EXCLUDED,DISPUTED
STATEMENT_EXCLUSION_ALLOWED=ONLY_UNMATCHED_OR_ELIGIBLE_SUGGESTED; exact rule pending
ADJUSTMENT_STATES=DRAFT,PENDING_APPROVAL,APPROVED,POSTED,REJECTED,CANCELLED
ADJUSTMENT_INITIAL=DRAFT
ADJUSTMENT_APPROVAL=PENDING_APPROVAL→APPROVED
ADJUSTMENT_POSTING=APPROVED→POSTED
ADJUSTMENT_DUAL_CONTROL=REQUESTED_BY != APPROVED_BY
PERIOD_POLICY=OPEN_OR_REOPENED_ONLY; CLOSED/REOPEN_PENDING DENIED
JOURNAL_SOURCE_TYPE=ACCOUNTING_RECONCILIATION_ADJUSTMENT (proposed)
JOURNAL_BALANCE=DEBITS == CREDITS; positive minor units; book currency
POSTING_IDEMPOTENCY=existing accounting_command_idempotency plus generation key
POSTED_IMMUTABILITY=existing journal posting guards
REVERSAL_POLICY=existing journal reversal flow; no direct edit
```

The state enum is sufficient for the nominal flow, but the persisted row lacks
an entity version, explicit request ID, idempotency key and dedicated history.
Wave 2 is blocked until BA/PO accepts a lock/idempotency equivalent or authorizes
the required data migration.

## Staff media privacy contract

```text
MEDIA_TYPES=BEFORE,AFTER,REFERENCE
ALLOWED_MIME=image/jpeg,image/png,image/webp
MAX_SIZE=15 MiB
CHECKSUM=SHA-256 hex
OBJECT_KEY=tenants/{tenantId}/sessions/{sessionId}/{mediaId}
SIGNED_UPLOAD_TTL=5 minutes
PUBLIC_BUCKET=NO
TENANT_BINDING=YES
SESSION_BINDING=YES
ASSIGNED_STAFF_BINDING=YES
RETENTION_POLICY=MISSING
DELETE_POLICY=DB soft-delete exists; object deletion lifecycle undefined
AUDIT_POLICY=presign/complete/delete security events exist; retention evidence missing
```

## Historical Wave 0 decision ledger

```text
HISTORICAL_CUSTOMER_UPDATE_CONTRACT=IMPLEMENTED_PENDING_SOURCE_CI
CUSTOMER_UPDATE_PERMISSION_DECIDED=YES (customer.update)
CUSTOMER_UPDATE_VERSION_CONTRACT=YES (customers.version BIGINT, optimistic lock)
STATEMENT_EXCLUSION_CONTRACT=BLOCKED
RECONCILIATION_ADJUSTMENT_CONTRACT=BLOCKED
ACCOUNTING_ADJUSTMENT_STATE_MACHINE=SUFFICIENT_STATE_FLOW_BUT_NOT_RELEASE_SAFE
STAFF_MEDIA_RECOMMENDATION=DEFER
MEDIA_RETENTION_POLICY=UNKNOWN
HISTORICAL_WAVE_1_RECOMMENDATION=BLOCK
WAVE_2_RECOMMENDATION=BLOCK
WAVE_3_RECOMMENDATION=DEFER
WAVE_4_RECOMMENDATION=BLOCK_PENDING_STAGING
```

## Current status after Wave 1 source CI

```text
WAVE_0_STATUS=COMPLETED
WAVE_1_STATUS=COMPLETED_AGAINST_SOURCE_CI
WAVE_1_SOURCE_SHA=1f8700cdb1aa92ee4950292a102d5088d9de3f93
WAVE_1_SOURCE_CI=31511983133 / SUCCESS
CUSTOMER_UPDATE_CONTRACT=ACCEPTED
CUSTOMER_UPDATE_PERMISSION_DECIDED=YES
CUSTOMER_UPDATE_VERSION_CONTRACT=YES
CUSTOMER_UPDATE_DUPLICATE_CONTRACT=YES
CUSTOMER_UPDATE_AUDIT_CONTRACT=YES
WAVE_2_STARTED=NO
WAVE_3_STATUS=DEFERRED
WAVE_4_STARTED=NO
WAVE_4_STATUS=NOT_STARTED
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Current Wave 2 accepted implementation status

The BA/PO correction superseded the historical Wave 0 accounting blockers and
authorized only the two accounting reconciliation mutation families. The
historical decisions above remain preserved; this section records the current
source implementation state after the exact full-CI gate.

```text
WAVE_2_STATUS=COMPLETED
WAVE_2_TITLE=ACCOUNTING_RECONCILIATION_CLOSURE
START_CHECKPOINT=ba8b41271a0a2f28fcac4b5a4c8a4eb4ec438332
MIGRATION=0036_accounting_reconciliation_closure
NEW_ACCOUNTING_PERMISSION_REQUIRED=NO
STATEMENT_EXCLUSION_PERMISSION=accounting.bank_reconciliation.manage
STATEMENT_RESTORE_PERMISSION=accounting.bank_reconciliation.manage
ADJUSTMENT_MANAGE_PERMISSION=accounting.bank_reconciliation.manage
ADJUSTMENT_POST_PERMISSION=accounting.journal.post
STATEMENT_EXCLUSION=ACCEPTED
STATEMENT_RESTORE=ACCEPTED
ADJUSTMENT_LIFECYCLE=ACCEPTED
ADJUSTMENT_POSTING=ACCEPTED
VERSIONING=IMPLEMENTED
IDEMPOTENCY=IMPLEMENTED
DUAL_CONTROL=IMPLEMENTED
PERIOD_LOCK=IMPLEMENTED
POSTED_IMMUTABILITY=IMPLEMENTED
JOURNAL_BALANCE_AND_SOURCE_LINK=IMPLEMENTED
TENANT_ISOLATION=IMPLEMENTED
AUDIT_OUTBOX_HISTORY=IMPLEMENTED
FX_UNSUPPORTED_FAIL_CLOSED=IMPLEMENTED
SOURCE_CI=31605026356 / SUCCESS
ACCEPTANCE=ACCEPTED
CANONICAL_SOURCE_SHA=c45f9d51cadf5ab9f93f25dda85229fe20993a33
WAVE_3_STATUS=DEFERRED
WAVE_4_STARTED=NO
WAVE_4_STATUS=NOT_STARTED
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

Accepted Wave 2 guards and migration-backed fields:

```text
EXCLUDE_ALLOWED_STATES=UNMATCHED,ELIGIBLE_SUGGESTED
RESTORE=EXCLUDED_TO_UNMATCHED_ONLY
ROW_LOCK_STATE_GUARD=IMPLEMENTED
PERIOD_GUARD=IMPLEMENTED
FINALIZED_RECONCILIATION_GUARD=IMPLEMENTED
AUDIT=IMPLEMENTED
OUTBOX=IMPLEMENTED
TENANT_ISOLATION=IMPLEMENTED
STATEMENT_LINE_VERSIONING=YES
ADJUSTMENT_VERSIONING=YES
ADJUSTMENT_UPDATED_AT=YES
ADJUSTMENT_POSTING_CONTEXT=YES
ADJUSTMENT_HISTORY=YES
```

The new command surface is limited to statement-line exclude/restore and the
existing reconciliation adjustment state machine. No new permission, parallel
ledger, customer merge, staff media, break-glass or production deployment is
introduced by Wave 2. Full CI run `31605026356` accepted exact source
`c45f9d51cadf5ab9f93f25dda85229fe20993a33`.
