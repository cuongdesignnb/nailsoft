BEGIN;

-- Sprint 12 closure: immutable correction sources and deterministic projection evidence.
CREATE TABLE attendance_correction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  adjustment_id uuid NOT NULL,
  timesheet_id uuid NOT NULL,
  session_id uuid,
  correction_type text NOT NULL CHECK(correction_type IN(
    'ADD_CLOCK_EVENT','REPLACE_CLOCK_EVENT','VOID_CLOCK_EVENT','ADD_BREAK',
    'CHANGE_BREAK_TYPE','CHANGE_BRANCH_ATTRIBUTION','CHANGE_PAYABLE_TIME','NOTE_ONLY'
  )),
  correction_json jsonb NOT NULL,
  before_fingerprint text NOT NULL,
  after_fingerprint text NOT NULL,
  actor_user_id uuid NOT NULL,
  request_id text NOT NULL,
  idempotency_key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,adjustment_id),
  UNIQUE(tenant_id,idempotency_key_hash),
  FOREIGN KEY(tenant_id,adjustment_id) REFERENCES timesheet_adjustment_requests(tenant_id,id),
  FOREIGN KEY(tenant_id,timesheet_id) REFERENCES staff_timesheets(tenant_id,id),
  FOREIGN KEY(tenant_id,session_id) REFERENCES attendance_sessions(tenant_id,id)
);
CREATE TRIGGER attendance_correction_events_append_only
  BEFORE UPDATE OR DELETE ON attendance_correction_events
  FOR EACH ROW EXECUTE FUNCTION sprint12_prevent_any_mutation();

ALTER TABLE timesheet_adjustment_requests
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN applied_by_user_id uuid,
  ADD COLUMN before_fingerprint text,
  ADD COLUMN after_fingerprint text;

ALTER TABLE staff_timesheets
  ADD COLUMN projection_input_fingerprint text,
  ADD COLUMN projected_at timestamptz,
  ADD COLUMN submitted_fingerprint text,
  ADD COLUMN approved_fingerprint text,
  ADD COLUMN locked_fingerprint text;

-- Preserve and deterministically materialize existing Sprint 12 attendance into day rows.
WITH source AS (
  SELECT t.tenant_id,t.id timesheet_id,s.id session_id,s.branch_id,
         gs::date local_date,
         GREATEST(0,EXTRACT(EPOCH FROM (
           LEAST(s.ended_at AT TIME ZONE b.timezone,gs+interval '1 day')-
           GREATEST(s.started_at AT TIME ZONE b.timezone,gs)
         ))::bigint) weight_seconds,
         s.regular_seconds,s.overtime_seconds,s.payable_seconds,s.paid_break_seconds,s.unpaid_break_seconds
  FROM staff_timesheets t
  JOIN timesheet_periods p ON p.tenant_id=t.tenant_id AND p.id=t.period_id
  JOIN attendance_sessions s ON s.tenant_id=t.tenant_id AND s.staff_id=t.staff_id AND s.ended_at IS NOT NULL
  JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
  CROSS JOIN LATERAL generate_series(
    GREATEST(p.starts_on,(s.started_at AT TIME ZONE b.timezone)::date)::timestamp,
    LEAST(p.ends_on,(s.ended_at AT TIME ZONE b.timezone)::date)::timestamp,
    interval '1 day'
  ) gs
  WHERE s.state IN('CLOSED','REVIEW_REQUIRED','ADJUSTED')
), base AS (
  SELECT *,
    sum(weight_seconds) OVER(PARTITION BY tenant_id,timesheet_id,session_id) total_weight,
    row_number() OVER(PARTITION BY tenant_id,timesheet_id,session_id ORDER BY local_date) rn,
    count(*) OVER(PARTITION BY tenant_id,timesheet_id,session_id) part_count
  FROM source WHERE weight_seconds>0
), proportional AS (
  SELECT *,
    regular_seconds*weight_seconds/NULLIF(total_weight,0) regular_base,
    overtime_seconds*weight_seconds/NULLIF(total_weight,0) overtime_base,
    payable_seconds*weight_seconds/NULLIF(total_weight,0) payable_base,
    paid_break_seconds*weight_seconds/NULLIF(total_weight,0) paid_base,
    unpaid_break_seconds*weight_seconds/NULLIF(total_weight,0) unpaid_base
  FROM base
), allocated AS (
  SELECT *,
    CASE WHEN rn=part_count THEN regular_seconds-COALESCE(sum(regular_base) OVER(PARTITION BY tenant_id,timesheet_id,session_id ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) ELSE regular_base END regular_alloc,
    CASE WHEN rn=part_count THEN overtime_seconds-COALESCE(sum(overtime_base) OVER(PARTITION BY tenant_id,timesheet_id,session_id ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) ELSE overtime_base END overtime_alloc,
    CASE WHEN rn=part_count THEN payable_seconds-COALESCE(sum(payable_base) OVER(PARTITION BY tenant_id,timesheet_id,session_id ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) ELSE payable_base END payable_alloc,
    CASE WHEN rn=part_count THEN paid_break_seconds-COALESCE(sum(paid_base) OVER(PARTITION BY tenant_id,timesheet_id,session_id ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) ELSE paid_base END paid_alloc,
    CASE WHEN rn=part_count THEN unpaid_break_seconds-COALESCE(sum(unpaid_base) OVER(PARTITION BY tenant_id,timesheet_id,session_id ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) ELSE unpaid_base END unpaid_alloc
  FROM proportional
), grouped AS (
  SELECT tenant_id,timesheet_id,local_date,branch_id,array_agg(session_id ORDER BY session_id) source_ids,
         sum(regular_alloc) regular_seconds,sum(overtime_alloc) overtime_seconds,sum(payable_alloc) payable_seconds,
         sum(paid_alloc) paid_break_seconds,sum(unpaid_alloc) unpaid_break_seconds
  FROM allocated GROUP BY tenant_id,timesheet_id,local_date,branch_id
)
INSERT INTO timesheet_day_entries(
  tenant_id,timesheet_id,local_date,branch_id,source_session_ids,regular_seconds,overtime_seconds,
  payable_seconds,paid_break_seconds,unpaid_break_seconds,fingerprint
)
SELECT tenant_id,timesheet_id,local_date,branch_id,source_ids,regular_seconds,overtime_seconds,
       payable_seconds,paid_break_seconds,unpaid_break_seconds,
       encode(digest(concat_ws(':',timesheet_id,local_date,branch_id,regular_seconds,overtime_seconds,payable_seconds,paid_break_seconds,unpaid_break_seconds),'sha256'),'hex')
FROM grouped
ON CONFLICT(tenant_id,timesheet_id,local_date,branch_id) DO UPDATE SET
  source_session_ids=EXCLUDED.source_session_ids,regular_seconds=EXCLUDED.regular_seconds,
  overtime_seconds=EXCLUDED.overtime_seconds,payable_seconds=EXCLUDED.payable_seconds,
  paid_break_seconds=EXCLUDED.paid_break_seconds,unpaid_break_seconds=EXCLUDED.unpaid_break_seconds,
  fingerprint=EXCLUDED.fingerprint;

WITH aggregate AS (
  SELECT d.tenant_id,d.timesheet_id,sum(d.regular_seconds) regular_seconds,sum(d.overtime_seconds) overtime_seconds,
         sum(d.payable_seconds) payable_seconds,sum(d.paid_break_seconds) paid_break_seconds,
         sum(d.unpaid_break_seconds) unpaid_break_seconds,
         jsonb_object_agg(d.local_date::text||':'||d.branch_id::text,d.payable_seconds ORDER BY d.local_date,d.branch_id) branch_json,
         encode(digest(string_agg(d.fingerprint,':' ORDER BY d.local_date,d.branch_id),'sha256'),'hex') projection_fp
  FROM timesheet_day_entries d GROUP BY d.tenant_id,d.timesheet_id
)
UPDATE staff_timesheets t SET
  regular_seconds=a.regular_seconds,overtime_seconds=a.overtime_seconds,payable_seconds=a.payable_seconds,
  paid_break_seconds=a.paid_break_seconds,unpaid_break_seconds=a.unpaid_break_seconds,
  branch_allocation_json=a.branch_json,projection_input_fingerprint=a.projection_fp,projected_at=COALESCE(t.updated_at,now()),
  submitted_fingerprint=CASE WHEN t.state IN('SUBMITTED','APPROVED','LOCKED') THEN t.fingerprint END,
  approved_fingerprint=CASE WHEN t.state IN('APPROVED','LOCKED') THEN t.fingerprint END,
  locked_fingerprint=CASE WHEN t.state='LOCKED' THEN t.fingerprint END
FROM aggregate a WHERE t.tenant_id=a.tenant_id AND t.id=a.timesheet_id;

ALTER TABLE timesheet_approvals DROP CONSTRAINT IF EXISTS timesheet_approvals_decision_check;
ALTER TABLE timesheet_approvals ADD CONSTRAINT timesheet_approvals_decision_check
  CHECK(decision IN('SUBMITTED','APPROVED','REJECTED','LOCKED','REOPENED','APPROVAL_INVALIDATED'));
ALTER TABLE payroll_approval_history DROP CONSTRAINT IF EXISTS payroll_approval_history_decision_check;
ALTER TABLE payroll_approval_history ADD CONSTRAINT payroll_approval_history_decision_check
  CHECK(decision IN('SUBMITTED','APPROVED','FINALIZED','VOID_REQUESTED','VOID_APPROVED','VOIDED','CALCULATION_INVALIDATED'));

-- Explicit references make used legal/rate versions protectable and auditable.
ALTER TABLE payroll_runs
  ADD COLUMN correction_of_payroll_run_id uuid,
  ADD COLUMN calculation_generation integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT payroll_runs_correction_parent_fk
    FOREIGN KEY(tenant_id,correction_of_payroll_run_id) REFERENCES payroll_runs(tenant_id,id),
  ADD CONSTRAINT payroll_runs_correction_contract CHECK(
    (run_type IN('SUPPLEMENTAL','CORRECTION') AND correction_of_payroll_run_id IS NOT NULL)
    OR (run_type IN('REGULAR','OFF_CYCLE') AND correction_of_payroll_run_id IS NULL)
  );

ALTER TABLE payroll_run_workers
  ADD COLUMN pay_profile_id uuid,
  ADD COLUMN policy_version_id uuid,
  ADD CONSTRAINT payroll_workers_profile_fk FOREIGN KEY(tenant_id,pay_profile_id) REFERENCES staff_pay_profiles(tenant_id,id),
  ADD CONSTRAINT payroll_workers_policy_fk FOREIGN KEY(tenant_id,policy_version_id) REFERENCES workforce_compliance_policy_versions(tenant_id,id);

ALTER TABLE payroll_earning_lines
  ADD COLUMN pay_rate_version_id uuid,
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT payroll_earning_rate_fk FOREIGN KEY(tenant_id,pay_rate_version_id) REFERENCES staff_pay_rate_versions(tenant_id,id),
  ADD CONSTRAINT payroll_earning_branch_fk FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id);

UPDATE payroll_run_workers
SET pay_profile_id = CASE
      WHEN pay_profile_version_json ? 'profileId'
       AND pay_profile_version_json->>'profileId' ~* '^[0-9a-f-]{36}$'
      THEN (pay_profile_version_json->>'profileId')::uuid
      ELSE NULL END,
    policy_version_id = CASE
      WHEN policy_version_json ? 'id'
       AND policy_version_json->>'id' ~* '^[0-9a-f-]{36}$'
      THEN (policy_version_json->>'id')::uuid
      ELSE NULL END;
UPDATE payroll_earning_lines
SET pay_rate_version_id = CASE
      WHEN metadata_json ? 'rateId' AND metadata_json->>'rateId' ~* '^[0-9a-f-]{36}$'
      THEN (metadata_json->>'rateId')::uuid
      ELSE NULL END;

CREATE TABLE payroll_correction_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  original_payroll_run_id uuid NOT NULL,
  original_statement_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','PENDING_APPROVAL','APPROVED','CLAIMED','CONSUMED','REJECTED','CANCELLED')),
  delta_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  reason text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}',
  fingerprint text NOT NULL,
  requested_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  approved_at timestamptz,
  claimed_by_payroll_run_id uuid,
  consumed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,original_payroll_run_id) REFERENCES payroll_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,original_statement_id) REFERENCES pay_statements(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,claimed_by_payroll_run_id) REFERENCES payroll_runs(tenant_id,id),
  CHECK(delta_minor <> 0)
);
CREATE UNIQUE INDEX payroll_one_open_correction_source_idx
  ON payroll_correction_sources(tenant_id,original_statement_id,fingerprint)
  WHERE state NOT IN('REJECTED','CANCELLED');

-- Exact staff ownership and stable provider idempotency are database invariants.
ALTER TABLE staff_payment_methods ADD CONSTRAINT staff_payment_methods_tenant_id_id_staff_id_key UNIQUE(tenant_id,id,staff_id);
ALTER TABLE payout_items DROP CONSTRAINT IF EXISTS payout_items_tenant_id_payment_method_id_fkey;
ALTER TABLE payout_items
  DROP CONSTRAINT IF EXISTS payout_items_state_check,
  ADD CONSTRAINT payout_items_state_check CHECK(state IN('PENDING','PROCESSING','UNKNOWN','MANUAL_REVIEW','PAID','FAILED','CANCELLED','REVERSAL_PENDING','REVERSED')),
  ADD COLUMN provider_request_key text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN unknown_since timestamptz,
  ADD COLUMN manual_recorded_by_user_id uuid,
  ADD COLUMN manual_evidence_hash text,
  ADD CONSTRAINT payout_item_staff_payment_method_fk
    FOREIGN KEY(tenant_id,payment_method_id,staff_id) REFERENCES staff_payment_methods(tenant_id,id,staff_id);
UPDATE payout_items SET provider_request_key='payout:'||tenant_id::text||':'||id::text;
ALTER TABLE payout_items ALTER COLUMN provider_request_key SET NOT NULL;
ALTER TABLE payout_items ADD CONSTRAINT payout_items_tenant_provider_request_key_key UNIQUE(tenant_id,provider_request_key);
CREATE OR REPLACE FUNCTION sprint12_assign_stable_provider_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_request_key IS NULL OR NEW.provider_request_key='' THEN
    NEW.provider_request_key := 'payout:'||NEW.tenant_id::text||':'||NEW.id::text;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_item_assign_stable_provider_key
  BEFORE INSERT ON payout_items FOR EACH ROW EXECUTE FUNCTION sprint12_assign_stable_provider_key();

ALTER TABLE payout_attempts DROP CONSTRAINT IF EXISTS payout_attempts_tenant_id_provider_request_key_key;
CREATE INDEX payout_attempts_provider_key_idx ON payout_attempts(tenant_id,provider_request_key,started_at DESC);
CREATE UNIQUE INDEX payout_attempt_one_active_idx ON payout_attempts(tenant_id,payout_item_id)
  WHERE state IN('PENDING','SUBMITTED','UNKNOWN');

CREATE OR REPLACE FUNCTION sprint12_used_policy_rate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='workforce_compliance_policy_versions' THEN
    IF EXISTS(SELECT 1 FROM payroll_run_workers WHERE tenant_id=OLD.tenant_id AND policy_version_id=OLD.id)
       OR EXISTS(SELECT 1 FROM timesheet_approvals WHERE tenant_id=OLD.tenant_id AND (snapshot_json->>'policyVersionId')=OLD.id::text) THEN
      RAISE EXCEPTION 'USED_POLICY_VERSION_IMMUTABLE' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME='staff_pay_rate_versions' THEN
    IF EXISTS(SELECT 1 FROM payroll_earning_lines WHERE tenant_id=OLD.tenant_id AND pay_rate_version_id=OLD.id) THEN
      RAISE EXCEPTION 'USED_PAY_RATE_VERSION_IMMUTABLE' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER workforce_policy_version_used_immutable BEFORE UPDATE OR DELETE ON workforce_compliance_policy_versions
  FOR EACH ROW EXECUTE FUNCTION sprint12_used_policy_rate_immutable();
CREATE TRIGGER staff_pay_rate_used_immutable BEFORE UPDATE OR DELETE ON staff_pay_rate_versions
  FOR EACH ROW EXECUTE FUNCTION sprint12_used_policy_rate_immutable();

CREATE OR REPLACE FUNCTION sprint12_correction_source_used_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN('CONSUMED','CLAIMED') AND (
    TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','claimed_by_payroll_run_id','consumed_at','updated_at']) <>
                      (to_jsonb(OLD)-ARRAY['state','claimed_by_payroll_run_id','consumed_at','updated_at'])
  ) THEN RAISE EXCEPTION 'PAYROLL_CORRECTION_SOURCE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER payroll_correction_source_used_immutable BEFORE UPDATE OR DELETE ON payroll_correction_sources
  FOR EACH ROW EXECUTE FUNCTION sprint12_correction_source_used_immutable();

-- Migration 0023 returned NEW from BEFORE DELETE triggers. NEW is NULL for a
-- DELETE, which silently cancelled cleanup on recalculation. Preserve the
-- finalized-run guard while allowing draft calculation children and claims to
-- be deleted in FK-safe order.
CREATE OR REPLACE FUNCTION sprint12_prevent_finalized_child_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM payroll_run_workers w JOIN payroll_runs r ON r.tenant_id=w.tenant_id AND r.id=w.payroll_run_id WHERE w.tenant_id=OLD.tenant_id AND w.id=OLD.payroll_worker_id AND r.state IN('FINALIZED','VOID_PENDING','VOIDED')) THEN
    RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE OR REPLACE FUNCTION sprint12_prevent_finalized_source_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM payroll_runs r WHERE r.tenant_id=OLD.tenant_id AND r.id=OLD.payroll_run_id AND r.state IN('FINALIZED','VOID_PENDING','VOIDED')) THEN
    RAISE EXCEPTION 'PAYROLL_FINALIZED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE INDEX timesheet_projection_lookup_idx ON attendance_sessions(tenant_id,staff_id,started_at,ended_at) WHERE state IN('CLOSED','REVIEW_REQUIRED','ADJUSTED');
CREATE INDEX payroll_day_branch_idx ON timesheet_day_entries(tenant_id,timesheet_id,branch_id,local_date);
CREATE INDEX payroll_correction_ready_idx ON payroll_correction_sources(tenant_id,state,staff_id) WHERE state='APPROVED';
CREATE INDEX payout_unknown_poll_idx ON payout_items(tenant_id,state,unknown_since) WHERE state IN('UNKNOWN','MANUAL_REVIEW');

INSERT INTO schema_migrations(version) VALUES('0024_sprint12_payroll_correctness_hardening') ON CONFLICT DO NOTHING;
COMMIT;
