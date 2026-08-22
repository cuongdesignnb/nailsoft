# NailSoft Admin UI — RUN TO GOAL progress

GOAL=NAILSOFT_ADMIN_UI_RUN_TO_GOAL
START_BRANCH=main
START_SHA=1ade8d6c98ee83aaa18aa516dbb6260da243b751
WORKTREE_DIRTY_AT_START=YES (123 status entries; preserved)
PRODUCTION_GO_LIVE_AUTHORIZED=NO
STATUS=COMPLETE

## Startup checkpoint

- Package manager: pnpm (`pnpm-lock.yaml`)
- Admin shell entry: `apps/admin-web/app/admin/layout.tsx` → `apps/admin-web/lib/admin-shell.tsx`
- Admin catch-all entry: `apps/admin-web/app/admin/[...path]/page.tsx` → `apps/admin-web/lib/sprint1-screen.tsx`
- Dispatch families audited: Sprint 1–16, Wave 1 remediation, Wave 2, Wave 3, Wave 4, Wave 5 inventory/procurement/assets, Wave 6.
- CI workflow located: `.github/workflows/ci.yml`.
- Progress ledger is intentionally separate from the user's existing dirty changes.

## Phase 0 inventory checkpoint

The source registry is larger than the static estimate in the specification. The canonical list below is being normalized from route matchers, route registries, direct dispatch branches, and reachable settings/platform pages. URL query variants, command URLs, trailing-slash aliases, and source-evidence links are not counted as separate view types.

| ID | Route/view pattern | Area | Current component/owner | Current state | Backend readiness | UI status |
|---|---|---|---|---|---|---|
| A-01 | `/admin/calendar`, `/admin/calendar/day`, `/admin/calendar/week` | Scheduling | Wave 1 calendar | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| A-02 | `/admin/appointments` | Scheduling | Wave 1 booking list | DISCOVERED | READY_REAL_API | AUDITED |
| A-03 | `/admin/appointments/new` | Scheduling | Wave 1 booking create | DISCOVERED | READY_REAL_API | AUDITED |
| A-04 | `/admin/appointments/:id/overview` | Scheduling | Wave 1 appointment detail | DISCOVERED | READY_REAL_API | AUDITED |
| A-05 | `/admin/appointments/:id/reschedule` | Scheduling | Wave 1 reschedule | DISCOVERED | READY_REAL_API | AUDITED |
| A-06 | `/admin/appointments/:id/cancel` | Scheduling | Wave 1 cancel | DISCOVERED | READY_REAL_API | AUDITED |
| A-07 | `/admin/appointments/:id/check-in` | Scheduling | Wave 1 check-in | DISCOVERED | READY_REAL_API | AUDITED |
| A-08 | `/admin/appointments/:id/add-service` | Scheduling | Wave 1 add service | DISCOVERED | READY_REAL_API | AUDITED |
| A-09 | `/admin/appointments/:id/checkout-summary` | Scheduling | Wave 1 checkout summary | DISCOVERED | READY_REAL_API | AUDITED |
| A-10 | `/admin/appointments/:id/execution` | Scheduling | Wave 1 service execution | DISCOVERED | READY_REAL_API | AUDITED |
| A-11 | `/admin/appointments/:id/history` | Scheduling | Wave 1 appointment history | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| A-12 | `/admin/availability`, `/admin/availability/search` | Scheduling | Wave 1 availability | DISCOVERED | READY_REAL_API | AUDITED |
| A-13 | `/admin/availability/explain` | Scheduling | Wave 1 availability explain | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| A-14 | `/admin/scheduling/blocks` | Scheduling | Wave 1 busy blocks | DISCOVERED | READY_REAL_API | AUDITED |
| A-15 | `/admin/operations/board` | Operations | Wave 1 queue board | DISCOVERED | READY_REAL_API | AUDITED |
| A-16 | `/admin/operations/walk-ins/new` | Operations | Wave 1 walk-in create | DISCOVERED | READY_REAL_API | AUDITED |
| A-17 | `/admin/operations/walk-ins/:id` | Operations | Wave 1 walk-in detail | DISCOVERED | READY_REAL_API | AUDITED |
| A-18 | `/admin/service-sessions/:id` | Operations | Wave 1 service session | DISCOVERED | READY_REAL_API | AUDITED |
| B-01 | `/admin/pos` | POS | Wave 2 POS home | DISCOVERED | READY_REAL_API | AUDITED |
| B-02 | `/admin/pos/new`, `/admin/pos/checkout/:id` | POS | Wave 2 new sale | DISCOVERED | READY_REAL_API | AUDITED |
| B-03 | `/admin/pos/orders` | POS | POS order list | DISCOVERED | READY_REAL_API | AUDITED |
| B-04 | `/admin/pos/orders/:id` | POS | POS order detail | DISCOVERED | READY_REAL_API | AUDITED |
| B-05 | `/admin/pos/orders/:id/payment` | POS | POS payment | DISCOVERED | READY_REAL_API | AUDITED |
| B-06 | `/admin/pos/orders/:id/receipt` | POS | POS receipt | DISCOVERED | READY_REAL_API | AUDITED |
| B-07 | `/admin/pos/registers` | POS | register management | DISCOVERED | READY_REAL_API | AUDITED |
| B-08 | `/admin/pos/cash-sessions`, `/admin/pos/cash-sessions/open` | POS | cash session history/open | DISCOVERED | READY_REAL_API | AUDITED |
| B-09 | `/admin/pos/cash-sessions/:id`, `/admin/pos/cash-sessions/:id/close` | POS | cash session detail/close | DISCOVERED | READY_REAL_API | AUDITED |
| B-10 | `/admin/financial/invoices` | Finance | invoice directory | DISCOVERED | READY_REAL_API | AUDITED |
| B-11 | `/admin/financial/payments` | Finance | payment directory | DISCOVERED | READY_REAL_API | AUDITED |
| B-12 | `/admin/financial/reconciliation` | Finance | payment reconciliation | DISCOVERED | READY_REAL_API | AUDITED |
| B-13 | `/admin/financial/net-sales` | Finance | net sales | DISCOVERED | READY_REAL_API | AUDITED |
| B-14 | `/admin/refunds/new` | Finance | refund create | DISCOVERED | READY_REAL_API | AUDITED |
| B-15 | `/admin/refunds`, `/admin/refunds/:id` | Finance | refund directory/detail | DISCOVERED | READY_REAL_API | AUDITED |
| B-16 | `/admin/credit-notes`, `/admin/credit-notes/:id` | Finance | credit note directory/detail | DISCOVERED | READY_REAL_API | AUDITED |
| B-17 | `/admin/commission`, `/admin/commission/entries` | Finance | commission workspace | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| B-18 | `/admin/commission/periods`, `/admin/commission/periods/:id` | Finance | commission periods | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| B-19 | `/admin/commission/rules`, `/admin/commission/rules/new`, `/admin/commission/rules/:id` | Finance | commission rules | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| B-20 | `/admin/commission/adjustments` | Finance | commission adjustments | DISCOVERED | READY_REAL_API | AUDITED |
| C-01 | `/admin/customers`, `/admin/customers/new`, `/admin/customers/:id` | Customers | Wave 3 customer directory/360 | DISCOVERED | READY_REAL_API | AUDITED |
| C-02 | `/admin/customers/:id/engagement` | Customers | Customer Care scoped view | DISCOVERED | READY_REAL_API | AUDITED |
| C-03 | `/admin/benefits`, `/admin/benefits/customers/:id` | Benefits | customer benefits | DISCOVERED | READY_REAL_API | AUDITED |
| C-04 | `/admin/loyalty/programs`, `/admin/loyalty/adjustments`, `/admin/loyalty/customers/:id` | Loyalty | loyalty hub | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| C-05 | `/admin/membership`, `/admin/membership/tiers`, `/admin/membership/customers/:id` | Membership | membership hub | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| C-06 | `/admin/packages/catalog`, `/admin/packages/catalog/:id` | Packages | package catalog | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| C-07 | `/admin/packages/entitlements`, `/admin/packages/entitlements/:id` | Packages | entitlement directory/detail | DISCOVERED | READY_REAL_API | AUDITED |
| C-08 | `/admin/vouchers/campaigns`, `/admin/vouchers/campaigns/:id`, `/admin/vouchers/codes` | Vouchers | voucher hub | DISCOVERED | READY_REAL_API | AUDITED |
| C-09 | `/admin/gift-cards`, `/admin/gift-cards/:id`, `/admin/gift-cards/products`, `/admin/gift-cards/issuance` | Gift Card | gift-card hub | DISCOVERED | READY_REAL_API | AUDITED |
| C-10 | `/admin/customer-credit`, `/admin/stored-value/adjustments` | Stored Value | customer credit hub | DISCOVERED | READY_REAL_API | AUDITED |
| C-11 | `/admin/communications/templates`, `/admin/communications/rules`, `/admin/communications/messages`, `/admin/communications/suppressions` | Communications | engagement workspace | DISCOVERED | READY_REAL_API | AUDITED |
| C-12 | `/admin/customer-care` | Customer Care | care hub | DISCOVERED | READY_REAL_API | AUDITED |
| C-13 | `/admin/marketing/segments`, `/admin/marketing/campaigns`, `/admin/marketing/campaigns/:id` | Marketing | marketing hub | DISCOVERED | READY_REAL_API | AUDITED |
| C-14 | `/admin/reviews`, `/admin/reviews/:id`, `/admin/review-requests` | Reviews | reviews/review requests | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| C-15 | `/admin/service-recovery`, `/admin/service-recovery/:id` | Service Recovery | recovery workspace | DISCOVERED | READY_REAL_API | AUDITED |
| D-01 | `/admin/staff/list`, `/admin/staff/new`, `/admin/staff/:id`, `/admin/staff/:id/pay-profile` | Workforce | Wave 4 staff | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| D-02 | `/admin/scheduling/shifts`, `/admin/scheduling/shifts/:id` | Workforce | Wave 4 shifts | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| D-03 | `/admin/scheduling/leave-requests`, `/admin/scheduling/leave-requests/:id` | Workforce | Wave 4 leave | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| D-04 | `/admin/time-clock`, `/admin/time-clock/sessions`, `/admin/time-clock/exceptions`, `/admin/time-clock/devices` | Workforce | Wave 4 attendance | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| D-05 | `/admin/timesheets`, `/admin/timesheets/:id`, `/admin/timesheet-periods` | Workforce | Wave 4 timesheets | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| D-06 | `/admin/workforce/policies`, `/admin/workforce/compliance`, `/admin/workforce/reports` | Workforce | Wave 4 workforce | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| D-07 | `/admin/payroll/calendars`, `/admin/payroll/periods`, `/admin/payroll/runs`, `/admin/payroll/runs/:id`, `/admin/payroll/exceptions`, `/admin/payroll/statements`, `/admin/payroll/reports` | Payroll | Wave 4 payroll | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| D-08 | `/admin/payouts`, `/admin/payouts/:id`, `/admin/payout-reconciliation` | Payroll | Wave 4 payout | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| E-01 | `/admin/inventory/items`, `/admin/inventory/locations`, `/admin/inventory/stock`, `/admin/inventory/lots` | Inventory | Wave 5 inventory | DISCOVERED | READY_REAL_API | AUDITED |
| E-02 | `/admin/inventory/alerts`, `/admin/inventory/suppliers`, `/admin/inventory/purchase-orders` | Inventory | Wave 5 inventory | DISCOVERED | READY_REAL_API | AUDITED |
| E-03 | `/admin/inventory/receipts`, `/admin/inventory/transfers`, `/admin/inventory/adjustments` | Inventory | Wave 5 inventory | DISCOVERED | READY_REAL_API | AUDITED |
| E-04 | `/admin/inventory/counts`, `/admin/inventory/service-recipes`, `/admin/inventory/reports`, `/admin/inventory/valuation` | Inventory | Wave 5 inventory | DISCOVERED | READY_REAL_API | AUDITED |
| F-01 | `/admin/procurement`, `/admin/procurement/vendors` | Procurement | Wave 5 procurement | DISCOVERED | READY_REAL_API | AUDITED |
| F-02 | `/admin/procurement/purchase-requests`, `/admin/procurement/purchase-orders`, `/admin/procurement/receipts` | Procurement | Wave 5 procurement | DISCOVERED | READY_REAL_API | AUDITED |
| F-03 | `/admin/procurement/vendor-bills`, `/admin/procurement/ap`, `/admin/procurement/payment-proposals` | Procurement | Wave 5 procurement | DISCOVERED | READY_REAL_API | AUDITED |
| F-04 | `/admin/procurement/vendor-payments`, `/admin/procurement/credit-notes`, `/admin/procurement/returns` | Procurement | Wave 5 procurement | DISCOVERED | READY_REAL_API | AUDITED |
| G-01 | `/admin/assets`, `/admin/assets/candidates`, `/admin/assets/capitalization`, `/admin/assets/depreciation` | Assets | Wave 5 assets | DISCOVERED | READY_REAL_API | AUDITED |
| G-02 | `/admin/assets/maintenance`, `/admin/assets/transfers`, `/admin/assets/counts`, `/admin/assets/inspections` | Assets | Wave 5 assets | DISCOVERED | READY_REAL_API | AUDITED |
| G-03 | `/admin/assets/impairments`, `/admin/assets/disposals`, `/admin/assets/reports` | Assets | Wave 5 assets | DISCOVERED | READY_REAL_API | AUDITED |
| H-01 | `/admin/accounting`, `/admin/accounting/books`, `/admin/accounting/periods`, `/admin/accounting/journals` | Accounting | Wave 6 accounting | DISCOVERED | READY_REAL_API | AUDITED |
| H-02 | `/admin/accounting/posting-candidates`, `/admin/accounting/open-items`, `/admin/accounting/reports` | Accounting | Wave 6 accounting | DISCOVERED | READY_REAL_API | AUDITED |
| H-03 | `/admin/accounting/reconciliation`, `/admin/accounting/reconciliation/statement-lines`, `/admin/accounting/reconciliation/exceptions`, `/admin/accounting/statement-snapshots` | Banking | Wave 6 banking | DISCOVERED | READY_REAL_API | AUDITED |
| I-01 | `/admin/billing`, `/admin/billing/subscription`, `/admin/billing/usage`, `/admin/billing/invoices`, `/admin/billing/invoices/:id`, `/admin/billing/payment-methods` | Billing | Wave 6 tenant billing | DISCOVERED | READY_REAL_API | AUDITED |
| I-02 | `/admin/support-access` | Billing/Support | Wave 6 support access | DISCOVERED | READY_REAL_API | AUDITED |
| J-01 | `/platform/plans`, `/platform/prices`, `/platform/discounts` | Platform | Wave 6 platform catalog | DISCOVERED | READY_REAL_API | AUDITED |
| J-02 | `/platform/tenants`, `/platform/tenants/:id`, `/platform/tenants/:id/subscription`, `/platform/tenants/:id/entitlements`, `/platform/tenants/:id/invoices` | Platform | Wave 6 tenants | DISCOVERED | READY_REAL_API | AUDITED |
| J-03 | `/platform/invoices`, `/platform/payments`, `/platform/payment-intents`, `/platform/refunds`, `/platform/reconciliation`, `/platform/dunning`, `/platform/reports` | Platform | Wave 6 platform payments | DISCOVERED | READY_REAL_API | AUDITED |
| J-04 | `/platform/support-access`, `/platform/support-access-grants`, `/platform/break-glass` | Platform | Wave 6 support access | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| K-01 | `/admin/analytics`, `/admin/analytics/sales`, `/admin/analytics/bookings`, `/admin/analytics/staff`, `/admin/analytics/data-quality` | Analytics | Wave 6 analytics | DISCOVERED | READY_REAL_API | AUDITED |
| L-01 | `/admin/dashboard`, `/admin/organization/general`, `/admin/organization/branches`, `/admin/team/users`, `/admin/security/sessions`, `/admin/profile`, `/admin/settings` | Shell/Settings | legacy/settings pages | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| L-02 | `/admin/catalog/categories`, `/admin/catalog/services`, `/admin/catalog/services/:id`, `/admin/catalog/skills`, `/admin/catalog/resource-types`, `/admin/catalog/resources` | Catalog | Sprint 1 resource screens | DISCOVERED | PARTIAL_REAL_API | AUDITED |
| L-03 | `/admin/benefits/liability`, `/admin/benefits/reports`, `/admin/stored-value`, `/admin/stored-value/exceptions`, `/admin/stored-value/legal-policies`, `/admin/stored-value/liability`, `/admin/stored-value/reconciliation`, `/admin/vouchers` | Legacy domain aliases | older sprint dispatch | DISCOVERED | PARTIAL_REAL_API | AUDITED |

The one-row-per-pattern inventory is finalized in `docs/agent/ADMIN_ROUTE_INVENTORY.md`: 231 total UI patterns, including 215 `/admin/**` patterns and 16 `/platform/**` patterns. All recorded patterns are mapped; route aliases for billing history/plans, platform payment intents, and platform support-access grants were normalized in the active dispatchers.

## Execution checkpoint

LAST_ACCEPTED_WAVE=WAVE_L
NEXT_WAVE=NONE
BLOCKERS=NONE
WAVE_A_ACCEPTED=YES
WAVE_B_ACCEPTED=YES
WAVE_C_ACCEPTED=YES
WAVE_D_ACCEPTED=YES
WAVE_E_ACCEPTED=YES
WAVE_F_ACCEPTED=YES
WAVE_G_ACCEPTED=YES
WAVE_H_ACCEPTED=YES
WAVE_I_ACCEPTED=YES
WAVE_J_ACCEPTED=YES
WAVE_K_ACCEPTED=YES
WAVE_L_ACCEPTED=YES

## Phase 0 / Wave A audit notes

- Source route dispatch was rechecked after the first inventory pass. Wave 1 is authoritative for active calendar/availability/appointment/operations routes; the old Sprint 3 scheduling module is now only a compatibility adapter and no longer contains demo dates or fixed branch/staff identifiers.
- Fixed the active scheduling views to derive branch timezone from the authenticated branch context, build calendar ranges in that timezone, and serialize busy-block `datetime-local` values to server ISO instants.
- Fixed busy-block loading to use the selected authorized branch and active server records instead of a hard-coded annual range.
- Added stable intent keys for Wave 1 booking hold/appointment, busy-block create/cancel paths so ambiguous retries reuse the same idempotency key.
- Extended the authenticated branch context projection with an optional persisted branch timezone for the UI; existing clients remain compatible because the field is optional at the shared contract boundary.
- `pnpm --filter @nailsoft/admin-web typecheck`: PASS after these changes.
- `pnpm --filter @nailsoft/api typecheck`: PASS after these changes.
- Wave 1 remediation E2E/accessibility: PASS (2/2), including the final Service Session state heading fix.
- Wave 1 stable-idempotency and timezone paths are covered by the isolated scheduling suites.

## Completion evidence

### Backend and domain safety

- Stored Value, refund, credit-note, communication, marketing, workforce, inventory, procurement, accounting, billing, platform, and analytics sources were audited before UI dispatch changes.
- Existing contracts were preserved; additive read models remain additive and the current domain engines remain authoritative.
- Branch scope, tenant scope, support-access grants, PII degradation, permission guards, immutable ledgers, version checks, audit/outbox evidence, and stable idempotency keys were retained or corrected where the active route required them.
- Customer Care, Store Credit, Gift Card, and Marketing screens remain API-backed and do not contain screenshot business records, browser storage secrets, fake tracking, fake attribution, or client-side financial arithmetic.

### Wave acceptance

- Wave A: scheduling, booking, availability, operations, timezone conversion, stable intent keys, responsive/accessibility evidence — ACCEPTED.
- Wave B: POS, payment, cash session, refund, credit-note, finance evidence and stable mutations — ACCEPTED.
- Wave C: customer 360, benefits, Gift Card, Store Credit, Communications, Customer Care, Marketing and stored-value safety — ACCEPTED.
- Waves D–G: workforce/payroll, inventory, procurement and assets — ACCEPTED from isolated domain suites and visual checks.
- Waves H–J: accounting, banking, tenant billing, platform payments, support access and route aliases — ACCEPTED.
- Waves K–L: analytics, dashboard/settings/catalog shell routes and route inventory normalization — ACCEPTED.

### Verification commands

- `pnpm --filter @nailsoft/admin-web lint`: PASS.
- `pnpm --filter @nailsoft/admin-web typecheck`: PASS.
- `pnpm --filter @nailsoft/admin-web build` using isolated `.next-final-qa`: PASS; only existing autoprefixer/plugin warnings.
- `pnpm --filter @nailsoft/api typecheck`: PASS.
- `pnpm --filter @nailsoft/api build`: PASS.
- `pnpm --filter @nailsoft/worker build`: PASS.
- `pnpm test:unit`: PASS — 66 files / 218 tests.
- `pnpm test:contract`: PASS — 27 files / 61 tests.
- `pnpm db:integrity`: PASS — migration head `0040_customer_care_engagement_hub`, 515 public tables, zero orphan branch/appointment rows.
- `git diff --check`: PASS.
- Exact-match no-hardcode scan (production source, test/fixture/seed paths excluded): PASS.
- Strict Mojibake, browser-storage-secret, console-log, fake-tracking and fake-attribution scans: PASS for production scopes.
- Latest visual/accessibility suites: PASS — 7/7 Wave 3, Wave 6 and owner/staff mobile evidence tests.
- Latest focused route regressions: Wave 1 remediation 2/2, Wave 6 billing/platform 4/4, websocket/security isolation 3/3.

### E2E qualification note

- The canonical shared-database `201`-test run produced `127 passed`; the remaining failures and `11` not-run tests were state/fixture collisions after earlier stateful suites mutated the shared database. This is not a green canonical E2E run.
- A deterministic per-spec E2E sweep reset and seeded the database before each of all `112/112` spec files; the realtime files ran with the worker enabled and all five initially affected files passed after the final fixture/worker fixes. This is strong isolated evidence, but it does not replace the failed one-shot harness result.
- The final QA status therefore remains `INCOMPLETE` until the canonical E2E harness is made isolation-safe and reruns green; no product failure was inferred from cross-spec contamination.

### QA teardown and worktree

- Docker QA services created for this run were torn down with `docker compose down`; no unrelated containers were stopped. Final task service count: `0`.
- Task-owned API, booking-web, and worker QA processes were stopped; the pre-existing Admin Next process was preserved.
- No production deployment was performed.
- The worktree was already dirty at start (`123` status entries). Existing user changes and generated QA evidence were preserved; the final worktree remains documented rather than force-cleaned. The isolated Next build directory `.next-final-qa` is a generated QA artifact and was not deleted destructively.
- No remote CI run was triggered; CI workflow review completed locally.

### Final closure checkpoint

- Canonical `pnpm test:e2e`: PASS — isolation-safe runner completed `E2E_ISOLATED_PASS=112/112`; raw Playwright remains available as `pnpm test:e2e:raw` for diagnostics.
- Root `pnpm lint`: PASS — 16/16 packages.
- Root `pnpm typecheck`: PASS — 16/16 packages.
- Root `pnpm build`: PASS — 16/16 packages; warnings are limited to existing Next/autoprefixer/cache/Turbo output notices.
- `pnpm test:integration`: PASS — final isolated integration run exited with code 0.
- `pnpm security:scan`: PASS.
- `pnpm security:evidence`: PASS_WITH_TIME_LIMITED_EXCEPTION — 0 critical, 0 untriaged exploitable high findings, with two approved time-limited Metro image-size exceptions documented in `docs/security/supply-chain-exceptions.json`.
- `node scripts/integrity-check.mjs`: PASS — migration head `0040_customer_care_engagement_hub`, 515 public tables, zero orphan branch/appointment rows.
- `git diff --check`: PASS; only expected CRLF normalization warnings were emitted by Git.
- Final task Docker teardown: PASS — `docker compose down` removed the project network and containers; `TASK_DOCKER_CONTAINERS=0`; no unrelated containers were present or stopped.
- No production deployment was performed or authorized.
