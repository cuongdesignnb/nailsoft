BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_version_check'
      AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_version_check CHECK (version > 0);
  END IF;
END $$;

INSERT INTO permissions(code, description)
VALUES ('customer.update', 'Update tenant customer profile fields')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role, permission_code)
SELECT roles.role, 'customer.update'
FROM (VALUES ('SALON_OWNER'), ('BRANCH_MANAGER'), ('RECEPTIONIST')) AS roles(role)
WHERE EXISTS (SELECT 1 FROM permissions WHERE code = 'customer.update')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES ('0035_customer_update')
ON CONFLICT DO NOTHING;
COMMIT;
