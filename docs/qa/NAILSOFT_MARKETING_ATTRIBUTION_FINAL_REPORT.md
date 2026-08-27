# NailSoft Marketing Attribution — Final QA Report

## Execution status

GOAL=NAILSOFT_MARKETING_ATTRIBUTION
START_CHECKPOINT_SHA=9e477bafa2f00e8dc6e73fb8affe4a6b48754937
FINAL_SOURCE_SHA=d41db27e37a2bdecb6b56fafced7ee22683b9b3a
FINAL_CI_RUN_ID=32753821931
FINAL_CI_CONCLUSION=FAILURE
STATUS=MARKETING_ATTRIBUTION_FINALIZATION_BLOCKED
PRODUCTION_DEPLOYED=NO
PRODUCTION_DATA_MUTATED=NO

The task-owned source and QA commits are pushed at `FINAL_SOURCE_SHA`; unrelated user changes remain uncommitted and preserved. The quality job in GitHub Actions passed, but the overall run is red because the separate pre-existing Wave0 visual job fails on the AdminShell date in its gallery snapshot. The repository-wide regression and isolated E2E gates are green in the non-production QA environment described below.

This report closes the former unsupported-domain blocker with implementation evidence. The historical Business Journey QA record remains unchanged and continues to record the state before this domain existed.

## Original blocker and scope

Before this work, Marketing Campaigns had no authoritative Campaign-to-Booking or Booking-to-paid-revenue relation. The Marketing API correctly exposed those capabilities as unsupported. This implementation adds only explicit attribution and financial evidence. Open tracking, click tracking, probabilistic attribution, and inferred conversion remain unsupported.

## Attribution model

```text
MODEL=EXPLICIT_LAST_TOUCH
DEFAULT_ATTRIBUTION_WINDOW_DAYS=30
```

The server issues an opaque context for a current Campaign recipient and stores only a SHA-256 reference hash. The Booking request may carry the opaque reference through the existing public Booking route. The API validates tenant, recipient, Customer, Campaign generation, Campaign branch, Booking branch, lifecycle, and expiry before writing one immutable Booking attribution. Missing or invalid context does not invalidate an otherwise valid Booking; it produces no attribution.

## Data model and integrity

Migrations `0041_marketing_attribution` and `0042_marketing_attribution_integrity_closure` add:

- context lifecycle/evidence;
- immutable Booking attribution;
- immutable paid financial evidence;
- immutable refund/Credit Note adjustment;
- composite tenant foreign keys, uniqueness, indexes, status/currency/payment guards, branch guards, and append-only triggers;
- separate `marketing.attribution.read` and `marketing.attribution.issue` permissions.

No mutable Campaign totals are used as the source of truth.

## Booking, payment, Invoice, and refund integration

Booking creation attaches context inside the existing transaction and idempotency flow. POS payment/finalization projects evidence only after the existing Order/Invoice state is authoritative. Gross uses existing invoice net-line evidence and excludes Gift Card lines. Values remain grouped by currency.

Refund completion projects one adjustment from completed invoice-line refund items and an issued Credit Note. The Credit Note is evidence for the same Refund and is not a second deduction. Replayed payment, invoice, and refund paths return existing evidence and do not duplicate rows or totals.

## API and UI

- Context issue: `POST /v1/marketing-campaigns/:campaignId/audience/:recipientId/attribution-context`.
- Campaign attribution: `GET /v1/marketing-campaigns/:campaignId/attribution`.
- Booking attribution: `GET /v1/appointments/:appointmentId/marketing-attribution`.
- Marketing overview and Campaign overview include attribution only for callers with the read permission.
- `/admin/marketing/campaigns` renders server-backed Booking, completed visits, paid orders, gross/refund/net currency groups, and a safe evidence table when capabilities and evidence are present.
- Open and Click are not rendered because the current EmailProvider has no persisted event source.

## Security and privacy

Tenant and branch scope is enforced in service queries and database triggers. Read permissions are separate from context issue permission. The attribution layer never exposes contact hashes, raw provider data, credentials, payment secrets, or context hashes. Evidence uses actual IDs and source references; no Customer names, Campaign codes, conversion values, or revenue are fabricated.

## Control evidence

The detailed matrix is [MARKETING_ATTRIBUTION_EVIDENCE_MATRIX.md](../../artifacts/qa/marketing-attribution/MARKETING_ATTRIBUTION_EVIDENCE_MATRIX.md). The transactional control proves:

- explicit issue and idempotent replay;
- no-context independent Booking control;
- Customer mismatch, Branch mismatch, and expired context rejection;
- single-use attach;
- captured payment + PAID Order + ISSUED Invoice evidence;
- `110000 VND` gross, `50000 VND` refund, `60000 VND` net;
- refund and payment replay idempotency;
- append-only evidence;
- hash-at-rest reference protection.

## Regression results captured so far

| Gate | Result |
|---|---|
| API typecheck | PASS |
| API lint | PASS |
| Booking web typecheck | PASS |
| Admin typecheck | PASS |
| Admin lint/build | PASS |
| Unit | PASS — 66 files / 218 tests |
| Contract | PASS — 27 files / 61 tests |
| Attribution integration | PASS — 1 test |
| Clean DB reset/migration | PASS — head `0042_marketing_attribution_integrity_closure` |
| DB integrity | PASS |
| Security scan | PASS |
| Worker/domain package builds | PASS |
| Full integration | PASS — `pnpm test:integration` exit 0; attribution and regression suites green |
| Isolated E2E wrapper | PASS — `pnpm test:e2e` exit 0; `E2E_ISOLATED_PASS=115/115` with task Redis available |
| Targeted Marketing/Engagement Playwright | PASS — 4 tests through the native Playwright web-server harness |
| Targeted Wave 3 visual/accessibility Playwright | PASS — 2 tests through the native Playwright web-server harness |
| Final clean reset + attribution control | PASS — 1 test |
| Security evidence / DB integrity / diff check | PASS |

## Final CI audit

GitHub Actions run `32753821931` checked out `d41db27e37a2bdecb6b56fafced7ee22683b9b3a`. The `quality` job completed successfully. The only failing job was `sprint19-wave0-visual`, whose gallery screenshot expected `22/08/2026` while the committed AdminShell rendered the runner date `24/08/2026`. The clock-freeze and snapshot changes that correct this are pre-existing unrelated worktree changes and were intentionally not committed.

## Remaining non-goals

- Provider Open/Click telemetry.
- Revenue/Booking attribution inferred from Campaign membership or timing.
- Multi-touch attribution.
- FX conversion.
- Marketing send-engine changes.
- Historical backfill without deterministic explicit evidence.

No production deployment is part of this task. Task-created Redis was used only for non-production QA and removed after the final gates; unrelated containers were preserved.

## Closure decision

The Marketing Attribution domain and its task-owned gates are green: explicit context, booking attachment, paid financial evidence, refund adjustment, currency grouping, permission gating, tenant/branch checks, idempotency, concurrency, append-only integrity, full integration, isolated E2E, security evidence, and targeted visual/accessibility checks all pass. Local isolated E2E is `115/115`. The required final CI conclusion remains blocked by the unrelated Wave0 visual mismatch documented above; `STATUS=MARKETING_ATTRIBUTION_FINALIZATION_BLOCKED` is the truthful current state.
