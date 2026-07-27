BEGIN;
DELETE FROM schema_migrations WHERE version='0013_sprint6_financial_attribution_hardening';

DROP TRIGGER IF EXISTS pos_order_register_immutable ON pos_orders;
DROP FUNCTION IF EXISTS sprint6_order_register_guard();

DROP INDEX IF EXISTS payments_cashier_captured_idx;
DROP INDEX IF EXISTS payments_register_captured_idx;
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_cash_session_register_fk,
  DROP CONSTRAINT IF EXISTS payments_order_register_fk,
  DROP CONSTRAINT IF EXISTS payments_register_fk,
  DROP COLUMN IF EXISTS register_id;

ALTER TABLE pos_orders
  DROP CONSTRAINT IF EXISTS pos_orders_finalized_register_required,
  DROP CONSTRAINT IF EXISTS pos_orders_tenant_id_id_register_key;
ALTER TABLE cash_sessions
  DROP CONSTRAINT IF EXISTS cash_sessions_drawer_register_fk,
  DROP CONSTRAINT IF EXISTS cash_sessions_tenant_id_id_register_key;
ALTER TABLE cash_drawers
  DROP CONSTRAINT IF EXISTS cash_drawers_tenant_id_id_register_key;
COMMIT;
