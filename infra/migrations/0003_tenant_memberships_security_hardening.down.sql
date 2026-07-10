BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM tenant_memberships GROUP BY user_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Rollback blocked: global users already belong to multiple tenants';
  END IF;
END $$;

DROP INDEX IF EXISTS users_global_email_unique;
DROP INDEX IF EXISTS users_global_phone_unique;
ALTER TABLE users DROP COLUMN IF EXISTS phone_verified_at,DROP COLUMN IF EXISTS security_stamp;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_origin_tenant_fkey;
ALTER TABLE users RENAME COLUMN origin_tenant_id TO tenant_id;
UPDATE users u SET tenant_id=tm.tenant_id FROM tenant_memberships tm WHERE tm.user_id=u.id;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES tenants(id);
ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_key UNIQUE(tenant_id,id);
CREATE UNIQUE INDEX users_tenant_email_unique ON users(tenant_id,email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_tenant_phone_unique ON users(tenant_id,phone_normalized) WHERE phone_normalized IS NOT NULL;

CREATE TABLE user_roles(tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL,branch_id uuid,role text NOT NULL,PRIMARY KEY(tenant_id,user_id,role),FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id));
INSERT INTO user_roles(tenant_id,user_id,branch_id,role)
SELECT tm.tenant_id,tm.user_id,mb.branch_id,mr.role FROM tenant_memberships tm JOIN membership_roles mr ON mr.membership_id=tm.id LEFT JOIN membership_branches mb ON mb.membership_id=tm.id;

ALTER TABLE device_sessions DROP CONSTRAINT device_sessions_membership_fkey;
ALTER TABLE device_sessions DROP COLUMN membership_id;
ALTER TABLE device_sessions ADD CONSTRAINT sessions_tenant_id_user_id_fkey FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id);
ALTER TABLE device_sessions RENAME CONSTRAINT device_sessions_replaced_by_session_id_fkey TO sessions_replaced_by_session_id_fkey;
ALTER TABLE device_sessions RENAME CONSTRAINT device_sessions_tenant_id_fkey TO sessions_tenant_id_fkey;
ALTER TABLE device_sessions RENAME TO sessions;
ALTER INDEX device_sessions_pkey RENAME TO sessions_pkey;
ALTER INDEX device_sessions_refresh_token_hash_key RENAME TO sessions_refresh_token_hash_key;
ALTER INDEX device_sessions_user_active_idx RENAME TO sessions_user_active_idx;
ALTER INDEX device_sessions_family_idx RENAME TO sessions_family_idx;

DROP TABLE auth_rate_limits,security_events,membership_branches,membership_roles,tenant_memberships;
DELETE FROM role_permissions WHERE permission_code IN('session.read_tenant','session.revoke_tenant');
DELETE FROM permissions WHERE code IN('session.read_tenant','session.revoke_tenant');
DELETE FROM schema_migrations WHERE version='0003_tenant_memberships_security_hardening';
COMMIT;
