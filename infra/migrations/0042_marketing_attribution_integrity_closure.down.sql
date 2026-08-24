BEGIN;

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
  SELECT a.customer_id,a.tenant_id,a.branch_id INTO appointment_row
    FROM appointments a
   WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.appointment_id;
  IF appointment_row IS NULL OR appointment_row.customer_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'MARKETING_BOOKING_ATTRIBUTION_CUSTOMER_MISMATCH';
  END IF;
  IF context_row.campaign_branch_id IS NOT NULL
     AND context_row.campaign_branch_id IS DISTINCT FROM appointment_row.branch_id THEN
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

DELETE FROM schema_migrations
WHERE version='0042_marketing_attribution_integrity_closure';

COMMIT;
