DELETE FROM role_permissions WHERE permission_code='service_session.checklist';
DELETE FROM permissions WHERE code='service_session.checklist';
DROP TRIGGER IF EXISTS service_session_checklist_template_clone ON service_sessions;
DROP FUNCTION IF EXISTS clone_service_session_checklist();
DROP TABLE IF EXISTS service_session_checklist_items;
DROP TABLE IF EXISTS service_execution_checklist_template_items;
DROP TABLE IF EXISTS service_execution_checklist_templates;
DELETE FROM schema_migrations WHERE version='0037_service_execution_checklist';
