# Sprint 8 ERD

```mermaid
erDiagram
  VOUCHER_CAMPAIGNS ||--o{ VOUCHER_CODES : issues
  VOUCHER_CODES ||--o{ VOUCHER_RESERVATIONS : reserves
  VOUCHER_RESERVATIONS ||--o{ VOUCHER_REDEMPTION_ENTRIES : proves
  CUSTOMERS ||--|| LOYALTY_ACCOUNTS : owns
  LOYALTY_ACCOUNTS ||--o{ LOYALTY_LEDGER_ENTRIES : projects
  LOYALTY_LEDGER_ENTRIES ||--o| LOYALTY_POINT_LOTS : creates
  MEMBERSHIP_TIERS ||--o{ CUSTOMER_MEMBERSHIP_ASSIGNMENTS : snapshots
  SERVICE_PACKAGE_PRODUCTS ||--o{ SERVICE_PACKAGE_ELIGIBILITY_ITEMS : covers
  SERVICE_PACKAGE_PRODUCTS ||--o{ CUSTOMER_PACKAGE_ENTITLEMENTS : grants
  CUSTOMER_PACKAGE_ENTITLEMENTS ||--o{ PACKAGE_RESERVATIONS : reserves
  CUSTOMER_PACKAGE_ENTITLEMENTS ||--o{ PACKAGE_LEDGER_ENTRIES : projects
  POS_ORDERS ||--o{ POS_ORDER_BENEFIT_APPLICATIONS : applies
  REFUNDS ||--o{ BENEFIT_REVERSAL_CONFLICTS : reviews
```

Every business child carries `tenant_id`; cross-aggregate foreign keys are composite tenant keys. Ledger/history tables reject UPDATE and DELETE. PostgreSQL projections are authoritative; Worker jobs and realtime are derived delivery mechanisms.
