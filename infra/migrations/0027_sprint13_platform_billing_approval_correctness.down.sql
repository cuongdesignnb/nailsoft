BEGIN;

DROP TABLE IF EXISTS platform_provider_operations;
ALTER TABLE platform_payment_intents
  DROP CONSTRAINT IF EXISTS platform_payment_allocation_cap,
  DROP CONSTRAINT IF EXISTS platform_payment_allocation_nonnegative,
  DROP COLUMN IF EXISTS applied_at,
  DROP COLUMN IF EXISTS overpayment_minor,
  DROP COLUMN IF EXISTS applied_to_invoice_minor;
DROP TABLE IF EXISTS platform_credit_applications;
DROP TRIGGER IF EXISTS platform_credit_note_history_append_only ON platform_credit_note_history;
DROP TABLE IF EXISTS platform_credit_note_history;
DROP INDEX IF EXISTS platform_credit_note_lines_source_idx;
ALTER TABLE platform_credit_note_lines DROP COLUMN IF EXISTS eligibility_snapshot_json;
DROP INDEX IF EXISTS platform_credit_notes_invoice_state_idx;
DROP INDEX IF EXISTS platform_credit_notes_refund_unique;
UPDATE platform_credit_notes
SET status=CASE
  WHEN status='DRAFT' THEN 'DRAFT'
  WHEN status='VOID' THEN 'VOID'
  ELSE 'FINALIZED'
END;
ALTER TABLE platform_credit_notes
  DROP COLUMN IF EXISTS migration_source,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS invoice_fingerprint,
  DROP COLUMN IF EXISTS source_refund_id,
  DROP COLUMN IF EXISTS invoice_snapshot_json,
  DROP COLUMN IF EXISTS approval_fingerprint,
  DROP COLUMN IF EXISTS applied_at,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS submitted_at;
ALTER TABLE platform_credit_notes DROP CONSTRAINT platform_credit_notes_status_check;
ALTER TABLE platform_credit_notes ADD CONSTRAINT platform_credit_notes_status_check CHECK(status IN('DRAFT','FINALIZED','VOID'));

DROP TRIGGER IF EXISTS platform_refund_history_append_only ON platform_refund_history;
DROP TABLE IF EXISTS platform_refund_history;
ALTER TABLE platform_refunds DROP CONSTRAINT IF EXISTS platform_refunds_tenant_id_unique;
DROP INDEX IF EXISTS platform_refunds_payment_state_idx;
UPDATE platform_refunds
SET status=CASE
  WHEN status='DRAFT' THEN 'REQUESTED'
  WHEN status='PENDING_APPROVAL' THEN 'REQUESTED'
  WHEN status='REJECTED' THEN 'CANCELLED'
  WHEN status='MANUAL_REVIEW' THEN 'UNKNOWN'
  ELSE status
END;
ALTER TABLE platform_refunds
  DROP COLUMN IF EXISTS migration_source,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS failure_code,
  DROP COLUMN IF EXISTS provider_evidence_hash,
  DROP COLUMN IF EXISTS payment_fingerprint,
  DROP COLUMN IF EXISTS payment_snapshot_json,
  DROP COLUMN IF EXISTS approval_fingerprint,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS rejected_at,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS submitted_at;
ALTER TABLE platform_refunds DROP CONSTRAINT platform_refunds_status_check;
ALTER TABLE platform_refunds ADD CONSTRAINT platform_refunds_status_check CHECK(status IN('REQUESTED','APPROVED','PROCESSING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED'));

DROP TRIGGER IF EXISTS platform_manual_payment_history_append_only ON platform_manual_payment_request_history;
DROP TABLE IF EXISTS platform_manual_payment_request_history;
DROP TABLE IF EXISTS platform_manual_payment_requests;

CREATE OR REPLACE FUNCTION sprint13_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL AND ((to_jsonb(NEW)-ARRAY['status','paid_minor','refunded_minor','updated_at','version'])<>(to_jsonb(OLD)-ARRAY['status','paid_minor','refunded_minor','updated_at','version'])) THEN RAISE EXCEPTION 'PLATFORM_INVOICE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
ALTER TABLE platform_invoices
  DROP CONSTRAINT IF EXISTS platform_invoice_credit_note_cap,
  DROP CONSTRAINT IF EXISTS platform_invoice_credit_application_cap,
  DROP CONSTRAINT IF EXISTS platform_invoice_credit_nonnegative,
  DROP COLUMN IF EXISTS credit_applied_minor,
  DROP COLUMN IF EXISTS credited_minor;

DROP INDEX IF EXISTS outbox_events_semantic_generation_unique;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS semantic_generation_key;
DROP INDEX IF EXISTS audit_logs_semantic_generation_unique;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS semantic_generation_key;

DELETE FROM schema_migrations
WHERE version='0027_sprint13_platform_billing_approval_correctness';
COMMIT;
