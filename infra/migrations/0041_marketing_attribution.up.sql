BEGIN;

ALTER TABLE marketing_campaign_audience
  ADD CONSTRAINT marketing_campaign_audience_tenant_id_id_key UNIQUE(tenant_id,id);

CREATE TABLE marketing_attribution_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  generation integer NOT NULL CHECK(generation > 0),
  reference_hash varchar(64) NOT NULL,
  model text NOT NULL DEFAULT 'EXPLICIT_LAST_TOUCH' CHECK(model IN('EXPLICIT_LAST_TOUCH')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CONSUMED','EXPIRED','REJECTED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_appointment_id uuid,
  issued_by_user_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,reference_hash),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,recipient_id) REFERENCES marketing_campaign_audience(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,consumed_by_appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(issued_by_user_id) REFERENCES users(id),
  CHECK(expires_at > valid_from),
  CHECK((status='CONSUMED') = (consumed_by_appointment_id IS NOT NULL)),
  CHECK((status='CONSUMED') = (consumed_at IS NOT NULL))
);

CREATE TABLE marketing_booking_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  attribution_context_id uuid NOT NULL,
  model text NOT NULL CHECK(model IN('EXPLICIT_LAST_TOUCH')),
  source text NOT NULL DEFAULT 'MARKETING_BOOKING_CONTEXT',
  attributed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,appointment_id),
  UNIQUE(tenant_id,attribution_context_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,recipient_id) REFERENCES marketing_campaign_audience(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(tenant_id,attribution_context_id) REFERENCES marketing_attribution_contexts(tenant_id,id)
);

CREATE TABLE marketing_attributed_financial_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  booking_attribution_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  order_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  payment_id uuid,
  currency char(3) NOT NULL CHECK(currency = upper(currency)),
  gross_eligible_revenue_minor bigint NOT NULL CHECK(gross_eligible_revenue_minor >= 0),
  evidence_json jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'POSTED' CHECK(status IN('POSTED')),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,order_id),
  UNIQUE(tenant_id,invoice_id),
  FOREIGN KEY(tenant_id,booking_attribution_id) REFERENCES marketing_booking_attributions(tenant_id,id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(tenant_id,order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id)
);

CREATE TABLE marketing_attribution_revenue_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  financial_evidence_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  refund_id uuid NOT NULL,
  credit_note_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK(currency = upper(currency)),
  adjustment_type text NOT NULL DEFAULT 'REFUND' CHECK(adjustment_type IN('REFUND')),
  amount_minor bigint NOT NULL CHECK(amount_minor >= 0),
  evidence_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,refund_id),
  UNIQUE(tenant_id,financial_evidence_id,refund_id),
  FOREIGN KEY(tenant_id,financial_evidence_id) REFERENCES marketing_attributed_financial_evidence(tenant_id,id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,credit_note_id) REFERENCES credit_notes(tenant_id,id)
);

CREATE OR REPLACE FUNCTION marketing_attribution_context_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  recipient record;
  campaign record;
BEGIN
  SELECT a.campaign_id,a.customer_id,a.generation INTO recipient
    FROM marketing_campaign_audience a
   WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.recipient_id;
  IF recipient IS NULL OR recipient.campaign_id IS DISTINCT FROM NEW.campaign_id
     OR recipient.customer_id IS DISTINCT FROM NEW.customer_id
     OR recipient.generation IS DISTINCT FROM NEW.generation THEN
    RAISE EXCEPTION 'MARKETING_ATTRIBUTION_CONTEXT_RECIPIENT_MISMATCH';
  END IF;
  SELECT c.id,c.tenant_id INTO campaign FROM marketing_campaigns c
   WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.campaign_id;
  IF campaign IS NULL THEN
    RAISE EXCEPTION 'MARKETING_ATTRIBUTION_CONTEXT_CAMPAIGN_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION marketing_booking_attribution_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  context_row record;
  appointment_row record;
BEGIN
  SELECT c.campaign_id,c.recipient_id,c.customer_id,c.model,mc.branch_id campaign_branch_id INTO context_row
    FROM marketing_attribution_contexts c
    JOIN marketing_campaigns mc ON mc.tenant_id=c.tenant_id AND mc.id=c.campaign_id
   WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.attribution_context_id;
  IF context_row IS NULL OR context_row.campaign_id IS DISTINCT FROM NEW.campaign_id
     OR context_row.recipient_id IS DISTINCT FROM NEW.recipient_id
     OR context_row.customer_id IS DISTINCT FROM NEW.customer_id
     OR context_row.model IS DISTINCT FROM NEW.model THEN
    RAISE EXCEPTION 'MARKETING_BOOKING_ATTRIBUTION_CONTEXT_MISMATCH';
  END IF;
  SELECT a.customer_id,a.tenant_id INTO appointment_row
    FROM appointments a
   WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.appointment_id;
  IF appointment_row IS NULL OR appointment_row.customer_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'MARKETING_BOOKING_ATTRIBUTION_CUSTOMER_MISMATCH';
  END IF;
  IF context_row.campaign_branch_id IS DISTINCT FROM (SELECT a.branch_id FROM appointments a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.appointment_id)
     AND context_row.campaign_branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'MARKETING_BOOKING_ATTRIBUTION_BRANCH_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION marketing_financial_evidence_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attribution record;
  order_row record;
  invoice_row record;
BEGIN
  SELECT ba.campaign_id,ba.customer_id,ba.appointment_id INTO attribution
    FROM marketing_booking_attributions ba
   WHERE ba.tenant_id=NEW.tenant_id AND ba.id=NEW.booking_attribution_id;
  IF attribution IS NULL OR attribution.campaign_id IS DISTINCT FROM NEW.campaign_id
     OR attribution.customer_id IS DISTINCT FROM NEW.customer_id
     OR attribution.appointment_id IS DISTINCT FROM NEW.appointment_id THEN
    RAISE EXCEPTION 'MARKETING_FINANCIAL_ATTRIBUTION_MISMATCH';
  END IF;
  SELECT o.appointment_id,o.customer_id,o.currency,o.status INTO order_row
    FROM pos_orders o WHERE o.tenant_id=NEW.tenant_id AND o.id=NEW.order_id;
  SELECT i.pos_order_id,i.currency,i.status INTO invoice_row
    FROM invoices i WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.invoice_id;
  IF order_row IS NULL OR invoice_row IS NULL OR order_row.status IS DISTINCT FROM 'PAID'
     OR invoice_row.status IS DISTINCT FROM 'ISSUED'
     OR order_row.appointment_id IS DISTINCT FROM NEW.appointment_id
     OR order_row.customer_id IS DISTINCT FROM NEW.customer_id
     OR invoice_row.pos_order_id IS DISTINCT FROM NEW.order_id
     OR order_row.currency IS DISTINCT FROM NEW.currency
     OR invoice_row.currency IS DISTINCT FROM NEW.currency
     OR (NEW.payment_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.payment_id
             AND p.pos_order_id=NEW.order_id AND p.status='CAPTURED'
        )) THEN
    RAISE EXCEPTION 'MARKETING_FINANCIAL_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION marketing_revenue_adjustment_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence record;
  refund_row record;
  note_row record;
BEGIN
  SELECT fe.campaign_id,fe.invoice_id,fe.currency INTO evidence
    FROM marketing_attributed_financial_evidence fe
   WHERE fe.tenant_id=NEW.tenant_id AND fe.id=NEW.financial_evidence_id;
  SELECT r.invoice_id,r.currency,r.status INTO refund_row
    FROM refunds r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.refund_id;
  SELECT n.refund_id,n.currency,n.status INTO note_row
    FROM credit_notes n WHERE n.tenant_id=NEW.tenant_id AND n.id=NEW.credit_note_id;
  IF evidence IS NULL OR refund_row IS NULL OR note_row IS NULL
     OR evidence.campaign_id IS DISTINCT FROM NEW.campaign_id
     OR evidence.currency IS DISTINCT FROM NEW.currency
     OR refund_row.status IS DISTINCT FROM 'COMPLETED'
     OR note_row.status IS DISTINCT FROM 'ISSUED'
     OR refund_row.invoice_id IS DISTINCT FROM evidence.invoice_id
     OR refund_row.currency IS DISTINCT FROM NEW.currency
     OR note_row.refund_id IS DISTINCT FROM NEW.refund_id
     OR note_row.currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'MARKETING_REVENUE_ADJUSTMENT_SOURCE_MISMATCH';
  END IF;
  IF NEW.amount_minor > (
    SELECT fe.gross_eligible_revenue_minor - COALESCE(sum(ra.amount_minor),0)
      FROM marketing_attributed_financial_evidence fe
      LEFT JOIN marketing_attribution_revenue_adjustments ra
        ON ra.tenant_id=fe.tenant_id AND ra.financial_evidence_id=fe.id
     WHERE fe.tenant_id=NEW.tenant_id AND fe.id=NEW.financial_evidence_id
     GROUP BY fe.gross_eligible_revenue_minor
  ) THEN
    RAISE EXCEPTION 'MARKETING_REVENUE_ADJUSTMENT_EXCEEDS_EVIDENCE';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION marketing_attribution_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MARKETING_ATTRIBUTION_APPEND_ONLY';
END $$;

CREATE TRIGGER marketing_attribution_context_consistency
  BEFORE INSERT OR UPDATE ON marketing_attribution_contexts
  FOR EACH ROW EXECUTE FUNCTION marketing_attribution_context_consistency();
CREATE TRIGGER marketing_booking_attribution_consistency
  BEFORE INSERT OR UPDATE ON marketing_booking_attributions
  FOR EACH ROW EXECUTE FUNCTION marketing_booking_attribution_consistency();
CREATE TRIGGER marketing_financial_evidence_consistency
  BEFORE INSERT OR UPDATE ON marketing_attributed_financial_evidence
  FOR EACH ROW EXECUTE FUNCTION marketing_financial_evidence_consistency();
CREATE TRIGGER marketing_revenue_adjustment_consistency
  BEFORE INSERT OR UPDATE ON marketing_attribution_revenue_adjustments
  FOR EACH ROW EXECUTE FUNCTION marketing_revenue_adjustment_consistency();
CREATE TRIGGER marketing_booking_attribution_append_only
  BEFORE UPDATE OR DELETE ON marketing_booking_attributions
  FOR EACH ROW EXECUTE FUNCTION marketing_attribution_append_only();
CREATE TRIGGER marketing_financial_evidence_append_only
  BEFORE UPDATE OR DELETE ON marketing_attributed_financial_evidence
  FOR EACH ROW EXECUTE FUNCTION marketing_attribution_append_only();
CREATE TRIGGER marketing_revenue_adjustment_append_only
  BEFORE UPDATE OR DELETE ON marketing_attribution_revenue_adjustments
  FOR EACH ROW EXECUTE FUNCTION marketing_attribution_append_only();

CREATE INDEX marketing_attribution_context_customer_idx
  ON marketing_attribution_contexts(tenant_id,customer_id,status,expires_at);
CREATE INDEX marketing_attribution_context_campaign_idx
  ON marketing_attribution_contexts(tenant_id,campaign_id,generation,created_at DESC);
CREATE INDEX marketing_booking_attribution_campaign_idx
  ON marketing_booking_attributions(tenant_id,campaign_id,attributed_at DESC);
CREATE INDEX marketing_booking_attribution_customer_idx
  ON marketing_booking_attributions(tenant_id,customer_id,attributed_at DESC);
CREATE INDEX marketing_financial_evidence_campaign_idx
  ON marketing_attributed_financial_evidence(tenant_id,campaign_id,recorded_at DESC);
CREATE INDEX marketing_revenue_adjustments_financial_idx
  ON marketing_attribution_revenue_adjustments(tenant_id,financial_evidence_id,created_at DESC);

INSERT INTO permissions(code,description)
SELECT code,'Marketing attribution permission'
FROM unnest(ARRAY['marketing.attribution.read','marketing.attribution.issue']) code
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT r.role,p.code
FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER'),('MARKETING')) r(role)
JOIN permissions p ON p.code IN ('marketing.attribution.read','marketing.attribution.issue')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT 'ACCOUNTANT',p.code
FROM permissions p
WHERE p.code='marketing.attribution.read'
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES('0041_marketing_attribution');

COMMIT;
