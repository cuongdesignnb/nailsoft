BEGIN;
DELETE FROM role_permissions WHERE permission_code='financial.reconciliation.review';
DELETE FROM permissions WHERE code='financial.reconciliation.review';
ALTER TABLE financial_export_jobs DROP CONSTRAINT IF EXISTS financial_export_jobs_export_type_check;
ALTER TABLE financial_export_jobs ADD CONSTRAINT financial_export_jobs_export_type_check
  CHECK (export_type IN ('REFUNDS','CREDIT_NOTES','COMMISSION_ENTRIES','COMMISSION_STATEMENTS','NET_SALES'));
DROP TABLE payment_reconciliation_events;
DROP TABLE payment_reconciliation_reviews;
DROP FUNCTION payment_reconciliation_event_append_only();
DELETE FROM schema_migrations WHERE version='0038_payment_reconciliation_reviews';
COMMIT;
