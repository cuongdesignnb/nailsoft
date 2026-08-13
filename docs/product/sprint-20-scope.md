# Sprint 20 Scope — Production Hardening & Selective Backlog Closure

```text
SPRINT=20
TYPE=MIXED_RELEASE_READINESS
WAVE_0_STATUS=COMPLETED
START_CHECKPOINT=a8246ccc1c14804a675bda6c45792cfc7595368b
WAVE_3_IMPLEMENTATION_AUTHORIZED=NO
WAVE_4_IMPLEMENTATION_AUTHORIZED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

This document contains the historical Wave 0 contract freeze and the current
Sprint 20 status. The Wave 0 snapshot records repository evidence and decisions
that were still requiring BA/PO or infrastructure ownership at that point; it
does not authorize runtime mutation work by itself.

## Current Sprint 20 status

The following status is authoritative after the Customer Update and Accounting
Reconciliation source commits and their exact full CI runs:

```text
WAVE_0_STATUS=COMPLETED
WAVE_1_STATUS=COMPLETED
WAVE_1_SOURCE_SHA=1f8700cdb1aa92ee4950292a102d5088d9de3f93
WAVE_1_SOURCE_CI=31511983133
WAVE_2_STATUS=COMPLETED
WAVE_2_FINAL_SOURCE_SHA=c45f9d51cadf5ab9f93f25dda85229fe20993a33
WAVE_2_FINAL_SOURCE_CI_RUN_ID=31605026356
WAVE_2_FINAL_SOURCE_CI_CONCLUSION=SUCCESS
WAVE_3_STATUS=DEFERRED
WAVE_4_STATUS=NOT_STARTED
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Scope decision

In scope for the approved Sprint 20 proposal:

1. Customer Update, without Customer Merge.
2. Statement-line exception exclusion.
3. Reconciliation manual exception adjustment.
4. Staff Mobile native media, conditional on the privacy and storage gates below.
5. Production/release hardening and staging evidence.

Explicitly out of scope:

- Customer Merge — future customer data governance.
- Platform discount mutation lifecycle — future platform monetization.
- Manual dunning actions — future collections policy.
- Global Staff stored-value browser — future privacy/security addendum.
- Break-glass enablement — intentionally disabled foundation.
- Production deployment or go-live authorization.

## Customer Update contract audit

The current API has `GET /v1/customers`, `GET /v1/customers/:customerId` and
`POST /v1/customers`. There is no update command or update schema. The customer
table has `updated_at`, but no integer/entity version. Therefore the Wave 1
contract is blocked until BA/PO accepts a real optimistic-concurrency contract;
last-write-wins is not acceptable for PII.

### Permission registry and rollout

```text
PERMISSION_REGISTRY_LOCATION=permissions table
ROLE_PERMISSION_DEFAULT_LOCATION=role_permissions table
CURRENT_CUSTOMER_PERMISSIONS=customer.booking_lookup, customer.booking_create
EXISTING_CUSTOMER_UPDATE_PERMISSION=NONE
PROPOSED_PERMISSION_CODE=customer.update
PRODUCTION_PERMISSION_ROLLOUT_MECHANISM=MIGRATION_DATA_CHANGE
CUSTOMER_UPDATE_PERMISSION_REQUIRES_DB_MIGRATION=YES_IF_APPROVED
CUSTOMER_UPDATE_PERMISSION_REQUIRES_SEED_CHANGE=NO_SEPARATE_SEED; role_permissions migration data must change
```

Proposed defaults, pending BA/PO decision:

```text
CUSTOMER_UPDATE_DEFAULT_ROLES=SALON_OWNER, BRANCH_MANAGER, RECEPTIONIST
CUSTOMER_UPDATE_CUSTOM_ROLE_SUPPORT=NO_NEW_CUSTOM_ROLE
CUSTOMER_UPDATE_BRANCH_SCOPE=OWNER_TENANT_WIDE; NON_OWNER_AUTHORIZED_BRANCH_CONTEXT_REQUIRED
CUSTOMER_UPDATE_TENANT_SCOPE=TENANT_ONLY
```

Cashier, Technician, Marketing, Accountant, Customer and Platform Super Admin
without a valid support grant are not proposed defaults. The client may hide an
action, but the server permission and scope remain authoritative.

### Field mutation matrix

| Field | Readable by | Updatable by proposal | Normalization | PII class | Audit/version | Duplicate risk |
|---|---|---|---|---|---|---|
| `id` | `customer.booking_lookup` | Never | UUID validation | Identifier | No / n.a. | None |
| `tenant_id` | Never in customer UI | Never | Server-owned | Security | No / n.a. | None |
| `display_name` | Lookup permission | `customer.update` roles | Trim, max 200 | Personal | Yes / Yes | Low |
| `phone_normalized` | Lookup permission | `customer.update` roles | Existing phone normalizer | High PII | Redacted / Yes | High |
| `email_normalized` | Lookup permission | `customer.update` roles | Lowercase/email normalizer | High PII | Redacted / Yes | High |
| `preferred_locale` | Lookup permission | `customer.update` roles | `vi-VN` or `en-US` | Low | Yes / Yes | None |
| `status` | Server projection | Lifecycle command only | Existing enum | Domain state | Yes / Domain-owned | Merge risk |
| `is_guest` | Server projection | Booking/domain workflow only | Boolean | Domain state | Yes / Domain-owned | None |
| `contact_verification_version` | Server-owned | Never directly | Server increment | Security | Yes / Yes | Contact risk |
| `created_at` | Profile projection | Never | Server-owned | Provenance | No / n.a. | None |
| `updated_at` | Server projection | Server-maintained | Timestamp | Metadata | Yes / Contract gap | None |

Birth date, address, notes, marketing preferences and external identifiers are
not present in the current customer schema or update contract. Consent and
contact preferences remain owned by the existing engagement APIs. Financial,
loyalty, package and stored-value balances are never customer-update fields.

### Historical Wave 0 decision snapshot (superseded by Wave 1 source CI)

```text
CUSTOMER_UPDATE_PERMISSION_DECIDED=NO
CUSTOMER_UPDATE_ROLE_MATRIX_DECIDED=NO
CUSTOMER_UPDATE_VERSION_CONTRACT=NO
CUSTOMER_UPDATE_DUPLICATE_CONTRACT=NO
CUSTOMER_UPDATE_AUDIT_CONTRACT=PARTIAL
PRODUCTION_PERMISSION_ROLLOUT_KNOWN=YES_MECHANISM_KNOWN_DATA_CHANGE_NOT_AUTHORIZED
HISTORICAL_WAVE_1_BLOCKED=YES
```

Duplicate phone/email updates must reject with a conflict; they must not resolve
an existing customer and must not become a merge operation. Audit must contain
actor, tenant, request ID, before/after redacted values and idempotency result.
The current customer-create pattern writes audit data and does not require a
new outbox event; Wave 1 must not introduce raw PII logging.

## Accounting reconciliation contracts

### Statement-line exclusion

Evidence: `accounting_bank_statement_lines.match_state` already allows
`EXCLUDED`; the line is linked to an import and bank account, while the
reconciliation carries `period_id`, `state` and `version`. The current
controller exposes read, match and unmatch only; there is no exclusion command.

```text
EXCLUSION_COMMAND_ROUTE_PROPOSAL=POST /v1/accounting/bank-accounts/:bankAccountId/statement-lines/:statementLineId/exclude
EXCLUSION_REQUEST_SCHEMA={reason: non-empty bounded text, expectedMatchState: current state}
EXCLUSION_REQUIRED_PERMISSION=accounting.bank_reconciliation.manage (existing; BA/PO confirm)
EXCLUSION_IDEMPOTENCY=accounting_command_idempotency with request fingerprint
EXCLUSION_VERSION=NO_ROW_VERSION; current match_state/fingerprint plus FOR UPDATE is the only existing equivalent
EXCLUSION_REASON_REQUIRED=YES
EXCLUSION_AUDIT=YES, before/after, actor, tenant, requestId, redacted
EXCLUSION_OUTBOX=UNDEFINED; no current exclusion event contract, BA/PO decision required
```

Safe proposal invariants:

```text
MATCHED_LINE_CAN_BE_EXCLUDED=NO
RECONCILED_LINE_CAN_BE_EXCLUDED=NO
LOCKED_PERIOD_CAN_BE_EXCLUDED=NO
POSTED_LINE_CAN_BE_EXCLUDED=NO
EXCLUSION_REVERSIBLE=BA_PO_DECISION_REQUIRED
CLIENT_CANNOT_OVERRIDE_PERIOD_LOCK=YES
```

The missing row-version/evidence-event/reversal decisions block Wave 2; the
existing `EXCLUDED` enum itself does not require a schema migration.

### Manual reconciliation adjustment

The existing table is `accounting_reconciliation_adjustment_requests`:

```text
ADJUSTMENT_STATES=DRAFT, PENDING_APPROVAL, APPROVED, POSTED, REJECTED, CANCELLED
INITIAL_STATE=DRAFT
APPROVABLE_STATES=PENDING_APPROVAL
POSTABLE_STATES=APPROVED
TERMINAL_STATES=POSTED, REJECTED, CANCELLED
```

The table already enforces `approved_by_user_id <> requested_by_user_id` when
both are present. It does not currently have a version, updated timestamp,
request id, idempotency key or dedicated history/outbox fields. The read
projection exists, but create/submit/approve/reject/cancel/post commands do not.

```text
ADJUSTMENT_STATE_MACHINE=SUFFICIENT_STATE_FLOW_BUT_INSUFFICIENT_CONTRACT_EVIDENCE
DUAL_CONTROL_REQUIRED=YES
SELF_APPROVAL_ALLOWED=NO
APPROVAL_PERMISSION=accounting.bank_reconciliation.manage (proposal)
POST_PERMISSION=accounting.journal.post (proposal)
ACCOUNTING_SCHEMA_SUFFICIENT=FOR_STATE_ENUMS_ONLY
ACCOUNTING_DATA_MIGRATION_REQUIRED=CONDITIONAL
ACCOUNTING_SCHEMA_MIGRATION_REQUIRED=CONDITIONAL_IF_VERSION_OR_HISTORY_IS_REQUIRED
WAVE_2_BLOCKED=YES
```

The proposed journal source type is `ACCOUNTING_RECONCILIATION_ADJUSTMENT`.
Lines must be balanced, use the reconciliation/book currency, post only to an
open or reopened period, use the existing posting engine and generation key,
and remain immutable after posting. Reversal must use the existing journal
reversal flow; direct edits are prohibited.

## Staff Mobile media decision

The backend sequence is already present:

```text
POST /v1/service-sessions/:sessionId/media/presign
PUT <private object-storage uploadUrl>
POST /v1/service-sessions/:sessionId/media/:mediaId/complete
GET  /v1/service-sessions/:sessionId/media
POST /v1/service-sessions/:sessionId/media/:mediaId/delete
```

Current contract: `BEFORE|AFTER|REFERENCE`, MIME `image/jpeg|image/png|image/webp`,
maximum 15 MiB, SHA-256 checksum, tenant/session object key,
five-minute signed upload URL, assigned-session authorization and soft-delete
metadata. Public buckets are prohibited.

The repository has no retention duration, object deletion lifecycle or complete
storage-credential soak evidence. Native Staff Mobile has no image-picker or
camera dependency and no iOS/Android permission strings.

```text
MEDIA_RETENTION_POLICY=MISSING
MEDIA_OBJECT_STORAGE_SCOPE=PRIVATE_TENANT_SESSION_ASSIGNED_STAFF
MEDIA_STAGING_CREDENTIAL_REQUIRED=YES
IMAGE_PICKER_DEPENDENCY=MISSING
CAMERA_DEPENDENCY=MISSING
PERMISSION_DEPENDENCY=MISSING
IOS_PERMISSION_STRINGS=MISSING
ANDROID_PERMISSION_REQUIREMENTS=MISSING
NATIVE_BUILD_CHANGE_REQUIRED=YES
STAFF_MEDIA_RECOMMENDATION=DEFER
WAVE_3_BLOCKED=YES
```

Wave 3 may be reconsidered only after retention, deletion, signed-upload soak,
storage credentials and native dependency decisions are accepted.

## Release and go-live policy

The source SLOs are `RPO <=15 minutes` and `RTO <=60 minutes`; the Sprint 18
local drill's 300-second threshold is not a replacement for those staging
targets. Local Docker success is never staging evidence.

Go-live state model:

```text
NOT_READY
→ READY_FOR_STAGING
→ STAGING_VALIDATED
→ READY_FOR_PRODUCTION_APPROVAL
→ GO_LIVE_AUTHORIZED
```

Only BA/PO plus the designated release operator can authorize the last state.
Agent and CI can provide evidence but cannot transition production authority.

## Historical Wave 0 gate

```text
CUSTOMER_UPDATE_CONTRACT=BLOCKED
STATEMENT_EXCLUSION_CONTRACT=BLOCKED
RECONCILIATION_ADJUSTMENT_CONTRACT=BLOCKED
STAFF_MEDIA_RECOMMENDATION=DEFER
RELEASE_WORKSTREAM_COUNT=15
WAVE_1_STARTED=NO
WAVE_2_STARTED=NO
WAVE_3_STARTED=NO
WAVE_4_STARTED=NO
RUNTIME_CODE_CHANGE=NO
TEST_CHANGE=NO
MIGRATION_CHANGE=NO
DEPENDENCY_CHANGE=NO
WORKFLOW_CHANGE=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Wave 2 authorization and implementation ledger

The current Wave 2 handoff authorizes only accounting reconciliation closure.
The historical Wave 0 and Wave 1 records above are retained for traceability;
they are not reopened or rewritten.

```text
WAVE_2_STATUS=COMPLETED
WAVE_2_START_CHECKPOINT=ba8b41271a0a2f28fcac4b5a4c8a4eb4ec438332
WAVE_2_BUSINESS_SOURCE_SHA=8fa7ca4dc44f6980ab31fe16365b4198a77f1ec3
FAILED_INTERMEDIATE_CI_RUN_ID=31583002111
FAILED_INTERMEDIATE_CLASSIFICATION=TEST_CONTRACT_DRIFT
RUNTIME_REMEDIATION_CLASSIFICATION=BANKING_BOOK_CONTEXT_REGRESSION
WAVE_2_REMEDIATION_SHA=c45f9d51cadf5ab9f93f25dda85229fe20993a33
WAVE_2_FINAL_SOURCE_SHA=c45f9d51cadf5ab9f93f25dda85229fe20993a33
WAVE_2_FINAL_SOURCE_CI_RUN_ID=31605026356
WAVE_2_FINAL_SOURCE_CI_CONCLUSION=SUCCESS
WAVE_2_ACCEPTANCE=ACCEPTED
MIGRATION=0036_accounting_reconciliation_closure
NEW_ACCOUNTING_PERMISSION_REQUIRED=NO
STATEMENT_EXCLUSION=ACCEPTED
STATEMENT_RESTORE=ACCEPTED
RECONCILIATION_ADJUSTMENT=ACCEPTED
BANKING_BOOK_CONTEXT=PASS
MULTIPLE_BOOK_AUTO_SELECT_FIRST=NO
```

In-scope commands are:

- bank statement-line exclude and restore;
- reconciliation adjustment create, submit, approve, reject, cancel and post;
- optimistic version checks, idempotency, dual control, period locks, journal
  balance/source linking, reconciliation balance updates, audit/outbox/history
  evidence and posted immutability.

The server derives the bank GL account and accounting period. Clients submit
only an active same-book offset account and a positive minor-unit amount. FX
that the existing posting engine cannot support fails closed. Wave 2 does not
add permissions, change the accounting state enum, introduce a parallel
ledger, or authorize production deployment.
Full CI run `31605026356` validated exact source
`c45f9d51cadf5ab9f93f25dda85229fe20993a33`; Wave 2 is accepted.

```text
WAVE_3_STATUS=DEFERRED
WAVE_4_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Wave 4 production hardening status

Wave 4 is limited to repository-safe hardening and release evidence. It does
not deploy production or authorize go-live. The current release state remains
`NOT_READY` until staging/operator evidence is attached.

```text
RELEASE_WORKSTREAM_COUNT=15
WAVE_4_STATUS=IN_PROGRESS
WAVE_4_START_CHECKPOINT=102cd43b23983afeb54662adeb1c42f4e0756010
CAPACITY_TARGETS=FROZEN_BY_BA_PO
RPO_MAX=15_MINUTES
RTO_MAX=60_MINUTES
REDIS_SHARED_RATE_LIMIT=IMPLEMENTED_FAIL_CLOSED_IN_PRODUCTION
RELEASE_MANIFEST_AND_SBOM=IMPLEMENTED_WITH_RELEASE_ARTIFACT_NAMESPACE
WAVE4_SOURCE_CI=NOT_RUN
STAGING_EVIDENCE=NOT_AVAILABLE
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

Wave 3 remains deferred because media retention, object-storage lifecycle and
staging storage soak are not complete. Customer Merge, platform discount
mutation, manual dunning, the global Staff stored-value browser and break-glass
enablement remain out of scope.
