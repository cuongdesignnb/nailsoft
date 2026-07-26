# Sprint 5 operational ERD

Migration `0011_walkin_checkin_service_execution` extends booking without changing migrations 0001-0010. PostgreSQL remains authoritative and every mutable aggregate is tenant-scoped.

```mermaid
erDiagram
  BRANCHES ||--o{ WALK_IN_ENTRIES : queues
  WALK_IN_QUEUE_COUNTERS ||--o{ WALK_IN_ENTRIES : numbers
  WALK_IN_ENTRIES ||--|{ WALK_IN_ITEMS : requests
  WALK_IN_ENTRIES ||--o{ WALK_IN_STATUS_HISTORY : records
  WALK_IN_ENTRIES o|--o| APPOINTMENTS : converts_via_booking
  APPOINTMENTS ||--o| APPOINTMENT_ARRIVALS : arrives
  APPOINTMENTS ||--|{ APPOINTMENT_ITEMS : schedules
  APPOINTMENT_ITEMS ||--o| SERVICE_SESSIONS : executes
  SERVICE_SESSIONS ||--o{ SERVICE_SESSION_STAFF_SEGMENTS : contributes
  SERVICE_SESSIONS ||--o{ SERVICE_SESSION_PAUSES : pauses
  SERVICE_SESSIONS ||--o{ SERVICE_SESSION_NOTES : notes
  SERVICE_SESSIONS ||--o{ SERVICE_SESSION_MEDIA : references
  STAFF_PROFILES ||--o{ SERVICE_SESSION_STAFF_SEGMENTS : works
  BRANCHES ||--|| BRANCH_OPERATIONAL_VERSIONS : sequences
```

Composite foreign keys prevent tenant/branch crossing. Partial unique indexes enforce one arrival, one session per item, one open pause, one open primary per session and one open execution segment per staff. Queue and execution history is append-only; media binary content is never stored in PostgreSQL.
