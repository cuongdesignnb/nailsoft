BEGIN;

-- Tip payout disposition is explicit and fail-closed. Historical allocations
-- are UNKNOWN until a tenant supplies evidence; they are never guessed eligible.
ALTER TABLE pos_tip_allocations
  ADD COLUMN payroll_disposition text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN payroll_disposition_evidence_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN payroll_disposition_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN claimed_by_payroll_run_id uuid,
  ADD COLUMN payroll_paid_at timestamptz,
  ADD COLUMN disposition_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT pos_tip_payroll_disposition_check CHECK(payroll_disposition IN(
    'UNKNOWN','NOT_PAYROLL_ELIGIBLE','PAYROLL_PENDING','PAID_DIRECT','PAYROLL_CLAIMED','PAYROLL_PAID','REVERSED'
  )),
  ADD CONSTRAINT pos_tip_payroll_claim_fk FOREIGN KEY(tenant_id,claimed_by_payroll_run_id)
    REFERENCES payroll_runs(tenant_id,id),
  ADD CONSTRAINT pos_tip_payroll_claim_shape CHECK(
    (payroll_disposition IN('PAYROLL_CLAIMED','PAYROLL_PAID') AND claimed_by_payroll_run_id IS NOT NULL)
    OR (payroll_disposition NOT IN('PAYROLL_CLAIMED','PAYROLL_PAID') AND claimed_by_payroll_run_id IS NULL)
  ),
  ADD CONSTRAINT pos_tip_payroll_paid_shape CHECK(
    (payroll_disposition='PAYROLL_PAID' AND payroll_paid_at IS NOT NULL)
    OR (payroll_disposition<>'PAYROLL_PAID' AND payroll_paid_at IS NULL)
  );

DROP TRIGGER tip_allocations_append_only ON pos_tip_allocations;
UPDATE pos_tip_allocations
SET payroll_disposition='UNKNOWN',
    payroll_disposition_evidence_json='{"backfill":"FAIL_CLOSED","eligible":false}'::jsonb,
    payroll_disposition_fingerprint=encode(digest(
      concat_ws(':',id::text,'UNKNOWN','1',
        '{"backfill":"FAIL_CLOSED","eligible":false}'::jsonb::text),'sha256'),'hex');

CREATE OR REPLACE FUNCTION sprint12_tip_payroll_disposition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Sprint 6 financial evidence is append-only' USING ERRCODE='55000';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['payroll_disposition','payroll_disposition_evidence_json','payroll_disposition_fingerprint','claimed_by_payroll_run_id','payroll_paid_at','disposition_version']) <>
     (to_jsonb(OLD)-ARRAY['payroll_disposition','payroll_disposition_evidence_json','payroll_disposition_fingerprint','claimed_by_payroll_run_id','payroll_paid_at','disposition_version']) THEN
    RAISE EXCEPTION 'Sprint 6 financial evidence is append-only' USING ERRCODE='55000';
  END IF;
  allowed := NEW.payroll_disposition=OLD.payroll_disposition OR
    (OLD.payroll_disposition='UNKNOWN' AND NEW.payroll_disposition IN('NOT_PAYROLL_ELIGIBLE','PAYROLL_PENDING','PAID_DIRECT','REVERSED')) OR
    (OLD.payroll_disposition='NOT_PAYROLL_ELIGIBLE' AND NEW.payroll_disposition IN('PAYROLL_PENDING','REVERSED')) OR
    (OLD.payroll_disposition='PAYROLL_PENDING' AND NEW.payroll_disposition IN('PAYROLL_CLAIMED','PAID_DIRECT','REVERSED')) OR
    (OLD.payroll_disposition='PAYROLL_CLAIMED' AND NEW.payroll_disposition IN('PAYROLL_PENDING','PAYROLL_PAID','REVERSED')) OR
    (OLD.payroll_disposition='PAID_DIRECT' AND NEW.payroll_disposition='REVERSED');
  IF NOT allowed THEN
    RAISE EXCEPTION 'TIP_PAYROLL_DISPOSITION_INVALID' USING ERRCODE='55000';
  END IF;
  IF NEW.payroll_disposition<>OLD.payroll_disposition OR
     NEW.payroll_disposition_evidence_json<>OLD.payroll_disposition_evidence_json THEN
    NEW.disposition_version := OLD.disposition_version+1;
  END IF;
  NEW.payroll_disposition_fingerprint := encode(digest(concat_ws(':',NEW.id::text,
    NEW.payroll_disposition,NEW.disposition_version::text,NEW.payroll_disposition_evidence_json::text,
    COALESCE(NEW.claimed_by_payroll_run_id::text,''),COALESCE(NEW.payroll_paid_at::text,'')),'sha256'),'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER tip_allocations_append_only BEFORE UPDATE OR DELETE ON pos_tip_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint12_tip_payroll_disposition_guard();
CREATE INDEX pos_tip_payroll_pending_idx ON pos_tip_allocations(tenant_id,staff_id)
  WHERE payroll_disposition='PAYROLL_PENDING';
CREATE UNIQUE INDEX pos_tip_one_payroll_claim_idx ON pos_tip_allocations(tenant_id,id,claimed_by_payroll_run_id)
  WHERE claimed_by_payroll_run_id IS NOT NULL;

-- Classification is a derived, versioned projection. Attendance payable time
-- remains immutable source evidence.
ALTER TABLE workforce_compliance_policy_versions
  ADD COLUMN attendance_projection_rules_json jsonb NOT NULL DEFAULT
    '{"autoCreatePeriod":true,"acceptedPeriodStates":["OPEN","SUBMISSION_OPEN","REVIEW"]}'::jsonb;

CREATE TABLE attendance_overtime_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  attendance_session_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  local_date date NOT NULL,
  policy_version_id uuid,
  source_payable_seconds bigint NOT NULL,
  regular_seconds bigint NOT NULL,
  overtime_seconds bigint NOT NULL,
  rule_snapshot_json jsonb NOT NULL,
  fingerprint text NOT NULL,
  classified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,attendance_session_id,local_date),
  FOREIGN KEY(tenant_id,attendance_session_id) REFERENCES attendance_sessions(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,policy_version_id) REFERENCES workforce_compliance_policy_versions(tenant_id,id),
  CHECK(source_payable_seconds>=0 AND regular_seconds>=0 AND overtime_seconds>=0),
  CHECK(regular_seconds+overtime_seconds=source_payable_seconds)
);
CREATE INDEX attendance_overtime_staff_date_idx
  ON attendance_overtime_classifications(tenant_id,staff_id,local_date);

ALTER TABLE attendance_exceptions DROP CONSTRAINT attendance_exceptions_exception_type_check;
ALTER TABLE attendance_exceptions ADD CONSTRAINT attendance_exceptions_exception_type_check CHECK(exception_type IN(
  'MISSED_CLOCK_IN','MISSED_CLOCK_OUT','DUPLICATE_CLOCK_IN','CLOCK_OUT_WITHOUT_SESSION','BREAK_END_WITHOUT_START',
  'OPEN_BREAK_AT_CLOCK_OUT','EXCESSIVE_SESSION_DURATION','LATE_ARRIVAL','EARLY_DEPARTURE','UNSCHEDULED_WORK',
  'CROSS_BRANCH_OVERLAP','BREAK_POLICY_VIOLATION','OVERTIME_WARNING','DEVICE_NOT_TRUSTED','LOCATION_POLICY_FAILED',
  'LATE_ATTENDANCE_AFTER_PERIOD_CLOSE','CROSS_PERIOD_ATTENDANCE'
));

ALTER TABLE timesheet_periods ADD CONSTRAINT timesheet_periods_no_overlap EXCLUDE USING gist
  (tenant_id WITH =, daterange(starts_on,ends_on,'[]') WITH &&);

-- Narrow correction contract: positive supplemental earnings only. Negative
-- recovery needs its own approved deduction policy and is rejected at ingress.
ALTER TABLE payroll_correction_sources DROP CONSTRAINT payroll_correction_sources_delta_minor_check;
ALTER TABLE payroll_correction_sources ADD CONSTRAINT payroll_correction_sources_delta_minor_check CHECK(delta_minor>0) NOT VALID;

INSERT INTO schema_migrations(version)
VALUES('0025_sprint12_payroll_source_coverage_hardening') ON CONFLICT DO NOTHING;
COMMIT;
