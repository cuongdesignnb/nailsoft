# NailSoft Marketing Attribution — Run-to-Goal Progress

GOAL=NAILSOFT_MARKETING_ATTRIBUTION
START_CHECKPOINT_SHA=9e477bafa2f00e8dc6e73fb8affe4a6b48754937
ENVIRONMENT=NON_PRODUCTION_ONLY
PRODUCTION_DEPLOYED=NO
PRODUCTION_DATA_MUTATED=NO

## Original blocker

The prior Business Journey QA recorded `GOLDEN_FLOW_G3=BLOCKED_UNSUPPORTED_DOMAIN`. The Marketing read models intentionally returned `bookingAttribution=false` and `revenueAttribution=false`; no persisted Campaign-to-Booking or Booking-to-paid-revenue evidence existed. Open/click tracking was also unsupported and remains out of scope.

## Implementation phases

| Phase | Result | Evidence |
|---|---|---|
| Source/schema/booking/marketing/finance/refund/security audit | PASS | Current HEAD audit and domain source review |
| Attribution tables, composite tenant keys, append-only triggers | PASS | `infra/migrations/0041_marketing_attribution.up.sql`, `0042_marketing_attribution_integrity_closure.up.sql` |
| Explicit context issue/expiry/replay controls | PASS | `MarketingAttributionService.issueContext()` and integration control |
| Booking attach and customer/branch/generation validation | PASS | `BookingService.createAppointment()` + integration control |
| Paid POS/Invoice financial evidence | PASS | `PosService.pay/finalize()` projection + database status/currency/payment guards |
| Refund/Credit Note adjustment | PASS | `RefundService.finalizeIfComplete()` projection + one-adjustment constraint |
| Marketing read capabilities and evidence UI | PASS | `MarketingService`, `/admin/marketing/campaigns`, campaign inspector |
| Full regression and isolated E2E closure | PASS | Full integration exit 0; isolated E2E `115/115` with task Redis available |

## Current model

- Attribution model: `EXPLICIT_LAST_TOUCH`.
- Context window: 30 days from server issue time.
- Booking relation: one immutable attribution per tenant/Booking.
- Revenue relation: one immutable evidence record per tenant/Order and Invoice.
- Refund relation: one immutable adjustment per tenant/Refund.
- Currency: grouped by persisted currency; no FX conversion.
- Consent: attribution preserves historical valid Booking evidence; it does not bypass the Marketing send preflight.
- Unsupported: open tracking, click tracking, probabilistic/multi-touch attribution, historical timing inference.

## Latest verified local gates

- API typecheck: PASS.
- API lint: PASS.
- Admin typecheck: PASS.
- Booking web typecheck: PASS.
- Admin lint: PASS.
- Admin build: PASS.
- Unit: PASS — 66 files / 218 tests.
- Contract: PASS — 27 files / 61 tests.
- Attribution integration: PASS — 1 test.
- Database reset/migration from clean schema: PASS — migration head `0042_marketing_attribution_integrity_closure`.
- Database integrity: PASS.
- Security scan: PASS.
- Worker/domain package builds: PASS.
- `git diff --check`: PASS (CRLF normalization warnings only).
- Latest UI continuation regression: admin lint PASS; admin typecheck PASS; isolated admin production build PASS; unit PASS — 67 files / 219 tests; contract PASS — 27 files / 61 tests.
- Latest workforce evidence: `/admin/staff/new`, `/admin/staff/:id/pay-profile`, `/admin/timesheets/:id`, `/admin/payouts` and `/admin/payouts/:id` each have desktop 1440, desktop 1280, tablet 768 and mobile 390 captures with Axe zero/no overflow. Their read paths are documented; authorized command outcomes remain explicitly `UI_PARTIAL`.
- Local services after the isolated build: admin `200`, booking `200`, API readiness `/v1/health/ready` `200`.
- Final `pnpm db:reset`: PASS.
- Final attribution control after reset: PASS — 1 test.
- Final `pnpm db:integrity`: PASS.
- Full `pnpm test:integration`: PASS — exit 0; attribution and regression suites green.
- `pnpm test:e2e`: PASS — `E2E_ISOLATED_PASS=115/115` with task Redis available.
- Native targeted Marketing/Engagement Playwright: PASS — 4 tests.
- Native targeted Wave 3 visual/accessibility Playwright: PASS — 2 tests.
- `pnpm security:evidence`: PASS — no untriaged critical or exploitable high findings.

## Control test

`tests/integration/sprint20-marketing-attribution.test.ts` runs in a transaction and rolls back all QA data. It proves explicit context issue/replay, no-context control, customer mismatch, branch mismatch, expiry, single-use attach, captured-payment + PAID Order + ISSUED Invoice evidence, refund adjustment, replay idempotency, append-only evidence, and hashed context storage.

The non-attributed control uses a separate existing Booking for the same Customer with `attributionReference` omitted. It asserts that no `marketing_booking_attributions` row is added.

## Finalization checklist

- [x] Run full unit/contract/integration/E2E gates after final source changes; record green results.
- [x] Run reconciliation/security/encoding/no-hardcode checks.
- [x] Capture final evidence matrix and local checkpoint identifiers.
- [x] Append closure to the historical Business Journey progress without deleting the old blocked record.
- [x] Task Redis was used only for QA and removed after the final run; unrelated services were not stopped.
- [x] Do not deploy production.

## Finalization audit

| Item | Result |
|---|---|
| Task-owned source/test SHA pushed | `d41db27e37a2bdecb6b56fafced7ee22683b9b3a` |
| GitHub Actions run | `32753821931` |
| GitHub Actions `quality` job | PASS |
| Overall GitHub Actions conclusion | FAILURE — unrelated `sprint19-wave0-visual` date snapshot mismatch |
| Unrelated Wave0 changes | Preserved and not committed |
| Task Docker containers | 0 |
| Production deployment/data mutation | NO / NO |

The final green CI requirement cannot be asserted until the pre-existing Wave0 clock-freeze/snapshot changes are authorized for commit or the CI baseline is corrected outside this task.
