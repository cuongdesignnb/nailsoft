BEGIN;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS metadata_json,DROP COLUMN IF EXISTS trace_id,DROP COLUMN IF EXISTS causation_id,DROP COLUMN IF EXISTS correlation_id,DROP COLUMN IF EXISTS source,DROP COLUMN IF EXISTS actor_json,DROP COLUMN IF EXISTS aggregate_version,DROP COLUMN IF EXISTS branch_id,DROP COLUMN IF EXISTS event_version;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS correlation_id,DROP COLUMN IF EXISTS request_id;
DROP TABLE IF EXISTS business_hours,branch_settings,tenant_settings,sessions,role_permissions,permissions;
ALTER TABLE users DROP COLUMN IF EXISTS updated_at,DROP COLUMN IF EXISTS locked_until,DROP COLUMN IF EXISTS failed_login_attempts,DROP COLUMN IF EXISTS locale,DROP COLUMN IF EXISTS password_hash;
ALTER TABLE branches DROP COLUMN IF EXISTS updated_at,DROP COLUMN IF EXISTS created_at,DROP COLUMN IF EXISTS phone,DROP COLUMN IF EXISTS address_json;
ALTER TABLE tenants DROP COLUMN IF EXISTS updated_at;
DELETE FROM schema_migrations WHERE version='0002_identity_organization';
COMMIT;
