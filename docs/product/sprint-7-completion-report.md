# Sprint 7 Completion Report

## Status

`IN PROGRESS — READY FOR CLOSURE CI AND BA/PRODUCT OWNER ACCEPTANCE`

Sprint 7 foundation and financial-correctness closure are implemented and have passed local QA. Sprint 8 is not authorized. Sprint 7 must not be marked `DONE` until the exact final evidence commit has a successful GitHub Actions run and BA/Product Owner accepts it.

## Git

- Branch: `main`
- Start checkpoint: `c1fd26a3ca41aacd5c90267aeb3bfa2fc48dcc41`
- Feature commit: pending local commit
- Closure commit: pending local commit
- Final evidence commit: the commit containing the final CI evidence in this report
- HEAD/origin: aligned at the start checkpoint; final values are recorded after push
- Working tree: pending final evidence commit

## GitHub Actions

- Accepted starting run: `30263379103` — `SUCCESS`
- Final closure run: pending exact final evidence commit
- Final status: pending

## Migration

- Added `0015_sprint7_financial_correctness_hardening`.
- Migrations `0001–0014` were not modified.
- Fresh migrate and deterministic seed: passed.
- Rollback `0015 → 0014`: passed.
- Re-migrate `0014 → 0015` and seed: passed.
- Existing issued invoices, captured payments, refunds, credit notes, commission entries and locked periods are preserved.

## Financial correctness closure

- Cash refunds retain immutable original register/session attribution and may execute only on a new open session belonging to the same register.
- Cross-register execution returns `CASH_REFUND_REGISTER_MISMATCH` without movement, credit note or reversal side effects.
- Gross/net tip and tip reversals include only the authoritative `ACTIVE` tip version.
- Manual commission adjustments no longer require a synthetic invoice; approval atomically creates exactly one linked entry before becoming `APPROVED`.
- Commission statements are scoped by tenant, period and staff, and their entry sum is verified against the locked snapshot.
- Period lock enforces currency and range scope, blocks unresolved adjustments/reversals, and uses `BigInt` with canonical decimal strings for totals and hashes.
- Refund-window policy is enforced and revalidated using branch-local calendar time; out-of-window actions require permission, explicit reason and audit evidence.
- Refund and credit-note fiscal years use the branch timezone.
- Provider refund references are tenant-scoped, and the refund provider must match the original payment provider.
- Active commission rules with equal normalized scope, priority and overlapping effective range are rejected, including concurrent creation.
- Repeated partial refunds cannot reverse more commission than the original earning; tax-only refunds do not reverse a tax-exclusive base.

## API and contracts

- Refund-plan and refund-create requests support `overrideReason` for authorized out-of-window processing.
- Refund details expose original and execution cash attribution separately.
- Webhook tenant resolution uses the signed payload tenant and tenant-scoped provider reference.
- OpenAPI, Sprint 7 API draft, ERD and test matrix document the closure invariants and error mapping.

## Tests and local QA

- Lint: 13/13 packages passed.
- Typecheck: 13/13 packages passed.
- Unit: 27 files / 81 tests passed.
- Contract: 1/1 passed.
- Full integration regression: 30/30 files passed with deterministic reset before each file.
- Required closure integration: 6/6 files passed.
- Existing Sprint 7 refund/commission integration: 4/4 tests passed.
- Required authenticated deep E2E: 5/5 flows passed.
- Build: 13/13 packages passed.
- Migration fresh/down/up: passed.
- Docker was enabled only for QA, then stopped.
- `DOCKER_SERVICES_RUNNING=0`.

Required closure integration files:

- `sprint7-cash-refund-register.test.ts`
- `sprint7-tip-version-integrity.test.ts`
- `sprint7-adjustment-posting.test.ts`
- `sprint7-period-statement-lock.test.ts`
- `sprint7-refund-window-numbering.test.ts`
- `sprint7-rule-overlap.test.ts`

Required authenticated deep E2E files:

- `sprint7-cash-refund-attribution-deep.spec.ts`
- `sprint7-tip-refund-deep.spec.ts`
- `sprint7-adjustment-deep.spec.ts`
- `sprint7-period-statement-deep.spec.ts`
- `sprint7-refund-window-deep.spec.ts`

## Performance

- The accepted Sprint 7 deterministic CI load smoke remains green with zero errors/timeouts.
- p95 evidence: refund list `6.41 ms`, net-sales report `6.54 ms`, commission entries `5.89 ms`, credit-note list `6.15 ms`.
- Closure hardening adds correctness constraints and indexes but makes no new production-scale performance claim.
- Production-like capacity and contention benchmarking remains technical debt and a release gate.

## Architecture decisions

- PostgreSQL constraints and transactions remain the source of truth for financial invariants.
- Original payment attribution is immutable; execution attribution is stored separately.
- Financial totals and snapshot hashes use exact integer/string representations, never unsafe JavaScript `Number` conversion.
- Branch-local time is the authoritative basis for refund deadlines and fiscal-year numbering.
- Ambiguous legacy commission-rule overlap is reconciled explicitly during migration instead of silently selecting a winner.

## Remaining risks and technical debt

- Production payment/refund provider integration remains deferred.
- Country-specific e-invoice filing remains deferred.
- Production-like financial capacity/contention benchmark remains outstanding.
- BA/Product Owner acceptance and final exact-commit CI are still required before `DONE`.

## Scope confirmation

Sprint 8 work was not started. Inventory, voucher/loyalty/membership/package, gift card, payroll payout, marketing, AI, production payment/refund provider and country-specific e-invoice filing were not implemented.
