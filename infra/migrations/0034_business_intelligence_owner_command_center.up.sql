BEGIN;

-- Sprint 17 is an additive, rebuildable read model.  Source domains remain authoritative.
CREATE TABLE analytics_metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  metric_key text NOT NULL, display_name text NOT NULL, formula text NOT NULL,
  source_domain text NOT NULL, metric_version integer NOT NULL DEFAULT 1 CHECK (metric_version > 0),
  permission_code text NOT NULL, drilldown_route text, definition_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_key, metric_version), FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE TABLE analytics_projection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  projector_name text NOT NULL, source_type text NOT NULL, source_id uuid NOT NULL,
  source_version integer NOT NULL DEFAULT 1, source_occurred_at timestamptz,
  business_date date, branch_id uuid, event_type text NOT NULL, payload_json jsonb NOT NULL DEFAULT '{}',
  processed_at timestamptz NOT NULL DEFAULT now(), projection_revision bigint NOT NULL,
  UNIQUE (tenant_id, projector_name, source_type, source_id, source_version),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE TABLE analytics_projection_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  projector_name text NOT NULL, last_event_id uuid, projection_revision bigint NOT NULL DEFAULT 0,
  last_successful_refresh_at timestamptz, status text NOT NULL DEFAULT 'HEALTHY' CHECK (status IN ('HEALTHY','DEGRADED','REBUILDING')),
  lag_seconds integer NOT NULL DEFAULT 0 CHECK (lag_seconds >= 0), error_json jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, projector_name)
);
CREATE TABLE analytics_snapshot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope_json jsonb NOT NULL DEFAULT '{}', revision bigint NOT NULL, status text NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING','READY','FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, error_json jsonb,
  UNIQUE (tenant_id, id)
);

CREATE TABLE analytics_daily_branch_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  business_date date NOT NULL, timezone text NOT NULL, currency_code char(3) NOT NULL,
  metric_version integer NOT NULL DEFAULT 1, projection_revision bigint NOT NULL,
  gross_sales_minor bigint NOT NULL DEFAULT 0, discount_minor bigint NOT NULL DEFAULT 0,
  net_sales_minor bigint NOT NULL DEFAULT 0, tax_collected_minor bigint NOT NULL DEFAULT 0,
  tips_minor bigint NOT NULL DEFAULT 0, payments_collected_minor bigint NOT NULL DEFAULT 0,
  refunds_minor bigint NOT NULL DEFAULT 0, bookings_created integer NOT NULL DEFAULT 0,
  bookings_confirmed integer NOT NULL DEFAULT 0, completed_appointments integer NOT NULL DEFAULT 0,
  cancelled_appointments integer NOT NULL DEFAULT 0, no_show_appointments integer NOT NULL DEFAULT 0,
  walk_ins integer NOT NULL DEFAULT 0, booked_service_minutes integer NOT NULL DEFAULT 0,
  completed_service_minutes integer NOT NULL DEFAULT 0, eligible_working_minutes integer NOT NULL DEFAULT 0,
  new_customers integer NOT NULL DEFAULT 0, returning_customers integer NOT NULL DEFAULT 0,
  active_customers integer NOT NULL DEFAULT 0, inventory_value_minor bigint NOT NULL DEFAULT 0,
  outstanding_ap_minor bigint NOT NULL DEFAULT 0, payroll_cost_minor bigint NOT NULL DEFAULT 0,
  asset_nbv_minor bigint NOT NULL DEFAULT 0, metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, business_date, currency_code, metric_version),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE INDEX analytics_daily_branch_date_idx ON analytics_daily_branch_facts(tenant_id, branch_id, business_date);
CREATE TABLE analytics_daily_staff_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  staff_id uuid NOT NULL, business_date date NOT NULL, timezone text NOT NULL, currency_code char(3) NOT NULL,
  metric_version integer NOT NULL DEFAULT 1, projection_revision bigint NOT NULL,
  completed_appointments integer NOT NULL DEFAULT 0, service_count integer NOT NULL DEFAULT 0,
  service_revenue_minor bigint NOT NULL DEFAULT 0, retail_revenue_minor bigint NOT NULL DEFAULT 0,
  productive_minutes integer NOT NULL DEFAULT 0, eligible_working_minutes integer NOT NULL DEFAULT 0,
  tips_minor bigint NOT NULL DEFAULT 0, commission_minor bigint NOT NULL DEFAULT 0,
  payroll_cost_minor bigint NOT NULL DEFAULT 0, rebooked_count integer NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, staff_id, business_date, currency_code, metric_version),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id), FOREIGN KEY (tenant_id, staff_id) REFERENCES staff_profiles(tenant_id, id)
);
CREATE INDEX analytics_daily_staff_date_idx ON analytics_daily_staff_facts(tenant_id, branch_id, staff_id, business_date);
CREATE TABLE analytics_daily_service_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  service_id uuid NOT NULL, business_date date NOT NULL, timezone text NOT NULL, currency_code char(3) NOT NULL,
  metric_version integer NOT NULL DEFAULT 1, projection_revision bigint NOT NULL,
  booking_count integer NOT NULL DEFAULT 0, completion_count integer NOT NULL DEFAULT 0,
  gross_sales_minor bigint NOT NULL DEFAULT 0, net_sales_minor bigint NOT NULL DEFAULT 0,
  discount_minor bigint NOT NULL DEFAULT 0, refund_minor bigint NOT NULL DEFAULT 0,
  average_duration_seconds integer NOT NULL DEFAULT 0, average_price_minor bigint NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, service_id, business_date, currency_code, metric_version),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id), FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id)
);
CREATE TABLE analytics_customer_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  cohort_month date NOT NULL, business_date date NOT NULL, timezone text NOT NULL, currency_code char(3),
  metric_version integer NOT NULL DEFAULT 1, projection_revision bigint NOT NULL, new_customers integer NOT NULL DEFAULT 0,
  returning_customers integer NOT NULL DEFAULT 0, active_customers integer NOT NULL DEFAULT 0, repeat_visit_rate numeric(12,6),
  return_30_count integer NOT NULL DEFAULT 0, return_60_count integer NOT NULL DEFAULT 0, return_90_count integer NOT NULL DEFAULT 0,
  realized_value_minor bigint NOT NULL DEFAULT 0, metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, cohort_month, business_date, metric_version), FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE TABLE analytics_inventory_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  business_date date NOT NULL, timezone text NOT NULL, currency_code char(3), metric_version integer NOT NULL DEFAULT 1,
  projection_revision bigint NOT NULL, on_hand_quantity numeric(20,6) NOT NULL DEFAULT 0, available_quantity numeric(20,6) NOT NULL DEFAULT 0,
  inventory_value_minor bigint NOT NULL DEFAULT 0, product_sales_minor bigint NOT NULL DEFAULT 0, consumption_quantity numeric(20,6) NOT NULL DEFAULT 0,
  adjustment_quantity numeric(20,6) NOT NULL DEFAULT 0, shrinkage_quantity numeric(20,6) NOT NULL DEFAULT 0, stockout_count integer NOT NULL DEFAULT 0,
  low_stock_count integer NOT NULL DEFAULT 0, purchase_receipt_minor bigint NOT NULL DEFAULT 0, transfer_quantity numeric(20,6) NOT NULL DEFAULT 0,
  count_variance_quantity numeric(20,6) NOT NULL DEFAULT 0, metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, business_date, metric_version), FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE TABLE analytics_financial_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  business_date date NOT NULL, timezone text NOT NULL, currency_code char(3) NOT NULL, metric_version integer NOT NULL DEFAULT 1,
  projection_revision bigint NOT NULL, posted_revenue_minor bigint NOT NULL DEFAULT 0, expense_minor bigint NOT NULL DEFAULT 0,
  cogs_minor bigint NOT NULL DEFAULT 0, cash_balance_minor bigint NOT NULL DEFAULT 0, bank_balance_minor bigint NOT NULL DEFAULT 0,
  unreconciled_bank_count integer NOT NULL DEFAULT 0, posting_failure_count integer NOT NULL DEFAULT 0, outstanding_liabilities_minor bigint NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, business_date, currency_code, metric_version), FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE TABLE analytics_asset_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  business_date date NOT NULL, timezone text NOT NULL, currency_code char(3) NOT NULL, metric_version integer NOT NULL DEFAULT 1,
  projection_revision bigint NOT NULL, asset_count integer NOT NULL DEFAULT 0, acquisition_cost_minor bigint NOT NULL DEFAULT 0,
  accumulated_depreciation_minor bigint NOT NULL DEFAULT 0, net_book_value_minor bigint NOT NULL DEFAULT 0, depreciation_expense_minor bigint NOT NULL DEFAULT 0,
  idle_asset_count integer NOT NULL DEFAULT 0, maintenance_due_count integer NOT NULL DEFAULT 0, warranty_expiring_count integer NOT NULL DEFAULT 0,
  open_work_order_count integer NOT NULL DEFAULT 0, count_discrepancy_count integer NOT NULL DEFAULT 0, impairment_minor bigint NOT NULL DEFAULT 0,
  disposal_gain_loss_minor bigint NOT NULL DEFAULT 0, metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, business_date, currency_code, metric_version), FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);

CREATE TABLE analytics_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid,
  metric_key text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, target_value numeric(24,6) NOT NULL,
  currency_code char(3), status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  version integer NOT NULL DEFAULT 1, created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id), CHECK (period_end >= period_start)
);
CREATE TABLE analytics_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid, metric_key text NOT NULL,
  operator text NOT NULL CHECK (operator IN ('LT','LTE','GT','GTE','EQ')), threshold numeric(24,6) NOT NULL, cooldown_minutes integer NOT NULL DEFAULT 60 CHECK (cooldown_minutes >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')), recipient_scope_json jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE TABLE analytics_alert_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), alert_rule_id uuid NOT NULL, branch_id uuid,
  metric_key text NOT NULL, observed_value numeric(24,6) NOT NULL, state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  dedupe_key text NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz, resolved_at timestamptz, acknowledged_by_user_id uuid REFERENCES users(id),
  UNIQUE (tenant_id, dedupe_key), FOREIGN KEY (tenant_id, alert_rule_id) REFERENCES analytics_alert_rules(tenant_id, id), FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)
);
CREATE TABLE analytics_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), owner_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL, filters_json jsonb NOT NULL DEFAULT '{}', display_json jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, id)
);
CREATE TABLE analytics_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), requested_by_user_id uuid NOT NULL REFERENCES users(id),
  export_type text NOT NULL, filters_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  storage_key text, checksum text, error_json jsonb, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE analytics_rebuild_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), requested_by_user_id uuid NOT NULL REFERENCES users(id),
  scope_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100), error_json jsonb, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_projection_events_pending_idx ON analytics_projection_events(tenant_id, processed_at, projection_revision);
CREATE INDEX analytics_alert_occurrences_open_idx ON analytics_alert_occurrences(tenant_id, state, first_seen_at);
CREATE INDEX analytics_export_jobs_status_idx ON analytics_export_jobs(tenant_id, status, created_at);

CREATE OR REPLACE FUNCTION analytics_projection_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ANALYTICS_PROJECTION_EVENT_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER analytics_projection_events_append_only BEFORE UPDATE OR DELETE ON analytics_projection_events FOR EACH ROW EXECUTE FUNCTION analytics_projection_events_append_only();

INSERT INTO permissions(code,description) SELECT code,'Sprint 17 analytics and owner command center permission' FROM unnest(ARRAY[
 'analytics.dashboard.read','analytics.sales.read','analytics.booking.read','analytics.staff.read','analytics.staff.personal.read','analytics.customer.read','analytics.benefit.read','analytics.inventory.read','analytics.procurement.read','analytics.finance.read','analytics.workforce.read','analytics.asset.read','analytics.target.manage','analytics.alert.manage','analytics.export','analytics.data_quality.read','analytics.rebuild.manage'
 ]) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code LIKE 'analytics.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'BRANCH_MANAGER',code FROM permissions WHERE code IN ('analytics.dashboard.read','analytics.sales.read','analytics.booking.read','analytics.staff.read','analytics.customer.read','analytics.inventory.read','analytics.procurement.read','analytics.target.manage','analytics.alert.manage','analytics.export','analytics.data_quality.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'ACCOUNTANT',code FROM permissions WHERE code IN ('analytics.dashboard.read','analytics.sales.read','analytics.finance.read','analytics.procurement.read','analytics.inventory.read','analytics.asset.read','analytics.export','analytics.data_quality.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'NAIL_TECHNICIAN',code FROM permissions WHERE code IN ('analytics.staff.personal.read') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('0034_business_intelligence_owner_command_center');
COMMIT;
