BEGIN;
DELETE FROM role_permissions WHERE permission_code IN (SELECT code FROM permissions WHERE code LIKE 'asset.%');
DELETE FROM permissions WHERE code LIKE 'asset.%';
DROP TRIGGER IF EXISTS asset_count_snapshot_guard ON asset_count_sessions;
DROP TRIGGER IF EXISTS asset_posted_economics_guard ON assets;
DROP TRIGGER IF EXISTS asset_maintenance_history_append_only ON asset_maintenance_history;
DROP TRIGGER IF EXISTS asset_transfer_history_append_only ON asset_transfer_history;
DROP TRIGGER IF EXISTS asset_status_history_append_only ON asset_status_history;
DROP FUNCTION IF EXISTS asset_count_snapshot_guard();
DROP FUNCTION IF EXISTS asset_posted_economics_guard();
DROP FUNCTION IF EXISTS asset_append_only_guard();
DROP TABLE IF EXISTS asset_export_jobs, asset_reconciliation_snapshots, asset_import_errors, asset_opening_import_rows, asset_opening_imports,
  asset_disposal_history, asset_disposal_approvals, asset_disposals, asset_retirement_requests, asset_capital_improvement_approvals, asset_capital_improvements,
  asset_impairment_history, asset_impairment_approvals, asset_impairment_requests, asset_inspection_results, asset_inspections,
  asset_count_discrepancy_actions, asset_count_lines, asset_count_sessions, asset_transfer_history, asset_transfers,
  asset_warranty_claim_history, asset_warranty_claims, asset_warranties, asset_maintenance_history, asset_maintenance_costs, asset_maintenance_work_order_tasks, asset_maintenance_work_orders, asset_maintenance_plans,
  asset_depreciation_posting_history, asset_depreciation_adjustments, asset_depreciation_schedules, asset_depreciation_run_lines, asset_depreciation_runs,
  asset_capitalization_history, asset_cost_components, asset_capitalization_approvals, asset_capitalization_request_lines, asset_capitalization_requests,
  asset_tags, asset_photos, asset_documents, asset_status_history, asset_components, asset_bundles, assets, asset_asset_code_sequences,
  asset_candidate_classification_history, asset_candidate_source_allocations, asset_candidates,
  asset_configuration_checklists, asset_gl_mappings, asset_maintenance_policies, asset_capitalization_policies, asset_depreciation_policies, asset_categories, asset_command_idempotency, asset_module_configurations CASCADE;
DELETE FROM schema_migrations WHERE version='0033_fixed_assets_maintenance_depreciation';
COMMIT;
