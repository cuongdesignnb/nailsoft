# Sprint 8 ERD

```mermaid
erDiagram
  VOUCHER_CAMPAIGNS ||--o{ VOUCHER_CODES : issues
  VOUCHER_CODES ||--o{ VOUCHER_RESERVATIONS : reserves
  VOUCHER_RESERVATIONS ||--o{ VOUCHER_REDEMPTION_ENTRIES : proves
  VOUCHER_CAMPAIGNS ||--o{ VOUCHER_CUSTOMER_USAGE : limits
  CUSTOMERS ||--|| LOYALTY_ACCOUNTS : owns
  LOYALTY_ACCOUNTS ||--o{ LOYALTY_LEDGER_ENTRIES : projects
  LOYALTY_LEDGER_ENTRIES ||--o| LOYALTY_POINT_LOTS : creates
  LOYALTY_POINT_LOTS ||--o{ LOYALTY_REDEMPTION_LOT_ALLOCATIONS : reserves
  MEMBERSHIP_TIERS ||--o{ CUSTOMER_MEMBERSHIP_ASSIGNMENTS : snapshots
  SERVICE_PACKAGE_PRODUCTS ||--o{ SERVICE_PACKAGE_ELIGIBILITY_ITEMS : covers
  SERVICE_PACKAGE_PRODUCTS ||--o{ CUSTOMER_PACKAGE_ENTITLEMENTS : grants
  CUSTOMER_PACKAGE_ENTITLEMENTS ||--o{ PACKAGE_RESERVATIONS : reserves
  CUSTOMER_PACKAGE_ENTITLEMENTS ||--o{ PACKAGE_LEDGER_ENTRIES : projects
  POS_ORDERS ||--o{ POS_ORDER_BENEFIT_APPLICATIONS : applies
  POS_ORDER_BENEFIT_APPLICATIONS ||--o{ BENEFIT_APPLICATION_ALLOCATIONS : settles
  INVOICE_LINES ||--o{ BENEFIT_APPLICATION_ALLOCATIONS : receives
  BENEFIT_APPLICATION_ALLOCATIONS ||--o{ BENEFIT_REFUND_ALLOCATIONS : reverses
  REFUNDS ||--o{ BENEFIT_REFUND_ALLOCATIONS : records
  REFUNDS ||--o{ BENEFIT_REVERSAL_CONFLICTS : reviews
```

Every business child carries `tenant_id`; cross-aggregate foreign keys are composite tenant keys. Ledger/history and benefit allocation tables reject UPDATE and DELETE. `covered_order_line_id` makes package uniqueness line-specific. PostgreSQL projections are authoritative; Worker jobs and realtime are derived delivery mechanisms.
