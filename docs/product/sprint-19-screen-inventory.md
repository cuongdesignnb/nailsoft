# Sprint 19 Screen Inventory

Start checkpoint: `2c9f1ecbec44bf561457b305bd8e727d08b72dea`
Current phase: Wave 1 complete; Wave 2 not authorized
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

| ID | Screen | App | Route | Persona | Permission and scope | API dependency | States | Breakpoints | Evidence / status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.1.1 | Today dashboard | Admin Web | `/admin/dashboard` | Owner, Manager, Receptionist | `operations.board.read`, branch scope | `/v1/operations/summary`, `/v1/operations/board` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | `tests/e2e/sprint19-wave1-booking-operations.spec.ts`; IMPLEMENTED |
| 19.1.2 | Booking calendar day/week | Admin Web | `/admin/calendar/day`, `/admin/calendar/week` | Owner, Manager, Receptionist | `calendar.*`, branch scope | `/v1/calendar/events` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | Wave 1 E2E; IMPLEMENTED |
| 19.1.3 | Booking list | Admin Web | `/admin/appointments` | Owner, Manager, Receptionist | `appointment.read`, branch scope | `/v1/appointments` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | Wave 1 E2E; IMPLEMENTED |
| 19.1.4 | Create booking | Admin Web | `/admin/appointments/new` | Receptionist, Manager | `appointment.create`, branch scope | Booking/availability APIs | Loading, validation, conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Sprint 4 flow + Wave 1 route smoke; IMPLEMENTED |
| 19.1.5 | Booking details | Admin Web | `/admin/appointments/:id/overview` | Owner, Manager, Receptionist, Technician | appointment read with branch/own-staff scope | Appointment detail API | Loading, ready, not found, forbidden, retry | 1440, 1280, 1024, 768, 390, 360 | Wave 1 route smoke; IMPLEMENTED |
| 19.1.6 | Reschedule booking | Booking Web | `/manage-booking` (reschedule flow) | Customer, Receptionist | Public token or appointment scope | Public booking search, availability, hold/booking APIs | Loading, validation, no-slot, conflict, retry, success | 1440, 1280, 1024, 768, 390, 360 | Public booking E2E; IMPLEMENTED |
| 19.1.7 | Cancel / no-show action surface | Admin Web | `/admin/appointments/:id/cancel` | Manager, Receptionist | `appointment.cancel`; no-show remains policy-gated | Appointment command API | Loading, reason validation, forbidden, conflict, success/error | 1440, 1280, 1024, 768, 390, 360 | Wave 1 route smoke; IMPLEMENTED (no-show command unchanged) |
| 19.1.8 | Availability search | Admin Web | `/admin/availability/search` | Receptionist, Manager | `availability.read`, branch scope | `/v1/availability` | Loading, ready, empty, error/retry, forbidden, offline | 1440, 1280, 1024, 768, 390, 360 | Wave 1 E2E; IMPLEMENTED |
| 19.1.9 | Busy block | Admin Web | `/admin/scheduling/blocks` | Manager, Owner | `availability.block.manage`, branch scope | `/v1/availability-blocks` | Loading, validation, conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Wave 1 route smoke; IMPLEMENTED |
| 19.1.10 | Walk-in creation | Admin Web | `/admin/operations/walk-ins/new` | Receptionist, Manager | `walkin.create`, branch scope | `/v1/walk-ins` | Loading, validation, ETA empty/error, forbidden, success | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; IMPLEMENTED |
| 19.1.11 | Queue board | Admin Web | `/admin/operations/board`, `/admin/operations/walk-ins` | Receptionist, Manager | `operations.board.read`, `walkin.read`, branch scope | Operations/walk-in APIs + realtime refetch | Loading, empty, error/retry, forbidden, stale/offline | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; IMPLEMENTED |
| 19.1.12 | Check-in | Admin Web | `/admin/appointments/:id/check-in` | Receptionist, Manager | `appointment.check_in`, branch scope | Arrival/check-in APIs | Loading, early/late warning, validation, conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; IMPLEMENTED |
| 19.1.13 | Service session workspace | Admin Web / Staff Mobile | `/admin/appointments/:id/execution`, `/admin/service-sessions/:id` | Technician, Manager | `service_session.read_own`/`read_branch`, own-staff/branch scope | Service session command APIs | Loading, ready, empty, forbidden, offline, version conflict, retry | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; IMPLEMENTED |
| 19.1.14 | Add-service approval | Admin Web | `/admin/appointments/:id/add-service` | Receptionist, Technician, Manager | `service_session.add_service`, branch scope | Add-service plan/hold/commit APIs | Loading, validation, availability conflict, approval, forbidden, retry | 1440, 1280, 1024, 768, 390, 360 | Sprint 5 surface + Wave 1 route smoke; IMPLEMENTED |
| 19.1.15 | Staff assignment | Admin Web | appointment execution detail | Manager, Receptionist, Technician | Existing staff/assignment permissions and scope | Appointment/service-session assignment APIs | Loading, empty, conflict, forbidden, retry | 1440, 1280, 1024, 768, 390, 360 | Documentation split of duplicated handoff ID; IMPLEMENTED |
| 19.1.16 | Staff transfer and segment assignment | Admin Web / Staff Mobile | `/admin/service-sessions/:id` | Manager, Technician | `service_session.transfer_staff`, branch/own-staff scope | Transfer command and realtime refetch | Loading, validation, busy/skill conflict, version conflict, forbidden, success/error | 1440, 1280, 1024, 768, 390, 360 | Documentation split of duplicated handoff ID; IMPLEMENTED |

Evidence for this wave is targeted E2E and local QA recorded in the Wave 1
report. No unverified screenshot is claimed as acceptance evidence.

## Business route inventory for later waves

The following route families are registered before implementation. Each business screen will receive its own acceptance row immediately before work starts; no business screen is accepted in Wave 0.

| Wave | Route family | Screen IDs | Primary personas | Permission examples |
| --- | --- | --- | --- | --- |
| 1 | Booking and daily operations | 19.1.1-19.1.16 | Owner, Manager, Receptionist, Technician | `calendar.*`, `appointment.*`, `operations.*`, `walkin.*` |
| 2 | POS, payment and cash | 19.2.1-19.2.17 | Receptionist, Cashier, Manager, Accountant | `pos.*`, `payment.*`, `invoice.*`, `cash_session.*` |
| 3 | Customers, loyalty and engagement | 19.3.1-19.3.15 | Receptionist, Owner, Marketing | `customer.*`, `loyalty.*`, `membership.*`, `marketing.*` |
| 4 | Staff, workforce and payroll | 19.4.1-19.4.14 | Owner, Manager, Accountant, Technician | `staff.*`, `shift.*`, `leave.*`, `payroll.*` |
| 5 | Inventory, procurement and assets | 19.5.1-19.5.36 | Inventory/Procurement Operator, Manager, Accountant | `inventory.*`, `procurement.*`, `asset.*` |
| 6 | Accounting, platform billing and analytics | 19.6.1-19.6.34 | Accountant, Owner, Platform Support | `accounting.*`, `bank.*`, `analytics.*` |
| 7 | Public Booking Web | 19.7.1-19.7.13 | Customer | Public booking contract |
| 8 | Owner Mobile | 19.8.1-19.8.12 | Owner | Effective owner permissions |
| 9 | Staff Mobile | 19.9.1-19.9.10 | Technician | Own staff and assigned-session scope |

Total planned units: 180 (13 foundations and 167 business screens, including the
documentation-only split for duplicated handoff IDs). Wave 2 onward is not
authorized by this document.
