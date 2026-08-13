# Sprint 20 Release Readiness Matrix — Wave 0

```text
SPRINT=20
WAVE=0
TITLE=Production Hardening & Selective Backlog Closure
RELEASE_WORKSTREAM_COUNT=15
CURRENT_RELEASE_STATE=NOT_READY
PRODUCTION_GO_LIVE_AUTHORIZED=NO
PRODUCTION_GO_LIVE_DECISION_OWNER=BA_PO_OPERATOR
```

This matrix separates repository preparation from evidence that must be produced
in staging, by an operator, or with a real external provider. A passing local
Docker run is not staging evidence. Wave 0 does not deploy or authorize a
production release.

## Go-live state model

```text
NOT_READY
→ READY_FOR_STAGING
→ STAGING_VALIDATED
→ READY_FOR_PRODUCTION_APPROVAL
→ GO_LIVE_AUTHORIZED
```

The agent and CI may produce evidence only. The final transition is owned by
BA/PO and the designated release operator.

## Release workstreams

| ID | WORKSTREAM | CURRENT_CONTROL | MISSING_EVIDENCE | OWNER | CAN_REPO_AGENT_COMPLETE | REQUIRES_STAGING | REQUIRES_REAL_SECRET | REQUIRES_EXTERNAL_PROVIDER | PASS_EVIDENCE | STOP_GO_EFFECT |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Secret injection and rotation | Environment catalog and fail-closed configuration validation exist; no values are committed. | Secret-manager injection, rotation rehearsal, rollback after rotation and access review. | Release/security operator | PARTIAL | YES | YES | NO | Staging startup with injected secrets, rotation record, old-secret rejection and repository scan. | Missing injection or rotation keeps `NOT_READY`. |
| R2 | Production configuration and release artifact | Runtime configuration validates required variables; no approved production image or immutable release manifest is configured; mobile app configs are minimal. | Target artifact/container, immutable digest, SBOM/signature, production config and mobile release configuration. | DevOps/release | PARTIAL | YES | NO | NO | Immutable artifact manifest, SBOM/scan, version/health probes and reproducible config evidence. | No approved artifact or config keeps `NOT_READY`. |
| R3 | Staging migration rehearsal | Migrations `0001`–`0034` and migration checks are in the repository. | Real staging forward migration, restart, head verification, rollback/roll-forward decision and data smoke. | Database/release operator | PARTIAL | YES | YES | NO | Timestamped staging migration log, schema head, smoke result and rollback decision. | Unrehearsed migration blocks staging validation. |
| R4 | Backup, restore, RPO and RTO | Backup/restore scripts and local drills exist; source targets are RPO ≤15 minutes and RTO ≤60 minutes. | Staging restore, measured recovery point, measured recovery time, integrity and application smoke. | Database/operations | PARTIAL | YES | YES | NO | Staging restore artifact with timestamps, RPO/RTO measurements and smoke output. | Missing measured restore evidence blocks production approval. |
| R5 | Disaster-recovery target and credentials | DR runbook exists; Redis can be rebuilt from PostgreSQL/outbox in local evidence. | Isolated restore target, credentials, promotion authority and recovery rehearsal. | Infrastructure/incident commander | NO | YES | YES | NO | Approved DR target, credential access review and completed recovery drill. | Undefined target or credentials keeps `NOT_READY`. |
| R6 | Monitoring wiring | Metrics endpoint and dashboard catalog exist. | Production scrape, retention, dashboards and coverage for API, worker, DB, Redis, queue, WebSocket, providers, backup, rate limit and auth. | SRE/operations | PARTIAL | YES | NO | NO | Dashboard links, scrape health, retention proof and metric-to-service coverage. | Missing critical telemetry blocks release approval. |
| R7 | Alert delivery and on-call | Alert catalog and deduplication tests exist. | Live delivery, escalation, acknowledgement, resolution and on-call ownership. | SRE/on-call operator | NO | YES | NO | YES | Test alerts with delivery receipt, escalation timeline and acknowledged incident. | Undeliverable critical alerts block production approval. |
| R8 | Log retention and SIEM | Recursive redaction and secret/PII exclusion controls exist. | Retention period, ingestion, access controls, search and incident-export evidence. | Security/SRE | PARTIAL | YES | NO | NO | Redaction test, retention/access configuration and traceable incident search. | Missing protected log handling blocks approval. |
| R9 | Multi-replica rate limiting | Sensitive DB-backed protections exist; general HTTP limiting is in-memory per process. | Decision and proof for shared gateway or shared store; multi-replica abuse/load evidence. | Infrastructure/security | PARTIAL | YES | NO | NO | Architecture decision, two-replica test and limit consistency evidence. | Per-process-only protection is not production-ready for multi-replica deployment. |
| R10 | Load and capacity | Local/CI smoke coverage exists, but no consolidated production-like capacity target exists. | BA/PO targets for concurrency, throughput, queue depth, WebSocket connections, latency and error rate; production-like load evidence. | Performance/BA/infra | PARTIAL | YES | NO | NO | Approved target sheet, load report, bottleneck actions and error/latency thresholds. | `TARGET_MISSING=YES` and failed thresholds block approval. |
| R11 | Worker lease and provider soak | Graceful shutdown, outbox leasing/reclaim and worker processors are implemented. | Per-processor metrics, long-running lease/retry soak and provider behavior under timeout/failure. | Worker/platform/provider owner | PARTIAL | YES | YES | YES | Staging soak report with lease ownership, retries, dead-letter/recovery and provider traces. | Unproven lease or retry behavior blocks production approval. |
| R12 | Redis and queue HA | Redis readiness and Socket.IO adapter support exist; production topology is not selected. | HA/failover topology, queue durability/replay, maintenance and capacity plan. | Infrastructure | NO | YES | YES | NO | Approved topology, failover drill, queue replay/duplicate policy and recovery evidence. | Undefined HA or queue durability is a release blocker. |
| R13 | WebSocket multi-replica | Redis adapter, CORS/auth revalidation and reconnect behavior exist. | Production sticky-session/shared-pubsub decision, connection/latency load and reconnect evidence. | Infrastructure/realtime | PARTIAL | YES | NO | NO | Multi-replica connect/broadcast/reconnect report and topology configuration. | Missing topology or cross-replica delivery blocks approval. |
| R14 | External provider credentials and soak | Email, OTP, payment, accounting delivery and object-storage adapters fail closed when unconfigured. | Provider selection, sandbox/staging credentials, latency/error/unknown-state/reconciliation soak and rotation evidence. | Integration owners/operations | NO | YES | YES | YES | Provider matrix, credential injection proof, failure-mode and soak reports. | Any untested production provider blocks approval. |
| R15 | Deploy, rollback, health and mobile release | Deployment/rollback runbooks, readiness/version/health probes exist; mobile `app.json` remains minimal. | Executed staging deploy, application/worker rollback, migration decision, health smoke, mobile signing/build/deep-link/crash configuration. | Release/mobile operator | PARTIAL | YES | YES | YES | Timestamped deploy/rollback drill, health checks, artifact versions and mobile release evidence. | No tested rollback or mobile artifact blocks approval. |

```text
RELEASE_WORKSTREAM_COUNT=15
REPO_COMPLETABLE_WORKSTREAM_COUNT=7
STAGING_REQUIRED_WORKSTREAM_COUNT=15
EXTERNAL_PROVIDER_REQUIRED_WORKSTREAM_COUNT=4
OPERATOR_REQUIRED_WORKSTREAM_COUNT=15
```

`REPO_COMPLETABLE_WORKSTREAM_COUNT=7` means repository-side preparation or
evidence tooling only; it does not make the corresponding staging gate pass.
The 15 workstreams all require an operator-owned acceptance record before
production approval.

## Secret categories and rotation ownership

Values must remain outside the repository. Names below are categories to be
resolved against the environment-variable catalog and deployment secret store.

| Category | Required secret/config names | Owner | Rotation procedure | Rotation rehearsal / rollback |
|---|---|---|---|---|
| Application auth | `JWT_SECRET`, refresh-token signing/rotation material | Security/release | Generate replacement, deploy overlap if supported, invalidate old material according to auth policy | Staging rotation, failed-refresh verification and rollback to approved version |
| Database | `DATABASE_URL`, migration/backup credentials | DBA/operations | Rotate through secret manager and least-privilege account process | Staging connection, migration and restore rehearsal |
| Redis/queue | `REDIS_URL`, TLS/auth material if enabled | Infrastructure | Secret-manager rotation with worker/socket reconnect test | Staging reconnect and queue recovery drill |
| Email/OTP | Provider API keys, webhook verification material | Integration owner | Provider rotation and webhook verification update | Staging send/verify/failure soak; no real recipient data in tests |
| Payment/accounting delivery | Provider credentials and signing keys | Finance/integration owner | Provider-approved key rotation and reconciliation check | Staging sandbox soak and unknown-result handling |
| Object storage | Bucket endpoint, access key/secret, signing material | Infrastructure/media owner | Key rotation with signed-upload/delete verification | Staging upload, complete, read, delete and expiry soak |
| Observability/alerts | Scrape, log, alert destination credentials | SRE | Secret-manager rotation with delivery test | Staging dashboard and alert delivery rehearsal |

## Provider matrix

| Domain | Provider selected | Sandbox available | Staging credentials | Fail-closed test | Soak required |
|---|---|---|---|---|---|
| Email | NOT_RECORDED_IN_WAVE_0 | NOT_VERIFIED | NO | YES | YES |
| OTP | Environment/provider adapter only; name not frozen here | NOT_VERIFIED | NO | YES | YES |
| Payment | Existing provider boundary; concrete production provider not frozen in this wave | NOT_VERIFIED | NO | YES | YES |
| Accounting external delivery | Existing adapter boundary; provider not frozen | NOT_VERIFIED | NO | PARTIAL | YES |
| Object storage | Private object-storage adapter; concrete service not frozen | NOT_VERIFIED | NO | YES | YES |

No provider name or credential is invented by this document. A missing provider
selection or staging credential is an operator/BA/PO decision, not a reason to
pretend that local Docker evidence is sufficient.

## Monitoring and alert coverage

| Surface | Current repository control | Production wiring still required |
|---|---|---|
| API/auth | Health/readiness probes, request/error metrics and auth guards | Scrape, retention, SLO dashboard, auth failure and 5xx alerts |
| Worker/queue | Lease, reclaim, graceful shutdown and processor code | Per-processor latency, retry/dead-letter, stuck lease and queue-depth alerts |
| Database | Pool timeouts, migrations and backup scripts | Storage/connection/replication telemetry and restore alerts |
| Redis | Readiness checks and adapter usage | Memory, eviction, failover and reconnect telemetry |
| WebSocket | Adapter, reconnect and auth revalidation code | Cross-replica delivery, connection count and latency dashboards |
| Providers | Fail-closed adapters and provider boundaries | Delivery/error/timeout/unknown-state dashboards and alerts |
| Backup/rate limit | Backup scripts and sensitive DB-backed limits | Backup freshness/restore alerts and multi-replica limit consistency |

## Capacity, topology and recovery decisions

```text
TARGET_MISSING=YES
TARGET_CONCURRENCY=BA_PO_INFRA_DECISION_REQUIRED
TARGET_RPS_OR_DOMAIN_THROUGHPUT=BA_PO_INFRA_DECISION_REQUIRED
TARGET_QUEUE_DEPTH=BA_PO_INFRA_DECISION_REQUIRED
TARGET_WEBSOCKET_CONNECTIONS=BA_PO_INFRA_DECISION_REQUIRED
TARGET_LATENCY=SOURCE_SLO_ONLY; NO_SINGLE_SPRINT20_DOMAIN_TARGET
TARGET_ERROR_RATE=BA_PO_INFRA_DECISION_REQUIRED
RPO_TARGET=<=15 minutes
RTO_TARGET=<=60 minutes
STAGING_RESTORE_EVIDENCE_REQUIRED=YES
REDIS_HA_ARCHITECTURE_DEFINED=NO
QUEUE_FAILOVER_ARCHITECTURE_DEFINED=NO
REQUIRED_INFRA_CHANGE=YES
WEBSOCKET_MULTI_REPLICA_TOPOLOGY_DEFINED=NO
STICKY_SESSION_REQUIREMENT=UNDECIDED
SHARED_PUBSUB=REDIS_ADAPTER_PRESENT; PRODUCTION_TOPOLOGY_UNPROVEN
AUTH_REVALIDATION=IMPLEMENTED; STAGING_MULTI_REPLICA_EVIDENCE_MISSING
```

RPO/RTO values are preserved from the source SLO document. The local restore
drill threshold is not production evidence. Redis/queue topology and rate-limit
architecture require infrastructure decisions before a production gate can
advance.

## Security exception recheck

```text
SECURITY_EXCEPTION_ID=SEC-2026-IMAGE-SIZE-METRO
NO_PATCH_AVAILABLE=true (repository exception evidence)
EXPIRES_AT=2026-09-07
PRODUCTION_GO_LIVE_EXCEPTION=false
PATCH_RECHECK=NO_COMPATIBLE_PATCH_EVIDENCED_IN_REPOSITORY
SECURITY_EXCEPTION_STATUS=VALID_AT_WAVE0_DATE_2026-08-11
STOP_IF_COMPATIBLE_PATCH_APPEARS=YES
STOP_IF_EXCEPTION_EXPIRES_WITHOUT_REVIEW=YES
```

The exception is not modified or extended by Sprint 20 Wave 0. A compatible
patch or expiry requires a new BA/PO/security decision before continuing.

## Release gate decision

```text
CURRENT_STATE=NOT_READY
STAGING_ENTRY_REQUIRES=contracts frozen; release owner assigned; staging secrets and topology available
STAGING_VALIDATED_REQUIRES=all applicable R1-R15 evidence; measured restore/load/soak; security review
PRODUCTION_APPROVAL_REQUIRES=STAGING_VALIDATED; unresolved risks accepted by BA/PO/operator
GO_LIVE_AUTHORIZED_REQUIRES=explicit BA_PO_OPERATOR decision
AGENT_CAN_AUTHORIZE_GO_LIVE=NO
```

Wave 0 is documentation-only:

```text
RUNTIME_CODE_CHANGE=NO
TEST_CHANGE=NO
MIGRATION_CHANGE=NO
DEPENDENCY_CHANGE=NO
WORKFLOW_CHANGE=NO
PRODUCTION_DEPLOY=NO
```

## Wave 4 reconciliation addendum

The Wave 0 table above is retained as historical evidence. This addendum is
the current Wave 4 repository reconciliation and does not turn an
operator-owned staging requirement into a local PASS.

```text
WAVE_4_STATUS=IN_PROGRESS
WAVE_4_START_CHECKPOINT=102cd43b23983afeb54662adeb1c42f4e0756010
MIGRATION_HEAD=0036_accounting_reconciliation_closure
CAPACITY_TARGETS=FROZEN_BY_BA_PO
API_SUSTAINED_RPS=50
API_BURST_RPS=100_FOR_60_SECONDS
AUTHENTICATED_SESSIONS=250
PUBLIC_SESSIONS=100
WEBSOCKET_CONNECTIONS=500
API_P95_READ_MS=750
API_P95_MUTATION_MS=1500
API_P99_MS=3000
HTTP_5XX_RATE_MAX=0.1_PERCENT
TOTAL_ERROR_RATE_MAX=1_PERCENT
WEBSOCKET_DELIVERY_MIN=99.9_PERCENT
WEBSOCKET_BROADCAST_P95_MS=500
QUEUE_JOBS_MIN=1000
QUEUE_RECOVERY_MAX=10_MINUTES
RPO_MAX=15_MINUTES
RTO_MAX=60_MINUTES
R9_DECISION=REDIS_SHARED_RATE_LIMIT_STORE_FAIL_CLOSED
R12_DECISION=REDIS_PRIMARY_FAILOVER_TLS_AUTH_AT_LEAST_ONCE_IDEMPOTENT_CONSUMERS
R13_DECISION=REDIS_SOCKET_IO_PUBSUB_TRANSPORT_STICKINESS_REQUIRES_STAGING_TEST
CURRENT_RELEASE_STATE=NOT_READY
STAGING_VALIDATED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

Repository-side controls now include a production-required shared Redis rate
limit path, release-specific manifest/SBOM output and a Wave 4 contract lane.
R1-R15 still require their respective staging, operator or external-provider
evidence before the release state can advance.

Known Wave 0 blockers that require a later decision are counted once each in
the product/contract ledger: Customer Update permission/versioning; statement
exclusion concurrency/reversal/event semantics; reconciliation adjustment
idempotency/history/posting evidence; media retention/deletion and native
permissions; production artifact/topology; staging evidence; and the unchanged
security-exception review. This matrix does not authorize Waves 1–4.
