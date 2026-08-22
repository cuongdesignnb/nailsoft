BEGIN;

ALTER TABLE benefit_exports DROP CONSTRAINT IF EXISTS benefit_exports_export_type_check;
ALTER TABLE benefit_exports
  ADD CONSTRAINT benefit_exports_export_type_check
  CHECK(export_type IN('VOUCHERS','LOYALTY','MEMBERSHIP','PACKAGES','LIABILITY','EXPIRING','CUSTOMER_DIRECTORY'));

INSERT INTO schema_migrations(version)
VALUES ('0039_benefits_customer_directory_export')
ON CONFLICT DO NOTHING;
COMMIT;
