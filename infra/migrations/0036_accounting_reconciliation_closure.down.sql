BEGIN;
DROP TRIGGER IF EXISTS accounting_reconciliation_adjustment_posted_guard ON accounting_reconciliation_adjustment_requests;
DROP FUNCTION IF EXISTS accounting_reconciliation_adjustment_posted_guard();
DROP TRIGGER IF EXISTS accounting_reconciliation_adjustment_history_append_only ON accounting_reconciliation_adjustment_history;
DROP TABLE IF EXISTS accounting_reconciliation_adjustment_history;
ALTER TABLE accounting_reconciliation_adjustment_requests
  DROP CONSTRAINT IF EXISTS accounting_reconciliation_adjustment_requests_offset_account_fk,
  DROP CONSTRAINT IF EXISTS accounting_reconciliation_adjustment_requests_tenant_id_key,
  DROP CONSTRAINT IF EXISTS accounting_reconciliation_adjustment_requests_amount_check,
  DROP CONSTRAINT IF EXISTS accounting_reconciliation_adjustment_requests_direction_check,
  DROP CONSTRAINT IF EXISTS accounting_reconciliation_adjustment_requests_version_check;
ALTER TABLE accounting_reconciliation_adjustment_requests
  DROP COLUMN IF EXISTS accounting_date,
  DROP COLUMN IF EXISTS offset_account_id,
  DROP COLUMN IF EXISTS direction,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS version;
DROP TRIGGER IF EXISTS accounting_bank_statement_line_append_only ON accounting_bank_statement_lines;
CREATE OR REPLACE FUNCTION accounting_bank_statement_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACCOUNTING_BANK_STATEMENT_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER accounting_bank_statement_line_append_only BEFORE UPDATE OR DELETE ON accounting_bank_statement_lines FOR EACH ROW EXECUTE FUNCTION accounting_bank_statement_append_only_guard();
ALTER TABLE accounting_bank_statement_lines DROP CONSTRAINT IF EXISTS accounting_bank_statement_lines_version_check;
ALTER TABLE accounting_bank_statement_lines DROP COLUMN IF EXISTS version;
DELETE FROM schema_migrations WHERE version='0036_accounting_reconciliation_closure';
COMMIT;
