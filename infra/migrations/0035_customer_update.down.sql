BEGIN;

DELETE FROM role_permissions
WHERE permission_code = 'customer.update'
  AND role IN ('SALON_OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST');

DELETE FROM permissions
WHERE code = 'customer.update'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions WHERE permission_code = 'customer.update'
  );

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_version_check;
ALTER TABLE customers
  DROP COLUMN IF EXISTS version;

DELETE FROM schema_migrations WHERE version = '0035_customer_update';
COMMIT;
