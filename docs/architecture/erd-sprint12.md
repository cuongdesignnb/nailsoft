# Sprint 12 ERD

```mermaid
erDiagram
  TENANT ||--o{ BRANCH : owns
  STAFF_PROFILE ||--o{ TIME_CLOCK_EVENT : records
  TIME_CLOCK_EVENT ||--o| ATTENDANCE_SESSION : projects
  ATTENDANCE_SESSION ||--o{ ATTENDANCE_BREAK : contains
  ATTENDANCE_SESSION ||--o{ ATTENDANCE_EXCEPTION : raises
  WORKFORCE_POLICY ||--o{ WORKFORCE_POLICY_VERSION : versions
  WORKFORCE_POLICY_VERSION ||--o{ COMPLIANCE_VIOLATION : evaluates
  TIMESHEET_PERIOD ||--o{ STAFF_TIMESHEET : groups
  STAFF_TIMESHEET ||--o{ TIMESHEET_DAY_ENTRY : snapshots
  STAFF_TIMESHEET ||--o{ TIMESHEET_ADJUSTMENT : corrects
  TIMESHEET_ADJUSTMENT ||--o| ATTENDANCE_CORRECTION_EVENT : applies
  STAFF_PROFILE ||--|| STAFF_PAY_PROFILE : configures
  STAFF_PAY_PROFILE ||--o{ STAFF_PAY_RATE_VERSION : rates
  PAYROLL_CALENDAR ||--o{ PAYROLL_PERIOD : generates
  PAYROLL_PERIOD ||--o{ PAYROLL_RUN : executes
  PAYROLL_RUN ||--o{ PAYROLL_RUN_WORKER : calculates
  PAYROLL_RUN_WORKER ||--o{ PAYROLL_EARNING_LINE : earns
  PAYROLL_RUN_WORKER ||--o{ PAYROLL_SOURCE_ALLOCATION : consumes
  PAYROLL_RUN ||--o{ PAYROLL_CORRECTION_SOURCE : corrects
  PAYROLL_RUN ||--o{ PAYROLL_RUN : supplemental_of
  PAYROLL_RUN ||--|| PAYROLL_FINALIZATION_SNAPSHOT : freezes
  PAYROLL_RUN_WORKER ||--o{ PAY_STATEMENT : renders
  PAYROLL_RUN ||--o{ PAYOUT_BATCH : funds
  PAYOUT_BATCH ||--o{ PAYOUT_ITEM : pays
  PAYOUT_ITEM ||--o{ PAYOUT_ATTEMPT : attempts
  PAYOUT_ITEM ||--|| PAYOUT_RECONCILIATION : reconciles
```

Every operational child carries `tenant_id`; branch/staff foreign keys are composite. Ledger/history tables are append-only. Migration `0024_sprint12_payroll_correctness_hardening` adds immutable attendance correction overlays, explicit payroll profile/policy/rate references, correction-source attribution, staff-owned payment-method keys and stable provider request keys. Open-session/open-break, effective-rate overlap, active provider-attempt and source-use constraints are enforced by PostgreSQL.
