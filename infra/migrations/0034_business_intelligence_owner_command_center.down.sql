BEGIN;
DROP TRIGGER IF EXISTS analytics_projection_events_append_only ON analytics_projection_events;
DROP FUNCTION IF EXISTS analytics_projection_events_append_only();
DROP TABLE IF EXISTS analytics_rebuild_runs, analytics_export_jobs, analytics_saved_views, analytics_alert_occurrences, analytics_alert_rules, analytics_targets,
  analytics_asset_facts, analytics_financial_facts, analytics_inventory_facts, analytics_customer_cohorts, analytics_daily_service_facts,
  analytics_daily_staff_facts, analytics_daily_branch_facts, analytics_snapshot_runs, analytics_projection_checkpoints, analytics_projection_events,
  analytics_metric_definitions;
DELETE FROM role_permissions WHERE permission_code LIKE 'analytics.%';
DELETE FROM permissions WHERE code LIKE 'analytics.%';
DELETE FROM schema_migrations WHERE version='0034_business_intelligence_owner_command_center';
COMMIT;
