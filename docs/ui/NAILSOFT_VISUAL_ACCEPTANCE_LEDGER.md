# NailSoft Visual Acceptance Ledger

This ledger records visual evidence for each completed screen. A screen is accepted only when the image was captured from the running local application and its data path is documented.

| Screen ID | Route/View | Desktop 1440 | Desktop 1280 | Tablet 768 | Mobile 390 | Evidence | Result |
|---|---|---|---|---|---|---|---|
| CUSTOMER_LANDING | `/` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-landing/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| CUSTOMER_BOOKING_BRANCH | `/book/:salonSlug` — Branch | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-branch/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| CUSTOMER_BOOKING_SERVICES | `/book/:salonSlug` — Services | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-services/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| CUSTOMER_BOOKING_STAFF | `/book/:salonSlug` — Staff preference | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-staff/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — real availability filtered to an API-backed staff preference; no slot hold created. |
| CUSTOMER_BOOKING_AVAILABILITY | `/book/:salonSlug` — Availability | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-availability/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| CUSTOMER_BOOKING_CONTACT | `/book/:salonSlug` — Contact | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-contact/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — live hold/contact flow and WCAG AA contrast verified. |
| CUSTOMER_BOOKING_OTP | `/book/:salonSlug` — OTP | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-otp/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — live verification challenge, masked destination and expiry state verified. |
| CUSTOMER_BOOKING_REVIEW | `/book/:salonSlug` — Review | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-review/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — live held booking, service, price and policy state verified. |
| CUSTOMER_BOOKING_SUCCESS | `/book/:salonSlug` — Result | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-booking-success/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — real booking result and management handoff verified. |
| CUSTOMER_MANAGE_LOOKUP | `/manage-booking` — Lookup | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-manage-booking-lookup/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — live secure lookup and neutral response. |
| CUSTOMER_MANAGE_OTP | `/manage-booking` — OTP | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-manage-booking-otp/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — live OTP challenge, masked destination and server expiry. |
| CUSTOMER_MANAGE_DETAIL | `/manage-booking` — Detail | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-manage-booking-detail/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — live booking, service, policy and truthful package empty state. |
| CUSTOMER_MANAGE_RESCHEDULE | `/manage-booking` — Reschedule | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-manage-booking-reschedule/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png`; `artifacts/ui-completion/customer-manage-booking-reschedule-review/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — live availability and server hold review. |
| CUSTOMER_MANAGE_CANCEL | `/manage-booking` — Cancel | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-manage-booking-cancel/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — real local QA cancellation and persisted terminal state. |
| CUSTOMER_PACKAGE_RESERVATION | `/manage-booking` — Package reservation | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-manage-booking-detail/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — API-backed panel shows no active entitlement when none exists; no fake reserve CTA. |
| CUSTOMER_PUBLIC_REVIEW | `/public/review` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-public-review-valid/`, `artifacts/ui-completion/customer-public-review-success/` | ACCEPTED — signed review verification, real public submission and success state captured at four viewports; Axe zero and no page-level overflow. |
| CUSTOMER_UNSUBSCRIBE | `/public/unsubscribe` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-public-unsubscribe-valid/`, `artifacts/ui-completion/customer-public-unsubscribe-success/` | ACCEPTED — signed unsubscribe entry, real consent mutation and success state captured at four viewports; Axe zero and no page-level overflow. |
| CUSTOMER_PREFERENCES | `/customer/preferences` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-preferences/` | ACCEPTED — authenticated QA customer session, real preference payload, Axe zero and no page-level overflow |
| CUSTOMER_CONSENTS | `/customer/consents` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/customer-consents/` | ACCEPTED — authenticated QA customer session, real consent payload, Axe zero and no page-level overflow |
| ADMIN_DASHBOARD | `/admin/dashboard` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-dashboard/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_MARKETING_CAMPAIGNS | `/admin/marketing/campaigns` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-marketing-campaigns/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — Axe zero/no overflow at all four viewports. |
| ADMIN_CUSTOMERS | `/admin/customers` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-customers/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_CUSTOMER_DETAIL | `/admin/customers/:customerId` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-customer-detail/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_CUSTOMER_ENGAGEMENT | `/admin/customers/:customerId/engagement` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-customer-engagement/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_CUSTOMER_CARE | `/admin/customer-care` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-customer-care/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — Axe zero/no overflow at all four viewports. |
| ADMIN_COMMUNICATION_MESSAGES | `/admin/communications/messages` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-communications-messages/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_COMMUNICATION_MESSAGE_DETAIL | `/admin/communications/messages/:id` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-communications-message-detail/` | ACCEPTED — persisted Worker-created scheduled message captured at four viewports; Axe zero and no page-level horizontal overflow. |
| ADMIN_MARKETING_SEGMENTS | `/admin/marketing/segments` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-marketing-segments/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_SERVICE_RECOVERY | `/admin/service-recovery` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-service-recovery/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_STORED_VALUE_ADJUSTMENTS | `/admin/stored-value/adjustments` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-stored-value-adjustments/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED |
| ADMIN_STORED_VALUE | `/admin/stored-value` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-stored-value/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — liability, Customer Credit and reconciliation report composition; domains and currencies remain separate. |

### Phase 2–4 route evidence

| Screen ID | Route/View | Desktop 1440 | Desktop 1280 | Tablet 768 | Mobile 390 | Evidence | Result |
|---|---|---|---|---|---|---|---|---|
| ADMIN_APPOINTMENTS | `/admin/appointments` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-appointments/` | ACCEPTED |
| ADMIN_AVAILABILITY | `/admin/availability` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-availability/` | ACCEPTED |
| ADMIN_OPERATIONS | `/admin/operations` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-operations/` | ACCEPTED |
| ADMIN_POS | `/admin/pos` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-pos/` | ACCEPTED |
| ADMIN_ANALYTICS | `/admin/analytics` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-analytics/` | ACCEPTED |
| ADMIN_INVENTORY | `/admin/inventory` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-inventory/` | ACCEPTED |
| ADMIN_ASSETS | `/admin/assets` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-assets/` | ACCEPTED |
| ADMIN_PROCUREMENT | `/admin/procurement` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-procurement/` | ACCEPTED |
| ADMIN_FINANCIAL | `/admin/financial` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-financial/` | ACCEPTED |
| ADMIN_FINANCIAL_INVOICES | `/admin/financial/invoices` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-financial-invoices/` | ACCEPTED |
| ADMIN_ACCOUNTING | `/admin/accounting` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-accounting/` | ACCEPTED |
| ADMIN_PROFILE | `/admin/profile` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-profile/` | ACCEPTED |
| ADMIN_ORGANIZATION_BRANCHES | `/admin/organization/branches` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-organization-branches/` | ACCEPTED |
| ADMIN_TEAM_USERS | `/admin/team/users` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-team-users/` | ACCEPTED |
| ADMIN_SECURITY_SESSIONS | `/admin/security/sessions` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-security-sessions/` | ACCEPTED |
| ADMIN_SUPPORT_ACCESS | `/admin/support-access` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-support-access/` | ACCEPTED |
| PLATFORM_TENANTS | `/platform/tenants` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/platform-tenants/` | ACCEPTED |
| ADMIN_COMMUNICATION_TEMPLATES | `/admin/communications/templates` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-communication-templates/` | ACCEPTED |
| ADMIN_COMMUNICATION_RULES | `/admin/communications/rules` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-communications-rules/` | ACCEPTED |
| ADMIN_COMMUNICATION_SUPPRESSIONS | `/admin/communications/suppressions` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-communication-suppressions/` | ACCEPTED |
| ADMIN_REVIEWS | `/admin/reviews` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-reviews/` | ACCEPTED |
| ADMIN_REVIEW_REQUESTS | `/admin/review-requests` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-review-requests/` | ACCEPTED |
| ADMIN_GIFT_CARD_PRODUCTS | `/admin/gift-cards/products` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-gift-card-products/` | ACCEPTED |
| ADMIN_GIFT_CARD_ISSUANCE | `/admin/gift-cards/issuance` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-gift-card-issuance/` | ACCEPTED |
| ADMIN_LOYALTY_PROGRAMS | `/admin/loyalty/programs` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-loyalty-programs/` | ACCEPTED |
| ADMIN_PACKAGES_CATALOG | `/admin/packages/catalog` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-packages-catalog/` | ACCEPTED |
| ADMIN_PACKAGES_ENTITLEMENTS | `/admin/packages/entitlements` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-packages-entitlements/` | ACCEPTED |
| ADMIN_VOUCHER_CAMPAIGNS | `/admin/vouchers/campaigns` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-voucher-campaigns/` | ACCEPTED |
| ADMIN_PAYROLL_RUNS | `/admin/payroll/runs` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-payroll-runs/` | ACCEPTED |
| ADMIN_STAFF_LIST | `/admin/staff/list` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-staff-list/` | ACCEPTED |
| ADMIN_TIME_CLOCK | `/admin/time-clock` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-time-clock/` | ACCEPTED |
| ADMIN_TIME_CLOCK_SESSIONS | `/admin/time-clock/sessions` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-time-clock-sessions/` | ACCEPTED |
| ADMIN_TIME_CLOCK_EXCEPTIONS | `/admin/time-clock/exceptions` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-time-clock-exceptions/` | ACCEPTED |
| ADMIN_TIME_CLOCK_DEVICES | `/admin/time-clock/devices` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-time-clock-devices/` | ACCEPTED |
| ADMIN_TIMESHEETS | `/admin/timesheets` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-timesheets/` | ACCEPTED |
| ADMIN_TIMESHEET_PERIODS | `/admin/timesheet-periods` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-timesheet-periods/` | ACCEPTED |
| ADMIN_WORKFORCE_POLICIES | `/admin/workforce/policies` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-workforce-policies/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — source-backed read-only policy directory; unsupported version mutation is not exposed. |
| ADMIN_WORKFORCE_COMPLIANCE | `/admin/workforce/compliance` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-workforce-compliance/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — source-backed exception triage; local acknowledge → resolve command QA passed. |
| ADMIN_WORKFORCE_REPORTS | `/admin/workforce/reports` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-workforce-reports/desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, `mobile-390.png` | ACCEPTED — source-backed attendance sessions and duration evidence; read-only boundary is intentional. |
| ADMIN_CUSTOMER_CREDIT | `/admin/customer-credit` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-customer-credit/` | ACCEPTED — Axe zero/no overflow at all four viewports. |
| ADMIN_GIFT_CARDS | `/admin/gift-cards` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-gift-cards/` | ACCEPTED — Axe zero/no overflow at all four viewports. |
| ADMIN_BENEFITS | `/admin/benefits` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-benefits/` | ACCEPTED |
| ADMIN_BENEFITS_CUSTOMERS | `/admin/benefits/customers` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-benefits-customers/` | ACCEPTED — API-backed Customer Benefits directory alias; Axe zero and no page-level overflow at all four viewports. |
| ADMIN_MEMBERSHIP_CUSTOMERS | `/admin/membership/customers` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-membership-customers/` | ACCEPTED — API-backed Membership directory alias; Axe zero and no page-level overflow at all four viewports. |
| ADMIN_VOUCHER_CODES | `/admin/vouchers/codes` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-voucher-codes/` | ACCEPTED |
| ADMIN_FINANCIAL_REFUNDS | `/admin/financial/refunds` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-financial-refunds/` | ACCEPTED |
| ADMIN_FINANCIAL_NET_SALES | `/admin/financial/net-sales` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-financial-net-sales/` | ACCEPTED |
| ADMIN_COMMISSION | `/admin/commission` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-commission/` | ACCEPTED |
| ADMIN_COMMISSION_ENTRIES | `/admin/commission/entries` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-commission-entries/` | ACCEPTED |
| ADMIN_CREDIT_NOTES | `/admin/credit-notes` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-credit-notes/` | ACCEPTED |
| ADMIN_COMMISSION_RULES | `/admin/commission/rules` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-commission-rules/` | ACCEPTED |
| ADMIN_COMMISSION_RULE_NEW | `/admin/commission/rules/new` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-commission-rules-new/` | ACCEPTED |
| ADMIN_FINANCIAL_EXPORTS | `/admin/financial/exports` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-financial-exports/` | ACCEPTED |
| ADMIN_FINANCIAL_REFUNDS | `/admin/financial/refunds` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-financial-refunds/` | ACCEPTED |
| ADMIN_COMMISSION_PERIODS | `/admin/commission/periods` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-commission-periods/` | ACCEPTED |
| ADMIN_COMMISSION_PERIOD_DETAIL | `/admin/commission/periods/:id` | PASS | PASS | PASS | PASS | `artifacts/ui-completion/admin-commission-period-detail-b2000000-0000-4000-8000-000000000001/` | ACCEPTED |

## Acceptance notes

- Customer screenshots were captured from local `booking-web` with the real public salon API; Admin screenshots were captured from the authenticated local `admin-web` against the running API.
- The availability screenshot intentionally shows the server-returned empty state for the selected date and branch.
- No customer name, booking code, appointment, price or slot was hardcoded for visual matching.
- Customer mutation states and deeper Admin detail/command routes stay pending until they receive their own evidence; normalized primary views are accepted only with four viewport captures.

## Current worktree capture checkpoint

- `artifacts/ui-completion/` contains **283** route/view evidence directories.
- **279** route/view evidence directories have the four required captures: `desktop-1440.png`, `desktop-1280.png`, `tablet-768.png`, and `mobile-390.png` (**1116 four-viewport files**); four booking-flow state directories and one legacy customer-landing directory retain their source-specific extra layout captures.
- The 184 static Admin route patterns in the current route inventory each have a dedicated evidence directory. Dynamic `:id` and mutation states remain classified separately until an authorized real record/state is available.
- The latest shared-workspace recapture includes Workforce, Inventory, Billing/Platform, Catalog and customer-benefit routes after localization and identifier-masking fixes. Screenshots were reviewed from the running authenticated local app; baselines were not changed.
- Empty, forbidden and unavailable states are accepted only when returned by the live API. No screenshot business records are embedded in the UI.
- Latest capture checkpoint: Voucher directory/campaign screens and Customer creation were recaptured after the safe-reference and customer-code display refinements. Admin was restarted on the same local port after an isolated build temporarily left the previous dev process unhealthy; API and booking processes remained running.
- Latest capture checkpoint: Customer Care, Store Credit, Loyalty customer, Package entitlements, Service Recovery detail and Communication Rules were recaptured after UUID masking, API-backed Email template selection, Vietnamese source/status labels and the Email-only capability label were refined.
- Latest capture checkpoint: Accounting Journals, POS, Scheduling Shifts/Leave, Communication Templates/Rules/Messages/Suppressions, Voucher alias, Loyalty adjustments/programs, Benefit liability/reports, Customer Benefits alias and Membership Customers alias were recaptured at four viewports; all reviewed captures have Axe zero and no page-level width overflow.
- Latest capture checkpoint: `/admin/dashboard` was recaptured at four viewports after the visible heading and dashboard palette were corrected; all four captures report zero Axe violations and no page-level width overflow. `/admin/catalog/categories/new` was also captured at four viewports with the route-specific “Thêm nhóm dịch vụ” heading and no write performed.
- These recaptures keep the live API data and four viewport evidence requirement; no baseline snapshot was changed.
