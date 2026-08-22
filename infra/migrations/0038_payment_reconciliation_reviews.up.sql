BEGIN;

-- Additive payment reconciliation workspace.  Payment, invoice, POS and cash
-- evidence remain immutable; this domain stores only the review projection,
-- decisions and append-only audit history.
CREATE TABLE payment_reconciliation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'OPEN'
    CHECK (state IN ('OPEN','UNDER_REVIEW','RESOLVED','ESCALATED')),
  case_type text NOT NULL
    CHECK (case_type IN ('MATCH','AMOUNT_MISMATCH','MISSING_INVOICE','MISSING_CASH_MOVEMENT','MISSING_CASH_SESSION','PROVIDER_UNRESOLVED','PROVIDER_EVIDENCE_MISMATCH','DUPLICATE_REFERENCE','PARTIAL_OUTSTANDING')),
  decision text
    CHECK (decision IS NULL OR decision IN ('CONFIRM_MATCH','ACCEPT_VARIANCE','KEEP_REVIEW','ESCALATE')),
  reason_code text,
  note text,
  expected_minor bigint,
  confirmed_minor bigint,
  variance_minor bigint,
  currency char(3) NOT NULL,
  evidence_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id),
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,payment_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,payment_id) REFERENCES payments(tenant_id,id),
  CHECK (variance_minor IS NULL OR (expected_minor IS NOT NULL AND confirmed_minor IS NOT NULL AND variance_minor=confirmed_minor-expected_minor))
);

CREATE TABLE payment_reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  review_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('RECONCILIATION_OPENED','REVIEW_STARTED','NOTE_ADDED','DECISION_RECORDED','MATCH_CONFIRMED','VARIANCE_ACCEPTED','ESCALATED')),
  from_state text,
  to_state text NOT NULL,
  decision text,
  reason_code text,
  note text,
  actor_user_id uuid REFERENCES users(id),
  request_id text NOT NULL,
  idempotency_key_hash text,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,review_id) REFERENCES payment_reconciliation_reviews(tenant_id,id),
  FOREIGN KEY (tenant_id,payment_id) REFERENCES payments(tenant_id,id)
);

CREATE OR REPLACE FUNCTION payment_reconciliation_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment reconciliation history is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER payment_reconciliation_event_append_only
  BEFORE UPDATE OR DELETE ON payment_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION payment_reconciliation_event_append_only();

CREATE INDEX payment_reconciliation_reviews_scope_idx
  ON payment_reconciliation_reviews(tenant_id,branch_id,state,case_type,updated_at DESC,id);
CREATE INDEX payment_reconciliation_events_review_idx
  ON payment_reconciliation_events(tenant_id,review_id,created_at,id);

ALTER TABLE financial_export_jobs DROP CONSTRAINT IF EXISTS financial_export_jobs_export_type_check;
ALTER TABLE financial_export_jobs ADD CONSTRAINT financial_export_jobs_export_type_check
  CHECK (export_type IN ('REFUNDS','CREDIT_NOTES','COMMISSION_ENTRIES','COMMISSION_STATEMENTS','NET_SALES','PAYMENT_RECONCILIATION'));

INSERT INTO permissions(code,description) VALUES
  ('financial.reconciliation.review','Review and decide payment reconciliation cases')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT r.role,'financial.reconciliation.review'
FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER'),('ACCOUNTANT')) r(role)
ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('0038_payment_reconciliation_reviews');
COMMIT;
