# Sprint 12 Workforce and Payroll API

All paths are under `/v1`, require bearer authentication, tenant context and granular permission. Every POST command requires `Idempotency-Key`; money is a decimal integer-minor-unit string where it enters JSON. Commands are online-only. Realtime payloads contain safe identifiers and `refetch: true` only.

## Time clock and own staff

`GET /time-clock/status`; `POST /time-clock/clock-in`, `/clock-out`, `/breaks/start`, `/breaks/end`; `GET /time-clock/sessions`, `/sessions/{id}`, `/exceptions`, `/devices`; `POST /time-clock/exceptions/{id}/acknowledge|resolve|waive`, `/devices`, `/devices/{id}/revoke`.

Own scope: `GET /staff/me/time-clock/status`, `/attendance`; `POST /staff/me/time-clock/clock-in|clock-out|breaks/start|breaks/end`.

## Timesheets and compliance

`GET|POST /timesheet-periods`; commands `/open-submission`, `/start-review`, `/lock`, `/close`. `GET /timesheets`, `/timesheets/{id}`; commands `/submit`, `/approve`, `/reject`, `/reopen`, `/lock`. `GET|POST /timesheets/{id}/adjustments`; adjustment commands `/submit`, `/approve`, `/reject`, `/cancel`.

Own scope: `GET /staff/me/timesheets`, `/staff/me/timesheets/{id}`; `POST /staff/me/timesheets/{id}/submit`, `/adjustments`.

Policies: `GET|POST /workforce-compliance/policies`; `POST /policies/{id}/versions`, `/versions/{versionId}/activate`, `/retire`.

## Pay profile and payroll

`GET /staff/{staffId}/pay-profile`; `POST /staff/{staffId}/pay-profile/update`; `GET|POST /staff/{staffId}/pay-rates`; `POST /staff/{staffId}/pay-rates/{rateId}/deactivate`.

`GET|POST /payroll-calendars`; commands `/update`, `/activate`, `/deactivate`. `GET /payroll/periods`; `POST /payroll/periods/generate`. `GET|POST /payroll/runs`; `GET /payroll/runs/{runId}`; commands `/calculate`, `/recalculate`, `/submit`, `/approve`, `/finalize`, `/request-void`, `/approve-void`. Worker and exception reads are nested below the run; exception commands acknowledge/resolve/waive.

Statements: `GET /pay-statements`, `/{id}`, `/staff/me/pay-statements`, `/staff/me/pay-statements/{id}`.

## Payout and reporting

`GET|POST /payout-batches`; commands `/{id}/submit|approve|process|cancel|retry-failed`; item reads and `record-manual-payment`, `request-reversal`, `approve-reversal`; reconciliation read/resolve.

Reports: `/workforce/reports/{attendance|exceptions|overtime|break-compliance|timesheets}` and `/payroll/reports/{summary|earnings|commission-tip|exceptions|payout|reconciliation}`. Export: `POST /payroll/exports`, `GET /payroll/exports/{id}`.

Canonical conflict codes include `TIME_CLOCK_ALREADY_CLOCKED_IN`, `TIME_CLOCK_BREAK_ALREADY_OPEN`, `TIMESHEET_SELF_APPROVAL_DENIED`, `TIMESHEET_ALREADY_USED_IN_PAYROLL`, `WORKFORCE_POLICY_NOT_LEGALLY_REVIEWED`, `PAY_RATE_OVERLAP`, `PAYROLL_SOURCE_ALREADY_USED`, `PAYROLL_SELF_APPROVAL_DENIED`, `PAYROLL_FINALIZED_IMMUTABLE`, `PAYOUT_PROVIDER_NOT_CONFIGURED`, `PAYOUT_EVIDENCE_REQUIRED` and `PAYOUT_RECONCILIATION_VARIANCE`.
