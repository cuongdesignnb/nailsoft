BEGIN;
CREATE OR REPLACE FUNCTION sprint12_prevent_finalized_child_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM payroll_run_workers w JOIN payroll_runs r ON r.tenant_id=w.tenant_id AND r.id=w.payroll_run_id WHERE w.tenant_id=OLD.tenant_id AND w.id=OLD.payroll_worker_id AND r.state IN('FINALIZED','VOID_PENDING','VOIDED')) THEN RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION sprint12_prevent_finalized_source_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM payroll_runs r WHERE r.tenant_id=OLD.tenant_id AND r.id=OLD.payroll_run_id AND r.state IN('FINALIZED','VOID_PENDING','VOIDED')) THEN
    RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DROP INDEX IF EXISTS payout_unknown_poll_idx;
DROP INDEX IF EXISTS payroll_correction_ready_idx;
DROP INDEX IF EXISTS payroll_day_branch_idx;
DROP INDEX IF EXISTS timesheet_projection_lookup_idx;
DROP TRIGGER IF EXISTS payroll_correction_source_used_immutable ON payroll_correction_sources;
DROP FUNCTION IF EXISTS sprint12_correction_source_used_immutable();
DROP TRIGGER IF EXISTS staff_pay_rate_used_immutable ON staff_pay_rate_versions;
DROP TRIGGER IF EXISTS workforce_policy_version_used_immutable ON workforce_compliance_policy_versions;
DROP FUNCTION IF EXISTS sprint12_used_policy_rate_immutable();

DROP INDEX IF EXISTS payout_attempt_one_active_idx;
DROP INDEX IF EXISTS payout_attempts_provider_key_idx;
DROP TRIGGER IF EXISTS payout_item_assign_stable_provider_key ON payout_items;
DROP FUNCTION IF EXISTS sprint12_assign_stable_provider_key();
ALTER TABLE payout_attempts ADD CONSTRAINT payout_attempts_tenant_id_provider_request_key_key UNIQUE(tenant_id,provider_request_key);

ALTER TABLE payout_items DROP CONSTRAINT IF EXISTS payout_item_staff_payment_method_fk;
ALTER TABLE payout_items DROP CONSTRAINT IF EXISTS payout_items_tenant_provider_request_key_key;
ALTER TABLE payout_items DROP CONSTRAINT IF EXISTS payout_items_state_check;
ALTER TABLE payout_items DROP COLUMN IF EXISTS manual_evidence_hash,DROP COLUMN IF EXISTS manual_recorded_by_user_id,DROP COLUMN IF EXISTS unknown_since,DROP COLUMN IF EXISTS lease_expires_at,DROP COLUMN IF EXISTS provider_request_key;
ALTER TABLE payout_items ADD CONSTRAINT payout_items_state_check CHECK(state IN('PENDING','PROCESSING','PAID','FAILED','CANCELLED','REVERSAL_PENDING','REVERSED'));
ALTER TABLE payout_items ADD CONSTRAINT payout_items_tenant_id_payment_method_id_fkey FOREIGN KEY(tenant_id,payment_method_id) REFERENCES staff_payment_methods(tenant_id,id);
ALTER TABLE staff_payment_methods DROP CONSTRAINT IF EXISTS staff_payment_methods_tenant_id_id_staff_id_key;

DROP TABLE IF EXISTS payroll_correction_sources;
ALTER TABLE payroll_approval_history DROP CONSTRAINT IF EXISTS payroll_approval_history_decision_check;
ALTER TABLE payroll_approval_history ADD CONSTRAINT payroll_approval_history_decision_check CHECK(decision IN('SUBMITTED','APPROVED','FINALIZED','VOID_REQUESTED','VOID_APPROVED','VOIDED'));
ALTER TABLE payroll_earning_lines DROP CONSTRAINT IF EXISTS payroll_earning_branch_fk,DROP CONSTRAINT IF EXISTS payroll_earning_rate_fk,DROP COLUMN IF EXISTS branch_id,DROP COLUMN IF EXISTS pay_rate_version_id;
ALTER TABLE payroll_run_workers DROP CONSTRAINT IF EXISTS payroll_workers_policy_fk,DROP CONSTRAINT IF EXISTS payroll_workers_profile_fk,DROP COLUMN IF EXISTS policy_version_id,DROP COLUMN IF EXISTS pay_profile_id;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_correction_contract,DROP CONSTRAINT IF EXISTS payroll_runs_correction_parent_fk,DROP COLUMN IF EXISTS calculation_generation,DROP COLUMN IF EXISTS correction_of_payroll_run_id;

ALTER TABLE timesheet_approvals DROP CONSTRAINT IF EXISTS timesheet_approvals_decision_check;
ALTER TABLE timesheet_approvals ADD CONSTRAINT timesheet_approvals_decision_check CHECK(decision IN('APPROVED','REJECTED','LOCKED','REOPENED'));
ALTER TABLE staff_timesheets DROP COLUMN IF EXISTS locked_fingerprint,DROP COLUMN IF EXISTS approved_fingerprint,DROP COLUMN IF EXISTS submitted_fingerprint,DROP COLUMN IF EXISTS projected_at,DROP COLUMN IF EXISTS projection_input_fingerprint;
ALTER TABLE timesheet_adjustment_requests DROP COLUMN IF EXISTS after_fingerprint,DROP COLUMN IF EXISTS before_fingerprint,DROP COLUMN IF EXISTS applied_by_user_id,DROP COLUMN IF EXISTS applied_at;
DROP TABLE IF EXISTS attendance_correction_events;
DELETE FROM schema_migrations WHERE version='0024_sprint12_payroll_correctness_hardening';
COMMIT;
