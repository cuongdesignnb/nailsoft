BEGIN;

DELETE FROM role_permissions WHERE permission_code IN (
  'branch.activate','branch.deactivate','user.invite','user.update','user.activate','user.suspend',
  'user.assign_role','user.assign_branch','audit.read','role.read','permission.read','mfa.manage_own','mfa.reset_user'
);
DELETE FROM permissions WHERE code IN (
  'branch.activate','branch.deactivate','user.invite','user.update','user.activate','user.suspend',
  'user.assign_role','user.assign_branch','audit.read','role.read','permission.read','mfa.manage_own','mfa.reset_user'
);

UPDATE membership_roles SET role='MARKETING_STAFF' WHERE role='MARKETING';
UPDATE role_permissions SET role='MARKETING_STAFF' WHERE role='MARKETING';

DROP TABLE mfa_challenges;
DROP TABLE mfa_recovery_codes;
DROP TABLE mfa_methods;
DROP TABLE phone_verification_challenges;
DROP TABLE password_reset_tokens;
DROP TABLE invitation_branches;
DROP TABLE invitation_roles;
DROP TABLE invitations;

ALTER TABLE tenant_settings DROP COLUMN auth_policy_json;
ALTER INDEX users_global_phone_e164_unique RENAME TO users_global_phone_unique;
ALTER TABLE users RENAME COLUMN phone_e164 TO phone_normalized;

DELETE FROM schema_migrations WHERE version='0004_identity_recovery_mfa';
COMMIT;
