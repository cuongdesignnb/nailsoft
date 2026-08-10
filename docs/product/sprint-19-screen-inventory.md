# Sprint 19 Screen Inventory

Start checkpoint: `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e`
Current phase: Wave 7 accepted against source CI; Wave 8 not authorized
Source: Sprint 19 BA/PO handoff plus routes present in the repository.

## Inventory rules

- A screen is an independently accepted user experience, not a source file.
- A catch-all route is split into screen IDs when data, permission, primary action or responsive behavior differs.
- Aliases may be grouped only when renderer, authorization and data are identical.
- Inventory/Procurement Operator is a usability persona mapped to existing granular permissions. It is not a new role or migration.
- Every row records app, route, persona, permission, branch scope, API dependency, state coverage, breakpoint matrix and evidence.

## Wave 0 foundations

| ID | Screen or foundation | App | Route | Persona | Permission and scope | API dependency | States | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.0.1 | Screen inventory | Shared | Documentation | Delivery | N/A | N/A | Ready | All | In progress |
| 19.0.2 | Role usability matrix | Shared | Documentation | All personas | N/A | N/A | Ready | All | In progress |
| 19.0.3 | Semantic design tokens | Shared | Package gallery | All authenticated users | Client presentation | N/A | Ready | All | In progress |
| 19.0.4 | Typography and formatters | Shared | Package gallery | All authenticated users | Client presentation | N/A | Ready | All | In progress |
| 19.0.5 | Forms and validation | Web and Mobile | Package gallery | All authenticated users | Existing endpoint permissions | Existing APIs | Loading, ready, error | All | In progress |
| 19.0.6 | Buttons and actions | Web and Mobile | Package gallery | All authenticated users | Existing endpoint permissions | Existing APIs | Ready, forbidden | All | In progress |
| 19.0.7 | Tables and responsive lists | Web and Mobile | Package gallery | All authenticated users | Existing endpoint permissions | Existing APIs | Empty, ready, error | All | In progress |
| 19.0.8 | Modal, drawer, toast and banner | Web and Mobile | Package gallery | All authenticated users | Existing endpoint permissions | Existing APIs | Ready, keyboard | All | In progress |
| 19.0.9 | UI state panels | Web and Mobile | Package gallery | All authenticated users | Existing endpoint permissions | Existing APIs | Loading, empty, error, retry, forbidden, stale, offline, partial | All | In progress |
| 19.0.10 | Charts and table fallback | Web and Mobile | Package gallery | Owner, Manager, Accountant | Existing analytics permissions | Existing analytics APIs | Loading, empty, ready | All | In progress |
| 19.0.11 | Component gallery | Admin Web | `/admin/design-system` | Developer and test operator | Development/test configuration | `/v1/auth/context` | Full state gallery | 1440, 1280, 1024, 768, 390, 360 | In progress |
| 19.0.12 | Admin shell | Admin Web | `/admin/**` | Role adaptive | Effective server permissions and branch scope | `/v1/auth/context` | Loading, ready, forbidden, retry | 1440, 1280, 1024, 768, 390, 360 | In progress |
| 19.0.13 | Mobile shell | Owner and Staff Mobile | `/` and tab routes | Owner, Technician | Effective server permissions and own staff scope | `/v1/auth/context` | Loading, ready, forbidden, offline | 390, 360, Expo Web | In progress |

## Wave 1 — Booking and daily salon operations

Wave 1 keeps the existing business contracts and route families. The four
overview surfaces below use the Wave 1 API-backed presentation layer; command
surfaces continue to use the accepted Sprint 3–5 domain components and APIs.

Final source validation is commit
`5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e`, validated by full CI run
`30985009361` with conclusion `SUCCESS`. Every Wave 1 row below is
`TARGET_STATE=REDESIGNED`, `IMPLEMENTATION_STATE=API_BACKED`, and
`ACCEPTANCE_STATE=ACCEPTED`.

```text
SOURCE_SHA=5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e
CI_RUN=30985009361
CI_CONCLUSION=SUCCESS
```

## Wave 6 — Accounting, platform billing and analytics (accepted)

Wave 6 starts from `290e9ae24775ad89ffc9af9e982dad161878633a`. Phase 0A
hardens Support Access to a target-tenant boundary and Phase 0B adds the
approved read-only projections. Final source commit
`c3c46ab5e7cbf9b970e2fcd52836c7025c60cccc` was validated by full CI run
`31302322332` with conclusion `SUCCESS`. The documentation commit created
after this validation is not the source commit validated by that run.

| ID | Screen | Route | Persona | Permission / scope | API dependency | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 19.6.1 | Accounting control center | `/admin/accounting` | Accountant, Owner | `accounting.book.read`; tenant | `/v1/accounting/books` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.2 | Books & chart | `/admin/accounting/books` | Accountant | `accounting.account.read`; tenant | `/v1/accounting/accounts` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.3 | Accounting periods | `/admin/accounting/periods` | Accountant | `accounting.period.read`; tenant | `/v1/accounting/periods` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.4 | Journal workbench | `/admin/accounting/journals` | Accountant | `accounting.journal.*`; tenant | `/v1/accounting/journals` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.5 | Posting queue | `/admin/accounting/posting-candidates` | Accountant | `accounting.posting.read`; tenant | `/v1/accounting/posting-candidates` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.6 | Open items | `/admin/accounting/open-items` | Accountant | `accounting.open_item.read`; tenant | `/v1/accounting/open-items` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.7 | Financial reports | `/admin/accounting/reports` | Accountant, Owner | `accounting.report.read`; tenant | `/v1/accounting/reports` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.8 | Bank accounts & imports | `/admin/accounting/reconciliation` | Accountant | `accounting.bank_account.read`; tenant | `/v1/accounting/bank-accounts` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.9 | Statement lines & matching | `/admin/accounting/reconciliation/statement-lines` | Accountant | bank reconciliation; tenant | `/v1/accounting/bank-accounts/:id/statement-lines`, `/v1/accounting/bank-matches` | REDESIGNED / API_BACKED / ACCEPTED; exclusion deferred; source `c3c46ab5`; CI `31302322332` |
| 19.6.10 | Reconciliation & exceptions | `/admin/accounting/reconciliation/exceptions` | Accountant | `accounting.bank_reconciliation.read`; tenant | `/v1/accounting/reconciliation-exceptions` | REDESIGNED / API_BACKED / ACCEPTED; adjustment deferred; source `c3c46ab5`; CI `31302322332` |
| 19.6.11 | Statement snapshots | `/admin/accounting/statement-snapshots` | Accountant | `accounting.report.read`; tenant | `/v1/accounting/statement-snapshots` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.12 | Billing overview | `/admin/billing` | Owner | `tenant.billing.read`; tenant | `/v1/tenant/billing/subscription` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.13 | Subscription | `/admin/billing/subscription` | Owner | `tenant.billing.manage`; tenant | `/v1/tenant/billing/subscription` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.14 | Plans, entitlements & usage | `/admin/billing/usage` | Owner | `tenant.billing.read`; tenant | `/v1/tenant/billing/usage` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.15 | Invoices & history | `/admin/billing/invoices` | Owner | `tenant.billing.read`; tenant | `/v1/tenant/billing/invoices` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.16 | Invoice detail | `/admin/billing/invoices/:id` | Owner | `tenant.billing.read`; tenant | `/v1/tenant/billing/invoices/:id` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.17 | Payment methods | `/admin/billing/payment-methods` | Owner | `tenant.billing.read`; tenant | `/v1/tenant/billing/payment-methods` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.18 | Tenant support access | `/admin/support-access` | Owner, Manager | tenant support grant permissions | `/v1/tenant/support-access-grants` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.19 | Plan/price/discount catalog | `/platform/plans`, `/platform/prices`, `/platform/discounts` | Platform Admin | platform plan/price read; global | `/v1/platform/plans`, `/v1/platform/prices`, `/v1/platform/discounts` | REDESIGNED / API_BACKED / ACCEPTED; discount mutation deferred; source `c3c46ab5`; CI `31302322332` |
| 19.6.20 | Tenant directory | `/platform/tenants` | Platform Admin, Support | platform tenant read; support target only | `/v1/platform/tenants` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.21 | Tenant detail & lifecycle | `/platform/tenants/:id` | Platform Admin, Support | tenant-targeted platform read | `/v1/platform/tenants/:id` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.22 | Tenant subscription | `/platform/tenants/:id/subscription` | Platform Admin, Support | subscription read; target tenant | `/v1/platform/tenants/:id/subscription` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.23 | Tenant entitlements & usage | `/platform/tenants/:id/entitlements` | Platform Admin, Support | subscription/usage read; target tenant | `/v1/platform/tenants/:id/entitlements` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.24 | Tenant invoices & payments | `/platform/tenants/:id/invoices` | Platform Admin, Support | invoice/payment read; target tenant | `/v1/platform/tenants/:id/invoices`, `/v1/platform/tenants/:id/payments` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.25 | Platform invoice/payment operations | `/platform/invoices`, `/platform/payments` | Platform Admin | platform invoice/payment; global or target | `/v1/platform/invoices`, `/v1/platform/payment-intents` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.26 | Refund & reconciliation | `/platform/refunds`, `/platform/reconciliation` | Platform Admin | payment read/reconcile; global or target | `/v1/platform/refunds`, `/v1/platform/reconciliation` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.27 | Dunning & platform reports | `/platform/dunning`, `/platform/reports` | Platform Admin | invoice/tenant read; SaaS-only | `/v1/platform/dunning`, `/v1/platform/reports` | REDESIGNED / API_BACKED / ACCEPTED; manual dunning deferred; source `c3c46ab5`; CI `31302322332` |
| 19.6.28 | Platform support access | `/platform/support-access` | Platform Admin | `platform.support_grant.*`; global or current grant | `/v1/platform/support-access-grants` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.29 | Break-glass safety | `/platform/break-glass` | Platform Admin | support grant read | `/v1/platform/break-glass` | REDESIGNED / API_BACKED / ACCEPTED; disabled foundation; source `c3c46ab5`; CI `31302322332` |
| 19.6.30 | Analytics command center | `/admin/analytics` | Owner, Manager | `analytics.dashboard.read`; tenant/branch | `/v1/analytics/command-center` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.31 | Sales analytics | `/admin/analytics/sales` | Owner, Manager | `analytics.sales.read`; tenant/branch | `/v1/analytics/trends`, `/v1/analytics/services` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.32 | Booking analytics | `/admin/analytics/bookings` | Owner, Manager | `analytics.booking.read`; tenant/branch | `/v1/analytics/bookings` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.33 | Staff analytics | `/admin/analytics/staff` | Owner, Manager, Technician | `analytics.staff.read` or personal; scope | `/v1/analytics/staff`, `/v1/analytics/staff/me` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |
| 19.6.34 | Data quality, alerts, exports & rebuilds | `/admin/analytics/data-quality` | Owner, Accountant | analytics data-quality/export/rebuild permissions | `/v1/analytics/data-quality`, `/v1/analytics/alerts`, `/v1/analytics/exports`, `/v1/analytics/rebuilds` | REDESIGNED / API_BACKED / ACCEPTED; source `c3c46ab5`; CI `31302322332` |

```text
WAVE_6_STATUS=COMPLETED
WAVE_6_STARTED=YES
SPRINT_19_STATUS=IN_PROGRESS
WAVE_7_STARTED=NO
WAVE_7_AUTHORIZED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

| ID | Screen | App | Route | Persona | Permission and scope | API dependency | States | Breakpoints | Evidence / status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.1.1 | Today dashboard | Admin Web | `/admin/dashboard` | Owner, Manager, Receptionist | `operations.board.read`, branch scope | `/v1/operations/summary`, `/v1/operations/board` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | `tests/e2e/sprint19-wave1-booking-operations.spec.ts`; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.2 | Booking calendar day/week | Admin Web | `/admin/calendar/day`, `/admin/calendar/week` | Owner, Manager, Receptionist | `calendar.*`, branch scope | `/v1/calendar/events` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | Wave 1 E2E; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.3 | Booking list | Admin Web | `/admin/appointments` | Owner, Manager, Receptionist | `appointment.read`, branch scope | `/v1/appointments` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | Wave 1 E2E; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.4 | Create booking | Admin Web | `/admin/appointments/new` | Receptionist, Manager | `appointment.create`, branch scope | Booking/availability APIs | Loading, validation, conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Sprint 4 flow + Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.5 | Booking details | Admin Web | `/admin/appointments/:id/overview` | Owner, Manager, Receptionist, Technician | appointment read with branch/own-staff scope | Appointment detail API | Loading, ready, not found, forbidden, retry | 1440, 1280, 1024, 768, 390, 360 | Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.6 | Reschedule booking | Booking Web | `/manage-booking` (reschedule flow) | Customer, Receptionist | Public token or appointment scope | Public booking search, availability, hold/booking APIs | Loading, validation, no-slot, conflict, retry, success | 1440, 1280, 1024, 768, 390, 360 | Public booking E2E; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.7 | Cancel / no-show action surface | Admin Web | `/admin/appointments/:id/cancel` | Manager, Receptionist | `appointment.cancel`; no-show remains policy-gated | Appointment command API | Loading, reason validation, forbidden, conflict, success/error | 1440, 1280, 1024, 768, 390, 360 | Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED (no-show command unchanged) |
| 19.1.8 | Availability search | Admin Web | `/admin/availability/search` | Receptionist, Manager | `availability.read`, branch scope | `/v1/availability` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | Wave 1 E2E; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.9 | Busy block | Admin Web | `/admin/scheduling/blocks` | Manager, Owner | `availability.block.manage`, branch scope | `/v1/availability-blocks` | Loading, validation, conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.10 | Walk-in creation | Admin Web | `/admin/operations/walk-ins/new` | Receptionist, Manager | `walkin.create`, branch scope | `/v1/walk-ins` | Loading, validation, ETA empty/error, forbidden, success | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.11 | Queue board | Admin Web | `/admin/operations/board`, `/admin/operations/walk-ins` | Receptionist, Manager | `operations.board.read`, `walkin.read`, branch scope | Operations/walk-in APIs + realtime refetch | Loading, empty, error/retry, forbidden, stale/offline | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.12 | Check-in | Admin Web | `/admin/appointments/:id/check-in` | Receptionist, Manager | `appointment.check_in`, branch scope | Arrival/check-in APIs | Loading, early/late warning, validation, conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.13 | Service session workspace | Admin Web / Staff Mobile | `/admin/appointments/:id/execution`, `/admin/service-sessions/:id` | Technician, Manager | `service_session.read_own`/`read_branch`, own-staff/branch scope | Service session command APIs | Loading, ready, empty, forbidden, offline, version conflict, retry | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.14 | Add-service approval | Admin Web | `/admin/appointments/:id/add-service` | Receptionist, Technician, Manager | `service_session.add_service`, branch scope | Add-service plan/hold/commit APIs | Loading, validation, availability conflict, approval, forbidden, retry | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.15 | Staff assignment | Admin Web | appointment execution detail | Manager, Receptionist, Technician | Existing staff/assignment permissions and scope | Appointment/service-session assignment APIs | Loading, empty, conflict, forbidden, retry | 1440, 1280, 1024, 768, 390, 360 | Assignment API and authorization evidence; REDESIGNED / API_BACKED / ACCEPTED |
| 19.1.16 | Staff transfer and segment assignment | Admin Web / Staff Mobile | `/admin/service-sessions/:id` | Manager, Technician | `service_session.transfer_staff`, branch/own-staff scope | Transfer command and realtime refetch | Loading, validation, busy/skill conflict, version conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Transfer API, segment history and authorization evidence; REDESIGNED / API_BACKED / ACCEPTED |

Evidence for this wave is targeted E2E and local QA recorded in the Wave 1
report. No unverified screenshot is claimed as acceptance evidence.

## Business route inventory for later waves

## Wave 2 — POS, payment and cash operations (accepted)

Wave 2 keeps the existing Sprint 6–7 APIs and permission guards. The new
Admin Web surface is additive and server-authoritative; no migration or
business state-machine change is part of this wave. Each row is tracked
separately even where the catch-all route shares a renderer.

Final Wave 2 source validation is commit
`83474b1f12c107292b0b4144923b16edff39a720`, validated by full CI run
`31085184446` with conclusion `SUCCESS`. The documentation commit that follows
is not the source commit validated by that CI run.

| ID | Screen | App | Route | Persona | Permission / scope | API dependency | Required states | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.2.1 | POS home and register context | Admin Web | `/admin/pos` | Owner, Manager, Cashier, Receptionist | `financial.summary.read`, `cash_session.read`, branch | summary, orders, cash sessions | loading, ready, empty, retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.2 | Open and held orders | Admin Web | `/admin/pos/orders` | Cashier, Receptionist, Manager | `pos.order.read`, branch | `/v1/pos-orders` | loading, empty, retry, forbidden, stale | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.3 | New sale workspace | Admin Web | `/admin/pos/new` | Cashier, Receptionist | `pos.order.create`, branch | appointment POS order command | loading, validation, conflict, success | 1440, 1024, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.4 | Customer and appointment linking | Admin Web | `/admin/pos/new`, `/admin/pos/checkout/:id` | Cashier, Receptionist | appointment/POS scope | appointment detail, POS order creation | loading, not found, forbidden, retry | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.5 | Service and retail cart | Admin Web | `/admin/pos/orders/:id` | Cashier, Receptionist | `pos.order.update`, branch | POS order detail/line/recalculate | loading, empty, validation, version conflict | 1440, 1024, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.6 | Discount, tax, tip and approval | Admin Web | `/admin/pos/orders/:id` | Cashier, Manager | `pos.discount.*`, `pos.tip.set` | discount, tip, server totals | pending approval, success, error, conflict | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.7 | Checkout summary | Admin Web | `/admin/pos/orders/:id/payment` | Cashier, Manager | `payment.capture_cash`, branch | order detail/payment | loading, review, invalid, conflict | 1440, 1024, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.8 | Split tender payment | Admin Web | `/admin/pos/orders/:id/payment` | Cashier, Manager | payment tender permissions | POS payment command | submitting, success, failed, unknown, retry | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.9 | Payment result and recovery | Admin Web | `/admin/pos/orders/:id/payment` | Cashier, Manager | payment read/command scope | POS order/payment detail | processing, failed, unknown, requires action | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.10 | Invoice and receipt | Admin Web | `/admin/pos/orders/:id/receipt`, `/admin/financial/invoices` | Cashier, Accountant, Manager | `invoice.read`, `invoice.print` | invoice print/detail | loading, immutable ready, forbidden, retry | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.11 | Register assignment and open | Admin Web | `/admin/pos/registers`, `/admin/pos/cash-sessions/open` | Cashier, Manager | `cash_session.read/open`, device/branch | registers, cash session open | loading, validation, conflict, forbidden | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.12 | Cash drawer and movements | Admin Web | `/admin/pos/cash-sessions/:id` | Cashier, Manager | `cash_session.read/move_cash`, session ownership | session, movements, move command | loading, empty, validation, conflict | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.13 | Blind count and register close | Admin Web | `/admin/pos/cash-sessions/:id/close` | Cashier, Manager | `cash_session.begin_close/declare/close` | closing review, declare, close | blind, pending review, conflict, success | 1280, 768, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.14 | Variance review and reconciliation | Admin Web | `/admin/pos/cash-sessions/:id/close`, `/admin/financial/reconciliation` | Manager, Owner, Accountant | `cash_session.approve_variance`, financial read | closing review, reconciliation | loading, variance, approval, forbidden | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.15 | Refund initiation | Admin Web | `/admin/refunds/new` | Manager, Owner, Cashier (request) | `refund.request`, branch | refund plan/create | validation, policy window, error, success | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.16 | Refund allocation and review | Admin Web | `/admin/refunds`, `/admin/refunds/:id` | Manager, Owner | `refund.read/approve`, branch | refund list/detail/commands | loading, empty, approval, conflict, retry | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.17 | Credit note and refund detail | Admin Web | `/admin/credit-notes`, `/admin/credit-notes/:id` | Manager, Accountant, Owner | `credit_note.read/print`, branch | credit-note detail/delivery | loading, immutable ready, forbidden, retry | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |
| 19.2.18 | Tip and commission reversal evidence | Admin Web | `/admin/commission`, `/admin/commission/adjustments` | Manager, Owner, Accountant | commission read/adjustment permissions | commission entries/adjustments | loading, empty, approval, forbidden | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `83474b1f`; CI `31085184446` |

The following route families remain planned for later waves. Wave 2 and Wave 4
rows above are accepted; Wave 6 and later screens remain unauthorized.

| Wave | Route family | Screen IDs | Primary personas | Permission examples |
| --- | --- | --- | --- | --- |
| 1 | Booking and daily operations | 19.1.1-19.1.16 | Owner, Manager, Receptionist, Technician | `calendar.*`, `appointment.*`, `operations.*`, `walkin.*` |
| 2 | POS, payment and cash | 19.2.1-19.2.18 | Receptionist, Cashier, Manager, Accountant | `pos.*`, `payment.*`, `invoice.*`, `cash_session.*` |
| 3 | Customers, loyalty and engagement | 19.3.1-19.3.15 | Receptionist, Owner, Marketing | `customer.*`, `loyalty.*`, `membership.*`, `marketing.*` |
| 4 | Staff, workforce and payroll | 19.4.1-19.4.14 | Owner, Manager, Accountant, Technician | `staff.*`, `shift.*`, `leave.*`, `payroll.*` |
| 5 | Inventory, procurement and assets | 19.5.1-19.5.36 | Inventory/Procurement Operator, Manager, Accountant | `inventory.*`, `procurement.*`, `asset.*` |
| 6 | Accounting, platform billing and analytics | 19.6.1-19.6.34 | Accountant, Owner, Platform Support | `accounting.*`, `bank.*`, `analytics.*` |
| 7 | Public Booking Web | 19.7.1-19.7.13 | Customer | Public booking contract |
| 8 | Owner Mobile | 19.8.1-19.8.12 | Owner | Effective owner permissions |
| 9 | Staff Mobile | 19.9.1-19.9.10 | Technician | Own staff and assigned-session scope |

Total planned units: 180 (13 foundations and 167 business screens, including
separately tracked staff assignment and transfer units).

## Wave 4 — Staff, workforce and payroll (accepted)

The Wave 4 Admin Web renderer is API-backed and preserves existing Sprint 2 and
Sprint 12 contracts. All rows below are accepted against the exact source CI
evidence.

Final Wave 4 source validation is commit
`e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6`, validated by full CI run
`31184779182` with conclusion `SUCCESS`.

The documentation commit that follows is not the source commit validated by
that CI run.

| ID | Screen | Route | Persona | Permission / scope | API dependency | Required states | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 19.4.1 | Staff directory and create | `/admin/staff/list`, `/admin/staff/new` | Owner, Manager | `staff.read`, `staff.create`; tenant/branch | `/v1/staff` | loading, empty, retry, forbidden, validation, success | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.2 | Staff profile, branches and skills | `/admin/staff/:id` | Owner, Manager | `staff.read`, assignment scope | staff profile/branch/skill APIs | loading, error, forbidden, version conflict | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.3 | Shift planner | `/admin/scheduling/shifts` | Owner, Manager, Receptionist | `shift.*`; branch | `/v1/shifts` | loading, empty, validation, conflict, success | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.4 | Leave review | `/admin/scheduling/leave-requests` | Owner, Manager | `leave.read_branch`, `leave.review_branch` | `/v1/leave-requests` | loading, empty, forbidden, state conflict | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.5 | Live clock and sessions | `/admin/time-clock`, `/admin/time-clock/sessions` | Manager, Technician | `time_clock.*`; branch/own staff | `/v1/time-clock` | loading, empty, retry, forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.6 | Attendance exceptions and devices | `/admin/time-clock/exceptions`, `/admin/time-clock/devices` | Manager | `time_clock.exception.*`, device scope | `/v1/time-clock/exceptions`, `/v1/time-clock/devices` | loading, action feedback, forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.7 | Timesheets and periods | `/admin/timesheets`, `/admin/timesheet-periods` | Manager, Accountant | `timesheet.*`; branch | `/v1/timesheets`, `/v1/timesheet-periods` | loading, empty, lock/review states | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.8 | Workforce policies, compliance and reports | `/admin/workforce/**` | Owner, Manager, Accountant | `workforce.policy.*`, report scope | workforce compliance/report APIs | loading, empty, forbidden, retry | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.9 | Staff pay profile | `/admin/staff/:id/pay-profile` | Owner, Accountant | `pay_profile.*`; tenant/staff | pay profile API | loading, validation, version conflict, success | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.10 | Payroll calendars and periods | `/admin/payroll/calendars`, `/admin/payroll/periods` | Owner, Accountant | `payroll.calendar.*`, period scope | payroll calendar/period APIs | loading, empty, validation, forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.11 | Payroll runs and exceptions | `/admin/payroll/runs`, `/admin/payroll/exceptions` | Owner, Accountant | payroll run/exception permissions | payroll run/exception APIs | loading, immutable states, conflict, retry | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.12 | Pay statements and reports | `/admin/payroll/statements`, `/admin/payroll/reports` | Owner, Accountant, Technician | statement/report read scope | statements/report APIs | loading, empty, privacy/forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.13 | Payout batches | `/admin/payouts`, `/admin/payouts/:id` | Owner, Accountant | payout dual-control scope | payout batch APIs | loading, approval, processing, error | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |
| 19.4.14 | Payout reconciliation | `/admin/payout-reconciliation` | Owner, Accountant | reconciliation scope | reconciliation API | loading, empty, variance, forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `e257d0cc`; CI `31184779182` |

```text
WAVE_4_SOURCE_SHA=e257d0ccd5ee4601051f5df670f43c5ca0e7f0c6
WAVE_4_CI_RUN_ID=31184779182
WAVE_4_CI_CONCLUSION=SUCCESS

SCREEN_ROWS_19_4_1_TO_19_4_14=ALL_ACCEPTED

STAFF_WORKSPACE=ACCEPTED
SCHEDULING_WORKSPACE=ACCEPTED
ATTENDANCE_WORKSPACE=ACCEPTED
TIMESHEET_WORKSPACE=ACCEPTED
WORKFORCE_COMPLIANCE=ACCEPTED
PAY_SETUP=ACCEPTED
PAYROLL_WORKSPACE=ACCEPTED
PAYOUT_WORKSPACE=ACCEPTED

WAVE_4_STATUS=COMPLETED
WAVE_5_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Wave 3 Cluster 2 implementation ledger

Cluster 2 implements the Admin Web benefits, loyalty, membership and package
surfaces with the existing Sprint 8 API contracts. POS benefit routes remain
owned by the Sprint 8 renderer. Final source validation is commit
`638831f2021c4994a838eb19e213e3744381ee2b`, validated by full CI run
`31168662060` with conclusion `SUCCESS`.

| ID | Screen | Route | Permission / scope | API dependency | Required states | Status |
| --- | --- | --- | --- | --- | --- |
| 19.3.6 | Customer benefits wallet | `/admin/benefits`, `/admin/benefits/customers/:customerId` | Existing benefits permissions; tenant/customer scope | loyalty, membership, voucher and package read APIs | loading, ready, empty, retry, forbidden, partial | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.7 | Loyalty program, adjustment and ledger | `/admin/loyalty/programs`, `/admin/loyalty/adjustments`, `/admin/loyalty/customers/:customerId` | `loyalty.*`; tenant/customer scope; independent approval | loyalty program/account/ledger/adjustment APIs | validation, submitting, success, error, version conflict, forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.8 | Membership tiers and customer history | `/admin/membership/tiers`, `/admin/membership/customers/:customerId` | `membership.*`; tenant/customer scope | membership tier and assignment APIs | loading, ready, empty, retry, forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.9 | Package catalog, entitlements and ledger | `/admin/packages/catalog`, `/admin/packages/catalog/:packageId`, `/admin/packages/entitlements`, `/admin/packages/entitlements/:entitlementId` | `package.*`; tenant/customer scope | package catalog, entitlement and ledger APIs | validation, lifecycle, loading, empty, retry, forbidden | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |

```text
WAVE_3_CLUSTER_2_STATUS=ACCEPTED
SCREEN_ROWS_19_3_6_TO_19_3_9=ACCEPTED
POS_ROUTE_OWNERSHIP_PRESERVED=YES
CUSTOMER_MUTATION_ADDED=NO
MIGRATION_CHANGED=NO
```

## Wave 3 Cluster 3 implementation ledger

Cluster 3 redesigns voucher, gift-card and customer-credit operational
surfaces using the existing benefits and stored-value APIs. POS funding and
stored-value liability/reconciliation routes remain owned by their existing
renderers. Final source validation is commit
`638831f2021c4994a838eb19e213e3744381ee2b`, validated by full CI run
`31168662060` with conclusion `SUCCESS`.

| ID | Screen | App | Route | Persona | Permission / scope | API dependency | Required states | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3.10 | Voucher campaigns, codes and customer vouchers | Admin Web | `/admin/vouchers/campaigns`, `/admin/vouchers/campaigns/:campaignId`, `/admin/vouchers/codes` | Receptionist, Owner, Marketing | `voucher.campaign.*`, `voucher.code.*`, tenant scope | Voucher campaign/code APIs | loading, empty, retry, forbidden, validation, version conflict, masked secret | 1440, 1280, 1024, 768, 390, 360 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.11 | Gift-card products, issuance and detail | Admin Web | `/admin/gift-cards/products`, `/admin/gift-cards/issuance`, `/admin/gift-cards`, `/admin/gift-cards/:giftCardId` | Receptionist, Owner, Cashier | `gift_card.*`, branch scope | Gift-card product/card/balance/ledger APIs | loading, empty, retry, forbidden, capture handoff, masked secret, version conflict | 1440, 1280, 1024, 768, 390, 360 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.12 | Customer credit and stored-value adjustments | Admin Web | `/admin/customer-credit`, `/admin/stored-value/adjustments` | Owner, Manager, Receptionist | `customer_credit.*`, branch scope, dual control | Customer credit and adjustment APIs | loading, empty, retry, forbidden, submitting, self-approval denied, version conflict, offline denied | 1440, 1280, 1024, 768, 390, 360 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |

```text
WAVE_3_CLUSTER_3_STATUS=ACCEPTED
SCREEN_ROWS_19_3_10_TO_19_3_12=ACCEPTED
VOUCHER_SECRET_MASKING=YES
GIFT_CARD_SECRET_MASKING=YES
SERVER_AUTHORITATIVE_STORED_VALUE=YES
DUAL_CONTROL_SURFACE=YES
POS_ROUTE_OWNERSHIP_PRESERVED=YES
LIABILITY_ROUTE_OWNERSHIP_PRESERVED=YES
MIGRATION_CHANGED=NO
```

## Wave 3 Cluster 4 implementation ledger

Cluster 4 redesigns communications, marketing, reviews and service recovery
with existing Sprint 11 API contracts. Email remains the only communication
channel; consent, suppression, dual-control and compensation ownership remain
server-authoritative. Final source validation is commit
`638831f2021c4994a838eb19e213e3744381ee2b`, validated by full CI run
`31168662060` with conclusion `SUCCESS`.

| ID | Screen | App | Route | Persona | Permission / scope | API dependency | Required states | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3.13 | Communications, segments and email campaigns | Admin Web | `/admin/communications/templates`, `/admin/communications/rules`, `/admin/communications/messages`, `/admin/communications/suppressions`, `/admin/marketing/segments`, `/admin/marketing/campaigns`, `/admin/marketing/campaigns/:campaignId` | Owner, Manager, Marketing | `communication.*`, `marketing.*`, tenant/branch scope, consent and suppression | Communication, segment and campaign APIs | loading, ready, empty, retry, forbidden, offline, submitting, version conflict, dual-control | 1440, 1280, 1024, 768, 390, 360 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.14 | Reviews and review requests | Admin Web | `/admin/reviews`, `/admin/reviews/:reviewId`, `/admin/review-requests` | Owner, Manager, Receptionist | `review.*`, branch scope | Review and review-request APIs | loading, ready, empty, retry, forbidden, response validation, version conflict | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.15 | Service recovery, compensation and timeline | Admin Web | `/admin/service-recovery`, `/admin/service-recovery/:caseId` | Owner, Manager, Receptionist, assigned Technician | `service_recovery.*`, branch and assigned-task scope, compensation dual control | Recovery case, task and compensation APIs | loading, ready, empty, retry, forbidden, version conflict, dual-control, owning-domain handoff | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |

```text
WAVE_3_CLUSTER_4_STATUS=ACCEPTED
SCREEN_ROWS_19_3_13_TO_19_3_15=ACCEPTED
EMAIL_ONLY=YES
CONSENT_AND_SUPPRESSION_SERVER_CHECKED=YES
COMPENSATION_OWNING_DOMAIN_HANDOFF=YES
ROUTE_OWNERSHIP_EXPLICIT=YES
MIGRATION_CHANGED=NO
```

## Wave 3 Cluster 1A implementation ledger

Cluster 1A adds the Admin Web Customer Directory, create-only flow, read-only
Customer 360 profile/history and a link-only handoff to the existing Sprint 11
engagement renderer. Final source validation is commit
`638831f2021c4994a838eb19e213e3744381ee2b`, validated by full CI run
`31168662060` with conclusion `SUCCESS`.

| ID | Screen | App | Route | Persona | Permission / scope | API dependency | Required states | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3.1 | Customer directory and search | Admin Web | `/admin/customers` | Receptionist, Owner | `customer.booking_lookup`, tenant | `GET /v1/customers` cursor search | loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.2 | Customer create and duplicate-safe resolution | Admin Web | `/admin/customers/new` | Receptionist, Owner | `customer.booking_create`, tenant | `POST /v1/customers`, existing lookup | validation, submitting, error, forbidden, duplicate warning, success | 1280, 390 | REDESIGNED / API_BACKED_PARTIAL / ACCEPTED_WITH_DEFERRED_SCOPE; create and duplicate-safe resolution implemented; update/merge deferred |
| 19.3.3 | Customer 360 profile | Admin Web | `/admin/customers/:id` | Receptionist, Owner | `customer.booking_lookup`, tenant | `GET /v1/customers/:customerId` | loading, ready, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.4 | Booking, visit and purchase history | Admin Web | `/admin/customers/:id` | Receptionist, Owner | branch-filtered child activity; `invoice.read` optional | Customer detail aggregate | loading, bounded ready/empty, optional denied, retry | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |
| 19.3.5 | Consent preferences and engagement timeline link | Admin Web | `/admin/customers/:id/engagement` | Receptionist, Owner, Marketing | existing Sprint 11 permission and consent contract | existing engagement timeline API | legacy loading/empty/error/forbidden states | 1280, 390 | REDESIGNED / API_BACKED / ACCEPTED; source `638831f2`; CI `31168662060` |

## Wave 3 final acceptance

Final Wave 3 source validation is commit
`638831f2021c4994a838eb19e213e3744381ee2b`, validated by full CI run
`31168662060` with conclusion `SUCCESS`. The documentation commit created
after this validation is not the source commit validated by that run.

```text
WAVE_3_REMOTE_START_CHECKPOINT=da8ecc107b85f4ad6877aee7b154f342fcba2d57
CUSTOMER_360_READ_FOUNDATION_SHA=1fcf657694dfe6912a53f239b886530f151c5453
CUSTOMER_360_UI_SHA=46f6d3c5476785ad64159bcdf9cdb66290102e54
LOYALTY_BENEFITS_UI_SHA=0c48325e59814c298f8b6a8eab3f08e929582595
VOUCHERS_STORED_VALUE_UI_SHA=797fc814f9ea71b0c941c86726296765becab36c
CUSTOMER_ENGAGEMENT_UI_SHA=6b054d57363091c45756aaa54e430b5305b2281f
WAVE_3_CI_LANES_SHA=4addcf4b389751119b8626af432abe35636650c3
SUPPLY_CHAIN_HARDENING_SHA=c39ae97282cd58c513e1f569f9c2ae8e10d0dc6a
SPRINT8_MEMBERSHIP_FIXTURE_ISOLATION_SHA=638831f2021c4994a838eb19e213e3744381ee2b
FINAL_WAVE_3_SOURCE_SHA=638831f2021c4994a838eb19e213e3744381ee2b
FINAL_WAVE_3_CI_RUN_ID=31168662060
FINAL_WAVE_3_CI_CONCLUSION=SUCCESS

FULLY_ACCEPTED_ROWS=14
ACCEPTED_WITH_DEFERRED_SCOPE_ROWS=1
ROW_19_3_2=ACCEPTED_WITH_DEFERRED_SCOPE
CUSTOMER_UPDATE=DEFERRED
CUSTOMER_MERGE=DEFERRED
WAVE_3_STATUS=COMPLETED_WITH_DOCUMENTED_DEFERRAL
WAVE_4_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

Row `19.3.2` is accepted for customer creation, duplicate-safe existing
customer resolution and the approved create flow only. Customer Update and
Customer Merge remain deferred; this inventory does not claim either mutation
is implemented. The deferred item belongs to a future customer mutation
addendum or product backlog, not Wave 4.

## Wave 5 — Inventory, procurement and fixed assets (accepted)

Final Wave 5 source validation is commit
`7d01aa86d94ebf4a7e6406082d3aeb176cac884c`, validated by full CI run
`31287558715` with conclusion `SUCCESS`.

The documentation commit created after this validation is not the source
commit validated by run `31287558715`.

All Wave 5 screens are API-backed and accepted against the exact source/CI
evidence below. Branch context remains server-authoritative; the Admin Shell
uses Auth Context, defaults multi-branch workspaces to an explicit unselected
state, and validates stale local storage before any branch-scoped write.

| ID | Screen | Cluster | Status |
| --- | --- | --- | --- |
| 19.5.1 | Inventory items | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.2 | Stock locations | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.3 | Stock availability | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.4 | Lot and expiry | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.5 | Inventory alerts | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.6 | Inventory suppliers | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.7 | Inventory purchase orders | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.8 | Goods receipts | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.9 | Stock transfers | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.10 | Stock adjustments | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.11 | Blind stock counts | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.12 | Service material recipes | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.13 | Inventory ledger | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.14 | Inventory valuation | Inventory | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.15 | Procurement control center | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.16 | Vendors | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.17 | Purchase requests | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.18 | Purchase orders | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.19 | Goods and service receipts | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.20 | Vendor bills | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.21 | Accounts payable | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.22 | Payment proposals | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.23 | Vendor payments | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.24 | Vendor credit notes | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.25 | Vendor returns | Procurement | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.26 | Fixed asset register | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.27 | Asset candidates | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.28 | Capitalization approvals | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.29 | Depreciation runs | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.30 | Maintenance work orders | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.31 | Asset transfers | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.32 | Asset counts | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.33 | Inspections | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.34 | Impairments | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.35 | Disposals | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |
| 19.5.36 | Asset reports | Fixed assets | REDESIGNED / API_BACKED / ACCEPTED; source `7d01aa86`; CI `31287558715` |

```text
WAVE_5_SOURCE_SHA=7d01aa86d94ebf4a7e6406082d3aeb176cac884c
WAVE_5_SOURCE_CI_RUN_ID=31287558715
WAVE_5_SOURCE_CI_CONCLUSION=SUCCESS
SCREEN_ROWS_19_5_1_TO_19_5_36=ALL_ACCEPTED
INVENTORY_SCREEN_ROWS=14_ACCEPTED
PROCUREMENT_SCREEN_ROWS=11_ACCEPTED
FIXED_ASSET_SCREEN_ROWS=11_ACCEPTED
WAVE_5_STATUS=COMPLETED
BA_PO_WAVE_5_ACCEPTANCE=PASS
WAVE_6_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```

## Wave 7 — Public Booking Web (accepted against source CI)

Wave 7 starts from `97ca6c643fcc427076948cbba4f827cce7ab3b95`. Final source
validation is commit `214e90e58b1c8b25438b170c82622a77342de24b`, validated by
full CI run `31324420953` with conclusion `SUCCESS`. The documentation commit
created after this validation is not the source commit validated by that run.

| ID | Screen | Route | Persona | Permission / scope | API dependency | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 19.7.1 | Public booking landing | `/` | Customer | Public; tenant-neutral | Public salon resolution | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.2 | Salon and branch discovery | `/book/[salonSlug]` | Customer | Public; active tenant/branch | Public salon, branches | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.3 | Service catalog and staff preference | `/book/[salonSlug]` | Customer | Public offering policy | Public services, staff | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.4 | Availability and date/time | `/book/[salonSlug]` | Customer | Public booking capability | Public availability and holds | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.5 | Customer contact | `/book/[salonSlug]` | Customer | Public; verified contact | Contact verification | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.6 | Contact OTP verification | `/book/[salonSlug]` | Customer | Public OTP policy | OTP request/verify | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.7 | Review, policy and consent | `/book/[salonSlug]` | Customer | Public booking policy | Hold plan and policy | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.8 | Booking result | `/book/[salonSlug]` | Customer | Public; no payment capture | Booking create/result | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.9 | Manage booking lookup | `/manage-booking` | Customer | Safe neutral lookup | Management access request | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.10 | Manage booking OTP | `/manage-booking` | Customer | Management OTP policy | OTP request/verify | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.11 | Booking detail, packages and cancel | `/manage-booking` | Customer | Management token and domain policy | Detail, cancel, package reservation | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.12 | Replacement availability | `/manage-booking` | Customer | Management token | Replacement availability | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |
| 19.7.13 | Reschedule hold and confirmation | `/manage-booking` | Customer | FULL/GRACE + booking entitlement | Reschedule hold/commit | REDESIGNED / API_BACKED / ACCEPTED; source `214e90e5`; CI `31324420953` |

```text
WAVE_7_STATUS=COMPLETED
WAVE_7_SOURCE_SHA=214e90e58b1c8b25438b170c82622a77342de24b
WAVE_7_SOURCE_CI_RUN_ID=31324420953
WAVE_7_SOURCE_CI=SUCCESS
WAVE_7_SOURCE_CI_CONCLUSION=SUCCESS
SCREEN_ROWS_19_7_1_TO_19_7_13=ALL_ACCEPTED
BA_PO_WAVE_7_ACCEPTANCE=PASS
WAVE_8_STARTED=NO
SPRINT_20_STARTED=NO
PRODUCTION_GO_LIVE_AUTHORIZED=NO
```
