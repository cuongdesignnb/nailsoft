# Sprint 7 ERD — financial corrections and commission

```mermaid
erDiagram
  invoices ||--o{ refunds : "corrected by"
  refunds ||--|{ refund_items : contains
  payments ||--o{ refund_payment_allocations : "original tender"
  pos_registers ||--o{ refund_payment_allocations : "immutable original register"
  cash_sessions ||--o{ refund_payment_allocations : "original and execution sessions"
  refunds ||--|{ refund_payment_allocations : executes
  refunds ||--o{ refund_attempts : records
  refunds ||--|{ refund_status_history : transitions
  refunds ||--|| credit_notes : issues
  credit_notes ||--|{ credit_note_lines : contains
  pos_tip_allocations ||--o{ refund_tip_allocations : reverses
  commission_rules ||--o{ commission_entries : snapshots
  invoices ||--o{ commission_entries : generates
  commission_entries ||--o{ commission_entries : reverses
  commission_periods ||--o{ commission_entries : groups
  commission_periods ||--o{ commission_period_staff_snapshots : locks
  commission_adjustment_requests ||--o| commission_entries : posts
```

Every relationship is tenant-scoped through composite foreign keys. Original invoice/payment/tip/earning evidence is never updated by refund flows.

Migration `0015_sprint7_financial_correctness_hardening` adds immutable cash attribution, tenant-scoped provider references, `commission_entries.adjustment_request_id`, conditional invoice/adjustment attribution, one-entry-per-adjustment uniqueness and the active commission-rule range exclusion constraint. `staff_net_tip` now includes only allocations belonging to an `ACTIVE` tip version.
