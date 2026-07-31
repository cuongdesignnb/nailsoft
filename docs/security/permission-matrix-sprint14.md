# Sprint 14 permission matrix

| Capability | Owner | Accountant | Branch Manager | Cashier | Platform roles |
|---|---:|---:|---:|---:|---:|
| Read accounting book/reports | Yes | Yes | Scoped read | Bank read | Denied |
| Manage COA/mapping | Yes | Yes | No | No | Denied |
| Journal submit | Yes | Yes | No | No | Denied |
| Journal approve/post | Yes | Policy scoped | No | No | Denied |
| Close/reopen period | Yes | Explicit only | No | No | Denied |
| Bank reconciliation | Yes | Yes | Read scoped | Read | Denied |

Support access must include an explicit accounting scope and is audited. Platform Billing Admin has no salon GL access.
