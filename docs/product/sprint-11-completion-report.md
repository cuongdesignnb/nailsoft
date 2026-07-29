# Sprint 11 Completion Report

STATUS=`READY_FOR_BA_PO_ACCEPTANCE`

SPRINT_11_START_CHECKPOINT=`8df5f1203cdeaf3e209c7339d98dbcd88fa03c5e`
SPRINT_11_IMPLEMENTATION_COMMIT=`47b20e328513c8f17668697719941c9e7c2035e8`
CI_REGRESSION_FIX_COMMIT=`af56e86f3247bb11ef6a3a8e8b27e9d1a1564d9d`
CI_TIMEOUT_HARDENING_COMMIT=`3558b4d36e094b5020a62245fc11d18090160593`
FINAL_EVIDENCE_COMMIT=`SELF_RESOLVED_IN_IMMUTABLE_HANDOFF`

CI_RUN_ID=`SELF_RESOLVED_IN_IMMUTABLE_HANDOFF`
CI_URL=`SELF_RESOLVED_IN_IMMUTABLE_HANDOFF`
CI_STATUS=`SUCCESS_REQUIRED_FOR_HANDOFF`

MIGRATION=`0021_notifications_marketing_reviews_service_recovery`
MIGRATION_FRESH=`PASS`
MIGRATION_ROLLBACK=`PASS_TO_0020`
MIGRATION_REUP=`PASS`
EXISTING_DATA_PRESERVED=`PASS_SPRINT_1_TO_10_REGRESSION`

Implemented: append-only versioned consent; default marketing not granted; immediate unsubscribe suppression; immutable email templates; safe rendering; durable deduplicated messages; timezone-aware reminders; bounded retry/dead-letter; scoped segments; dual-control campaigns; immutable audience and send-time eligibility; verified paid-visit reviews; one low-rating recovery case; SLA/tasks/contact; dual-control compensation through existing domain services.

UI: functional Admin communication/marketing/review/recovery screens; Customer preferences/consents/unsubscribe/review; Owner approvals/alerts; Staff assigned recovery/contact. Loading, empty, error/retry, permission, success and offline command states are included. No global redesign was started.

Scope: email only. Sprint 12, SMS, advanced automation, AI, full CRM/CDP and provider-specific production delivery are not implemented.

## Local QA evidence

- Lint: 13/13 workspaces passed.
- Typecheck: 13/13 workspaces passed in TypeScript strict mode.
- Unit/mobile/worker smoke: 38 files, 132 tests passed.
- PostgreSQL integration: 58 files, 162 test cases passed with a deterministic database reset per file.
- Contract/OpenAPI: 2 files, 3 tests passed.
- Authenticated Sprint 11 E2E: 3/3 passed (campaign and compensation dual control, Staff assigned-task scope, branch scope and Platform Super Admin denial).
- Build: 13/13 workspaces passed, including Admin Web prerender and Owner/Staff Mobile web export.
- Load smoke: four Sprint 11 read scenarios, concurrency 5, 0% error; p95 8.59-10.07 ms on local deterministic fixtures. This is not a production claim.
- Docker: used only for QA; verified `DOCKER_COMPOSE_RUNNING_SERVICES=0` after handoff shutdown.

## Architecture decisions

ADRs 0061-0067 cover durable email delivery, consent/suppression evidence, immutable template versions, audience/frequency controls, paid-visit review verification, recovery/compensation boundaries and the provider abstraction. PostgreSQL remains the source of truth; Redis is never the sole authoritative store.

## Remaining risks / technical debt

- A production email provider and webhook credentials remain intentionally unconfigured; production mode fails closed.
- Production-like 10k-recipient campaign benchmarking and external-provider latency evidence require staging.
- SMS, advanced automation, AI and Sprint 12 are explicitly out of scope.
- The repository-wide Next.js ESLint-plugin migration warning predates Sprint 11 and remains non-blocking.

The final evidence commit and its exact successful GitHub Actions run are recorded in the immutable BA/PO handoff because a commit cannot contain its own future SHA or workflow run ID. Sprint 11 remains subject to formal BA/Product Owner acceptance and Sprint 12 is not authorized by this report.

## Correctness closure

CLOSURE_START_CHECKPOINT=`d939dac44042fb7adbf0e6fdbb6436f049a9ddb4`
CLOSURE_IMPLEMENTATION_COMMIT=`SELF_RESOLVED_IN_IMMUTABLE_HANDOFF`
MIGRATION_0022=`0022_sprint11_engagement_correctness_hardening`
MIGRATION_FRESH=`PASS`
MIGRATION_ROLLBACK=`PASS_TO_0021`
MIGRATION_REUP=`PASS`

- Campaign pause prevents new claims; cancel terminalizes unsent message/audience evidence; resume continues only remaining work; the replay-safe finalizer persists generation and terminal counters.
- The frequency cap is an atomic PostgreSQL reservation gate with expiring leases. Consent, preference and suppression versions are revalidated immediately before provider invocation.
- Public marketing unsubscribe derives a deterministic key from the token hash and does not require an `Idempotency-Key` header. Review withdrawal suppresses pending/claimed-before-provider review delivery without changing transactional communication.
- Tenant-wide marketing objects and tenant-wide template/rule management are Owner-only. Branch actors cannot cross their scope through object IDs or `branchVisited`. Unsupported segment filters fail explicitly and the audience limit never truncates silently.
- Review requests use the versioned 24-hour delay policy with a migration activation boundary that prevents historical backlog. Visit, settlement, refund and review consent are revalidated before send.
- Customer-credit and loyalty compensation synchronize from the independently approved owning-domain adjustment to `POSTED` (or failure); durable voucher issuance posts immediately. Recovery resolution remains blocked until compensation is suitably terminal.

Closure QA adds 4 integration suites / 15 tests and 1 authenticated/public Playwright suite covering campaign lifecycle, 20-way frequency contention, consent/provider race, public unsubscribe, branch/segment semantics, review delay/withdrawal, owning-domain rejection and all three compensation paths. The exact final CI run remains the authoritative full-regression evidence.
