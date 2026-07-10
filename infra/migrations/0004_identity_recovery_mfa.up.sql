BEGIN;

-- Preserve existing phone data while adopting the domain's canonical E.164 name.
ALTER TABLE users RENAME COLUMN phone_normalized TO phone_e164;
ALTER INDEX users_global_phone_unique RENAME TO users_global_phone_e164_unique;

ALTER TABLE tenant_settings
  ADD COLUMN auth_policy_json jsonb NOT NULL DEFAULT '{"mfa":{"requiredRoles":["SALON_OWNER","BRANCH_MANAGER"],"enrollmentGraceMinutes":1440}}';

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email_normalized text,
  phone_e164 text,
  display_name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES users(id),
  accepted_by_user_id uuid REFERENCES users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  CHECK(email_normalized IS NOT NULL OR phone_e164 IS NOT NULL),
  CHECK(phone_e164 IS NULL OR phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  CHECK((status <> 'ACCEPTED') OR (accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL)),
  CHECK((status <> 'REVOKED') OR revoked_at IS NOT NULL)
);
CREATE INDEX invitations_tenant_status_created_idx ON invitations(tenant_id,status,created_at DESC);
CREATE UNIQUE INDEX invitations_pending_email_unique
  ON invitations(tenant_id,lower(email_normalized)) WHERE status='PENDING' AND email_normalized IS NOT NULL;
CREATE UNIQUE INDEX invitations_pending_phone_unique
  ON invitations(tenant_id,phone_e164) WHERE status='PENDING' AND phone_e164 IS NOT NULL;

CREATE TABLE invitation_roles (
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('SALON_OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER','NAIL_TECHNICIAN','ACCOUNTANT','MARKETING')),
  PRIMARY KEY(invitation_id,role)
);

CREATE TABLE invitation_branches (
  invitation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  PRIMARY KEY(invitation_id,branch_id),
  FOREIGN KEY(tenant_id,invitation_id) REFERENCES invitations(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  requested_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_created_idx ON password_reset_tokens(user_id,created_at DESC);

CREATE TABLE phone_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL CHECK(phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  purpose text NOT NULL CHECK(purpose IN ('LOGIN','VERIFY_PHONE','ACCEPT_INVITATION','RECOVERY')),
  code_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  resend_count integer NOT NULL DEFAULT 0 CHECK(resend_count >= 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  blocked_until timestamptz,
  request_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_challenge_lookup_idx ON phone_verification_challenges(phone_e164,purpose,created_at DESC);

CREATE TABLE mfa_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK(type='TOTP'),
  secret_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','DISABLED')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CHECK((status <> 'ACTIVE') OR verified_at IS NOT NULL),
  CHECK((status <> 'DISABLED') OR disabled_at IS NOT NULL)
);
CREATE UNIQUE INDEX mfa_methods_user_active_unique ON mfa_methods(user_id,type) WHERE status IN ('PENDING','ACTIVE');

CREATE TABLE mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_user_available_idx ON mfa_recovery_codes(user_id) WHERE consumed_at IS NULL;

CREATE TABLE mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK(purpose IN ('LOGIN','STEP_UP','ENROLLMENT')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenge_user_expiry_idx ON mfa_challenges(user_id,expires_at) WHERE consumed_at IS NULL;

-- Resolve the legacy synonym without allowing two role codes to persist.
UPDATE membership_roles SET role='MARKETING' WHERE role='MARKETING_STAFF';
UPDATE role_permissions SET role='MARKETING' WHERE role='MARKETING_STAFF';

INSERT INTO permissions(code,description) VALUES
('branch.activate','Activate a branch'),
('branch.deactivate','Deactivate a branch'),
('user.invite','Invite a tenant member'),
('user.update','Update a tenant member'),
('user.activate','Activate a tenant member'),
('user.suspend','Suspend a tenant member'),
('user.assign_role','Assign roles within authorized scope'),
('user.assign_branch','Assign branches within authorized scope'),
('audit.read','Read tenant audit records'),
('role.read','Read the system role catalog'),
('permission.read','Read the permission catalog'),
('mfa.manage_own','Manage own MFA methods'),
('mfa.reset_user','Reset MFA for an authorized user')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role,permission_code)
SELECT 'SALON_OWNER',code FROM permissions
WHERE code IN ('branch.activate','branch.deactivate','user.invite','user.update','user.activate','user.suspend','user.assign_role','user.assign_branch','audit.read','role.read','permission.read','mfa.manage_own','mfa.reset_user')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('BRANCH_MANAGER','user.invite'),('BRANCH_MANAGER','user.update'),('BRANCH_MANAGER','user.activate'),
('BRANCH_MANAGER','user.suspend'),('BRANCH_MANAGER','user.assign_role'),('BRANCH_MANAGER','user.assign_branch'),
('BRANCH_MANAGER','role.read'),('BRANCH_MANAGER','permission.read'),('BRANCH_MANAGER','mfa.manage_own'),
('RECEPTIONIST','mfa.manage_own'),('CASHIER','mfa.manage_own'),('NAIL_TECHNICIAN','mfa.manage_own'),
('ACCOUNTANT','mfa.manage_own'),('MARKETING','mfa.manage_own')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0004_identity_recovery_mfa');
COMMIT;
