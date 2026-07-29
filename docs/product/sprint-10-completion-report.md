# Sprint 10 Closure Report

Status: `DONE` — formally accepted before Sprint 11 authorization.

## Git

- Branch: `main`.
- Start checkpoint and foundation commit: `8966925bfbf2745e28c18ef9c3690e42a7feda16`.
- Foundation CI: run `30369302098`, `SUCCESS`.
- Closure implementation commit: `28e4a51343a8617472fbc7be1b96c07a9a8168cc`.
- Loyalty contract hotfix commit: `8b316fb95ed07d0b2ddf9fd472340d10f570279e`.
- Final evidence commit: `8df5f1203cdeaf3e209c7339d98dbcd88fa03c5e`.
- Final CI: run `30385648010`, `SUCCESS`.
- Final handoff verified `HEAD = origin/main`, a clean working tree and `DOCKER_SERVICES_RUNNING=0`.

## Migration

- Added `0020_sprint10_stored_value_correctness_hardening` without modifying migrations `0001–0019`.
- Added immutable payment-to-card funding allocations, immutable application-to-invoice-line settlement allocations, refund line plans and cumulative restore guards.
- Added card/reservation/ledger/adjustment branch attribution, replacement lineage, legal-policy fields, daily velocity counters and high-value approvals.
- Deterministic backfill is limited to exact evidence. Ambiguous historical funding remains fail-closed as a reconciliation exception; no funding is fabricated.
- Fresh migrate and deterministic seed replay: passed.
- Rollback from `0020` to `0019`, re-migrate to `0020`, and seed replay: passed.
- Data preservation evidence across rollback/re-migrate: appointments `40`, Gift Cards `3`, payments `3` before and after.

## Redemption safety

- Redemption plans expose eligible, external-paid, existing stored-value, remaining eligible, current due, tip due, requested, accepted and unused minor-unit amounts.
- Accepted value is capped by available balance, remaining eligible line due and current order due after external payments.
- External tender funds Gift Card and policy-ineligible lines before stored-value-eligible lines. Tip uses only explicit tip payment allocation.
- Exact line allocations and eligibility snapshots are persisted and revalidated before final payment commit.
- Gift Card funding lines and tips cannot be covered by Gift Card or Customer Credit.

## Funding

- Activation deterministically allocates all captured `ORDER_TOTAL` evidence to Gift Card lines and requires exact face value before posting liability.
- Split funding uses multiple immutable rows; `source_payment_id` is retained only for single-payment funding.
- Reload requires a dedicated single-line funding order matching branch, currency, card and amount.
- PostgreSQL caps allocation by captured/order-funded payment and funding-line amounts. Concurrent reuse maps to a domain conflict.

## Refund

- Invoice issuance persists exact stored-value allocation per invoice line.
- Refund planning intersects only the selected invoice line's original stored-value allocation.
- Repeated partial refunds use cumulative desired-minus-completed/pending proportional restoration.
- PostgreSQL enforces cumulative restoration no greater than the original line allocation.
- Gift Card purchase refunds resolve all exact funding payments, including split-payment activation.

## Ownership and authorization

- Card snapshots include assignment, customer, bearer capability, purchase/redemption branches and eligible-line policy.
- Assigned cards require the order customer to match and return `STORED_VALUE_CUSTOMER_MISMATCH` without customer disclosure.
- Owner retains tenant scope. Branch Manager card lifecycle, Customer Credit, adjustment and reporting access is branch-filtered.
- Product purchase branch, redemption branch and service/product eligibility are server-enforced and snapshotted.

## Lifecycle and legal policy

- Generic cancellation cannot destroy monetary value; any lifetime redemption requires manual review and monetary cancellation requires refund evidence.
- Replacement atomically transfers value and preserves expiry, legal, assignment, branch and eligibility policy plus lineage.
- Issuance accepts only effective approved legal policy. Unapproved references fail closed; no policy defaults to `NO_EXPIRATION`.
- Activation applies fixed-date, activation-day or last-activity expiry plus grace. No automatic breakage revenue is recorded.

## Fraud controls

- Issue, redeem/reserve and reload enforce persisted branch-local daily counters across actor, device, customer and account dimensions.
- High-value operations require Owner/Manager reason and immutable approval evidence.
- Reserve uses persisted lookup and recent-reservation limits; card number and PIN remain redacted.

## Tests and CI

- Added ten required PostgreSQL/API integration files and eight authenticated closure E2E files.
- Added unit coverage for current-due caps and cumulative proportional restoration.
- Added CI lanes for correctness, funding/refund, authorization/fraud and closure E2E while retaining Sprint 1–10 regression.
- Unit: `35` files / `122` tests passed, including `8/8` targeted Loyalty Adjustment contract tests.
- Contract: `2` files / `3` tests passed.
- Sprint 10 mobile/contract smoke: `2` files / `4` tests passed.
- PostgreSQL integration regression: all `55` integration files passed with deterministic reset/seed before every file.
- Closure E2E: all `8` required authenticated scenarios passed with reset/seed before every spec.
- Sprint 10 foundation E2E regression: `3/3` passed.
- Lint: `13/13` packages passed.
- Typecheck: `13/13` packages passed.
- Build: `13/13` packages passed.
- `git diff --check`: passed; only the repository's Windows line-ending notices remain.
- Exact-hotfix-commit GitHub Actions: run `30383280979`, `SUCCESS`, commit `8b316fb95ed07d0b2ddf9fd472340d10f570279e`.

## Scope confirmation

- Sprint 11 was not started.
- Marketing automation, AI and General Ledger were not implemented.
- PostgreSQL remains authoritative.
- Docker was used only for QA, then stopped with `docker compose down`; verified `DOCKER_SERVICES_RUNNING=0` without deleting volumes.

## Sprint 8 Contract Regression Hotfix

- Sprint 10 closure commit:
  `28e4a51343a8617472fbc7be1b96c07a9a8168cc`
- Failed CI:
  `30379014826`
- Failed step:
  `Sprint 8 authenticated wallet and dual-control E2E`
- Root cause:
  `loyaltyAdjustmentSchema` accidentally required `branchId`.
- Product impact:
  Validation-only regression in Sprint 8 Loyalty Adjustment contract.
- Hotfix:
  Removed `branchId` from `loyaltyAdjustmentSchema` while preserving all required Sprint 8 fields and strict unknown-field rejection.
- Stored-value branch attribution:
  Preserved for Customer Credit, Stored Value and Gift Card operations.
- Hotfix commit:
  `8b316fb95ed07d0b2ddf9fd472340d10f570279e`
- Final evidence commit:
  This report commit; its immutable SHA is recorded in the final handoff.
- Final CI:
  `30383280979` — `SUCCESS` for the exact hotfix commit.
