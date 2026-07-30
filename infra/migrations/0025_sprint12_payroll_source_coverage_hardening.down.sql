BEGIN;
ALTER TABLE payroll_correction_sources DROP CONSTRAINT IF EXISTS payroll_correction_sources_delta_minor_check;
ALTER TABLE payroll_correction_sources ADD CONSTRAINT payroll_correction_sources_delta_minor_check CHECK(delta_minor<>0);
ALTER TABLE timesheet_periods DROP CONSTRAINT IF EXISTS timesheet_periods_no_overlap;
ALTER TABLE attendance_exceptions DROP CONSTRAINT attendance_exceptions_exception_type_check;
ALTER TABLE attendance_exceptions ADD CONSTRAINT attendance_exceptions_exception_type_check CHECK(exception_type IN(
  'MISSED_CLOCK_IN','MISSED_CLOCK_OUT','DUPLICATE_CLOCK_IN','CLOCK_OUT_WITHOUT_SESSION','BREAK_END_WITHOUT_START',
  'OPEN_BREAK_AT_CLOCK_OUT','EXCESSIVE_SESSION_DURATION','LATE_ARRIVAL','EARLY_DEPARTURE','UNSCHEDULED_WORK',
  'CROSS_BRANCH_OVERLAP','BREAK_POLICY_VIOLATION','OVERTIME_WARNING','DEVICE_NOT_TRUSTED','LOCATION_POLICY_FAILED',
  'LATE_ATTENDANCE_AFTER_PERIOD_CLOSE','CROSS_PERIOD_ATTENDANCE'
));
DROP INDEX IF EXISTS attendance_overtime_staff_date_idx;
DROP TABLE IF EXISTS attendance_overtime_classifications;
ALTER TABLE workforce_compliance_policy_versions DROP COLUMN IF EXISTS attendance_projection_rules_json;
DROP INDEX IF EXISTS pos_tip_one_payroll_claim_idx;
DROP INDEX IF EXISTS pos_tip_payroll_pending_idx;
DROP TRIGGER IF EXISTS tip_allocations_append_only ON pos_tip_allocations;
DROP FUNCTION IF EXISTS sprint12_tip_payroll_disposition_guard();
CREATE TRIGGER tip_allocations_append_only BEFORE UPDATE OR DELETE ON pos_tip_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
ALTER TABLE pos_tip_allocations
  DROP CONSTRAINT IF EXISTS pos_tip_payroll_paid_shape,
  DROP CONSTRAINT IF EXISTS pos_tip_payroll_claim_shape,
  DROP CONSTRAINT IF EXISTS pos_tip_payroll_claim_fk,
  DROP CONSTRAINT IF EXISTS pos_tip_payroll_disposition_check,
  DROP COLUMN IF EXISTS disposition_version,
  DROP COLUMN IF EXISTS payroll_paid_at,
  DROP COLUMN IF EXISTS claimed_by_payroll_run_id,
  DROP COLUMN IF EXISTS payroll_disposition_fingerprint,
  DROP COLUMN IF EXISTS payroll_disposition_evidence_json,
  DROP COLUMN IF EXISTS payroll_disposition;
DELETE FROM schema_migrations WHERE version='0025_sprint12_payroll_source_coverage_hardening';
COMMIT;
