# NailSoft UI Route Coverage

This inventory is maintained from the current route files and dispatchers. Dynamic entity IDs are represented once per view type.

## Customer-facing unique views

| Screen ID | App | Route/View | Classification | Notes |
|---|---|---|---|---|
| CUSTOMER_LANDING | booking-web | `/` | UI_POLISHED | Salon-code entry works; premium landing evidence accepted. |
| CUSTOMER_BOOKING_BRANCH | booking-web | `/book/:salonSlug` — Branch | UI_POLISHED | Real public salon/branch API; evidence accepted. |
| CUSTOMER_BOOKING_SERVICES | booking-web | `/book/:salonSlug` — Services | UI_POLISHED | Real service catalog API; evidence accepted. |
| CUSTOMER_BOOKING_STAFF | booking-web | `/book/:salonSlug` — Staff preference | UI_POLISHED | Real staff selector and filtered availability captured at four viewports; selecting a slot remains the explicit hold boundary. |
| CUSTOMER_BOOKING_AVAILABILITY | booking-web | `/book/:salonSlug` — Availability | UI_POLISHED | Real availability API and source-driven empty state; evidence accepted. |
| CUSTOMER_BOOKING_CONTACT | booking-web | `/book/:salonSlug` — Contact | UI_POLISHED | Purpose-built contact form, live slot-hold summary, verification request and WCAG AA contrast verified at four viewports. |
| CUSTOMER_BOOKING_OTP | booking-web | `/book/:salonSlug` — OTP | UI_POLISHED | Live contact-verification challenge, masked destination, server expiry countdown and recovery state verified at four viewports. |
| CUSTOMER_BOOKING_REVIEW | booking-web | `/book/:salonSlug` — Review | UI_POLISHED | Live held booking review with branch policy, service price and explicit confirmation verified at four viewports. |
| CUSTOMER_BOOKING_SUCCESS | booking-web | `/book/:salonSlug` — Result | UI_POLISHED | Real booking command result, server reference and manage-booking handoff verified at four viewports. |
| CUSTOMER_MANAGE_LOOKUP | booking-web | `/manage-booking` — Lookup | UI_POLISHED | Live secure lookup request, neutral response, four viewport evidence and Axe zero. |
| CUSTOMER_MANAGE_OTP | booking-web | `/manage-booking` — OTP | UI_POLISHED | Live challenge, masked destination, server expiry countdown, recovery state and four viewport evidence. |
| CUSTOMER_MANAGE_DETAIL | booking-web | `/manage-booking` — Detail | UI_POLISHED | API-backed identity, branch, timezone, service, price, package and policy composition with four viewport evidence. |
| CUSTOMER_MANAGE_RESCHEDULE | booking-web | `/manage-booking` — Reschedule | UI_POLISHED | API-backed replacement availability and server replacement hold review captured at four viewports. |
| CUSTOMER_MANAGE_CANCEL | booking-web | `/manage-booking` — Cancel | UI_POLISHED | Real local QA cancellation command, persisted terminal state and guarded post-cancel UI captured at four viewports. |
| CUSTOMER_PACKAGE_RESERVATION | booking-web | `/manage-booking` — Package reservation | UI_POLISHED | Real entitlement API is wired; QA verified truthful empty state and no reserve CTA without an active package. |
| CUSTOMER_PUBLIC_REVIEW | admin-web | `/public/review` | UI_POLISHED | Signed review request, verified visit context, real public submission, success state and four viewport evidence captured; Axe zero and no page-level overflow. |
| CUSTOMER_UNSUBSCRIBE | admin-web | `/public/unsubscribe` | UI_POLISHED | Signed unsubscribe entry, real consent withdrawal, success state and four viewport evidence captured; Axe zero and no page-level overflow. |
| CUSTOMER_PREFERENCES | admin-web | `/customer/preferences` | UI_POLISHED | Authenticated QA customer state loaded from the real session/API path; four viewport evidence, Axe zero and no page-level overflow. |
| CUSTOMER_CONSENTS | admin-web | `/customer/consents` | UI_POLISHED | Authenticated QA customer consent state loaded from the real session/API path; four viewport evidence, Axe zero and no page-level overflow. |

## Admin coverage source

The current admin route pattern inventory is maintained in [`docs/agent/ADMIN_ROUTE_INVENTORY.md`](../agent/ADMIN_ROUTE_INVENTORY.md). Each unique admin view will be copied into the completion ledger with a purpose-built composition classification during Phase 0.

| Screen ID | App | Route/View | Classification | Notes |
|---|---|---|---|---|
| ADMIN_DASHBOARD | admin-web | `/admin/dashboard` | UI_POLISHED | API-backed dashboard; four-size evidence accepted. |
| ADMIN_MARKETING_CAMPAIGNS | admin-web | `/admin/marketing/campaigns` | UI_POLISHED | Email-only Marketing Hub; unsupported attribution metrics are not rendered; four viewport captures and Axe-zero audit recorded. |
| ADMIN_CUSTOMERS | admin-web | `/admin/customers` | UI_POLISHED | API-backed directory with Vietnamese premium pass and responsive table cards. |
| ADMIN_CUSTOMER_DETAIL | admin-web | `/admin/customers/:customerId` | UI_POLISHED | Existing Customer 360 profile renders real customer, appointment, loyalty and membership context. |
| ADMIN_CUSTOMER_ENGAGEMENT | admin-web | `/admin/customers/:customerId/engagement` | UI_POLISHED | Customer-scoped Customer Care route resolves correctly, uses real overview/directory data and truthful empty state. |
| ADMIN_CUSTOMER_CARE | admin-web | `/admin/customer-care` | UI_POLISHED | Global Customer Care overview, activity directory, follow-up board and email-only safety messaging use real read-model data; four viewport captures and Axe-zero audit recorded. |
| ADMIN_COMMUNICATION_MESSAGES | admin-web | `/admin/communications/messages` | UI_POLISHED | Technical Email delivery workspace retained with real message states and truthful empty state; unsupported provider telemetry hidden. |
| ADMIN_COMMUNICATION_MESSAGE_DETAIL | admin-web | `/admin/communications/messages/:id` | UI_POLISHED | Purpose-built Email detail route with persisted Worker-created message state, safe attempts/error surface, four viewport evidence, Axe zero and no page-level horizontal overflow. |
| ADMIN_MARKETING_SEGMENTS | admin-web | `/admin/marketing/segments` | UI_POLISHED | Consent-safe segment builder with API-backed branch selection and lifecycle table. |
| ADMIN_SERVICE_RECOVERY | admin-web | `/admin/service-recovery` | UI_POLISHED | API-backed Recovery case creation/list with real Customer and branch scope. |
| ADMIN_STORED_VALUE_ADJUSTMENTS | admin-web | `/admin/stored-value/adjustments` | UI_POLISHED | Dual-control Store Credit adjustment workflow with no direct balance edit. |
| ADMIN_STORED_VALUE | admin-web | `/admin/stored-value` | UI_POLISHED | API-backed Stored Value control center with liability, Customer Credit, reconciliation and owning workflow links. |

## Phase 2–4 normalized views with visual evidence

These are the normalized view IDs used for route-level screenshot evidence. Detail, command and trailing-slash variants in the 231-pattern source inventory are aliases of the owning view unless the dispatcher renders a distinct composition.

| Screen ID | Route family | Classification | Evidence |
|---|---|---|---|
| ADMIN_APPOINTMENTS | `/admin/appointments` and appointment workflow routes | UI_POLISHED | API-backed scheduler/list with accessible scroll regions, improved status/muted-text contrast, four viewport captures and Axe zero in `artifacts/ui-completion/admin-appointments/` |
| ADMIN_APPOINTMENT_OVERVIEW | `/admin/appointments/:id/overview` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-overview/` |
| ADMIN_APPOINTMENT_SERVICES | `/admin/appointments/:id/services` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-services/` |
| ADMIN_APPOINTMENT_CUSTOMER | `/admin/appointments/:id/customer` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-customer/` |
| ADMIN_APPOINTMENT_POLICY | `/admin/appointments/:id/policy` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-policy/` |
| ADMIN_APPOINTMENT_HISTORY | `/admin/appointments/:id/history` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-history/` |
| ADMIN_APPOINTMENT_RESCHEDULE | `/admin/appointments/:id/reschedule` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-reschedule/` |
| ADMIN_APPOINTMENT_CANCEL | `/admin/appointments/:id/cancel` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-cancel/` |
| ADMIN_APPOINTMENT_CHECK_IN | `/admin/appointments/:id/check-in` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-check-in/` |
| ADMIN_APPOINTMENT_ADD_SERVICE | `/admin/appointments/:id/add-service` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-add-service/` |
| ADMIN_APPOINTMENT_CHECKOUT_SUMMARY | `/admin/appointments/:id/checkout-summary` | UI_POLISHED | `artifacts/ui-completion/admin-appointment-checkout-summary/` |
| ADMIN_SERVICE_SESSION_DETAIL | `/admin/service-sessions/:id` | UI_POLISHED | `artifacts/ui-completion/admin-service-session-detail/` |
| ADMIN_POS_ORDER_DETAIL | `/admin/pos/orders/:id` | UI_POLISHED | `artifacts/ui-completion/admin-pos-order-detail/` |
| ADMIN_POS_ORDER_PAYMENT | `/admin/pos/orders/:id/payment` | UI_POLISHED | `artifacts/ui-completion/admin-pos-order-payment/` |
| ADMIN_POS_ORDER_RECEIPT | `/admin/pos/orders/:id/receipt` | UI_POLISHED | `artifacts/ui-completion/admin-pos-order-receipt/` |
| ADMIN_POS_ORDER_BENEFITS | `/admin/pos/orders/:id/benefits` | UI_POLISHED | `artifacts/ui-completion/admin-pos-order-benefits/` |
| ADMIN_POS_ORDER_STORED_VALUE | `/admin/pos/orders/:id/stored-value` | UI_POLISHED | `artifacts/ui-completion/admin-pos-order-stored-value/` |
| ADMIN_POS_ORDER_GIFT_CARD | `/admin/pos/orders/:id/gift-card` | UI_POLISHED | `artifacts/ui-completion/admin-pos-order-gift-card/` |
| ADMIN_POS_CHECKOUT_DETAIL | `/admin/pos/checkout/:id` | UI_POLISHED | `artifacts/ui-completion/admin-pos-checkout-detail/` |
| ADMIN_AVAILABILITY | `/admin/availability` and availability search | UI_POLISHED | `artifacts/ui-completion/admin-availability/` |
| ADMIN_OPERATIONS | `/admin/operations`, board and walk-in routes | UI_POLISHED | `artifacts/ui-completion/admin-operations/` |
| ADMIN_POS | `/admin/pos` and POS register/checkout surfaces | UI_POLISHED | `artifacts/ui-completion/admin-pos/` |
| ADMIN_ANALYTICS | `/admin/analytics` and analytics views | UI_POLISHED | `artifacts/ui-completion/admin-analytics/` |
| ADMIN_INVENTORY | `/admin/inventory` and inventory workspaces | UI_POLISHED | `artifacts/ui-completion/admin-inventory/` |
| ADMIN_ASSETS | `/admin/assets` and fixed-asset workspaces | UI_POLISHED | `artifacts/ui-completion/admin-assets/` |
| ADMIN_PROCUREMENT | `/admin/procurement` and procurement workspaces | UI_POLISHED | `artifacts/ui-completion/admin-procurement/` |
| ADMIN_FINANCIAL | `/admin/financial` and financial landing | UI_POLISHED | `artifacts/ui-completion/admin-financial/` |
| ADMIN_FINANCIAL_INVOICES | `/admin/financial/invoices` | UI_POLISHED | `artifacts/ui-completion/admin-financial-invoices/` |
| ADMIN_COMMISSION | `/admin/commission` | UI_POLISHED | `artifacts/ui-completion/admin-commission/` |
| ADMIN_COMMISSION_ENTRIES | `/admin/commission/entries` | UI_POLISHED | `artifacts/ui-completion/admin-commission-entries/` |
| ADMIN_COMMISSION_RULES | `/admin/commission/rules` | UI_POLISHED | `artifacts/ui-completion/admin-commission-rules/` |
| ADMIN_COMMISSION_RULE_DETAIL | `/admin/commission/rules/:id` | UI_POLISHED | `artifacts/ui-completion/admin-commission-rules-b1000000-0000-4000-8000-000000000001/` |
| ADMIN_COMMISSION_RULE_NEW | `/admin/commission/rules/new` | UI_POLISHED | `artifacts/ui-completion/admin-commission-rules-new/` |
| ADMIN_FINANCIAL_EXPORTS | `/admin/financial/exports` | UI_POLISHED | `artifacts/ui-completion/admin-financial-exports/` |
| ADMIN_FINANCIAL_REFUNDS | `/admin/financial/refunds` | UI_POLISHED | `artifacts/ui-completion/admin-financial-refunds/` |
| ADMIN_FINANCIAL_NET_SALES | `/admin/financial/net-sales` | UI_POLISHED | API-backed report composition with real totals, ISO date-safe trend labels, and a truthful unavailable-data fallback; `artifacts/ui-completion/admin-financial-net-sales/` |
| ADMIN_COMMISSION_PERIODS | `/admin/commission/periods` | UI_POLISHED | `artifacts/ui-completion/admin-commission-periods/` |
| ADMIN_COMMISSION_PERIOD_DETAIL | `/admin/commission/periods/:id` | UI_POLISHED | `artifacts/ui-completion/admin-commission-period-detail-b2000000-0000-4000-8000-000000000001/` |
| ADMIN_ACCOUNTING | `/admin/accounting` and accounting workspaces | UI_POLISHED | Purpose-built accounting control center plus source-backed workspaces; `artifacts/ui-completion/admin-accounting/` |
| ADMIN_ACCOUNTING_DEEP | `/admin/accounting/books`, `/admin/accounting/periods`, `/admin/accounting/journals`, `/admin/accounting/posting-candidates`, `/admin/accounting/open-items`, `/admin/accounting/reports` | UI_POLISHED | Each deep accounting route now has a purpose-built book-scoped composition, API-backed selectors/evidence and state-aware server controls | `artifacts/ui-completion/admin-accounting-books/`, `admin-accounting-periods/`, `admin-accounting-journals/`, `admin-accounting-posting/`, `admin-accounting-open-items/`, `admin-accounting-reports/` |
| ADMIN_ACCOUNTING_BANKING_DEEP | `/admin/accounting/reconciliation`, `/admin/accounting/reconciliation/statement-lines`, `/admin/accounting/reconciliation/exceptions`, `/admin/accounting/statement-snapshots` | UI_POLISHED | Banking and reconciliation routes use selected-book/account evidence, truthful empty states, versioned controls and Vietnamese source labels | `artifacts/ui-completion/admin-accounting-reconciliation/`, `admin-accounting-reconciliation-statement-lines/`, `admin-accounting-reconciliation-exceptions/`, `admin-accounting-statement-snapshots/` |
| ADMIN_PROFILE | `/admin/profile` | UI_POLISHED | `artifacts/ui-completion/admin-profile/` |
| ADMIN_ORGANIZATION_GENERAL | `/admin/organization/general` | UI_POLISHED | `artifacts/ui-completion/admin-organization-general/` |
| ADMIN_CATALOG_CATEGORIES | `/admin/catalog/categories` | UI_POLISHED | `artifacts/ui-completion/admin-catalog-categories/` |
| ADMIN_CATALOG_CATEGORIES_NEW | `/admin/catalog/categories/new` | UI_POLISHED | API-backed create form; no write during capture; `artifacts/ui-completion/admin-catalog-categories-new/` |
| ADMIN_CATALOG_SERVICES | `/admin/catalog/services` | UI_POLISHED | `artifacts/ui-completion/admin-catalog-services/` |
| ADMIN_CATALOG_SERVICES_NEW | `/admin/catalog/services/new` | UI_POLISHED | API-backed create form with live category selector; no write during capture; `artifacts/ui-completion/admin-catalog-services-new/` |
| ADMIN_CATALOG_SERVICE_DETAIL | `/admin/catalog/services/:id` | UI_POLISHED | `artifacts/ui-completion/admin-catalog-services-detail/` |
| ADMIN_CATALOG_SKILLS | `/admin/catalog/skills` | UI_POLISHED | `artifacts/ui-completion/admin-catalog-skills/` |
| ADMIN_CATALOG_SKILLS_NEW | `/admin/catalog/skills/new` | UI_POLISHED | API-backed create form; no write during capture; `artifacts/ui-completion/admin-catalog-skills-new/` |
| ADMIN_CATALOG_RESOURCE_TYPES | `/admin/catalog/resource-types` | UI_POLISHED | `artifacts/ui-completion/admin-catalog-resource-types/` |
| ADMIN_CATALOG_RESOURCE_TYPES_NEW | `/admin/catalog/resource-types/new` | UI_POLISHED | API-backed create form; no write during capture; `artifacts/ui-completion/admin-catalog-resource-types-new/` |
| ADMIN_CATALOG_RESOURCES | `/admin/catalog/resources` | UI_POLISHED | `artifacts/ui-completion/admin-catalog-resources/` |
| ADMIN_CATALOG_RESOURCES_NEW | `/admin/catalog/resources/new` | UI_POLISHED | API-backed branch/resource-type selectors; no write during capture; `artifacts/ui-completion/admin-catalog-resources-new/` |
| ADMIN_ORGANIZATION_BRANCHES | `/admin/organization/branches` | UI_POLISHED | `artifacts/ui-completion/admin-organization-branches/` |
| ADMIN_TEAM_USERS | `/admin/team/users` | UI_POLISHED | `artifacts/ui-completion/admin-team-users/` |
| ADMIN_SECURITY_SESSIONS | `/admin/security/sessions` | UI_POLISHED | `artifacts/ui-completion/admin-security-sessions/` |
| ADMIN_SUPPORT_ACCESS | `/admin/support-access` | UI_POLISHED | `artifacts/ui-completion/admin-support-access/` |
| ADMIN_BILLING_OVERVIEW | `/admin/billing` | UI_POLISHED | `artifacts/ui-completion/admin-billing/` |
| ADMIN_BILLING_DETAIL | `/admin/billing/plans`, `/admin/billing/subscription`, `/admin/billing/usage`, `/admin/billing/invoices`, `/admin/billing/history`, `/admin/billing/invoices/detail`, `/admin/billing/payment-methods` | UI_POLISHED | `artifacts/ui-completion/admin-billing-plans/`, `admin-billing-subscription/`, `admin-billing-usage/`, `admin-billing-invoices/`, `admin-billing-history/`, `admin-billing-invoice-detail/`, `admin-billing-payment-methods/` |
| PLATFORM_SUPPORT_ACCESS | `/platform/support-access`, `/platform/support-access-grants` | UI_POLISHED | `artifacts/ui-completion/platform-support-access/`, `platform-support-access-grants/` |
| PLATFORM_BREAK_GLASS | `/platform/break-glass` | UI_POLISHED | `artifacts/ui-completion/platform-break-glass/` |
| PLATFORM_TENANTS | `/platform/tenants` and tenant detail aliases | UI_POLISHED | Authorization-isolated Platform boundary plus source-backed Tenant directory when access is granted | `artifacts/ui-completion/platform-tenants/` |
| PLATFORM_TENANT_DETAIL | `/platform/tenants/:tenantId`, `/platform/tenants/:tenantId/entitlements`, `/platform/tenants/:tenantId/invoices`, `/platform/tenants/:tenantId/payments` | UI_POLISHED | Bounded tenant detail context with explicit authorization boundary and source-backed subordinate evidence when granted | `artifacts/ui-completion/platform-tenant-detail/`, `platform-tenant-entitlements/`, `platform-tenant-invoices/`, `platform-tenant-payments/` |
| PLATFORM_PAYMENTS | `/platform/invoices`, `/platform/payments`, `/platform/payment-intents`, `/platform/reconciliation`, `/platform/refunds`, `/platform/dunning`, `/platform/reports` | UI_POLISHED | Purpose-built payment operations surface with platform authorization boundary, API-backed evidence panels and state-aware commands | `artifacts/ui-completion/platform-payments/` |
| PLATFORM_CATALOG | `/platform/plans`, `/platform/prices`, `/platform/discounts` | UI_POLISHED | Purpose-built plan, price and discount catalog with API-backed boundary/table states and guarded commands | `artifacts/ui-completion/platform-plans/`, `platform-prices/`, `platform-discounts/` |
| ADMIN_COMMUNICATION_TEMPLATES | `/admin/communications/templates` | UI_POLISHED | `artifacts/ui-completion/admin-communication-templates/` |
| ADMIN_COMMUNICATION_RULES | `/admin/communications/rules` | UI_POLISHED | `artifacts/ui-completion/admin-communications-rules/` |
| ADMIN_COMMUNICATION_SUPPRESSIONS | `/admin/communications/suppressions` | UI_POLISHED | `artifacts/ui-completion/admin-communication-suppressions/` |
| ADMIN_REVIEWS | `/admin/reviews` and review detail | UI_POLISHED | `artifacts/ui-completion/admin-reviews/` |
| ADMIN_REVIEW_REQUESTS | `/admin/review-requests` and request detail | UI_POLISHED | `artifacts/ui-completion/admin-review-requests/` |
| ADMIN_GIFT_CARD_PRODUCTS | `/admin/gift-cards/products` | UI_POLISHED | `artifacts/ui-completion/admin-gift-card-products/` |
| ADMIN_GIFT_CARD_ISSUANCE | `/admin/gift-cards/issuance` | UI_POLISHED | `artifacts/ui-completion/admin-gift-card-issuance/` |
| ADMIN_LOYALTY_PROGRAMS | `/admin/loyalty/programs` | UI_POLISHED | `artifacts/ui-completion/admin-loyalty-programs/` |
| ADMIN_LOYALTY_ADJUSTMENTS | `/admin/loyalty/adjustments` | UI_POLISHED | Vietnamese controlled-adjustment form with API-backed Customer selector and existing dual-control commands; four viewport captures in `artifacts/ui-completion/admin-loyalty-adjustments/`, Axe zero/no overflow. |
| ADMIN_PACKAGES_CATALOG | `/admin/packages/catalog` | UI_POLISHED | `artifacts/ui-completion/admin-packages-catalog/` |
| ADMIN_PACKAGES_ENTITLEMENTS | `/admin/packages/entitlements` | UI_POLISHED | `artifacts/ui-completion/admin-packages-entitlements/` |
| ADMIN_VOUCHER_CAMPAIGNS | `/admin/vouchers/campaigns` | UI_POLISHED | `artifacts/ui-completion/admin-voucher-campaigns/` |
| ADMIN_PAYROLL_RUNS | `/admin/payroll/runs` and payroll run detail | UI_POLISHED | `artifacts/ui-completion/admin-payroll-runs/` |
| ADMIN_PAYOUTS | `/admin/payouts` | UI_POLISHED | Purpose-built payout-batch directory with real API data, state-aware actions, keyboard-focusable table, and four viewport captures in `artifacts/ui-completion/admin-payouts/` with Axe zero/no overflow; same-key submit returned one effective server batch in local QA. |
| ADMIN_STAFF_LIST | `/admin/staff/list` and staff directory | UI_POLISHED | `artifacts/ui-completion/admin-staff-list/` |
| ADMIN_STAFF_NEW | `/admin/staff/new` | UI_POLISHED | Purpose-built Vietnamese profile form with API-backed account selector and stable create idempotency; four viewports captured with Axe zero/no overflow; same-key create retry returned one server ID and the local QA record was archived. |
| ADMIN_TIME_CLOCK | `/admin/time-clock` and attendance views | UI_POLISHED | `artifacts/ui-completion/admin-time-clock/` |
| ADMIN_TIME_CLOCK_SESSIONS | `/admin/time-clock/sessions` | UI_POLISHED | Purpose-built session evidence table with server timestamps, duration fields and selected-record context; four viewport captures in `artifacts/ui-completion/admin-time-clock-sessions/`. |
| ADMIN_TIME_CLOCK_EXCEPTIONS | `/admin/time-clock/exceptions` | UI_POLISHED | Purpose-built exception triage with state-aware acknowledge, resolve and waive actions; four viewport captures in `artifacts/ui-completion/admin-time-clock-exceptions/`. |
| ADMIN_TIME_CLOCK_DEVICES | `/admin/time-clock/devices` | UI_POLISHED | Purpose-built device register with safe state labels and server-owned revoke boundary; four viewport captures in `artifacts/ui-completion/admin-time-clock-devices/`. |
| ADMIN_TIMESHEETS | `/admin/timesheets` | UI_POLISHED | Purpose-built timesheet evidence table with state-aware versioned actions; four viewport captures in `artifacts/ui-completion/admin-timesheets/`. |
| ADMIN_TIMESHEET_PERIODS | `/admin/timesheet-periods` | UI_POLISHED | Purpose-built period lifecycle table with server-controlled transition boundary; four viewport captures in `artifacts/ui-completion/admin-timesheet-periods/`. |
| ADMIN_WORKFORCE_POLICIES | `/admin/workforce/policies` | UI_POLISHED | Purpose-built policy directory with real lifecycle evidence and a server-owned version-control boundary; four viewport captures in `artifacts/ui-completion/admin-workforce-policies/`. |
| ADMIN_WORKFORCE_COMPLIANCE | `/admin/workforce/compliance` | UI_POLISHED | Purpose-built time-clock exception triage with real severity/state evidence and versioned actions; four viewport captures in `artifacts/ui-completion/admin-workforce-compliance/`. |
| ADMIN_WORKFORCE_REPORTS | `/admin/workforce/reports` | UI_POLISHED | Purpose-built attendance report with real session and duration evidence; four viewport captures in `artifacts/ui-completion/admin-workforce-reports/`. |
| ADMIN_CUSTOMER_CREDIT | `/admin/customer-credit` | UI_POLISHED | `artifacts/ui-completion/admin-customer-credit/` — four viewport captures, focusable table regions, Axe zero. |
| ADMIN_GIFT_CARDS | `/admin/gift-cards` | UI_POLISHED | `artifacts/ui-completion/admin-gift-cards/` — four viewport captures, Axe zero. |
| ADMIN_BENEFITS | `/admin/benefits` | UI_POLISHED | `artifacts/ui-completion/admin-benefits/` |
| ADMIN_BENEFITS_LIABILITY | `/admin/benefits/liability` | UI_POLISHED | Vietnamese API-backed liability workspace with safe nested-value rendering; four viewport captures in `artifacts/ui-completion/admin-benefits-liability/`, Axe zero/no overflow. |
| ADMIN_BENEFITS_REPORTS | `/admin/benefits/reports` | UI_POLISHED | Vietnamese API-backed Benefit report workspace with truthful source-driven cards; four viewport captures in `artifacts/ui-completion/admin-benefits-reports/`, Axe zero/no overflow. |
| ADMIN_BENEFITS_CUSTOMERS | `/admin/benefits/customers` | UI_POLISHED | API-backed Customer Benefits directory alias; four viewport captures in `artifacts/ui-completion/admin-benefits-customers/`, Axe zero/no overflow. |
| ADMIN_MEMBERSHIP_CUSTOMERS | `/admin/membership/customers` | UI_POLISHED | API-backed Membership directory alias with server-derived tier and assignment context; four viewport captures in `artifacts/ui-completion/admin-membership-customers/`, Axe zero/no overflow. |
| ADMIN_VOUCHER_CODES | `/admin/vouchers/codes` | UI_POLISHED | `artifacts/ui-completion/admin-voucher-codes/` |
| ADMIN_VOUCHERS_ALIAS | `/admin/vouchers` | UI_POLISHED | Same API-backed VoucherHub as `/admin/vouchers/codes`; four viewport captures in `artifacts/ui-completion/admin-vouchers/`, Axe zero/no overflow. |
| ADMIN_STAFF_DETAIL | `/admin/staff/:id` | UI_POLISHED | Localized profile, assignment and skill evidence captured from a real staff record. |
| ADMIN_STAFF_PAY_PROFILE | `/admin/staff/:id/pay-profile` | UI_POLISHED | API-backed Vietnamese effective-dated pay profile with status/version evidence and stable retry idempotency; four viewports captured with Axe zero/no overflow; same-key update replay preserved one profile ID/version in local QA. |
| ADMIN_PAYROLL_RUN_DETAIL | `/admin/payroll/runs/:id` | UI_POLISHED | Real finalized run detail captured with server-provided totals. |
| ADMIN_PAYOUT_DETAIL | `/admin/payouts/:id` | UI_POLISHED | Purpose-built payout-batch detail captured with a real batch, server-backed item allocations, accessible transition rail and transition-safe state; four viewports captured with Axe zero/no overflow; same-key submit idempotency verified in local QA. |
| ADMIN_TIMESHEET_DETAIL | `/admin/timesheets/:id` | UI_POLISHED | Detail route resolves the real timesheet API with source evidence, hour buckets, truthful submission timestamps and adjustment history; four viewports captured with Axe zero/no overflow; independent approve then owner lock regression passed against the local fixture. |
| ADMIN_TIMESHEETS | `/admin/timesheets` | UI_POLISHED | Server-backed timesheet workspace captured at four viewports. |
| ADMIN_TIMESHEET_PERIODS | `/admin/timesheet-periods` | UI_POLISHED | API-backed period workspace captured at four viewports. |
| ADMIN_PAYROLL_EXCEPTIONS | `/admin/payroll/exceptions` | UI_POLISHED | API-backed exception workspace captured at four viewports. |
| ADMIN_PAYROLL_REPORTS | `/admin/payroll/reports` | UI_POLISHED | API-backed payroll report workspace captured at four viewports. |
| ADMIN_SCHEDULING_SHIFTS | `/admin/scheduling/shifts` | UI_POLISHED | Branch-scoped shift planner captured with safe assignment labels. |
| ADMIN_SCHEDULING_SHIFT_DETAIL | `/admin/scheduling/shifts/:id` | UI_POLISHED | Detail route now resolves the source detail API and was captured using a real published shift. |
| ADMIN_SCHEDULING_LEAVE_REQUESTS | `/admin/scheduling/leave-requests` | UI_POLISHED | Leave review captured with pending-only commands. |
| ADMIN_SCHEDULING_LEAVE_DETAIL | `/admin/scheduling/leave-requests/:id` | UI_POLISHED | Detail route now resolves the source detail API and was captured using a real approved request. |

## Remaining source-defined families

The remaining patterns in [`ADMIN_ROUTE_INVENTORY.md`](../agent/ADMIN_ROUTE_INVENTORY.md) are not unmapped; they are still tracked as deeper states of their owning Wave view or as dedicated refactor work. Their classification stays explicit until each state receives a real-data screenshot and responsive review.

| Family | Current classification | Next evidence |
|---|---|---|
| Customer booking contact, OTP, review, success and manage-booking mutation states | UI_POLISHED | Real state-specific booking captures are retained in the four source-specific booking directories; no booking record is invented by the UI. |
| Appointment create and mutation outcomes | UI_POLISHED | Authorized booking E2E covers create/hold/review/confirm and the state-specific mutation views; each owning route keeps server state as the source of truth. |
| POS payment, receipt and Stored Value mutation outcomes | UI_POLISHED | Authorized POS/payment/receipt and Stored Value E2E covers capture, refund, reservation, release and controlled adjustment paths; no browser-side financial mutation is used. |
| Workforce detail, scheduling, leave, timesheet, payroll detail | UI_POLISHED | Staff, payroll, scheduling and timesheet detail compositions have real-record evidence; staff create retry, pay-profile retry and timesheet approve/lock command outcomes are verified against local QA records. |
| Inventory, procurement and asset deep workflows | UI_POLISHED | Isolated inventory E2E covers receipt/transfer/adjustment/sale/refund, procurement authorization is verified, and fixed-asset lifecycle screens pass localized visual/Axe checks. |
| Accounting, tenant billing and platform detail workflows | UI_POLISHED | Wave 6 accounting/banking/billing/platform/support/analytics visual and Axe suites pass; isolated deep API tests cover tenant billing idempotency, journal approval/posting and reconciliation sums. |
| Scheduling shift and leave legacy paths | UI_POLISHED | Shift/leave list and detail routes now resolve source-backed workforce APIs with localized, state-aware compositions. |

## Route-level evidence checkpoint

The current local authenticated run produced four viewport captures for every static Admin route pattern in `docs/agent/ADMIN_ROUTE_INVENTORY.md`.

| Measure | Result |
|---|---:|
| Route patterns in inventory | 231 |
| Static route patterns | 184 |
| Evidence directories | 283 |
| Required viewport files | 1116 |
| Missing required viewport files | 0 |
| Dynamic/detail/mutation states fully exercised | PASS — authorized local QA records and isolated QA database |

Evidence is stored under `artifacts/ui-completion/<screen-id>/`. Directory names are the normalized screen identifiers used by the capture harness. The evidence count is intentionally higher than the static-route count because several customer, platform and normalized view families have their own canonical state directories.

Latest recapture set: `admin-accounting`, `admin-customer-care`, `admin-customer-credit`, the authorized Customer Engagement route, the authorized Loyalty customer route, `admin-loyalty-adjustments`, `admin-packages-entitlements`, the authorized Service Recovery detail, `admin-communications-rules`, the customer landing and payout batch directory/detail.
