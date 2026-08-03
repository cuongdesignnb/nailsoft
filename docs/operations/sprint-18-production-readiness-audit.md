# Sprint 18 Production Readiness Audit

## Scope and checkpoint

Audit started from `9faadc8c22b6eed536de88afa06aa7d8df7dbf7c` on `main`. Sprint 19/20 and UX/UI redesign are out of scope. This document is an engineering readiness record, not a production go-live approval.

## Baseline findings

| Area | Finding | Control delivered | Residual risk |
|---|---|---|---|
| Runtime configuration | Environment was only partially validated | `@nailsoft/config` schema, production placeholder/HTTPS/provider checks | Secrets still require deployment-platform injection |
| HTTP security | Canonical probes and response hardening were missing | health probes, request IDs, CSP, HSTS, rate-limit headers | In-memory rate limiting is per process; use a shared gateway for multi-replica enforcement |
| Database | Pool had no explicit timeout policy | connection, statement, lock and idle transaction timeouts | Values require load validation against production workload |
| Worker lifecycle | Context was never closed on signals | SIGTERM/SIGINT shutdown and startup failure handling | Individual processors must expose their own lease recovery metrics |
| Backup/DR | No repeatable repository runbook/scripts | checksum-protected `backup`, `restore`, `integrity-check` scripts and drills | Restore target and credentials remain environment-owned |
| Supply chain | No release evidence generator | release manifest, SBOM and static secret scan | Dependency advisory review remains a release gate |

## Closure-gap evidence (local QA)

| Gap | Evidence | Result |
|---|---|---|
| GAP-01 backup/restore | `scripts/verify-backup-restore.mjs` with PostgreSQL `pg_dump`/`pg_restore`, isolated restore database, checksum, schema head, critical-table/orphan checks and authenticated post-restore smoke | Three repeated drills passed (`C:\\tmp\\s18-drill-1.log` through `s18-drill-3.log`); RTO measured 30s against 300s target; temporary backup artifacts are deleted by the script |
| GAP-02 security | Session refresh-family reuse revocation, privileged MFA guard, tenant/branch/staff scope checks, support-access gate, CORS denial, rate abuse, export authorization and recursive log redaction integration coverage | Targeted integration/security tests pass locally; production-style E2E is rerun by the closure CI lane |
| GAP-03 resilience | Graceful lifecycle state coverage, expired outbox lease reclaim, Redis/DB readiness observability and alert open/resolve deduplication | Targeted integration tests pass locally; runtime recovery evidence is retained in CI logs |
| GAP-04 supply chain | Secret scan, lint/typecheck, dependency audit, CycloneDX SBOM and optional container scan gate | `pnpm security:evidence` passes with `UNTRIAGED_CRITICAL_FINDINGS=0`, `UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS=0`; container scan is `NOT_APPLICABLE_NO_PRODUCTION_IMAGE` because this repository has no production image configured |

The dependency gate uses patched resolutions for Next.js, sharp, fast-uri, find-my-way, @fastify/static, PostCSS and brace-expansion. Two moderate advisories remain and are tracked for the next dependency maintenance window; no high/critical finding is allowlisted.

## Stop/go gates

The release remains **not ready for production go-live** until a staging operator records: successful restore drill, RPO/RTO evidence, alert delivery test, vulnerability triage, secret rotation rehearsal and authenticated smoke/load results.

## Migration decision

No Sprint 18 schema change is required. Existing migrations `0001`–`0034` remain untouched; runtime controls use existing tables and artifact metadata.
