BEGIN;
DELETE FROM role_permissions WHERE permission_code IN (SELECT code FROM permissions WHERE code LIKE 'refund.%' OR code LIKE 'credit_note.%' OR code LIKE 'commission.%' OR code IN('financial.refund_report.read','financial.commission_report.read','financial.export'));
DELETE FROM permissions WHERE code LIKE 'refund.%' OR code LIKE 'credit_note.%' OR code LIKE 'commission.%' OR code IN('financial.refund_report.read','financial.commission_report.read','financial.export');
DROP VIEW IF EXISTS staff_net_tip;
DROP VIEW IF EXISTS invoice_line_refund_balance;
DROP VIEW IF EXISTS payment_refund_balance;
DROP VIEW IF EXISTS invoice_refund_summary;
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_refund_fk;
DROP INDEX IF EXISTS cash_movements_one_refund_idx;
ALTER TABLE cash_movements DROP COLUMN related_refund_id;
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_movement_type_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_movement_type_check CHECK(movement_type IN('OPENING_FLOAT','CASH_SALE','CASH_IN','CASH_OUT','CASH_DROP','CLOSING_ADJUSTMENT'));
DROP TABLE financial_export_jobs,commission_period_staff_snapshots,commission_adjustment_requests,commission_generation_conflicts,commission_entries,commission_periods,credit_note_lines,credit_notes,credit_note_counters,refund_tip_allocations,refund_status_history,refund_attempts,refund_payment_allocations,refund_items,refunds,refund_counters;
DROP INDEX IF EXISTS commission_rules_resolution_idx;
ALTER TABLE commission_rules
  DROP CONSTRAINT commission_rules_value_check,
  DROP CONSTRAINT commission_rules_effective_check,
  DROP CONSTRAINT commission_rules_version_check,
  DROP CONSTRAINT commission_rules_fixed_check,
  DROP CONSTRAINT commission_rules_percent_check,
  DROP CONSTRAINT commission_rules_base_check,
  DROP CONSTRAINT commission_rules_type_check,
  DROP CONSTRAINT commission_rules_status_check,
  DROP CONSTRAINT commission_rules_supersedes_fk,
  DROP CONSTRAINT commission_rules_created_by_fk,
  DROP CONSTRAINT commission_rules_service_fk,
  DROP CONSTRAINT commission_rules_staff_fk,
  DROP CONSTRAINT commission_rules_branch_fk,
  DROP CONSTRAINT commission_rules_tenant_code_version_key,
  DROP CONSTRAINT commission_rules_tenant_id_id_key,
  DROP COLUMN created_at,DROP COLUMN supersedes_rule_id,DROP COLUMN created_by_user_id,DROP COLUMN version,
  DROP COLUMN effective_to,DROP COLUMN effective_from,DROP COLUMN policy_json,DROP COLUMN priority,DROP COLUMN currency,
  DROP COLUMN fixed_minor,DROP COLUMN percent_basis_points,DROP COLUMN base_mode,DROP COLUMN rule_type,DROP COLUMN rule_code,
  DROP COLUMN service_id,DROP COLUMN staff_id,DROP COLUMN branch_id;
UPDATE commission_rules SET name=COALESCE(name,'Legacy commission rule'),rule_json=COALESCE(rule_json,'{}'::jsonb);
ALTER TABLE commission_rules ALTER COLUMN name SET NOT NULL,ALTER COLUMN rule_json SET NOT NULL;
DROP FUNCTION sprint7_credit_note_line_immutable();
DROP FUNCTION sprint7_credit_note_immutable();
DROP FUNCTION sprint7_append_only_guard();
DELETE FROM schema_migrations WHERE version='0014_refund_credit_note_commission_reporting';
COMMIT;
