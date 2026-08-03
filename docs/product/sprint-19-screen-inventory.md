# Sprint 19 Screen Inventory

Start checkpoint: `2c9f1ecbec44bf561457b305bd8e727d08b72dea`
Current phase: Wave 0 only
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

## Business route inventory for later waves

The following route families are registered before implementation. Each business screen will receive its own acceptance row immediately before work starts; no business screen is accepted in Wave 0.

| Wave | Route family | Screen IDs | Primary personas | Permission examples |
| --- | --- | --- | --- | --- |
| 1 | Booking and daily operations | 19.1.1-19.1.15 | Owner, Manager, Receptionist, Technician | `calendar.*`, `appointment.*`, `operations.*`, `walkin.*` |
| 2 | POS, payment and cash | 19.2.1-19.2.17 | Receptionist, Cashier, Manager, Accountant | `pos.*`, `payment.*`, `invoice.*`, `cash_session.*` |
| 3 | Customers, loyalty and engagement | 19.3.1-19.3.15 | Receptionist, Owner, Marketing | `customer.*`, `loyalty.*`, `membership.*`, `marketing.*` |
| 4 | Staff, workforce and payroll | 19.4.1-19.4.14 | Owner, Manager, Accountant, Technician | `staff.*`, `shift.*`, `leave.*`, `payroll.*` |
| 5 | Inventory, procurement and assets | 19.5.1-19.5.36 | Inventory/Procurement Operator, Manager, Accountant | `inventory.*`, `procurement.*`, `asset.*` |
| 6 | Accounting, platform billing and analytics | 19.6.1-19.6.34 | Accountant, Owner, Platform Support | `accounting.*`, `bank.*`, `analytics.*` |
| 7 | Public Booking Web | 19.7.1-19.7.13 | Customer | Public booking contract |
| 8 | Owner Mobile | 19.8.1-19.8.12 | Owner | Effective owner permissions |
| 9 | Staff Mobile | 19.9.1-19.9.10 | Technician | Own staff and assigned-session scope |

Total planned units: 179 (13 foundations and 166 business screens). Wave 1 onward is not authorized by this document.
