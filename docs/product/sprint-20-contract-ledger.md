# Sprint 20 Contract Ledger — Wave 0

```text
SPRINT=20
WAVE=0
START_CHECKPOINT=a8246ccc1c14804a675bda6c45792cfc7595368b
WAVE_0_STATUS=COMPLETE_WITH_BA_PO_DECISION_REQUIRED
IMPLEMENTATION_AUTHORIZED_FOR_WAVE_1_TO_4=NO
```

Wave 0 freezes contract decisions without implementing any business mutation.
`BLOCKED` means the contract is identified but requires BA/PO or infrastructure
decision before the corresponding wave can start.

| ID | Contract | Current evidence | Permission status | Migration status | Privacy/security status | Implementation authorized |
|---|---|---|---|---|---|---|
| 20.CUSTOMER_UPDATE | `PATCH /v1/customers/:customerId` is proposed; duplicate phone/email rejects; optimistic concurrency and idempotency required | Read/detail/create exist; update missing; customer has `updated_at` but no entity version | **BLOCKED**; no existing update permission; propose `customer.update`; role defaults pending | **CONDITIONAL**; role-permission data migration required if new code is approved | **PARTIAL**; PII redaction/audit shape defined, version and field authorization pending | NO |
| 20.STATEMENT_EXCLUSION | Exclude only an eligible unmatched statement line; no client period override; reversal policy pending | `match_state=EXCLUDED` already exists; controller has no exclusion command | Existing `accounting.bank_reconciliation.manage` proposed; BA/PO confirm | **NO schema change expected** for enum; contract still blocked by row-version/reversal decision | **BLOCKED**; financial audit, period lock and event semantics pending | NO |
| 20.RECONCILIATION_ADJUSTMENT | DRAFT → PENDING_APPROVAL → APPROVED → POSTED, with reject/cancel terminal paths and journal posting | Table and states exist; read projection exists; commands absent; no version/idempotency/history fields | Existing reconciliation/journal permissions proposed; exact split pending | **CONDITIONAL** if version/history fields are required | **BLOCKED**; posting source, idempotency and evidence contract pending | NO |
| 20.STAFF_MEDIA | Presign → private upload → complete → read → soft delete; native client remains conditional | Backend endpoints and constraints exist; native picker/camera and retention are absent | Existing `service_session.media`; assigned-session scope | NO current migration required for backend foundation | **BLOCKED**; retention, object deletion, native permissions and storage soak missing | NO |
| 20.RELEASE_READINESS | Evidence-only gate for staging and production approval | Runbooks, probes, security evidence and local drills exist; staging/operator evidence absent | N/A | N/A | **BLOCKED** until release matrix rows pass | NO |

## Customer field contract

| Field | Ordinary update | Normalization | Audit | Version conflict | Notes |
|---|---|---|---|---|---|
| `display_name` | Proposed | trim, max 200 | redacted before/after | required | no merge behavior |
| `phone_normalized` | Proposed | existing phone normalizer | redacted/fingerprint | required | duplicate conflict |
| `email_normalized` | Proposed | lowercase/email normalizer | redacted/fingerprint | required | duplicate conflict |
| `preferred_locale` | Proposed | `vi-VN`/`en-US` | yes | required | no mixed locale state |
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
| Exclude statement line | `accounting.bank_reconciliation.manage` exists | reuse only after BA/PO confirmation | Blocked |
| Create/submit adjustment | `accounting.bank_reconciliation.manage` exists | reuse only after contract confirmation | Blocked |
| Approve adjustment | no dedicated adjustment permission | `accounting.bank_reconciliation.manage` proposal; independent actor required | Blocked |
| Post adjustment | `accounting.journal.post` exists in accounting permission family | owning journal permission plus period guard | Blocked |

```text
NEW_ACCOUNTING_PERMISSION_REQUIRED_COUNT=0_EXPECTED_IF_EXISTING_PERMISSIONS_ARE_ACCEPTED
BA_PO_DECISION_REQUIRED=YES
```

## Accounting state and posting contract

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

## Wave 0 decision ledger

```text
CUSTOMER_UPDATE_CONTRACT=BLOCKED
CUSTOMER_UPDATE_PERMISSION_DECIDED=NO
CUSTOMER_UPDATE_VERSION_CONTRACT=NO
STATEMENT_EXCLUSION_CONTRACT=BLOCKED
RECONCILIATION_ADJUSTMENT_CONTRACT=BLOCKED
ACCOUNTING_ADJUSTMENT_STATE_MACHINE=SUFFICIENT_STATE_FLOW_BUT_NOT_RELEASE_SAFE
STAFF_MEDIA_RECOMMENDATION=DEFER
MEDIA_RETENTION_POLICY=UNKNOWN
WAVE_1_RECOMMENDATION=BLOCK
WAVE_2_RECOMMENDATION=BLOCK
WAVE_3_RECOMMENDATION=DEFER
WAVE_4_RECOMMENDATION=BLOCK_PENDING_STAGING
```
