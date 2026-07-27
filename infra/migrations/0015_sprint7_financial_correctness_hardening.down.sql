BEGIN;

DROP INDEX IF EXISTS commission_entries_refund_original_idx;
DROP INDEX IF EXISTS commission_adjustments_period_status_idx;

ALTER TABLE commission_rules
  DROP CONSTRAINT IF EXISTS commission_rules_active_scope_no_overlap;

UPDATE commission_rules r SET status=x.previous_status
FROM sprint7_rule_overlap_reconciliation x WHERE x.rule_id=r.id;
DROP TABLE sprint7_rule_overlap_reconciliation;

DROP INDEX IF EXISTS commission_entries_one_adjustment_request;
ALTER TABLE commission_entries
  DROP CONSTRAINT IF EXISTS commission_entries_source_attribution_check,
  DROP CONSTRAINT IF EXISTS commission_entries_adjustment_request_fk;

ALTER TABLE commission_entries DISABLE TRIGGER commission_entries_append_only;
UPDATE commission_entries ce
SET invoice_id=(
  SELECT i.id FROM invoices i
  WHERE i.tenant_id=ce.tenant_id
  ORDER BY i.issued_at DESC NULLS LAST,i.id LIMIT 1
)
WHERE ce.invoice_id IS NULL;

ALTER TABLE commission_entries
  ALTER COLUMN invoice_id SET NOT NULL,
  DROP COLUMN adjustment_request_id;
ALTER TABLE commission_entries ENABLE TRIGGER commission_entries_append_only;

CREATE OR REPLACE FUNCTION sprint7_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'financial history is append-only' USING ERRCODE='55000';
END
$$;

DROP VIEW staff_net_tip;
CREATE VIEW staff_net_tip AS
SELECT t.tenant_id,t.staff_id,sum(t.amount_minor)::bigint gross_tip_minor,
       COALESCE((SELECT sum(rta.amount_minor) FROM refund_tip_allocations rta JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id WHERE rta.tenant_id=t.tenant_id AND rta.staff_id=t.staff_id AND r.status='COMPLETED'),0)::bigint refunded_tip_minor,
       (sum(t.amount_minor)-COALESCE((SELECT sum(rta.amount_minor) FROM refund_tip_allocations rta JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id WHERE rta.tenant_id=t.tenant_id AND rta.staff_id=t.staff_id AND r.status='COMPLETED'),0))::bigint net_tip_minor
FROM pos_tip_allocations t GROUP BY t.tenant_id,t.staff_id;

DROP INDEX IF EXISTS refund_allocations_tenant_provider_reference_unique;
DROP TRIGGER IF EXISTS refund_cash_attribution_init ON refund_payment_allocations;
DROP FUNCTION IF EXISTS sprint7_refund_cash_attribution_init();
ALTER TABLE refund_payment_allocations
  DROP CONSTRAINT IF EXISTS refund_allocations_cash_attribution_check,
  DROP CONSTRAINT IF EXISTS refund_allocations_execution_session_fk,
  DROP CONSTRAINT IF EXISTS refund_allocations_original_session_fk,
  DROP CONSTRAINT IF EXISTS refund_allocations_original_register_fk,
  DROP COLUMN execution_cash_session_id,
  DROP COLUMN original_cash_session_id,
  DROP COLUMN original_register_id,
  ADD CONSTRAINT refund_payment_allocations_provider_provider_refund_id_key
    UNIQUE(provider,provider_refund_id);

DELETE FROM schema_migrations
WHERE version='0015_sprint7_financial_correctness_hardening';

COMMIT;
