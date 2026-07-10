BEGIN;

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('INVITED','ACTIVE','SUSPENDED','REVOKED')),
  authorization_version integer NOT NULL DEFAULT 1 CHECK(authorization_version > 0),
  joined_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,user_id),
  UNIQUE(tenant_id,id)
);

CREATE TABLE membership_roles (
  membership_id uuid NOT NULL REFERENCES tenant_memberships(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(membership_id,role)
);

CREATE TABLE membership_branches (
  membership_id uuid NOT NULL REFERENCES tenant_memberships(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(membership_id,branch_id),
  FOREIGN KEY(tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

INSERT INTO tenant_memberships(tenant_id,user_id,status,joined_at)
SELECT tenant_id,id,CASE WHEN status='ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END,now() FROM users;

INSERT INTO membership_roles(membership_id,role)
SELECT tm.id,ur.role FROM user_roles ur JOIN tenant_memberships tm ON tm.tenant_id=ur.tenant_id AND tm.user_id=ur.user_id;

INSERT INTO membership_branches(membership_id,tenant_id,branch_id)
SELECT tm.id,ur.tenant_id,ur.branch_id FROM user_roles ur JOIN tenant_memberships tm ON tm.tenant_id=ur.tenant_id AND tm.user_id=ur.user_id
WHERE ur.branch_id IS NOT NULL ON CONFLICT DO NOTHING;

ALTER TABLE sessions RENAME TO device_sessions;
ALTER INDEX sessions_pkey RENAME TO device_sessions_pkey;
ALTER INDEX sessions_refresh_token_hash_key RENAME TO device_sessions_refresh_token_hash_key;
ALTER INDEX sessions_user_active_idx RENAME TO device_sessions_user_active_idx;
ALTER INDEX sessions_family_idx RENAME TO device_sessions_family_idx;
ALTER TABLE device_sessions RENAME CONSTRAINT sessions_replaced_by_session_id_fkey TO device_sessions_replaced_by_session_id_fkey;
ALTER TABLE device_sessions RENAME CONSTRAINT sessions_tenant_id_fkey TO device_sessions_tenant_id_fkey;
ALTER TABLE device_sessions RENAME CONSTRAINT sessions_tenant_id_user_id_fkey TO device_sessions_tenant_id_user_id_fkey;
ALTER TABLE device_sessions ADD COLUMN membership_id uuid;
UPDATE device_sessions ds SET membership_id=tm.id FROM tenant_memberships tm WHERE tm.tenant_id=ds.tenant_id AND tm.user_id=ds.user_id;
ALTER TABLE device_sessions ALTER COLUMN membership_id SET NOT NULL;
ALTER TABLE device_sessions ADD CONSTRAINT device_sessions_membership_fkey FOREIGN KEY(tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id);

-- Merge legacy per-tenant identity rows sharing the same normalized email.
CREATE TEMP TABLE identity_merge ON COMMIT DROP AS
SELECT id AS duplicate_id,first_value(id) OVER(PARTITION BY lower(email) ORDER BY id::text) AS canonical_id
FROM users WHERE email IS NOT NULL;
DELETE FROM identity_merge WHERE duplicate_id=canonical_id;
UPDATE tenant_memberships tm SET user_id=m.canonical_id FROM identity_merge m WHERE tm.user_id=m.duplicate_id;
ALTER TABLE device_sessions DROP CONSTRAINT device_sessions_tenant_id_user_id_fkey;
UPDATE device_sessions ds SET user_id=m.canonical_id FROM identity_merge m WHERE ds.user_id=m.duplicate_id;
DROP TABLE user_roles;
DELETE FROM users u USING identity_merge m WHERE u.id=m.duplicate_id;

ALTER TABLE users DROP CONSTRAINT users_tenant_id_fkey;
ALTER TABLE users DROP CONSTRAINT users_tenant_id_id_key;
DROP INDEX users_tenant_email_unique;
DROP INDEX users_tenant_phone_unique;
ALTER TABLE users RENAME COLUMN tenant_id TO origin_tenant_id;
ALTER TABLE users ALTER COLUMN origin_tenant_id DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_origin_tenant_fkey FOREIGN KEY(origin_tenant_id) REFERENCES tenants(id);
CREATE UNIQUE INDEX users_global_email_unique ON users(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_global_phone_unique ON users(phone_normalized) WHERE phone_normalized IS NOT NULL;
ALTER TABLE users ADD COLUMN security_stamp uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;

CREATE INDEX tenant_memberships_user_status_idx ON tenant_memberships(user_id,status);
CREATE INDEX membership_branches_scope_idx ON membership_branches(tenant_id,branch_id,membership_id);
CREATE INDEX device_sessions_membership_active_idx ON device_sessions(membership_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,event_type text NOT NULL,
  identifier_hash text,ip_address inet,details_json jsonb NOT NULL DEFAULT '{}',request_id text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_type_created_idx ON security_events(event_type,created_at DESC);
CREATE TABLE auth_rate_limits (
  bucket_key text PRIMARY KEY,attempt_count integer NOT NULL DEFAULT 0,window_started_at timestamptz NOT NULL DEFAULT now(),blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions(code,description) VALUES
('session.read_tenant','View device sessions for users in authorized tenant/branch scope'),
('session.revoke_tenant','Revoke device sessions for users in authorized tenant/branch scope') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('SALON_OWNER','session.read_tenant'),('SALON_OWNER','session.revoke_tenant'),
('BRANCH_MANAGER','session.read_tenant'),('BRANCH_MANAGER','session.revoke_tenant') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0003_tenant_memberships_security_hardening');
COMMIT;
