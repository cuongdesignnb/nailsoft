# Sprint 4 booking ERD

Migration `0009_booking_appointment_lifecycle` extends the existing appointment aggregate in place. Every business relation retains `tenant_id`; composite foreign keys and branch checks prevent cross-tenant and cross-branch references.

```mermaid
erDiagram
  TENANTS ||--o{ CUSTOMERS : owns
  BRANCHES ||--o{ APPOINTMENTS : schedules
  CUSTOMERS ||--o{ APPOINTMENTS : books
  APPOINTMENTS ||--o{ APPOINTMENT_PARTICIPANTS : contains
  APPOINTMENTS ||--o{ APPOINTMENT_ITEMS : sequences
  APPOINTMENT_PARTICIPANTS ||--o{ APPOINTMENT_ITEMS : receives
  SERVICES ||--o{ APPOINTMENT_ITEMS : snapshots
  APPOINTMENT_ITEMS ||--o{ APPOINTMENT_ITEM_STAFF_ASSIGNMENTS : assigns
  STAFF_PROFILES ||--o{ APPOINTMENT_ITEM_STAFF_ASSIGNMENTS : serves
  APPOINTMENT_ITEMS ||--o{ APPOINTMENT_ITEM_RESOURCE_ALLOCATIONS : allocates
  RESOURCES ||--o{ APPOINTMENT_ITEM_RESOURCE_ALLOCATIONS : supplies
  BRANCHES ||--o{ SLOT_HOLDS : owns
  SLOT_HOLDS ||--o{ SLOT_HOLD_ITEMS : sequences
  SLOT_HOLD_ITEMS ||--o{ STAFF_SCHEDULE_RESERVATIONS : reserves
  SLOT_HOLD_ITEMS ||--o{ RESOURCE_SCHEDULE_RESERVATIONS : reserves
  APPOINTMENT_ITEMS ||--o{ STAFF_SCHEDULE_RESERVATIONS : confirms
  APPOINTMENT_ITEMS ||--o{ RESOURCE_SCHEDULE_RESERVATIONS : confirms
  APPOINTMENTS ||--o{ APPOINTMENT_STATUS_HISTORY : audits
  APPOINTMENTS ||--o{ APPOINTMENT_SCHEDULE_REVISIONS : revises
  APPOINTMENTS ||--o{ BOOKING_ACCESS_CHALLENGES : authorizes
  APPOINTMENTS ||--o{ BOOKING_NOTIFICATION_JOBS : notifies
```

Staff reservations use a PostgreSQL GiST exclusion constraint for active overlapping ranges. Shared resource capacity is checked while advisory-locking resource IDs in deterministic order. Holds are durable PostgreSQL rows; Redis never owns booking truth.
