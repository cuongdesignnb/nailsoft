# Business Journey Route Coverage

Generated for `NAILSOFT_BUSINESS_JOURNEY_QA` from the current route inventory and active dispatchers.

## Inventory comparison

- Source of truth: `docs/agent/ADMIN_ROUTE_INVENTORY.md`.
- Normalized route/view patterns: 231.
- `/admin/**` patterns: 215.
- `/platform/**` patterns: 16.
- Current validation: every inventory row has an owner and is mapped.
- This document maps routes that participate in the customer-to-cash lifecycle. Platform billing, fixed assets, procurement, and other non-customer-lifecycle routes remain explicitly outside this QA scope unless they are a downstream evidence surface.

## Journey route map

| Journey | Route/view patterns exercised or inspected | Owner | Coverage status |
|---|---|---|---|
| J01 | `/admin/pos/registers`, `/admin/pos/cash-sessions`, `/admin/pos/cash-sessions/open`, `/admin/pos/cash-sessions/:id`, `/admin/pos/cash-sessions/:id/close` | Wave 2 POS/finance | PASS |
| J02 | `/admin/customers`, `/admin/customers/new`, `/admin/operations/walk-ins/new`, `/admin/operations/board`, `/admin/operations/walk-ins/:id` | Wave 1 + Wave 3 | PASS |
| J03 | `/admin/customers`, `/admin/customers/:id`, `/admin/operations/walk-ins/new`, `/admin/operations/board` | Wave 1 + Wave 3 | PASS |
| J04 | `/admin/appointments`, `/admin/appointments/new`, `/admin/appointments/:id/overview`, `/admin/calendar`, `/admin/availability/search` | Wave 1 scheduling | PASS |
| J05 | `/admin/appointments/:id/check-in`, `/admin/operations/board`, `/admin/appointments/:id/overview` | Wave 1 scheduling/operations | PASS |
| J06 | `/admin/service-sessions/:id`, `/admin/appointments/:id/execution`, `/admin/operations/board` | Wave 1 operations | PASS |
| J07 | `/admin/appointments/:id/add-service`, `/admin/service-sessions/:id`, `/admin/appointments/:id/checkout-summary` | Wave 1 operations | PASS |
| J08 | `/admin/appointments/:id/checkout-summary`, `/admin/pos/checkout/:id`, `/admin/pos/orders/:id` | Wave 1 + Wave 2 | PASS |
| J09 | `/admin/pos/orders/:id/benefits`, `/admin/benefits`, `/admin/benefits/customers/:id`, `/admin/vouchers/codes`, `/admin/packages/entitlements`, `/admin/gift-cards/:id`, `/admin/customer-credit`, `/admin/pos/orders/:id/stored-value`, `/admin/pos/orders/:id/gift-card` | Wave 3 benefits/stored value | PASS |
| J10 | `/admin/pos/orders/:id/payment`, `/admin/pos/orders/:id`, `/admin/pos/cash-sessions/:id` | Wave 2 POS/finance | PASS |
| J11 | `/admin/pos/orders/:id/payment`, `/admin/financial/reconciliation`, provider boundary API | Wave 2 finance | PASS |
| J12 | `/admin/pos/orders/:id/receipt`, `/admin/financial/invoices`, `/admin/pos/orders/:id`, `/admin/customers/:id` | Wave 2 + Wave 3 | PASS |
| J13 | `/admin/loyalty/customers/:id`, `/admin/loyalty/adjustments`, `/admin/benefits/customers/:id` | Wave 3 benefits | PASS |
| J14 | `/admin/membership/customers/:id`, `/admin/membership/tiers`, `/admin/benefits/customers/:id` | Wave 3 benefits | PASS |
| J15 | `/admin/packages/entitlements`, `/admin/packages/entitlements/:id`, `/admin/benefits/customers/:id` | Wave 3 benefits | PASS |
| J16 | `/admin/customer-care`, `/admin/customers/:id/engagement`, `/admin/communications/messages`, `/admin/customers/:id` | Wave 3 engagement | PASS |
| J17 | `/admin/review-requests`, `/admin/reviews`, `/admin/reviews/:id`, public review route | Wave 3 engagement | PASS |
| J18 | `/admin/marketing/segments`, `/admin/marketing/campaigns`, `/admin/marketing/campaigns/:id`, `/admin/communications/templates`, `/admin/communications/messages` | Wave 3 marketing/engagement | PASS_WITH_NA |
| J19 | `/admin/benefits`, `/admin/loyalty/customers/:id`, `/admin/vouchers/codes`, `/admin/packages/entitlements`, `/admin/gift-cards/:id`, `/admin/customer-credit` | Wave 3 benefits/stored value | PASS_WITH_NA |
| J20 | `/admin/appointments/:id/reschedule`, `/admin/availability/search`, `/admin/calendar` | Wave 1 scheduling | PASS |
| J21 | `/admin/appointments/:id/cancel`, `/admin/appointments/:id/overview`, `/admin/operations/board` | Wave 1 scheduling/operations | PASS |
| J22 | `/admin/service-recovery`, `/admin/service-recovery/:id`, `/admin/refunds`, `/admin/refunds/new`, `/admin/refunds/:id`, `/admin/credit-notes`, `/admin/credit-notes/:id` | Wave 2 + Wave 3 | PASS |
| J23 | `/admin/financial/reconciliation`, `/admin/refunds/:id`, `/admin/credit-notes/:id`, `/admin/pos/cash-sessions/:id` | Wave 2 finance | PASS |
| J24 | `/admin/commission`, `/admin/commission/entries`, `/admin/commission/periods`, `/admin/commission/adjustments`, `/admin/payroll/runs` | Wave 2 + Wave 4 | PASS |
| J25 | `/admin/staff/list`, `/admin/staff/:id`, `/admin/scheduling/shifts`, `/admin/scheduling/leave-requests`, `/admin/time-clock`, `/admin/timesheets`, `/admin/workforce` | Wave 4 workforce | PASS |
| J26 | `/admin/inventory/service-recipes`, `/admin/inventory/items`, `/admin/inventory/stock`, `/admin/inventory/lots`, `/admin/inventory/locations`, `/admin/inventory/reports` | Wave 5 inventory | PASS |
| J27 | `/admin/pos/cash-sessions/:id`, `/admin/pos/cash-sessions/:id/close`, `/admin/pos/cash-sessions` | Wave 2 POS/finance | PASS |
| J28 | `/admin/accounting`, `/admin/accounting/journals`, `/admin/accounting/reconciliation`, `/admin/accounting/reports`, `/admin/financial/net-sales`, `/admin/financial/reconciliation` | Wave 6 accounting/banking | PASS |
| J29 | `/admin/analytics`, `/admin/analytics/sales`, `/admin/analytics/bookings`, `/admin/analytics/staff`, `/admin/analytics/data-quality` | Wave 6 analytics | PASS |
| J30 | `/admin/customers/:id`, `/admin/benefits/customers/:id`, `/admin/loyalty/customers/:id`, `/admin/membership/customers/:id`, `/admin/packages/entitlements`, `/admin/vouchers/codes`, `/admin/gift-cards`, `/admin/customer-credit`, `/admin/customer-care` | Wave 3 customer 360 | PASS |
| J31 | All lifecycle routes above with BRANCH_A/BRANCH_B IDs | Domain owners | PASS |
| J32 | All lifecycle API resources with Tenant A/Tenant B IDs | Domain owners | PASS |
| J33 | All lifecycle mutation/read surfaces and direct API calls | Permission registry/domain owners | PASS |
| J34 | Marketing URL state, Customer Care route, reload/back/second tab | `qa-journey-resilience.spec.ts` | PASS |
| J35 | Customer Care directory retry and offline write rejection | `qa-journey-resilience.spec.ts` | PASS |
| J36 | Operations board, Customer Care, Marketing and worker-backed projections | Owning domains | PASS |
| J37 | Core screens listed in the QA contract | Admin shell + owning domains | PASS |
| J38 | Core front-desk routes at 1440/1280/768/390 widths | Admin shell + owning domains | PASS |
| J39 | All Vietnamese customer-facing lifecycle routes | Admin shell + owning domains | PASS |
| J40 | Entity trace across API/DB/audit/outbox/downstream screens | All participating owners | PASS |

## Explicitly outside the customer lifecycle

The following inventory families are not silently treated as journey PASS: tenant billing/platform payments (`I-01`, `I-02`, `J-01`–`J-04`), fixed assets (`G-01`–`G-03`), procurement (`F-01`–`F-04`), and unrelated organization/settings/catalog compatibility routes (`L-01`–`L-03`). They remain covered by their own domain suites and are only used here when a downstream reference or isolation check requires them.

## Route acceptance rule

This matrix is updated as each journey produces evidence. `PENDING` means no acceptance claim has been made. A journey route is only marked PASS when UI, API, DB, audit, permission, idempotency/concurrency and downstream checkpoints required by the journey are evidenced or explicitly justified as N/A.

## Evidence notes

- `PASS` is backed by the final isolated browser run (`E2E_ISOLATED_PASS=114/114`), the passing integration/contract/unit suites, and the domain-specific evidence files under `artifacts/qa/business-journeys/`.
- `PASS_WITH_NA` means the supported journey is verified, while a capability absent from the current domain is explicitly excluded. J18 excludes booking/revenue attribution; J19 excludes birthday automation and unsupported expiry taxonomies.
- J34 and J35 are now backed by the dedicated `qa-journey-resilience.spec.ts` acceptance test; the test uses only non-production seeded data and does not enqueue offline writes.
