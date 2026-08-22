BEGIN;
DROP TRIGGER IF EXISTS customer_care_activities_append_only ON customer_care_activities;
DROP FUNCTION IF EXISTS customer_care_activity_append_only();
DROP TABLE IF EXISTS customer_care_followups;
DROP TABLE IF EXISTS customer_care_activities;
DELETE FROM role_permissions WHERE permission_code IN('customer.care.read','customer.care.manage','customer.care.followup.manage');
DELETE FROM permissions WHERE code IN('customer.care.read','customer.care.manage','customer.care.followup.manage');
DELETE FROM schema_migrations WHERE version='0040_customer_care_engagement_hub';
COMMIT;
