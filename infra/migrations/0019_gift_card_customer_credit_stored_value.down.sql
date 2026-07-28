BEGIN;
CREATE OR REPLACE VIEW invoice_refund_summary AS
SELECT i.tenant_id,i.id invoice_id,
       COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0)::bigint captured_minor,
       COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)::bigint completed_refund_minor,
       GREATEST(0,COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0)-COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0))::bigint refundable_minor,
       CASE WHEN COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)=0 THEN 'PAID'
            WHEN COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)>=COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0) THEN 'REFUNDED'
            ELSE 'PARTIALLY_REFUNDED' END financial_status
FROM invoices i WHERE i.status='ISSUED';
DELETE FROM role_permissions WHERE permission_code LIKE 'gift_card.%' OR permission_code LIKE 'stored_value.%' OR permission_code LIKE 'customer_credit.%';
DELETE FROM permissions WHERE code LIKE 'gift_card.%' OR code LIKE 'stored_value.%' OR code LIKE 'customer_credit.%';
ALTER TABLE pos_order_lines DROP CONSTRAINT IF EXISTS pos_order_line_gift_card_fk, DROP CONSTRAINT IF EXISTS pos_order_line_gift_card_product_fk, DROP COLUMN IF EXISTS gift_card_id, DROP COLUMN IF EXISTS gift_card_product_id;
ALTER TABLE pos_order_lines DROP CONSTRAINT pos_order_lines_line_type_check;
ALTER TABLE pos_order_lines ADD CONSTRAINT pos_order_lines_line_type_check CHECK(line_type IN('SERVICE','MANUAL_SERVICE','ADJUSTMENT','PRODUCT'));
DROP TABLE stored_value_export_jobs,stored_value_lookup_limits,stored_value_reconciliation_exceptions,stored_value_liability_daily_snapshots,gift_card_delivery_requests,gift_card_reload_requests,gift_card_activation_requests,gift_card_purchase_refund_plans,refund_stored_value_plans,stored_value_adjustment_requests,stored_value_refund_allocations,stored_value_settlement_allocations,pos_order_stored_value_applications,stored_value_reservations,stored_value_ledger_entries,stored_value_accounts,gift_cards,gift_card_products,stored_value_legal_policies,stored_value_settings;
ALTER TABLE refunds DROP COLUMN IF EXISTS refund_destination;
DROP FUNCTION sprint10_account_projection_guard();
DROP FUNCTION sprint10_append_only_guard();
DELETE FROM schema_migrations WHERE version='0019_gift_card_customer_credit_stored_value';
COMMIT;
