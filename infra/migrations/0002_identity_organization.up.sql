BEGIN;

ALTER TABLE tenants ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE branches ADD COLUMN address_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE branches ADD COLUMN phone text;
ALTER TABLE branches ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE branches ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'vi-VN' CHECK(locale IN ('vi-VN','en-US'));
ALTER TABLE users ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0 CHECK(failed_login_attempts >= 0);
ALTER TABLE users ADD COLUMN locked_until timestamptz;
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE permissions (
  code text PRIMARY KEY,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role text NOT NULL,
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY(role, permission_code)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  family_id uuid NOT NULL,
  refresh_token_hash text NOT NULL UNIQUE,
  device_id text NOT NULL,
  device_name text NOT NULL,
  platform text NOT NULL,
  app_version text,
  ip_address inet,
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  replaced_by_session_id uuid REFERENCES sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX sessions_user_active_idx ON sessions(tenant_id,user_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions(family_id);

CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  booking_policy_json jsonb NOT NULL DEFAULT '{}',
  cancellation_policy_json jsonb NOT NULL DEFAULT '{}',
  tax_policy_json jsonb NOT NULL DEFAULT '{}',
  branding_json jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branch_settings (
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  currency char(3) NOT NULL DEFAULT 'VND',
  tax_policy_json jsonb NOT NULL DEFAULT '{}',
  booking_policy_json jsonb NOT NULL DEFAULT '{}',
  notification_settings_json jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,branch_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  open_time time,
  close_time time,
  is_closed boolean NOT NULL DEFAULT false,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date,
  CHECK(is_closed OR (open_time IS NOT NULL AND close_time IS NOT NULL AND close_time > open_time)),
  CHECK(valid_to IS NULL OR valid_to >= valid_from),
  UNIQUE(tenant_id,branch_id,day_of_week,valid_from),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

ALTER TABLE audit_logs ADD COLUMN request_id text;
ALTER TABLE audit_logs ADD COLUMN correlation_id uuid;

ALTER TABLE outbox_events ADD COLUMN event_version integer NOT NULL DEFAULT 1;
ALTER TABLE outbox_events ADD COLUMN branch_id uuid;
ALTER TABLE outbox_events ADD COLUMN aggregate_version integer NOT NULL DEFAULT 1;
ALTER TABLE outbox_events ADD COLUMN actor_json jsonb NOT NULL DEFAULT '{"type":"SYSTEM","id":null}';
ALTER TABLE outbox_events ADD COLUMN source text NOT NULL DEFAULT 'api';
ALTER TABLE outbox_events ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE outbox_events ADD COLUMN causation_id uuid;
ALTER TABLE outbox_events ADD COLUMN trace_id text;
ALTER TABLE outbox_events ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{"schemaVersion":1}';

INSERT INTO permissions(code,description) VALUES
('organization.read','View salon configuration'),
('organization.update','Update salon configuration'),
('branch.read','View authorized branches'),
('branch.create','Create a branch'),
('branch.update','Update an authorized branch'),
('branch.manage_hours','Manage business hours'),
('user.read','View users in authorized scope'),
('user.manage','Manage users and role assignments'),
('session.read_own','View own device sessions'),
('session.revoke_own','Revoke own device sessions'),
('support.policy_boundary','Evaluate platform support policy without granting tenant data access');

INSERT INTO role_permissions(role,permission_code)
SELECT 'SALON_OWNER',code FROM permissions WHERE code <> 'support.policy_boundary';
INSERT INTO role_permissions(role,permission_code) VALUES
('BRANCH_MANAGER','organization.read'),('BRANCH_MANAGER','branch.read'),('BRANCH_MANAGER','branch.update'),
('BRANCH_MANAGER','branch.manage_hours'),('BRANCH_MANAGER','user.read'),('BRANCH_MANAGER','session.read_own'),
('BRANCH_MANAGER','session.revoke_own'),('RECEPTIONIST','branch.read'),('RECEPTIONIST','session.read_own'),
('RECEPTIONIST','session.revoke_own'),('NAIL_TECHNICIAN','branch.read'),('NAIL_TECHNICIAN','session.read_own'),
('NAIL_TECHNICIAN','session.revoke_own'),('PLATFORM_SUPER_ADMIN','support.policy_boundary');

UPDATE users SET password_hash='scrypt$nailsoft-demo-owner$0fc74e8eecbefabd51c25bde52305b97aeacbf373d234e7d627beeb8f59382f6d18293e20bf7837189eba0ef54445494eac854f09522f4ac3c54c6116bbcd42a'
WHERE email='owner@example.test';
INSERT INTO tenant_settings(tenant_id) SELECT id FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO branch_settings(tenant_id,branch_id) SELECT tenant_id,id FROM branches ON CONFLICT DO NOTHING;
INSERT INTO business_hours(tenant_id,branch_id,day_of_week,open_time,close_time,is_closed)
SELECT tenant_id,id,day,CASE WHEN day=0 THEN NULL ELSE time '09:00' END,CASE WHEN day=0 THEN NULL ELSE time '20:00' END,day=0
FROM branches CROSS JOIN generate_series(0,6) day ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0002_identity_organization');
COMMIT;
