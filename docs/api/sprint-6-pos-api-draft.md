# Sprint 6 POS API contract

All financial writes require bearer authentication, tenant context, granular permission, `Idempotency-Key`, online connectivity and optimistic `version` where an aggregate already exists.

## Orders and payments

- `POST /v1/appointments/:appointmentId/pos-orders`
- `GET /v1/pos-orders`, `GET /v1/pos-orders/:orderId`, `GET /v1/pos-orders/:orderId/history`
- `POST /v1/pos-orders/:orderId/lines|recalculate|discounts|tip|finalize|payments|void`
- `POST /v1/pos-discount-approvals/:approvalId/approve`
- `GET /v1/payments`, `GET /v1/payments/:paymentId`, `GET /v1/pos-orders/:orderId/payments`

Payment bodies are strict discriminated unions. Cash requires open `cashSessionId` and returns applied/change minor units. External tenders require a unique opaque reference and never accept full card data.

## Invoice and cash

- `GET /v1/invoices`, `GET /v1/invoices/:invoiceId`, `GET /v1/invoices/:invoiceId/print`
- `POST /v1/invoices/:invoiceId/deliver`
- `GET /v1/pos-registers`
- `GET /v1/cash-sessions`, `POST /v1/cash-sessions/open`
- `GET /v1/cash-sessions/:id`, `GET|POST /v1/cash-sessions/:id/movements`
- `POST /v1/cash-sessions/:id/begin-closing|declare|reopen|close`
- `GET /v1/financial/reconciliation/daily`, `GET /v1/financial/summary`
- `POST /v1/payment-providers/:provider/webhook`

Canonical schemas and error responses are maintained in `docs/api/openapi.yaml` version `0.8.0`.

Cash movement commands also return `CASH_MOVEMENT_INVALID` when an out/drop would make the session's expected cash negative; database constraint conflicts are mapped to domain errors rather than HTTP 500.
