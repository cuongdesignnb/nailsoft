BEGIN;

-- Sprint 12 stores UTC facts and versioned policy snapshots. Jurisdiction rules are data, never code.
CREATE TABLE time_clock_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid,
  status text NOT NULL DEFAULT 'INCOMPLETE' CHECK(status IN('INCOMPLETE','ACTIVE','DISABLED')),
  timezone text NOT NULL, geofence_mode text NOT NULL DEFAULT 'DISABLED' CHECK(geofence_mode IN('DISABLED','EVIDENCE_ONLY','ENFORCED')),
  maximum_session_minutes integer, location_radius_meters integer, policy_json jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  UNIQUE NULLS NOT DISTINCT(tenant_id,branch_id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK(maximum_session_minutes IS NULL OR maximum_session_minutes > 0), CHECK(location_radius_meters IS NULL OR location_radius_meters > 0)
);
CREATE TABLE time_clock_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  name text NOT NULL, device_type text NOT NULL CHECK(device_type IN('KIOSK','ADMIN_WEB','OWNER_MOBILE','STAFF_MOBILE','API')),
  secret_hash text, status text NOT NULL DEFAULT 'TRUSTED' CHECK(status IN('TRUSTED','REVOKED','LOCKED')),
  failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz, last_seen_at timestamptz, revoked_at timestamptz,
  created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), CHECK(failed_attempts >= 0)
);
CREATE TABLE time_clock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, staff_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN('CLOCK_IN','CLOCK_OUT','BREAK_START','BREAK_END','MANUAL_SESSION_OPEN','MANUAL_SESSION_CLOSE','EVENT_VOID_REQUESTED','EVENT_VOID_APPROVED')),
  occurred_at timestamptz NOT NULL DEFAULT now(), client_occurred_at timestamptz, branch_timezone_snapshot text NOT NULL,
  source text NOT NULL CHECK(source IN('STAFF_MOBILE','OWNER_MOBILE','ADMIN_WEB','KIOSK','API','SYSTEM')),
  device_id uuid, schedule_reference_id uuid, break_type text CHECK(break_type IS NULL OR break_type IN('PAID_REST','UNPAID_MEAL','OTHER')),
  location_evidence_json jsonb NOT NULL DEFAULT '{}', reason_code text, note text, actor_user_id uuid,
  idempotency_key_hash text NOT NULL, generation_key text, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,idempotency_key_hash), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,device_id) REFERENCES time_clock_devices(tenant_id,id)
);
CREATE INDEX time_clock_events_staff_time_idx ON time_clock_events(tenant_id,staff_id,occurred_at DESC);

CREATE TABLE attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, staff_id uuid NOT NULL,
  shift_id uuid, clock_in_event_id uuid NOT NULL, clock_out_event_id uuid, state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','CLOSED','REVIEW_REQUIRED','ADJUSTED','VOIDED')),
  started_at timestamptz NOT NULL, ended_at timestamptz, regular_seconds bigint NOT NULL DEFAULT 0, overtime_seconds bigint NOT NULL DEFAULT 0,
  payable_seconds bigint NOT NULL DEFAULT 0, paid_break_seconds bigint NOT NULL DEFAULT 0, unpaid_break_seconds bigint NOT NULL DEFAULT 0,
  exception_flags_json jsonb NOT NULL DEFAULT '[]', policy_version_id uuid, version integer NOT NULL DEFAULT 1, fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,clock_in_event_id) REFERENCES time_clock_events(tenant_id,id), FOREIGN KEY(tenant_id,clock_out_event_id) REFERENCES time_clock_events(tenant_id,id),
  CHECK(ended_at IS NULL OR ended_at >= started_at), CHECK(regular_seconds>=0 AND overtime_seconds>=0 AND payable_seconds>=0 AND paid_break_seconds>=0 AND unpaid_break_seconds>=0)
);
CREATE UNIQUE INDEX attendance_one_active_session_idx ON attendance_sessions(tenant_id,staff_id) WHERE state='OPEN';
CREATE INDEX attendance_branch_time_idx ON attendance_sessions(tenant_id,branch_id,started_at DESC);
CREATE TABLE attendance_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), session_id uuid NOT NULL,
  start_event_id uuid NOT NULL, end_event_id uuid, break_type text NOT NULL CHECK(break_type IN('PAID_REST','UNPAID_MEAL','OTHER')),
  state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','CLOSED','VOIDED')), started_at timestamptz NOT NULL, ended_at timestamptz,
  duration_seconds bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,session_id) REFERENCES attendance_sessions(tenant_id,id), FOREIGN KEY(tenant_id,start_event_id) REFERENCES time_clock_events(tenant_id,id),
  FOREIGN KEY(tenant_id,end_event_id) REFERENCES time_clock_events(tenant_id,id), CHECK(ended_at IS NULL OR ended_at>=started_at), CHECK(duration_seconds>=0)
);
CREATE UNIQUE INDEX attendance_one_open_break_idx ON attendance_breaks(tenant_id,session_id) WHERE state='OPEN';
CREATE TABLE attendance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, staff_id uuid NOT NULL,
  session_id uuid, exception_type text NOT NULL CHECK(exception_type IN('MISSED_CLOCK_IN','MISSED_CLOCK_OUT','DUPLICATE_CLOCK_IN','CLOCK_OUT_WITHOUT_SESSION','BREAK_END_WITHOUT_START','OPEN_BREAK_AT_CLOCK_OUT','EXCESSIVE_SESSION_DURATION','LATE_ARRIVAL','EARLY_DEPARTURE','UNSCHEDULED_WORK','CROSS_BRANCH_OVERLAP','BREAK_POLICY_VIOLATION','OVERTIME_WARNING','DEVICE_NOT_TRUSTED','LOCATION_POLICY_FAILED')),
  state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','ACKNOWLEDGED','RESOLVED','WAIVED','CANCELLED')),
  severity text NOT NULL DEFAULT 'WARNING' CHECK(severity IN('INFO','WARNING','BLOCKING')), policy_version_id uuid,
  evidence_json jsonb NOT NULL DEFAULT '{}', resolution_reason text, resolved_by_user_id uuid, resolved_at timestamptz,
  generation_key text NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(tenant_id,session_id) REFERENCES attendance_sessions(tenant_id,id)
);
CREATE INDEX attendance_open_exceptions_idx ON attendance_exceptions(tenant_id,branch_id,state,severity) WHERE state IN('OPEN','ACKNOWLEDGED');
CREATE TABLE attendance_projection_checkpoints (
  tenant_id uuid NOT NULL REFERENCES tenants(id), staff_id uuid NOT NULL, last_event_id uuid, last_occurred_at timestamptz,
  projection_version bigint NOT NULL DEFAULT 0, fingerprint text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,staff_id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(tenant_id,last_event_id) REFERENCES time_clock_events(tenant_id,id)
);

CREATE TABLE workforce_compliance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code text NOT NULL, name text NOT NULL,
  jurisdiction_code text, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','SUPERSEDED','RETIRED')),
  created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE TABLE workforce_compliance_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), policy_id uuid NOT NULL, version integer NOT NULL,
  effective_from date NOT NULL, effective_to date, timezone_basis text NOT NULL DEFAULT 'BRANCH', max_continuous_work_minutes integer,
  meal_break_required_after_minutes integer, meal_break_minimum_minutes integer, rest_break_rules_json jsonb NOT NULL DEFAULT '{}',
  daily_overtime_rules_json jsonb NOT NULL DEFAULT '{}', weekly_overtime_rules_json jsonb NOT NULL DEFAULT '{}', consecutive_day_rules_json jsonb NOT NULL DEFAULT '{}',
  grace_period_minutes integer NOT NULL DEFAULT 0, rounding_policy_json jsonb NOT NULL DEFAULT '{}', geofence_policy_json jsonb NOT NULL DEFAULT '{}',
  manual_adjustment_dual_control boolean NOT NULL DEFAULT true, timesheet_dual_control boolean NOT NULL DEFAULT true,
  payroll_dual_control boolean NOT NULL DEFAULT true, payout_dual_control boolean NOT NULL DEFAULT true,
  legal_review_status text NOT NULL DEFAULT 'PENDING' CHECK(legal_review_status IN('PENDING','APPROVED','REJECTED','EXPIRED')),
  policy_json jsonb NOT NULL DEFAULT '{}', fingerprint text NOT NULL, created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,policy_id,version), FOREIGN KEY(tenant_id,policy_id) REFERENCES workforce_compliance_policies(tenant_id,id),
  CHECK(effective_to IS NULL OR effective_to>=effective_from), CHECK(grace_period_minutes>=0),
  CHECK(max_continuous_work_minutes IS NULL OR max_continuous_work_minutes>0), CHECK(meal_break_required_after_minutes IS NULL OR meal_break_required_after_minutes>0),
  CHECK(meal_break_minimum_minutes IS NULL OR meal_break_minimum_minutes>0)
);
CREATE TABLE workforce_compliance_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, staff_id uuid NOT NULL,
  policy_version_id uuid NOT NULL, attendance_session_id uuid, violation_type text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','ACKNOWLEDGED','RESOLVED','WAIVED','CANCELLED')),
  evidence_json jsonb NOT NULL DEFAULT '{}', generation_key text NOT NULL, resolution_reason text, resolved_by_user_id uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,policy_version_id) REFERENCES workforce_compliance_policy_versions(tenant_id,id), FOREIGN KEY(tenant_id,attendance_session_id) REFERENCES attendance_sessions(tenant_id,id)
);
CREATE TABLE workforce_compliance_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), violation_id uuid NOT NULL,
  reason text NOT NULL, evidence_json jsonb NOT NULL DEFAULT '{}', actor_user_id uuid NOT NULL, policy_version_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,violation_id) REFERENCES workforce_compliance_violations(tenant_id,id),
  FOREIGN KEY(tenant_id,policy_version_id) REFERENCES workforce_compliance_policy_versions(tenant_id,id)
);

CREATE TABLE timesheet_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','SUBMISSION_OPEN','REVIEW','APPROVED','LOCKED','CLOSED')),
  timezone text NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), CHECK(ends_on>=starts_on)
);
CREATE TABLE staff_timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), period_id uuid NOT NULL, staff_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','SUBMITTED','APPROVED','REJECTED','LOCKED','REOPENED')),
  regular_seconds bigint NOT NULL DEFAULT 0, overtime_seconds bigint NOT NULL DEFAULT 0, payable_seconds bigint NOT NULL DEFAULT 0,
  scheduled_seconds bigint NOT NULL DEFAULT 0, paid_break_seconds bigint NOT NULL DEFAULT 0, unpaid_break_seconds bigint NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0, adjustment_count integer NOT NULL DEFAULT 0, branch_allocation_json jsonb NOT NULL DEFAULT '{}',
  fingerprint text NOT NULL, source_locked_at timestamptz, source_locked_by_payroll_run_id uuid, submitted_by_user_id uuid, approved_by_user_id uuid,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,period_id,staff_id), FOREIGN KEY(tenant_id,period_id) REFERENCES timesheet_periods(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), CHECK(regular_seconds>=0 AND overtime_seconds>=0 AND payable_seconds>=0 AND scheduled_seconds>=0 AND paid_break_seconds>=0 AND unpaid_break_seconds>=0)
);
CREATE TABLE timesheet_day_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), timesheet_id uuid NOT NULL, local_date date NOT NULL,
  branch_id uuid NOT NULL, source_session_ids uuid[] NOT NULL DEFAULT '{}', regular_seconds bigint NOT NULL DEFAULT 0, overtime_seconds bigint NOT NULL DEFAULT 0,
  payable_seconds bigint NOT NULL DEFAULT 0, paid_break_seconds bigint NOT NULL DEFAULT 0, unpaid_break_seconds bigint NOT NULL DEFAULT 0,
  rounding_delta_seconds bigint NOT NULL DEFAULT 0, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,timesheet_id,local_date,branch_id), FOREIGN KEY(tenant_id,timesheet_id) REFERENCES staff_timesheets(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), CHECK(regular_seconds>=0 AND overtime_seconds>=0 AND payable_seconds>=0)
);
CREATE TABLE timesheet_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), timesheet_id uuid NOT NULL,
  adjustment_type text NOT NULL CHECK(adjustment_type IN('ADD_CLOCK_EVENT','REPLACE_CLOCK_EVENT','VOID_CLOCK_EVENT','ADD_BREAK','CHANGE_BREAK_TYPE','CHANGE_BRANCH_ATTRIBUTION','CHANGE_PAYABLE_TIME','NOTE_ONLY')),
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','APPLIED','CANCELLED')),
  requested_change_json jsonb NOT NULL, before_calculation_json jsonb NOT NULL, after_calculation_json jsonb NOT NULL,
  reason text NOT NULL, requester_user_id uuid NOT NULL, approver_user_id uuid, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,timesheet_id) REFERENCES staff_timesheets(tenant_id,id)
);
CREATE TABLE timesheet_adjustment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), adjustment_id uuid NOT NULL,
  from_state text, to_state text NOT NULL, actor_user_id uuid NOT NULL, reason text, snapshot_json jsonb NOT NULL DEFAULT '{}', request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,adjustment_id) REFERENCES timesheet_adjustment_requests(tenant_id,id)
);
CREATE TABLE timesheet_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), timesheet_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN('APPROVED','REJECTED','LOCKED','REOPENED')), actor_user_id uuid NOT NULL,
  reason text, snapshot_json jsonb NOT NULL, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,timesheet_id) REFERENCES staff_timesheets(tenant_id,id)
);

CREATE TABLE staff_pay_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), staff_id uuid NOT NULL,
  profile_type text CHECK(profile_type IS NULL OR profile_type IN('HOURLY','SALARY','COMMISSION_ONLY','HOURLY_PLUS_COMMISSION','SALARY_PLUS_COMMISSION')),
  status text NOT NULL DEFAULT 'INCOMPLETE' CHECK(status IN('INCOMPLETE','ACTIVE','INACTIVE')), currency char(3), version integer NOT NULL DEFAULT 1,
  effective_from date, effective_to date, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,staff_id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to>=effective_from)
);
CREATE TABLE staff_pay_rate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), pay_profile_id uuid NOT NULL, branch_id uuid,
  component_type text NOT NULL CHECK(component_type IN('REGULAR_HOURLY_RATE','OVERTIME_MULTIPLIER','DOUBLE_TIME_MULTIPLIER','SALARY_PERIOD_AMOUNT','FIXED_ALLOWANCE','SERVICE_COMMISSION_OVERRIDE','RETAIL_COMMISSION_OVERRIDE')),
  amount_minor bigint, multiplier_numerator bigint, multiplier_denominator bigint, currency char(3) NOT NULL, effective_from date NOT NULL, effective_to date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')), version integer NOT NULL, fingerprint text NOT NULL,
  created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), deactivated_at timestamptz, UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,pay_profile_id,branch_id,component_type,version), FOREIGN KEY(tenant_id,pay_profile_id) REFERENCES staff_pay_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), CHECK(amount_minor IS NULL OR amount_minor>=0),
  CHECK(multiplier_numerator IS NULL OR multiplier_numerator>0), CHECK(multiplier_denominator IS NULL OR multiplier_denominator>0), CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
ALTER TABLE staff_pay_rate_versions ADD CONSTRAINT staff_pay_rate_no_overlap EXCLUDE USING gist
  (tenant_id WITH =, pay_profile_id WITH =, COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid) WITH =, component_type WITH =,
   daterange(effective_from,COALESCE(effective_to,'infinity'::date),'[]') WITH &&) WHERE(status='ACTIVE');
CREATE TABLE staff_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), staff_id uuid NOT NULL,
  method_type text NOT NULL CHECK(method_type IN('BANK_TRANSFER_REFERENCE','CASH','CHECK','EXTERNAL_PAYROLL_PROVIDER','MANUAL_OTHER')),
  token_reference text, display_hint text, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE','VERIFICATION_REQUIRED')),
  is_primary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id)
);
CREATE UNIQUE INDEX staff_one_primary_payment_method_idx ON staff_payment_methods(tenant_id,staff_id) WHERE is_primary AND status='ACTIVE';

CREATE TABLE payroll_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
  frequency text NOT NULL CHECK(frequency IN('WEEKLY','BIWEEKLY','SEMIMONTHLY','MONTHLY','CUSTOM')),
  timezone text NOT NULL, currency char(3) NOT NULL, status text NOT NULL DEFAULT 'INACTIVE' CHECK(status IN('INACTIVE','ACTIVE')),
  policy_json jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), calendar_id uuid NOT NULL, timesheet_period_id uuid,
  starts_on date NOT NULL, ends_on date NOT NULL, pay_date date NOT NULL, state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','TIMESHEET_REVIEW','READY','PAYROLL_RUNNING','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,calendar_id,starts_on,ends_on),
  FOREIGN KEY(tenant_id,calendar_id) REFERENCES payroll_calendars(tenant_id,id), FOREIGN KEY(tenant_id,timesheet_period_id) REFERENCES timesheet_periods(tenant_id,id), CHECK(ends_on>=starts_on)
);
CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_period_id uuid NOT NULL,
  run_type text NOT NULL CHECK(run_type IN('REGULAR','OFF_CYCLE','SUPPLEMENTAL','CORRECTION')),
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','CALCULATING','CALCULATED','PENDING_APPROVAL','APPROVED','FINALIZED','VOID_PENDING','VOIDED','FAILED')),
  currency char(3) NOT NULL, calculation_version text NOT NULL DEFAULT 'sprint12-v1', source_fingerprint text,
  gross_pay_minor bigint NOT NULL DEFAULT 0, reimbursement_minor bigint NOT NULL DEFAULT 0, employee_deductions_minor bigint NOT NULL DEFAULT 0,
  withholding_minor bigint NOT NULL DEFAULT 0, employer_contributions_minor bigint NOT NULL DEFAULT 0, net_pay_minor bigint NOT NULL DEFAULT 0,
  worker_count integer NOT NULL DEFAULT 0, blocking_exception_count integer NOT NULL DEFAULT 0, prepared_by_user_id uuid NOT NULL,
  approved_by_user_id uuid, finalized_by_user_id uuid, finalized_at timestamptz, void_reason text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,payroll_period_id) REFERENCES payroll_periods(tenant_id,id), CHECK(gross_pay_minor>=0 AND reimbursement_minor>=0 AND employee_deductions_minor>=0 AND withholding_minor>=0 AND employer_contributions_minor>=0)
);
ALTER TABLE staff_timesheets ADD CONSTRAINT staff_timesheets_source_run_fk FOREIGN KEY(tenant_id,source_locked_by_payroll_run_id) REFERENCES payroll_runs(tenant_id,id);
CREATE TABLE payroll_run_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_run_id uuid NOT NULL, staff_id uuid NOT NULL,
  pay_profile_version_json jsonb NOT NULL, policy_version_json jsonb NOT NULL, source_fingerprint text NOT NULL,
  gross_pay_minor bigint NOT NULL DEFAULT 0, reimbursement_minor bigint NOT NULL DEFAULT 0, deduction_minor bigint NOT NULL DEFAULT 0,
  withholding_minor bigint NOT NULL DEFAULT 0, net_pay_minor bigint NOT NULL DEFAULT 0, currency char(3) NOT NULL,
  state text NOT NULL DEFAULT 'CALCULATED' CHECK(state IN('CALCULATED','EXCEPTION','FINALIZED','VOIDED')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,payroll_run_id,staff_id), FOREIGN KEY(tenant_id,payroll_run_id) REFERENCES payroll_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), CHECK(gross_pay_minor>=0 AND reimbursement_minor>=0 AND deduction_minor>=0 AND withholding_minor>=0)
);
CREATE TABLE payroll_earning_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_worker_id uuid NOT NULL,
  earning_type text NOT NULL CHECK(earning_type IN('REGULAR_HOURS','OVERTIME','DOUBLE_TIME','SALARY','SERVICE_COMMISSION','RETAIL_COMMISSION','TIP','BONUS','ALLOWANCE','REIMBURSEMENT','SUPPLEMENTAL_ADJUSTMENT','CORRECTION')),
  quantity_seconds bigint, rate_minor bigint, multiplier_numerator bigint NOT NULL DEFAULT 1, multiplier_denominator bigint NOT NULL DEFAULT 1,
  amount_minor bigint NOT NULL, currency char(3) NOT NULL, source_type text, source_id uuid, source_fingerprint text, metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,payroll_worker_id) REFERENCES payroll_run_workers(tenant_id,id),
  CHECK(quantity_seconds IS NULL OR quantity_seconds>=0), CHECK(rate_minor IS NULL OR rate_minor>=0), CHECK(multiplier_numerator>0 AND multiplier_denominator>0)
);
CREATE TABLE payroll_deduction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_worker_id uuid NOT NULL,
  deduction_type text NOT NULL CHECK(deduction_type IN('MANUAL_DEDUCTION','ADVANCE_RECOVERY','UNIFORM_OR_EQUIPMENT','BENEFIT','TAX_WITHHOLDING_INPUT','OTHER')),
  amount_minor bigint NOT NULL CHECK(amount_minor>=0), currency char(3) NOT NULL, source_id uuid, reason text NOT NULL, approved_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,payroll_worker_id) REFERENCES payroll_run_workers(tenant_id,id)
);
CREATE TABLE payroll_employer_contribution_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_worker_id uuid NOT NULL,
  contribution_type text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>=0), currency char(3) NOT NULL, source_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,payroll_worker_id) REFERENCES payroll_run_workers(tenant_id,id)
);
CREATE TABLE payroll_source_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_run_id uuid NOT NULL, payroll_worker_id uuid NOT NULL,
  source_type text NOT NULL CHECK(source_type IN('LOCKED_TIMESHEET','LOCKED_COMMISSION_ENTRIES','LOCKED_TIP_ALLOCATIONS','APPROVED_PAYROLL_ADJUSTMENTS','APPROVED_REIMBURSEMENTS','APPROVED_DEDUCTIONS','PRIOR_RUN_CORRECTIONS')),
  source_id uuid NOT NULL, earning_usage_key text NOT NULL, source_fingerprint text NOT NULL, allocated_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL, state text NOT NULL DEFAULT 'CLAIMED' CHECK(state IN('CLAIMED','CONSUMED','RELEASED','REVERSED')),
  created_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz, UNIQUE(tenant_id,id),
  CONSTRAINT payroll_source_unique_usage UNIQUE(tenant_id,source_type,source_id,earning_usage_key), FOREIGN KEY(tenant_id,payroll_run_id) REFERENCES payroll_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,payroll_worker_id) REFERENCES payroll_run_workers(tenant_id,id)
);
CREATE INDEX payroll_source_claim_idx ON payroll_source_allocations(tenant_id,state,source_type) WHERE state='CLAIMED';
CREATE TABLE payroll_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_run_id uuid NOT NULL, payroll_worker_id uuid,
  exception_type text NOT NULL CHECK(exception_type IN('MISSING_TIMESHEET','UNLOCKED_TIMESHEET','OPEN_ATTENDANCE_SESSION','UNRESOLVED_ATTENDANCE_EXCEPTION','MISSING_PAY_RATE','OVERLAPPING_PAY_RATE','NEGATIVE_NET_PAY','CURRENCY_MISMATCH','DUPLICATE_SOURCE_USAGE','UNLOCKED_COMMISSION','UNSETTLED_TIP','MISSING_POLICY','POLICY_NOT_LEGALLY_REVIEWED','CALCULATION_FINGERPRINT_CHANGED','PAYOUT_METHOD_MISSING')),
  severity text NOT NULL CHECK(severity IN('INFO','WARNING','BLOCKING')), state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','ACKNOWLEDGED','RESOLVED','WAIVED')),
  details_json jsonb NOT NULL DEFAULT '{}', generation_key text NOT NULL, resolution_reason text, resolved_by_user_id uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,payroll_run_id) REFERENCES payroll_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,payroll_worker_id) REFERENCES payroll_run_workers(tenant_id,id)
);
CREATE TABLE payroll_approval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_run_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN('SUBMITTED','APPROVED','FINALIZED','VOID_REQUESTED','VOID_APPROVED','VOIDED')),
  actor_user_id uuid NOT NULL, reason text, snapshot_json jsonb NOT NULL, source_fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,payroll_run_id) REFERENCES payroll_runs(tenant_id,id)
);
CREATE TABLE payroll_finalization_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_run_id uuid NOT NULL,
  snapshot_json jsonb NOT NULL, source_fingerprint text NOT NULL, calculation_version text NOT NULL, finalized_by_user_id uuid NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,payroll_run_id), FOREIGN KEY(tenant_id,payroll_run_id) REFERENCES payroll_runs(tenant_id,id)
);
CREATE TABLE pay_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_run_id uuid NOT NULL, payroll_worker_id uuid NOT NULL, staff_id uuid NOT NULL,
  statement_version integer NOT NULL DEFAULT 1, employer_snapshot_json jsonb NOT NULL, statement_json jsonb NOT NULL, net_pay_minor bigint NOT NULL,
  currency char(3) NOT NULL, payment_status text NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN('UNPAID','PROCESSING','PAID','REVERSED')),
  correction_of_statement_id uuid, generated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,payroll_worker_id,statement_version),
  FOREIGN KEY(tenant_id,payroll_run_id) REFERENCES payroll_runs(tenant_id,id), FOREIGN KEY(tenant_id,payroll_worker_id) REFERENCES payroll_run_workers(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(tenant_id,correction_of_statement_id) REFERENCES pay_statements(tenant_id,id), CHECK(net_pay_minor>=0)
);

CREATE TABLE payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payroll_run_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','PENDING_APPROVAL','APPROVED','PROCESSING','PARTIALLY_PAID','PAID','FAILED','CANCELLED','REVERSAL_PENDING','REVERSED')),
  method text NOT NULL CHECK(method IN('BANK_TRANSFER_REFERENCE','CASH','CHECK','EXTERNAL_PAYROLL_PROVIDER','MANUAL_OTHER')),
  provider_code text, currency char(3) NOT NULL, total_minor bigint NOT NULL DEFAULT 0, item_count integer NOT NULL DEFAULT 0,
  requested_by_user_id uuid NOT NULL, approved_by_user_id uuid, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,payroll_run_id,method), FOREIGN KEY(tenant_id,payroll_run_id) REFERENCES payroll_runs(tenant_id,id), CHECK(total_minor>=0 AND item_count>=0)
);
CREATE TABLE payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), batch_id uuid NOT NULL, pay_statement_id uuid NOT NULL, staff_id uuid NOT NULL,
  payment_method_id uuid, state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','PROCESSING','PAID','FAILED','CANCELLED','REVERSAL_PENDING','REVERSED')),
  requested_minor bigint NOT NULL, confirmed_minor bigint, currency char(3) NOT NULL, provider_reference text, manual_evidence_json jsonb,
  paid_at timestamptz, failure_code text, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,pay_statement_id), FOREIGN KEY(tenant_id,batch_id) REFERENCES payout_batches(tenant_id,id),
  FOREIGN KEY(tenant_id,pay_statement_id) REFERENCES pay_statements(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_method_id) REFERENCES staff_payment_methods(tenant_id,id), CHECK(requested_minor>=0), CHECK(confirmed_minor IS NULL OR confirmed_minor>=0),
  CONSTRAINT payout_item_paid_evidence CHECK(state<>'PAID' OR (paid_at IS NOT NULL AND confirmed_minor=requested_minor AND (provider_reference IS NOT NULL OR manual_evidence_json IS NOT NULL)))
);
CREATE TABLE payout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payout_item_id uuid NOT NULL,
  attempt_no integer NOT NULL, state text NOT NULL CHECK(state IN('PENDING','SUBMITTED','CONFIRMED','FAILED','UNKNOWN')),
  provider_request_key text NOT NULL, provider_reference text, safe_request_json jsonb NOT NULL DEFAULT '{}', safe_response_json jsonb NOT NULL DEFAULT '{}',
  error_code text, next_retry_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,payout_item_id,attempt_no), UNIQUE(tenant_id,provider_request_key), FOREIGN KEY(tenant_id,payout_item_id) REFERENCES payout_items(tenant_id,id), CHECK(attempt_no>0)
);
CREATE TABLE payout_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), provider_code text NOT NULL, provider_event_id text NOT NULL,
  event_type text NOT NULL, payload_hash text NOT NULL, signature_verified boolean NOT NULL DEFAULT false, safe_payload_json jsonb NOT NULL DEFAULT '{}',
  processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,provider_code,provider_event_id)
);
CREATE TABLE payout_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payout_item_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'UNMATCHED' CHECK(state IN('UNMATCHED','MATCHED','VARIANCE','RESOLVED')),
  expected_minor bigint NOT NULL, confirmed_minor bigint NOT NULL DEFAULT 0, reversed_minor bigint NOT NULL DEFAULT 0, currency char(3) NOT NULL,
  external_reference text, variance_reason text, resolved_by_user_id uuid, resolved_at timestamptz, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,payout_item_id),
  FOREIGN KEY(tenant_id,payout_item_id) REFERENCES payout_items(tenant_id,id), CHECK(expected_minor>=0 AND confirmed_minor>=0 AND reversed_minor>=0)
);
CREATE TABLE payroll_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), requested_by_user_id uuid NOT NULL,
  export_type text NOT NULL, filters_json jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','PROCESSING','READY','FAILED','EXPIRED')),
  storage_key text, checksum text, error_code text, attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(tenant_id,id), CHECK(attempts>=0)
);

CREATE OR REPLACE FUNCTION sprint12_prevent_any_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY_VIOLATION' USING ERRCODE='55000'; END $$;
CREATE TRIGGER time_clock_events_append_only BEFORE UPDATE OR DELETE ON time_clock_events FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_any_mutation();
CREATE TRIGGER timesheet_adjustment_history_append_only BEFORE UPDATE OR DELETE ON timesheet_adjustment_history FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_any_mutation();
CREATE TRIGGER timesheet_approvals_append_only BEFORE UPDATE OR DELETE ON timesheet_approvals FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_any_mutation();
CREATE TRIGGER payroll_approval_history_append_only BEFORE UPDATE OR DELETE ON payroll_approval_history FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_any_mutation();
CREATE TRIGGER payroll_finalization_snapshots_append_only BEFORE UPDATE OR DELETE ON payroll_finalization_snapshots FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_any_mutation();
CREATE OR REPLACE FUNCTION sprint12_prevent_finalized_run_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.state IN('FINALIZED','VOID_PENDING','VOIDED') THEN RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF OLD.state IN('FINALIZED','VOID_PENDING','VOIDED') THEN
    IF ((OLD.state='FINALIZED' AND NEW.state='VOID_PENDING') OR (OLD.state='VOID_PENDING' AND NEW.state='VOIDED'))
       AND (to_jsonb(NEW)-ARRAY['state','version','updated_at','void_reason'])=(to_jsonb(OLD)-ARRAY['state','version','updated_at','void_reason']) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_run_finalized_immutable BEFORE UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_finalized_run_mutation();
CREATE OR REPLACE FUNCTION sprint12_prevent_finalized_child_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM payroll_run_workers w JOIN payroll_runs r ON r.tenant_id=w.tenant_id AND r.id=w.payroll_run_id WHERE w.tenant_id=OLD.tenant_id AND w.id=OLD.payroll_worker_id AND r.state IN('FINALIZED','VOID_PENDING','VOIDED')) THEN RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER payroll_earning_finalized_immutable BEFORE UPDATE OR DELETE ON payroll_earning_lines FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_finalized_child_mutation();
CREATE TRIGGER payroll_deduction_finalized_immutable BEFORE UPDATE OR DELETE ON payroll_deduction_lines FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_finalized_child_mutation();
CREATE OR REPLACE FUNCTION sprint12_prevent_finalized_source_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM payroll_runs r WHERE r.tenant_id=OLD.tenant_id AND r.id=OLD.payroll_run_id AND r.state IN('FINALIZED','VOID_PENDING','VOIDED')) THEN
    IF TG_OP='UPDATE' AND OLD.state='CLAIMED' AND NEW.state='CONSUMED'
       AND (to_jsonb(NEW)-ARRAY['state','consumed_at'])=(to_jsonb(OLD)-ARRAY['state','consumed_at']) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_source_finalized_immutable BEFORE UPDATE OR DELETE ON payroll_source_allocations FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_finalized_source_mutation();
CREATE OR REPLACE FUNCTION sprint12_pay_statement_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['payment_status'])<>(to_jsonb(OLD)-ARRAY['payment_status']) THEN RAISE EXCEPTION 'PAY_STATEMENT_IMMUTABLE' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER pay_statement_content_immutable BEFORE UPDATE OR DELETE ON pay_statements FOR EACH ROW EXECUTE FUNCTION sprint12_pay_statement_content_immutable();

INSERT INTO permissions(code,description) VALUES
('time_clock.self.use','Use own time clock'),('time_clock.session.read','Read attendance sessions'),('time_clock.session.manage','Manage attendance sessions'),
('time_clock.device.read','Read clock devices'),('time_clock.device.manage','Manage clock devices'),('time_clock.exception.read','Read attendance exceptions'),('time_clock.exception.resolve','Resolve attendance exceptions'),
('timesheet.self.read','Read own timesheets'),('timesheet.self.submit','Submit own timesheet'),('timesheet.adjustment.request','Request adjustment'),
('timesheet.read','Read timesheets'),('timesheet.review','Review timesheets'),('timesheet.approve','Approve timesheets'),('timesheet.lock','Lock timesheets'),
('workforce.policy.read','Read workforce policy'),('workforce.policy.manage','Manage workforce policy'),('workforce.compliance.read','Read compliance'),('workforce.compliance.resolve','Resolve compliance'),('workforce.report.read','Read workforce reports'),
('pay_profile.read','Read pay profiles'),('pay_profile.manage','Manage pay profiles'),('pay_rate.read','Read pay rates'),('pay_rate.manage','Manage pay rates'),
('payroll.calendar.read','Read payroll calendars'),('payroll.calendar.manage','Manage payroll calendars'),('payroll.run.read','Read payroll runs'),('payroll.run.create','Create payroll runs'),
('payroll.run.calculate','Calculate payroll'),('payroll.run.submit','Submit payroll'),('payroll.run.approve','Approve payroll'),('payroll.run.finalize','Finalize payroll'),('payroll.run.void','Void payroll'),
('payroll.adjustment.manage','Manage payroll adjustments'),('payroll.exception.resolve','Resolve payroll exceptions'),('payroll.statement.read','Read pay statements'),('payroll.report.read','Read payroll reports'),('payroll.export','Export payroll'),
('payout.batch.read','Read payout batches'),('payout.batch.create','Create payout batches'),('payout.batch.approve','Approve payout batches'),('payout.batch.process','Process payouts'),
('payout.manual_record','Record manual payout'),('payout.reverse','Reverse payout'),('payout.reconciliation.read','Read payout reconciliation'),('payout.reconciliation.resolve','Resolve payout reconciliation')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;
INSERT INTO role_permissions(role,permission_code)
SELECT 'SALON_OWNER',code FROM permissions WHERE code ~ '^(time_clock|timesheet|workforce|pay_profile|pay_rate|payroll|payout)\.'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('BRANCH_MANAGER','time_clock.session.read'),('BRANCH_MANAGER','time_clock.session.manage'),('BRANCH_MANAGER','time_clock.device.read'),('BRANCH_MANAGER','time_clock.device.manage'),('BRANCH_MANAGER','time_clock.exception.read'),('BRANCH_MANAGER','time_clock.exception.resolve'),
('BRANCH_MANAGER','timesheet.read'),('BRANCH_MANAGER','timesheet.review'),('BRANCH_MANAGER','timesheet.approve'),('BRANCH_MANAGER','timesheet.lock'),('BRANCH_MANAGER','workforce.policy.read'),('BRANCH_MANAGER','workforce.compliance.read'),('BRANCH_MANAGER','workforce.compliance.resolve'),('BRANCH_MANAGER','workforce.report.read'),
('RECEPTIONIST','time_clock.device.read'),('RECEPTIONIST','time_clock.session.read'),
('NAIL_TECHNICIAN','time_clock.self.use'),('NAIL_TECHNICIAN','timesheet.self.read'),('NAIL_TECHNICIAN','timesheet.self.submit'),('NAIL_TECHNICIAN','timesheet.adjustment.request'),('NAIL_TECHNICIAN','payroll.statement.read'),
('ACCOUNTANT','pay_profile.read'),('ACCOUNTANT','pay_rate.read'),('ACCOUNTANT','payroll.calendar.read'),('ACCOUNTANT','payroll.calendar.manage'),('ACCOUNTANT','payroll.run.read'),('ACCOUNTANT','payroll.run.create'),('ACCOUNTANT','payroll.run.calculate'),('ACCOUNTANT','payroll.run.submit'),('ACCOUNTANT','payroll.adjustment.manage'),('ACCOUNTANT','payroll.exception.resolve'),('ACCOUNTANT','payroll.statement.read'),('ACCOUNTANT','payroll.report.read'),('ACCOUNTANT','payroll.export'),('ACCOUNTANT','payout.batch.read'),('ACCOUNTANT','payout.batch.create'),('ACCOUNTANT','payout.batch.process'),('ACCOUNTANT','payout.manual_record'),('ACCOUNTANT','payout.reconciliation.read'),('ACCOUNTANT','payout.reconciliation.resolve')
ON CONFLICT DO NOTHING;

INSERT INTO staff_pay_profiles(tenant_id,staff_id,status)
SELECT tenant_id,id,'INCOMPLETE' FROM staff_profiles ON CONFLICT(tenant_id,staff_id) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('0023_time_clock_payroll_payout_workforce_compliance') ON CONFLICT DO NOTHING;
COMMIT;
