BEGIN;

DELETE FROM schema_migrations
WHERE version='0039_benefits_customer_directory_export';
ALTER TABLE benefit_exports DROP CONSTRAINT IF EXISTS benefit_exports_export_type_check;
ALTER TABLE benefit_exports
  ADD CONSTRAINT benefit_exports_export_type_check
  CHECK(export_type IN('VOUCHERS','LOYALTY','MEMBERSHIP','PACKAGES','LIABILITY','EXPIRING'));

COMMIT;
