# Sprint 20 Wave 4 — Release Readiness Report

```text
SPRINT=20
WAVE=4
TITLE=PRODUCTION_HARDENING_AND_RELEASE_READINESS
REPORT_STATUS=DRAFT_REPO_HARDENING_IN_PROGRESS
START_CHECKPOINT=102cd43b23983afeb54662adeb1c42f4e0756010
PRODUCTION_GO_LIVE_AUTHORIZED=NO
WAVE_3_STATUS=DEFERRED
```

This report is an evidence ledger, not a production approval. Repository and
CI evidence is kept separate from staging, operator and external-provider
evidence. Local Docker success is never substituted for staging evidence.

## Release state model

```text
NOT_READY
→ READY_FOR_STAGING
→ STAGING_VALIDATED
→ READY_FOR_PRODUCTION_APPROVAL
→ GO_LIVE_AUTHORIZED
```

The agent and CI may collect evidence only. `GO_LIVE_AUTHORIZED` requires an
explicit BA/PO and release-operator decision.

## Frozen capacity and recovery targets

```text
STEADY_STATE_DURATION=15 minutes
API_SUSTAINED_RPS=50
API_BURST_RPS=100 for 60 seconds
AUTHENTICATED_SESSIONS=250
PUBLIC_SESSIONS=100
WEBSOCKET_CONNECTIONS=500
API_P95_READ_MS=750
API_P95_MUTATION_MS=1500
API_P99_MS=3000
HTTP_5XX_RATE_MAX=0.1%
TOTAL_ERROR_RATE_MAX=1%
WEBSOCKET_DELIVERY_MIN=99.9%
WEBSOCKET_BROADCAST_P95_MS=500
QUEUE_JOBS_MIN=1000
QUEUE_RECOVERY_MAX=10 minutes
RPO_MAX=15 minutes
RTO_MAX=60 minutes
```

These are acceptance targets. They are not claims that staging or production
has met them.

## R1–R15 reconciliation

| ID | Repository control/evidence | Remaining evidence | Owner | Repo complete | Staging/operator required | Status | Stop/go effect |
|---|---|---|---|---|---|---|---|---|
| R1 | Environment catalog, production placeholder rejection, secret redaction | Secret-manager injection, rotation, old-secret rejection and access review | Release/security operator | PARTIAL | YES | EXTERNAL_BLOCKED | No rotation proof: stop |
| R2 | Release manifest, SBOM and immutable commit metadata scripts | Approved image/digest, signing, production/mobile artifacts | DevOps/release | YES | YES | EXTERNAL_BLOCKED | No approved artifact: stop |
| R3 | Migration runner, rollback tooling and discovered head `0036_accounting_reconciliation_closure` | Staging forward/restart/head/rollback-or-roll-forward log | DBA/release operator | YES | YES | EXTERNAL_BLOCKED | No rehearsal: stop |
| R4 | Backup, restore, integrity and repeatable local drill scripts | Measured staging RPO/RTO, restore integrity and smoke | DBA/operations | PARTIAL | YES | EXTERNAL_BLOCKED | No measured recovery: stop |
| R5 | DR runbook and rebuild-from-Postgres/outbox guidance | Isolated target, credentials, promotion authority and drill | Infrastructure/incident commander | PARTIAL | YES | EXTERNAL_BLOCKED | Undefined target: stop |
| R6 | `/v1/metrics`, request/error counters, health/version probes | Production scrape, retention and service dashboards | SRE/operations | PARTIAL | YES | EXTERNAL_BLOCKED | Missing critical telemetry: stop |
| R7 | Alert catalog and deduplication primitive/tests | Delivery, escalation, acknowledgement and on-call receipt | SRE/on-call operator | PARTIAL | YES | EXTERNAL_BLOCKED | Undeliverable critical alert: stop |
| R8 | Recursive redaction and security scan | SIEM ingestion, retention, access and incident export | Security/SRE | PARTIAL | YES | EXTERNAL_BLOCKED | Unprotected logs: stop |
| R9 | Redis-backed shared rate-limit path with fail-closed production config | Two-replica consistency and Redis outage drill | Infrastructure/security | YES | YES | EXTERNAL_BLOCKED | Per-process fallback in production: prohibited |
| R10 | Load-smoke harness and frozen target matrix | Production-like 15-minute load report and bottleneck actions | Performance/BA/infra | YES | YES | EXTERNAL_BLOCKED | Threshold failure: stop |
| R11 | Durable outbox, lease/reclaim, graceful shutdown and retry processors | Long-running worker/provider soak with lease and recovery traces | Worker/provider owner | PARTIAL | YES | EXTERNAL_BLOCKED | Unproven recovery: stop |
| R12 | Redis adapter and explicit topology decision recorded | Primary/failover, TLS/auth, queue replay and failover drill | Infrastructure | PARTIAL | YES | EXTERNAL_BLOCKED | HA not evidenced: stop |
| R13 | Redis Socket.IO adapter, reconnect and auth revalidation | Multi-replica broadcast, transport/sticky-session and latency evidence | Infrastructure/realtime | PARTIAL | YES | EXTERNAL_BLOCKED | Cross-replica gap: stop |
| R14 | Provider boundaries fail closed; no real credentials in repo | Sandbox/staging credentials and timeout/unknown-state soak | Integration owners | PARTIAL | YES | EXTERNAL_BLOCKED | Untested provider: stop |
| R15 | Health/readiness/version probes, release/rollback runbooks and mobile build scripts | Staging deploy/rollback smoke and signed mobile artifacts | Release/mobile operator | PARTIAL | YES | EXTERNAL_BLOCKED | No rollback/mobile evidence: stop |

```text
RELEASE_WORKSTREAM_COUNT=15
REPO_COMPLETABLE_WORKSTREAM_COUNT=7
STAGING_REQUIRED_WORKSTREAM_COUNT=15
EXTERNAL_PROVIDER_REQUIRED_WORKSTREAM_COUNT=4
OPERATOR_REQUIRED_WORKSTREAM_COUNT=15
```

## Security exception recheck

```text
SECURITY_EXCEPTION_ID=SEC-2026-IMAGE-SIZE-METRO
PATCH_RECHECK=NO_COMPATIBLE_PATCH_EVIDENCED_IN_REPOSITORY
EXPIRES_AT=2026-09-07
PRODUCTION_GO_LIVE_EXCEPTION=NO
SECURITY_EXCEPTION_CHANGED_BY_WAVE4=NO
STOP_IF_PATCH_AVAILABLE_OR_EXCEPTION_EXPIRES=YES
```

## Wave 4 evidence policy

```text
REPO_LOCAL_DOCKER_IS_STAGING=NO
REAL_SECRET_COMMIT=NO
REAL_CUSTOMER_DATA_IN_PROVIDER_TEST=NO
PRODUCTION_DEPLOYMENT=NO
PRODUCTION_GO_LIVE=NO
```

The report remains draft until the Wave 4 source SHA and exact full CI run are
known. External release blockers remain blockers even when all repository and
CI checks pass.
