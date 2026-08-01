# Sprint 15 test matrix

| Area | Coverage | Status |
|---|---|---|
| Quantity/money precision | Decimal quantity parsing and exact minor arithmetic | Passing unit test |
| API contract | Procurement paths, idempotency and versioned OpenAPI | Passing contract test |
| Migration | Fresh, rollback to 0030, re-migrate | Passed locally with PostgreSQL 16 |
| Tenant/branch isolation | Composite tenant/branch foreign keys and service scope | Foundation implemented; integration lane pending |
| Approval/idempotency | Request/PO/bill/payment/credit/return dual-control and replay | Foundation implemented; integration lane pending |
| Receipt/bill/AP caps | Receipt tolerance, 3-way match, AP allocation caps | Foundation implemented; integration lane pending |
| Provider boundary | Attempt/unknown/reconciliation tables and worker seam | Foundation implemented; provider adapter pending |

