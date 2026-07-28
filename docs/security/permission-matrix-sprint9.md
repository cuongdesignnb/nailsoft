# Sprint 9 Permission Matrix

| Capability | Owner | Manager (branch) | Reception | Cashier | Technician (own) | Accountant | Marketing | Platform admin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Item/location/stock read | Yes | Yes | Stock, no cost | Stock, no cost | Materials only | Yes | No | No grant = denied |
| Item/location/supplier manage | Yes | Yes | No | No | No | No | No | No |
| Cost/ledger/valuation | Yes | Yes | No | No | No | Yes | No | No |
| PO create/submit/approve | Yes | Yes | No | No | No | Read only | No | No |
| Receipt create/post | Yes | Yes | No | No | No | Read only | No | No |
| Transfer/adjust/count | Yes | Yes | No | No | No | Read/report | No | No |
| Recipe manage | Yes | Yes | No | No | No | No | No | No |
| Service reserve/consume | Yes | Yes | No | No | Own session | No | No | No |
| Retail sell/return request | Yes | Yes | No | Yes | No | No | No | No |
| Return inspection | Yes | Yes | No | No | No | No | No | No |

Tenant IDs are always taken from access claims. Branch-scoped rows are checked against claim branches. Supplier contacts and all cost fields are omitted from endpoints lacking their specific permission. Blind count expected values remain absent until submission.
