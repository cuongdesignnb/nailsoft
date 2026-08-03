# Sprint 19 Role Usability Matrix

| Persona | Primary surfaces | Density and workflow | Must not expose |
| --- | --- | --- | --- |
| Platform Super Admin / Support | Platform billing, tenant administration, support access | Audit-first, explicit tenant/support context | Salon data without an active Support Access Grant |
| Salon Owner | Command Center, business KPI, approvals, workforce and finance summaries | Executive overview with drill-down | Cross-tenant data |
| Branch Manager | Operations, calendar, queue, staff and scoped inventory | Keyboard and touch-efficient daily control | Finance/payroll outside permission and branch scope |
| Receptionist | Calendar, booking, walk-in, check-in and allowed POS | Fast search, large actions, minimal clicks | Payroll, cross-branch and technician-private data |
| Nail Technician | My Day, queue, session, notes, attendance and personal earnings | Native mobile first, focused next-action flow | Other staff/customer finance data outside own assignment |
| Accountant | Ledger, reconciliation, AP, assets, payroll evidence and export | Dense tables, filters, reconciliation and drill-down | Operational mutations without permission |
| Inventory/Procurement Operator | Product, stock, receipt, count, vendor and purchase workflow | Dense operational tables and scanner-ready actions | Finance/payroll and ungranted approval actions |
| Customer | Public booking, manage booking and OTP flow | Plain language, progressive steps and clear recovery | Salon internal data |

Navigation uses server-provided effective permissions. Persona labels improve usability only; backend authorization remains the source of truth.
