BEGIN;

ALTER TABLE audit_logs ADD COLUMN semantic_generation_key text;
CREATE UNIQUE INDEX audit_logs_semantic_generation_unique
  ON audit_logs(tenant_id,semantic_generation_key)
  WHERE semantic_generation_key IS NOT NULL;
ALTER TABLE outbox_events ADD COLUMN semantic_generation_key text;
CREATE UNIQUE INDEX outbox_events_semantic_generation_unique
  ON outbox_events(tenant_id,semantic_generation_key)
  WHERE semantic_generation_key IS NOT NULL;

ALTER TABLE platform_invoices
  ADD COLUMN credited_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN credit_applied_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE platform_invoices
  ADD CONSTRAINT platform_invoice_credit_nonnegative CHECK(credited_minor>=0 AND credit_applied_minor>=0),
  ADD CONSTRAINT platform_invoice_credit_application_cap CHECK(paid_minor+credit_applied_minor<=total_minor),
  ADD CONSTRAINT platform_invoice_credit_note_cap CHECK(credited_minor<=total_minor);

CREATE TABLE platform_manual_payment_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL REFERENCES platform_invoices(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','PROCESSING','SUCCEEDED','FAILED','CANCELLED')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL,
  evidence_reference text NOT NULL,
  evidence_hash text NOT NULL UNIQUE,
  reason text NOT NULL,
  invoice_snapshot_json jsonb NOT NULL,
  invoice_fingerprint text NOT NULL,
  approval_fingerprint text,
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  approved_by_user_id uuid REFERENCES users(id),
  rejected_by_user_id uuid REFERENCES users(id),
  processed_by_user_id uuid REFERENCES users(id),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  processed_at timestamptz,
  payment_intent_id uuid REFERENCES platform_payment_intents(id),
  failure_code text,
  migration_source text NOT NULL DEFAULT 'NATIVE_0027',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  CHECK(approved_by_user_id IS NULL OR approved_by_user_id<>requested_by_user_id),
  CHECK(rejected_by_user_id IS NULL OR rejected_by_user_id<>requested_by_user_id)
);
CREATE INDEX platform_manual_payment_requests_invoice_state_idx
  ON platform_manual_payment_requests(tenant_id,invoice_id,status,created_at);
CREATE TABLE platform_manual_payment_request_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text,
  snapshot_json jsonb NOT NULL,
  command_request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,request_id) REFERENCES platform_manual_payment_requests(tenant_id,id)
);
CREATE TRIGGER platform_manual_payment_history_append_only
  BEFORE UPDATE OR DELETE ON platform_manual_payment_request_history
  FOR EACH ROW EXECUTE FUNCTION sprint13_append_only_guard();

ALTER TABLE platform_refunds DROP CONSTRAINT platform_refunds_status_check;
ALTER TABLE platform_refunds
  ADD CONSTRAINT platform_refunds_status_check CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','PROCESSING','SUCCEEDED','FAILED','UNKNOWN','MANUAL_REVIEW','REJECTED','CANCELLED')),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN processed_at timestamptz,
  ADD COLUMN approval_fingerprint text,
  ADD COLUMN payment_snapshot_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN payment_fingerprint text,
  ADD COLUMN provider_evidence_hash text,
  ADD COLUMN failure_code text,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN migration_source text NOT NULL DEFAULT 'NATIVE_0027';
UPDATE platform_refunds
SET migration_source=CASE WHEN approved_by_user_id IS NULL THEN 'LEGACY_0026_NO_APPROVAL' ELSE 'LEGACY_0026_UNVERIFIED_APPROVAL' END,
    status=CASE WHEN status='REQUESTED' THEN 'DRAFT' WHEN status='APPROVED' THEN 'MANUAL_REVIEW' ELSE status END,
    payment_snapshot_json=jsonb_build_object('legacy',true,'paymentIntentId',payment_intent_id),
    payment_fingerprint=encode(digest(payment_intent_id::text||':'||amount_minor::text||':'||currency,'sha256'),'hex');
CREATE INDEX platform_refunds_payment_state_idx ON platform_refunds(tenant_id,payment_intent_id,status,created_at);
ALTER TABLE platform_refunds
  ADD CONSTRAINT platform_refunds_tenant_id_unique UNIQUE(tenant_id,id);
CREATE TABLE platform_refund_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  refund_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  reason text,
  snapshot_json jsonb NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES platform_refunds(tenant_id,id)
);
CREATE TRIGGER platform_refund_history_append_only
  BEFORE UPDATE OR DELETE ON platform_refund_history
  FOR EACH ROW EXECUTE FUNCTION sprint13_append_only_guard();

ALTER TABLE platform_credit_notes DROP CONSTRAINT platform_credit_notes_status_check;
ALTER TABLE platform_credit_notes
  ADD CONSTRAINT platform_credit_notes_status_check CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','FINALIZED','APPLIED','VOID')),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN approval_fingerprint text,
  ADD COLUMN invoice_snapshot_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN invoice_fingerprint text,
  ADD COLUMN source_refund_id uuid REFERENCES platform_refunds(id),
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN migration_source text NOT NULL DEFAULT 'NATIVE_0027';
UPDATE platform_credit_notes
SET migration_source=CASE WHEN approved_by_user_id IS NULL THEN 'LEGACY_0026_NO_APPROVAL' ELSE 'LEGACY_0026_UNVERIFIED_APPROVAL' END,
    invoice_snapshot_json=jsonb_build_object('legacy',true,'invoiceId',invoice_id),
    invoice_fingerprint=COALESCE(fingerprint,encode(digest(invoice_id::text||':'||total_minor::text||':'||currency,'sha256'),'hex'));
CREATE INDEX platform_credit_notes_invoice_state_idx ON platform_credit_notes(tenant_id,invoice_id,status,created_at);
CREATE UNIQUE INDEX platform_credit_notes_refund_unique ON platform_credit_notes(source_refund_id) WHERE source_refund_id IS NOT NULL;
ALTER TABLE platform_credit_note_lines ADD COLUMN eligibility_snapshot_json jsonb NOT NULL DEFAULT '{}';
CREATE INDEX platform_credit_note_lines_source_idx ON platform_credit_note_lines(tenant_id,source_invoice_line_id,credit_note_id);
CREATE TABLE platform_credit_note_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  credit_note_id uuid NOT NULL REFERENCES platform_credit_notes(id),
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text,
  snapshot_json jsonb NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER platform_credit_note_history_append_only
  BEFORE UPDATE OR DELETE ON platform_credit_note_history
  FOR EACH ROW EXECUTE FUNCTION sprint13_append_only_guard();

CREATE TABLE platform_credit_applications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  billing_account_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES platform_invoices(id),
  credit_note_id uuid REFERENCES platform_credit_notes(id),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'APPLIED' CHECK(status IN('APPLIED','REVERSED')),
  ledger_entry_id uuid NOT NULL REFERENCES platform_billing_credit_ledger(id),
  evidence_json jsonb NOT NULL DEFAULT '{}',
  applied_by_user_id uuid NOT NULL REFERENCES users(id),
  reversed_by_user_id uuid REFERENCES users(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,ledger_entry_id),
  FOREIGN KEY(tenant_id,billing_account_id) REFERENCES platform_billing_accounts(tenant_id,id)
);

CREATE TABLE platform_provider_operations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  operation_type text NOT NULL CHECK(operation_type IN('PAYMENT','PAYMENT_STATUS','REFUND','REFUND_STATUS')),
  aggregate_type text NOT NULL CHECK(aggregate_type IN('PAYMENT_INTENT','REFUND')),
  aggregate_id uuid NOT NULL,
  provider text NOT NULL,
  stable_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CLAIMED','SUCCEEDED','FAILED','UNKNOWN','MANUAL_REVIEW')),
  request_json jsonb NOT NULL DEFAULT '{}',
  response_redacted_json jsonb,
  lease_owner text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  attempt_no integer NOT NULL DEFAULT 0,
  provider_reference text,
  evidence_hash text,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id)
);
CREATE INDEX platform_provider_operations_claim_idx ON platform_provider_operations(state,operation_type,created_at);

ALTER TABLE platform_payment_intents
  ADD COLUMN applied_to_invoice_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN overpayment_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN applied_at timestamptz,
  ADD CONSTRAINT platform_payment_allocation_nonnegative CHECK(applied_to_invoice_minor>=0 AND overpayment_minor>=0),
  ADD CONSTRAINT platform_payment_allocation_cap CHECK(applied_to_invoice_minor+overpayment_minor<=amount_minor);

CREATE OR REPLACE FUNCTION sprint13_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL AND ((to_jsonb(NEW)-ARRAY['status','paid_minor','refunded_minor','credited_minor','credit_applied_minor','updated_at','version'])<>(to_jsonb(OLD)-ARRAY['status','paid_minor','refunded_minor','credited_minor','credit_applied_minor','updated_at','version'])) THEN RAISE EXCEPTION 'PLATFORM_INVOICE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;

INSERT INTO schema_migrations(version)
VALUES('0027_sprint13_platform_billing_approval_correctness');
COMMIT;
