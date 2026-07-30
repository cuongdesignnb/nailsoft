# Sprint 13 ERD

```mermaid
erDiagram
  TENANT ||--|| PLATFORM_BILLING_ACCOUNT : owns
  PLATFORM_PRODUCT ||--o{ PLATFORM_PLAN : offers
  PLATFORM_PLAN ||--o{ PLATFORM_PLAN_VERSION : versions
  PLATFORM_PLAN_VERSION ||--o{ PLATFORM_PRICE : prices
  PLATFORM_BILLING_ACCOUNT ||--o{ PLATFORM_SUBSCRIPTION : bills
  PLATFORM_SUBSCRIPTION ||--o{ PLATFORM_SUBSCRIPTION_PERIOD : snapshots
  PLATFORM_USAGE_METER ||--o{ PLATFORM_USAGE_EVENT : records
  PLATFORM_USAGE_EVENT ||--o{ PLATFORM_USAGE_CORRECTION : corrects
  PLATFORM_SUBSCRIPTION_PERIOD ||--o| PLATFORM_INVOICE : invoices
  PLATFORM_INVOICE ||--o{ PLATFORM_INVOICE_LINE : totals
  PLATFORM_INVOICE ||--o{ PLATFORM_PAYMENT_INTENT : collects
  PLATFORM_INVOICE ||--o{ PLATFORM_MANUAL_PAYMENT_REQUEST : requests
  PLATFORM_MANUAL_PAYMENT_REQUEST ||--o| PLATFORM_PAYMENT_INTENT : records
  PLATFORM_PAYMENT_INTENT ||--o{ PLATFORM_REFUND : refunds
  PLATFORM_PAYMENT_INTENT ||--o{ PLATFORM_PROVIDER_OPERATION : leases
  PLATFORM_REFUND ||--o{ PLATFORM_PROVIDER_OPERATION : leases
  PLATFORM_INVOICE ||--o{ PLATFORM_CREDIT_NOTE : credits
  PLATFORM_CREDIT_NOTE ||--o{ PLATFORM_CREDIT_NOTE_LINE : allocates
  PLATFORM_INVOICE_LINE ||--o{ PLATFORM_CREDIT_NOTE_LINE : eligible_source
  PLATFORM_CREDIT_NOTE ||--o{ PLATFORM_CREDIT_APPLICATION : applies
  PLATFORM_INVOICE ||--o{ PLATFORM_CREDIT_APPLICATION : receives
  PLATFORM_BILLING_ACCOUNT ||--o{ PLATFORM_BILLING_CREDIT_LEDGER : credits
  TENANT ||--o{ PLATFORM_SUPPORT_ACCESS_GRANT : approves
  PLATFORM_SUPPORT_ACCESS_GRANT ||--o{ PLATFORM_SUPPORT_SESSION : binds
```

Manual payment, refund, and credit-note histories are append-only. Provider operations use short database leases; network calls occur after the claim transaction commits and before the finish transaction starts. Credit issuance is a positive account-credit ledger entry, while application is a distinct negative entry linked through `platform_credit_applications`.

SaaS financial tables have no foreign key to salon POS, stored-value, loyalty or payroll ledgers.
