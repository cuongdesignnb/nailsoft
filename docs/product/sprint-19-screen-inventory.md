# Sprint 19 Screen Inventory

Start checkpoint: `5483ac0763b5d34af9ba0963cdbe26bac3b6ef4e`
Current phase: Wave 2 accepted against source CI; Wave 3 not authorized
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

The following route families remain planned for later waves. Wave 2 rows above
are accepted; Wave 3 and later screens are not authorized by this closure.

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

## Wave 3 Cluster 2 implementation ledger

Cluster 2 implements the Admin Web benefits, loyalty, membership and package
surfaces with the existing Sprint 8 API contracts. POS benefit routes remain
owned by the Sprint 8 renderer. These rows are implementation evidence only
until targeted QA and Wave 3 CI are complete.

| ID | Screen | Route | Permission / scope | API dependency | Required states | Status |
| --- | --- | --- | --- | --- | --- |
| 19.3.6 | Customer benefits wallet | `/admin/benefits`, `/admin/benefits/customers/:customerId` | Existing benefits permissions; tenant/customer scope | loyalty, membership, voucher and package read APIs | loading, ready, empty, retry, forbidden, partial | IMPLEMENTED_PENDING_QA; local Cluster 2 |
| 19.3.7 | Loyalty program, adjustment and ledger | `/admin/loyalty/programs`, `/admin/loyalty/adjustments`, `/admin/loyalty/customers/:customerId` | `loyalty.*`; tenant/customer scope; independent approval | loyalty program/account/ledger/adjustment APIs | validation, submitting, success, error, version conflict, forbidden | IMPLEMENTED_PENDING_QA; local Cluster 2 |
| 19.3.8 | Membership tiers and customer history | `/admin/membership/tiers`, `/admin/membership/customers/:customerId` | `membership.*`; tenant/customer scope | membership tier and assignment APIs | loading, ready, empty, retry, forbidden | IMPLEMENTED_PENDING_QA; local Cluster 2 |
| 19.3.9 | Package catalog, entitlements and ledger | `/admin/packages/catalog`, `/admin/packages/catalog/:packageId`, `/admin/packages/entitlements`, `/admin/packages/entitlements/:entitlementId` | `package.*`; tenant/customer scope | package catalog, entitlement and ledger APIs | validation, lifecycle, loading, empty, retry, forbidden | IMPLEMENTED_PENDING_QA; local Cluster 2 |

```text
WAVE_3_CLUSTER_2_STATUS=IMPLEMENTED_PENDING_QA
SCREEN_ROWS_19_3_6_TO_19_3_9=IMPLEMENTED_PENDING_QA
POS_ROUTE_OWNERSHIP_PRESERVED=YES
CUSTOMER_MUTATION_ADDED=NO
MIGRATION_CHANGED=NO
```

## Wave 3 Cluster 3 implementation ledger

Cluster 3 redesigns voucher, gift-card and customer-credit operational
surfaces using the existing benefits and stored-value APIs. POS funding and
stored-value liability/reconciliation routes remain owned by their existing
renderers. These rows are implementation evidence only until targeted QA and
Wave 3 CI are complete.

| ID | Screen | App | Route | Persona | Permission / scope | API dependency | Required states | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3.10 | Voucher campaigns, codes and customer vouchers | Admin Web | `/admin/vouchers/campaigns`, `/admin/vouchers/campaigns/:campaignId`, `/admin/vouchers/codes` | Receptionist, Owner, Marketing | `voucher.campaign.*`, `voucher.code.*`, tenant scope | Voucher campaign/code APIs | loading, empty, retry, forbidden, validation, version conflict, masked secret | 1440, 1280, 1024, 768, 390, 360 | IMPLEMENTED_PENDING_QA; local Cluster 3 |
| 19.3.11 | Gift-card products, issuance and detail | Admin Web | `/admin/gift-cards/products`, `/admin/gift-cards/issuance`, `/admin/gift-cards`, `/admin/gift-cards/:giftCardId` | Receptionist, Owner, Cashier | `gift_card.*`, branch scope | Gift-card product/card/balance/ledger APIs | loading, empty, retry, forbidden, capture handoff, masked secret, version conflict | 1440, 1280, 1024, 768, 390, 360 | IMPLEMENTED_PENDING_QA; local Cluster 3 |
| 19.3.12 | Customer credit and stored-value adjustments | Admin Web | `/admin/customer-credit`, `/admin/stored-value/adjustments` | Owner, Manager, Receptionist | `customer_credit.*`, branch scope, dual control | Customer credit and adjustment APIs | loading, empty, retry, forbidden, submitting, self-approval denied, version conflict, offline denied | 1440, 1280, 1024, 768, 390, 360 | IMPLEMENTED_PENDING_QA; local Cluster 3 |

```text
WAVE_3_CLUSTER_3_STATUS=IMPLEMENTED_PENDING_QA
SCREEN_ROWS_19_3_10_TO_19_3_12=IMPLEMENTED_PENDING_QA
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
server-authoritative. These rows are implementation evidence only until the
Wave 3 targeted QA and exact full CI source gate pass.

| ID | Screen | App | Route | Persona | Permission / scope | API dependency | Required states | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3.13 | Communications, segments and email campaigns | Admin Web | `/admin/communications/templates`, `/admin/communications/rules`, `/admin/communications/messages`, `/admin/communications/suppressions`, `/admin/marketing/segments`, `/admin/marketing/campaigns`, `/admin/marketing/campaigns/:campaignId` | Owner, Manager, Marketing | `communication.*`, `marketing.*`, tenant/branch scope, consent and suppression | Communication, segment and campaign APIs | loading, ready, empty, retry, forbidden, offline, submitting, version conflict, dual-control | 1440, 1280, 1024, 768, 390, 360 | IMPLEMENTED_PENDING_QA; local Cluster 4 |
| 19.3.14 | Reviews and review requests | Admin Web | `/admin/reviews`, `/admin/reviews/:reviewId`, `/admin/review-requests` | Owner, Manager, Receptionist | `review.*`, branch scope | Review and review-request APIs | loading, ready, empty, retry, forbidden, response validation, version conflict | 1280, 390 | IMPLEMENTED_PENDING_QA; local Cluster 4 |
| 19.3.15 | Service recovery, compensation and timeline | Admin Web | `/admin/service-recovery`, `/admin/service-recovery/:caseId` | Owner, Manager, Receptionist, assigned Technician | `service_recovery.*`, branch and assigned-task scope, compensation dual control | Recovery case, task and compensation APIs | loading, ready, empty, retry, forbidden, version conflict, dual-control, owning-domain handoff | 1280, 390 | IMPLEMENTED_PENDING_QA; local Cluster 4 |

```text
WAVE_3_CLUSTER_4_STATUS=IMPLEMENTED_PENDING_QA
SCREEN_ROWS_19_3_13_TO_19_3_15=IMPLEMENTED_PENDING_QA
EMAIL_ONLY=YES
CONSENT_AND_SUPPRESSION_SERVER_CHECKED=YES
COMPENSATION_OWNING_DOMAIN_HANDOFF=YES
ROUTE_OWNERSHIP_EXPLICIT=YES
MIGRATION_CHANGED=NO
```

## Wave 3 Cluster 1A implementation ledger

Cluster 1A adds the Admin Web Customer Directory, create-only flow, read-only
Customer 360 profile/history and a link-only handoff to the existing Sprint 11
engagement renderer. These rows are implementation evidence only and remain
pending QA acceptance.

| ID | Screen | App | Route | Persona | Permission / scope | API dependency | Required states | Breakpoints | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3.1 | Customer directory and search | Admin Web | `/admin/customers` | Receptionist, Owner | `customer.booking_lookup`, tenant | `GET /v1/customers` cursor search | loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | IMPLEMENTED_PENDING_QA; local Cluster 1A |
| 19.3.2 | Customer create/edit and duplicate warning | Admin Web | `/admin/customers/new` | Receptionist, Owner | `customer.booking_create`, tenant | `POST /v1/customers`, existing lookup | validation, submitting, error, forbidden, duplicate warning, success | 1280, 390 | PARTIAL_CREATE_ONLY_PENDING_UPDATE_CONTRACT; update/merge not authorized |
| 19.3.3 | Customer 360 profile | Admin Web | `/admin/customers/:id` | Receptionist, Owner | `customer.booking_lookup`, tenant | `GET /v1/customers/:customerId` | loading, ready, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | IMPLEMENTED_PENDING_QA; local Cluster 1A |
| 19.3.4 | Booking, visit and purchase history | Admin Web | `/admin/customers/:id` | Receptionist, Owner | branch-filtered child activity; `invoice.read` optional | Customer detail aggregate | loading, bounded ready/empty, optional denied, retry | 1280, 390 | IMPLEMENTED_PENDING_QA; local Cluster 1A |
| 19.3.5 | Consent preferences and engagement timeline link | Admin Web | `/admin/customers/:id/engagement` | Receptionist, Owner, Marketing | existing Sprint 11 permission and consent contract | existing engagement timeline API | legacy loading/empty/error/forbidden states | 1280, 390 | IMPLEMENTED_PENDING_QA; Sprint 11 renderer retained |
