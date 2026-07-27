# Sprint 6 ERD

```mermaid
erDiagram
  APPOINTMENTS ||--o| POS_ORDERS : checkout
  POS_ORDERS ||--|{ POS_ORDER_LINES : snapshots
  POS_ORDERS ||--o{ POS_DISCOUNTS : append
  POS_ORDERS ||--|{ POS_ORDER_PRICING_REVISIONS : immutable_repricing
  POS_ORDERS ||--o| POS_TIPS : active
  POS_TIPS ||--|{ POS_TIP_ALLOCATIONS : exact_sum
  POS_ORDERS ||--o{ PAYMENTS : settles
  POS_REGISTERS ||--o{ POS_ORDERS : attributes_draft
  POS_REGISTERS ||--o{ PAYMENTS : immutable_attribution
  POS_REGISTERS ||--o{ POS_REGISTER_DEVICE_BINDINGS : authorizes_device
  DEVICE_SESSIONS ||--o{ POS_REGISTER_DEVICE_BINDINGS : resolves_device_id
  PAYMENTS ||--|{ PAYMENT_ATTEMPTS : evidence
  PAYMENTS ||--|{ PAYMENT_ALLOCATIONS : allocates
  POS_ORDERS ||--o| INVOICES : projects
  INVOICES ||--|{ INVOICE_LINES : immutable
  INVOICES ||--o{ INVOICE_DELIVERIES : queues
  POS_REGISTERS ||--|{ CASH_DRAWERS : owns
  CASH_DRAWERS ||--o{ CASH_SESSIONS : opens
  CASH_SESSIONS ||--|{ CASH_MOVEMENTS : reconciles
  PAYMENTS ||--o| CASH_MOVEMENTS : cash_sale
  POS_ORDERS ||--|{ POS_ORDER_STATUS_HISTORY : history
  POS_ORDERS ||--o{ FINANCIAL_EVENTS : evidence
```

Every business table is tenant scoped; branch/register entities use composite tenant foreign keys. Migration `0013` requires register attribution for every non-draft order and every payment, enforces matching order/payment and drawer/session register tuples, and prevents changing an order register after finalize or payment. Partial unique indexes protect the one active appointment order and one active drawer session. Pricing revisions preserve the complete authoritative before/after totals and pricing version for every recalculation.
