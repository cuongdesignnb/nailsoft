BEGIN;

CREATE FUNCTION sprint9_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'INVENTORY_LEDGER_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE FUNCTION sprint9_posted_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='POSTED' THEN RAISE EXCEPTION 'INVENTORY_RECEIPT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE FUNCTION sprint9_posted_receipt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM inventory_receipts WHERE tenant_id=OLD.tenant_id AND id=OLD.receipt_id AND status='POSTED') THEN
    RAISE EXCEPTION 'INVENTORY_RECEIPT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE TABLE inventory_uoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code varchar(40) NOT NULL,
  name_json jsonb NOT NULL, category text NOT NULL CHECK(category IN('COUNT','MASS','WEIGHT','VOLUME','LENGTH')),
  precision_scale smallint NOT NULL DEFAULT 3 CHECK(precision_scale BETWEEN 0 AND 6), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ARCHIVED')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE TABLE inventory_uom_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), from_uom_id uuid NOT NULL, to_uom_id uuid NOT NULL,
  numerator bigint NOT NULL CHECK(numerator>0), denominator bigint NOT NULL CHECK(denominator>0), effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,from_uom_id,to_uom_id),
  FOREIGN KEY(tenant_id,from_uom_id) REFERENCES inventory_uoms(tenant_id,id), FOREIGN KEY(tenant_id,to_uom_id) REFERENCES inventory_uoms(tenant_id,id), CHECK(from_uom_id<>to_uom_id), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
ALTER TABLE inventory_uom_conversions ADD CONSTRAINT inventory_uom_conversion_effective_no_overlap EXCLUDE USING gist
  (tenant_id WITH =,from_uom_id WITH =,to_uom_id WITH =,tstzrange(effective_from,effective_to,'[)') WITH &&);
CREATE TABLE inventory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), parent_id uuid, code varchar(60) NOT NULL,
  name_json jsonb NOT NULL, sort_order integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ARCHIVED')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,code),
  FOREIGN KEY(tenant_id,parent_id) REFERENCES inventory_categories(tenant_id,id)
);
CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), category_id uuid, base_uom_id uuid NOT NULL,
  sku varchar(80) NOT NULL, name_json jsonb NOT NULL, item_type text NOT NULL CHECK(item_type IN('CONSUMABLE','RETAIL','BOTH')),
  track_lot boolean NOT NULL DEFAULT false, track_expiry boolean NOT NULL DEFAULT false, tracking_mode text GENERATED ALWAYS AS (CASE WHEN track_expiry THEN 'LOT_AND_EXPIRY' WHEN track_lot THEN 'LOT' ELSE 'NONE' END) STORED, quantity_precision smallint NOT NULL DEFAULT 3 CHECK(quantity_precision BETWEEN 0 AND 6),
  currency char(3) NOT NULL DEFAULT 'VND', retail_price_minor bigint CHECK(retail_price_minor IS NULL OR retail_price_minor>=0), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ARCHIVED')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,sku), CHECK(NOT track_expiry OR track_lot),
  FOREIGN KEY(tenant_id,category_id) REFERENCES inventory_categories(tenant_id,id), FOREIGN KEY(tenant_id,base_uom_id) REFERENCES inventory_uoms(tenant_id,id)
);
CREATE TABLE inventory_item_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), item_id uuid NOT NULL, barcode varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,barcode), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id)
);
CREATE TABLE inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, code varchar(60) NOT NULL, name varchar(160) NOT NULL,
  location_type text NOT NULL CHECK(location_type IN('STOCKROOM','BACKBAR','SERVICE_FLOOR','RETAIL','RETAIL_FLOOR','QUARANTINE','DAMAGED','IN_TRANSIT')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ARCHIVED')), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,branch_id,code), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE inventory_item_branch_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, item_id uuid NOT NULL,
  reorder_point numeric(20,6) NOT NULL DEFAULT 0 CHECK(reorder_point>=0), par_level numeric(20,6) NOT NULL DEFAULT 0 CHECK(par_level>=0),
  inventory_enforcement text NOT NULL DEFAULT 'DISABLED' CHECK(inventory_enforcement IN('DISABLED','WARN','ENFORCE')), service_material_mode text NOT NULL DEFAULT 'DISABLED' CHECK(service_material_mode IN('DISABLED','RESERVE_ON_START','CONSUME_ON_COMPLETE')), shortage_policy text NOT NULL DEFAULT 'BLOCK_START' CHECK(shortage_policy IN('BLOCK_START','ALLOW_MANAGER_OVERRIDE','CREATE_CONFLICT_AND_CONTINUE')), default_location_id uuid,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,item_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,default_location_id) REFERENCES inventory_locations(tenant_id,branch_id,id)
);
CREATE TABLE inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, item_id uuid NOT NULL, lot_code varchar(100) NOT NULL,
  expiry_date date, status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','QUARANTINE','DAMAGED','EXPIRED','DEPLETED')), received_at timestamptz,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,branch_id,item_id,lot_code),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id)
);
CREATE TABLE inventory_stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, location_id uuid NOT NULL, item_id uuid NOT NULL, lot_id uuid,
  on_hand numeric(20,6) NOT NULL DEFAULT 0 CHECK(on_hand>=0), reserved numeric(20,6) NOT NULL DEFAULT 0 CHECK(reserved>=0),
  average_unit_cost_minor numeric(20,6) NOT NULL DEFAULT 0 CHECK(average_unit_cost_minor>=0), total_cost_minor numeric(30,6) NOT NULL DEFAULT 0 CHECK(total_cost_minor>=0),
  version bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE NULLS NOT DISTINCT(tenant_id,branch_id,location_id,item_id,lot_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_locations(tenant_id,branch_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,lot_id) REFERENCES inventory_lots(tenant_id,branch_id,id), CHECK(on_hand-reserved>=0)
);
CREATE TABLE inventory_stock_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, location_id uuid NOT NULL, item_id uuid NOT NULL, lot_id uuid,
  entry_type text NOT NULL CHECK(entry_type IN('OPENING','OPENING_BALANCE','RECEIPT','PURCHASE_RECEIPT','PURCHASE_RECEIPT_CORRECTION','TRANSFER_OUT','TRANSFER_IN','TRANSFER_VARIANCE','SERVICE_CONSUMPTION','POS_SALE','RETURN_RESTOCK','POS_RETURN_RESTOCK','POS_RETURN_QUARANTINE','POS_RETURN_DISCARD','ADJUSTMENT','ADJUSTMENT_IN','ADJUSTMENT_OUT','COUNT_CORRECTION','STOCKTAKE_VARIANCE','EXPIRY_WRITE_OFF','DAMAGE_WRITE_OFF','REVERSAL')),
  quantity_delta numeric(20,6) NOT NULL CHECK(quantity_delta<>0), unit_cost_minor numeric(20,6) NOT NULL CHECK(unit_cost_minor>=0), value_delta_minor numeric(30,6) NOT NULL,
  balance_quantity_after numeric(20,6) NOT NULL CHECK(balance_quantity_after>=0), balance_value_after_minor numeric(30,6) NOT NULL CHECK(balance_value_after_minor>=0),
  reference_type varchar(80) NOT NULL, reference_id uuid NOT NULL, reason_code varchar(80), actor_user_id uuid REFERENCES users(id), idempotency_key_hash varchar(128),
  request_id varchar(160) NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,reference_type,reference_id,item_id,location_id,entry_type), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_locations(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,lot_id) REFERENCES inventory_lots(tenant_id,branch_id,id)
);
CREATE TRIGGER inventory_stock_ledger_append_only BEFORE UPDATE OR DELETE ON inventory_stock_ledger_entries FOR EACH ROW EXECUTE FUNCTION sprint9_append_only_guard();
CREATE INDEX inventory_ledger_query_idx ON inventory_stock_ledger_entries(tenant_id,branch_id,item_id,occurred_at DESC,id);
CREATE INDEX inventory_balance_available_idx ON inventory_stock_balances(tenant_id,branch_id,item_id,location_id);
CREATE TABLE inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, location_id uuid NOT NULL, item_id uuid NOT NULL, lot_id uuid,
  reservation_type text NOT NULL CHECK(reservation_type IN('SERVICE','POS','POS_PRODUCT','TRANSFER')), aggregate_id uuid NOT NULL, quantity numeric(20,6) NOT NULL CHECK(quantity>0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMMITTED','RELEASED','EXPIRED','CANCELLED')), expires_at timestamptz, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_locations(tenant_id,branch_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,lot_id) REFERENCES inventory_lots(tenant_id,branch_id,id)
);
CREATE UNIQUE INDEX inventory_active_reservation_unique ON inventory_reservations(tenant_id,reservation_type,aggregate_id,item_id,location_id,COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE status='ACTIVE';
CREATE INDEX inventory_active_reservations_idx ON inventory_reservations(tenant_id,branch_id,item_id,expires_at) WHERE status='ACTIVE';

CREATE TABLE inventory_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code varchar(60) NOT NULL, name varchar(200) NOT NULL, legal_name varchar(240), contact_json jsonb NOT NULL DEFAULT '{}', lead_time_days integer NOT NULL DEFAULT 0 CHECK(lead_time_days>=0), payment_terms text, notes text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE','ARCHIVED')), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE TABLE inventory_supplier_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, supplier_id uuid NOT NULL, item_id uuid NOT NULL, supplier_sku varchar(100), purchase_uom_id uuid NOT NULL,
  conversion_numerator bigint NOT NULL CHECK(conversion_numerator>0), conversion_denominator bigint NOT NULL CHECK(conversion_denominator>0), lead_time_days integer NOT NULL DEFAULT 0 CHECK(lead_time_days>=0),
  minimum_order_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK(minimum_order_quantity>=0), preferred boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,supplier_id,item_id),
  FOREIGN KEY(tenant_id,supplier_id) REFERENCES inventory_suppliers(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,purchase_uom_id) REFERENCES inventory_uoms(tenant_id,id)
);
CREATE TABLE inventory_supplier_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, supplier_item_id uuid NOT NULL, unit_price_minor bigint NOT NULL CHECK(unit_price_minor>=0), currency char(3) NOT NULL,
  effective_from timestamptz NOT NULL, effective_to timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,supplier_item_id) REFERENCES inventory_supplier_items(tenant_id,id), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE TABLE purchase_order_counters (tenant_id uuid NOT NULL, branch_id uuid NOT NULL, local_year integer NOT NULL, next_value bigint NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,branch_id,local_year), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id));
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, supplier_id uuid NOT NULL, po_number varchar(80) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','SUBMITTED','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')), currency char(3) NOT NULL,
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK(subtotal_minor>=0), expected_at timestamptz, note text, version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL REFERENCES users(id), approved_by_user_id uuid REFERENCES users(id), approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,po_number),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,supplier_id) REFERENCES inventory_suppliers(tenant_id,id)
);
CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, purchase_order_id uuid NOT NULL, line_no integer NOT NULL CHECK(line_no>0), item_id uuid NOT NULL, uom_id uuid NOT NULL,
  ordered_quantity numeric(20,6) NOT NULL CHECK(ordered_quantity>0), received_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK(received_quantity>=0),
  unit_price_minor bigint NOT NULL CHECK(unit_price_minor>=0), line_total_minor bigint NOT NULL CHECK(line_total_minor>=0), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,purchase_order_id,line_no),
  FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES purchase_orders(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,uom_id) REFERENCES inventory_uoms(tenant_id,id), CHECK(received_quantity<=ordered_quantity)
);
CREATE TABLE purchase_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, purchase_order_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  actor_user_id uuid REFERENCES users(id), reason text, request_id varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES purchase_orders(tenant_id,id)
);
CREATE TRIGGER purchase_order_history_append_only BEFORE UPDATE OR DELETE ON purchase_order_status_history FOR EACH ROW EXECUTE FUNCTION sprint9_append_only_guard();
CREATE TABLE inventory_receipt_counters (tenant_id uuid NOT NULL, branch_id uuid NOT NULL, local_year integer NOT NULL, next_value bigint NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,branch_id,local_year), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id));
CREATE TABLE inventory_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, purchase_order_id uuid, receipt_number varchar(80) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','POSTED','CANCELLED')), received_at timestamptz NOT NULL, location_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1, created_by_user_id uuid NOT NULL REFERENCES users(id), posted_by_user_id uuid REFERENCES users(id), posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,receipt_number),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES purchase_orders(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_locations(tenant_id,branch_id,id), CHECK(status<>'POSTED' OR posted_at IS NOT NULL)
);
CREATE TABLE inventory_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, receipt_id uuid NOT NULL, purchase_order_line_id uuid, item_id uuid NOT NULL, lot_id uuid,
  received_quantity numeric(20,6) NOT NULL CHECK(received_quantity>0), base_quantity numeric(20,6) NOT NULL CHECK(base_quantity>0), unit_cost_minor numeric(20,6) NOT NULL CHECK(unit_cost_minor>=0), quality_disposition text NOT NULL DEFAULT 'ACCEPTED' CHECK(quality_disposition IN('ACCEPTED','QUARANTINE','REJECTED')),
  uom_id uuid, conversion_id uuid, conversion_numerator bigint NOT NULL DEFAULT 1 CHECK(conversion_numerator>0), conversion_denominator bigint NOT NULL DEFAULT 1 CHECK(conversion_denominator>0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,receipt_id) REFERENCES inventory_receipts(tenant_id,id),
  FOREIGN KEY(tenant_id,purchase_order_line_id) REFERENCES purchase_order_lines(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,lot_id) REFERENCES inventory_lots(tenant_id,id), FOREIGN KEY(tenant_id,uom_id) REFERENCES inventory_uoms(tenant_id,id), FOREIGN KEY(tenant_id,conversion_id) REFERENCES inventory_uom_conversions(tenant_id,id)
);
CREATE TRIGGER inventory_posted_receipt_immutable BEFORE UPDATE OR DELETE ON inventory_receipts FOR EACH ROW EXECUTE FUNCTION sprint9_posted_receipt_guard();
CREATE TRIGGER inventory_posted_receipt_line_immutable BEFORE UPDATE OR DELETE ON inventory_receipt_lines FOR EACH ROW EXECUTE FUNCTION sprint9_posted_receipt_line_guard();
CREATE TABLE inventory_transfer_counters (tenant_id uuid NOT NULL, branch_id uuid NOT NULL, local_year integer NOT NULL, next_value bigint NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,branch_id,local_year), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id));
CREATE TABLE inventory_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, source_branch_id uuid NOT NULL, destination_branch_id uuid NOT NULL,
  source_location_id uuid NOT NULL, destination_location_id uuid NOT NULL, transfer_number varchar(80) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','REQUESTED','APPROVED','IN_TRANSIT','SHIPPED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')), version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL REFERENCES users(id), approved_by_user_id uuid REFERENCES users(id), approved_at timestamptz, shipped_at timestamptz, received_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,transfer_number), FOREIGN KEY(tenant_id,source_branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,destination_branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,source_branch_id,source_location_id) REFERENCES inventory_locations(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,destination_branch_id,destination_location_id) REFERENCES inventory_locations(tenant_id,branch_id,id), CHECK(source_branch_id<>destination_branch_id)
);
CREATE TABLE inventory_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, transfer_id uuid NOT NULL, item_id uuid NOT NULL, lot_id uuid,
  requested_quantity numeric(20,6) NOT NULL CHECK(requested_quantity>0), shipped_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK(shipped_quantity>=0), received_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK(received_quantity>=0), transit_location_id uuid, reservation_id uuid,
  unit_cost_minor numeric(20,6) NOT NULL DEFAULT 0 CHECK(unit_cost_minor>=0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,transfer_id) REFERENCES inventory_transfers(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,lot_id) REFERENCES inventory_lots(tenant_id,id), FOREIGN KEY(tenant_id,transit_location_id) REFERENCES inventory_locations(tenant_id,id), FOREIGN KEY(tenant_id,reservation_id) REFERENCES inventory_reservations(tenant_id,id), CHECK(shipped_quantity<=requested_quantity), CHECK(received_quantity<=shipped_quantity)
);
CREATE TABLE inventory_transfer_variances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, transfer_line_id uuid NOT NULL, quantity_delta numeric(20,6) NOT NULL CHECK(quantity_delta<>0),
  reason_code varchar(80) NOT NULL, note text, actor_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,transfer_line_id) REFERENCES inventory_transfer_lines(tenant_id,id)
);
CREATE TRIGGER inventory_transfer_variances_append_only BEFORE UPDATE OR DELETE ON inventory_transfer_variances FOR EACH ROW EXECUTE FUNCTION sprint9_append_only_guard();
CREATE TABLE inventory_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, location_id uuid NOT NULL, item_id uuid NOT NULL, lot_id uuid,
  quantity_delta numeric(20,6) NOT NULL CHECK(quantity_delta<>0), reason_code varchar(80) NOT NULL, note text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','POSTED','CANCELLED')), version integer NOT NULL DEFAULT 1,
  requested_by_user_id uuid NOT NULL REFERENCES users(id), decided_by_user_id uuid REFERENCES users(id), decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_locations(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,lot_id) REFERENCES inventory_lots(tenant_id,branch_id,id)
);
CREATE TABLE inventory_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, location_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','COUNTING','SUBMITTED','REVIEW','APPROVED','POSTED','CANCELLED')), blind boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_by_user_id uuid NOT NULL REFERENCES users(id), started_at timestamptz, submitted_at timestamptz, posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_locations(tenant_id,branch_id,id)
);
CREATE TABLE inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, count_session_id uuid NOT NULL, item_id uuid NOT NULL, lot_id uuid,
  expected_quantity_snapshot numeric(20,6), counted_quantity numeric(20,6) CHECK(counted_quantity IS NULL OR counted_quantity>=0), variance_quantity numeric(20,6), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,count_session_id) REFERENCES inventory_count_sessions(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,lot_id) REFERENCES inventory_lots(tenant_id,id)
);
CREATE UNIQUE INDEX inventory_count_line_unique ON inventory_count_lines(tenant_id,count_session_id,item_id,COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE service_material_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, service_id uuid NOT NULL, branch_id uuid, name varchar(160) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','INACTIVE','SUPERSEDED','ARCHIVED')), version integer NOT NULL DEFAULT 1, recipe_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE NULLS NOT DISTINCT(tenant_id,service_id,branch_id,recipe_version), FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE service_material_recipe_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, recipe_id uuid NOT NULL, item_id uuid NOT NULL, quantity numeric(20,6) NOT NULL CHECK(quantity>0),
  uom_id uuid NOT NULL, base_quantity numeric(20,6) GENERATED ALWAYS AS (quantity) STORED, wastage_basis_points integer NOT NULL DEFAULT 0 CHECK(wastage_basis_points BETWEEN 0 AND 10000), source_location_id uuid, selection_method text NOT NULL DEFAULT 'FEFO' CHECK(selection_method IN('FEFO','FIFO','MANUAL')), required boolean NOT NULL DEFAULT true, conversion_id uuid, conversion_numerator bigint NOT NULL DEFAULT 1, conversion_denominator bigint NOT NULL DEFAULT 1, allow_override boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,recipe_id,item_id),
  FOREIGN KEY(tenant_id,recipe_id) REFERENCES service_material_recipes(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,uom_id) REFERENCES inventory_uoms(tenant_id,id), FOREIGN KEY(tenant_id,source_location_id) REFERENCES inventory_locations(tenant_id,id), FOREIGN KEY(tenant_id,conversion_id) REFERENCES inventory_uom_conversions(tenant_id,id)
);
CREATE TABLE service_material_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, service_session_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMMITTED','RELEASED','SHORTAGE','MANUAL_REVIEW')), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,service_session_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,service_session_id) REFERENCES service_sessions(tenant_id,id)
);
CREATE TABLE service_material_reservation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, service_material_reservation_id uuid NOT NULL, recipe_line_id uuid NOT NULL,
  inventory_reservation_id uuid, required_quantity numeric(20,6) NOT NULL CHECK(required_quantity>0), reserved_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0),
  consumed_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0), actual_quantity numeric(20,6), override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,service_material_reservation_id,recipe_line_id),
  FOREIGN KEY(tenant_id,service_material_reservation_id) REFERENCES service_material_reservations(tenant_id,id), FOREIGN KEY(tenant_id,recipe_line_id) REFERENCES service_material_recipe_lines(tenant_id,id), FOREIGN KEY(tenant_id,inventory_reservation_id) REFERENCES inventory_reservations(tenant_id,id)
);

ALTER TABLE pos_order_lines DROP CONSTRAINT pos_order_lines_line_type_check;
ALTER TABLE pos_order_lines ADD CONSTRAINT pos_order_lines_line_type_check CHECK(line_type IN('SERVICE','MANUAL_SERVICE','ADJUSTMENT','PRODUCT'));
ALTER TABLE pos_order_lines ADD COLUMN inventory_item_id uuid, ADD COLUMN inventory_reservation_id uuid;
ALTER TABLE pos_order_lines ADD CONSTRAINT pos_order_line_inventory_item_fk FOREIGN KEY(tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id),
  ADD CONSTRAINT pos_order_line_inventory_reservation_fk FOREIGN KEY(tenant_id,inventory_reservation_id) REFERENCES inventory_reservations(tenant_id,id),
  ADD CONSTRAINT pos_product_item_check CHECK(line_type<>'PRODUCT' OR inventory_item_id IS NOT NULL);
CREATE TABLE inventory_return_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, refund_item_id uuid NOT NULL, inventory_item_id uuid NOT NULL,
  disposition text NOT NULL CHECK(disposition IN('RESTOCK','DAMAGED','QUARANTINE','DISCARD','NO_RETURN')), quantity numeric(20,6) NOT NULL CHECK(quantity>0), status text NOT NULL DEFAULT 'INSPECTED' CHECK(status IN('INSPECTED','POSTED')),
  branch_id uuid NOT NULL, location_id uuid, lot_id uuid, inspected_by_user_id uuid NOT NULL REFERENCES users(id), posted_by_user_id uuid REFERENCES users(id), posted_at timestamptz, reason_code varchar(80) NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,refund_item_id),
  FOREIGN KEY(tenant_id,refund_item_id) REFERENCES refund_items(tenant_id,id), FOREIGN KEY(tenant_id,inventory_item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,location_id) REFERENCES inventory_locations(tenant_id,id), FOREIGN KEY(tenant_id,lot_id) REFERENCES inventory_lots(tenant_id,id)
);
CREATE TABLE inventory_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, item_id uuid NOT NULL, lot_id uuid,
  alert_type text NOT NULL CHECK(alert_type IN('LOW_STOCK','OUT_OF_STOCK','EXPIRING','EXPIRING_SOON','EXPIRED','EXPIRED_STOCK','NEGATIVE_STOCK','SHORTAGE','SHORTAGE_CONFLICT','TRANSFER_VARIANCE','RECEIPT_VARIANCE')), status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  details_json jsonb NOT NULL DEFAULT '{}', detected_at timestamptz NOT NULL DEFAULT now(), acknowledged_by_user_id uuid REFERENCES users(id), acknowledged_at timestamptz,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id), FOREIGN KEY(tenant_id,lot_id) REFERENCES inventory_lots(tenant_id,id)
);
CREATE UNIQUE INDEX inventory_one_open_alert ON inventory_alerts(tenant_id,branch_id,item_id,COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid),alert_type) WHERE status='OPEN';
CREATE TABLE inventory_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), export_type text NOT NULL CHECK(export_type IN('STOCK','LEDGER','VALUATION','PURCHASES','VARIANCES')),
  filters_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','COMPLETED','FAILED','DEAD_LETTER')), storage_key text,
  requested_by_user_id uuid NOT NULL REFERENCES users(id), attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, lease_until timestamptz,
  run_at timestamptz NOT NULL DEFAULT now(), last_error_code varchar(100), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE inventory_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), job_type text NOT NULL CHECK(job_type IN('LOW_STOCK_SCAN','LOW_STOCK_EVALUATION','EXPIRY_SCAN','EXPIRY_ALERT','CONSUMPTION_RETRY','SERVICE_CONSUMPTION_RETRY','RESERVATION_EXPIRY','VALUATION_SNAPSHOT','INVENTORY_REPORT_SNAPSHOT')),
  aggregate_id uuid, payload_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','COMPLETED','FAILED','DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, lease_until timestamptz, run_at timestamptz NOT NULL DEFAULT now(), last_error_code varchar(100), last_error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE INDEX inventory_jobs_claim_idx ON inventory_jobs(status,run_at,lease_until,id);

INSERT INTO permissions(code,description) VALUES
('inventory.item.read','Read inventory items'),('inventory.item.manage','Manage inventory items'),('inventory.location.read','Read inventory locations'),('inventory.location.manage','Manage inventory locations'),
('inventory.stock.read','Read stock availability'),('inventory.cost.read','Read stock cost'),('inventory.ledger.read','Read inventory ledger'),('inventory.supplier.read','Read suppliers'),('inventory.supplier.manage','Manage suppliers'),
('inventory.purchase_order.read','Read purchase orders'),('inventory.purchase_order.create','Create purchase orders'),('inventory.purchase_order.submit','Submit purchase orders'),('inventory.purchase_order.approve','Approve purchase orders'),('inventory.purchase_order.cancel','Cancel purchase orders'),('inventory.purchase_order.close','Close purchase orders'),
('inventory.receipt.read','Read receipts'),('inventory.receipt.create','Create receipts'),('inventory.receipt.post','Post receipts'),('inventory.transfer.read','Read transfers'),('inventory.transfer.create','Create transfers'),('inventory.transfer.approve','Approve transfers'),('inventory.transfer.ship','Ship transfers'),('inventory.transfer.receive','Receive transfers'),
('inventory.adjustment.read','Read adjustments'),('inventory.adjustment.create','Create adjustments'),('inventory.adjustment.request','Request adjustments'),('inventory.adjustment.approve','Approve adjustments'),('inventory.adjustment.post','Post adjustments'),('inventory.count.read','Read counts'),('inventory.count.create','Create counts'),('inventory.count.declare','Declare blind count quantities'),('inventory.count.review','Review blind counts'),('inventory.count.submit','Submit counts'),('inventory.count.approve','Approve counts'),('inventory.count.post','Post counts'),
('inventory.recipe.read','Read service recipes'),('inventory.recipe.manage','Manage service recipes'),('inventory.service.reserve','Reserve service materials'),('inventory.service.consume','Consume service materials'),('inventory.service.override','Override material usage'),('inventory.service.override_shortage','Override service material shortages'),
('inventory.pos_product.read','Read retail products'),('inventory.pos_product.sell','Sell retail products'),('inventory.return.request','Request product return'),('inventory.return.inspect','Inspect product return'),('inventory.return.post','Post inspected product returns'),
('inventory.alert.read','Read inventory alerts'),('inventory.alert.manage','Manage inventory alerts'),('inventory.report.read','Read inventory reports'),('inventory.export','Export inventory data') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code LIKE 'inventory.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'BRANCH_MANAGER',code FROM permissions WHERE code LIKE 'inventory.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('RECEPTIONIST','inventory.item.read'),('RECEPTIONIST','inventory.stock.read'),('CASHIER','inventory.item.read'),('CASHIER','inventory.stock.read'),('CASHIER','inventory.pos_product.read'),('CASHIER','inventory.pos_product.sell'),('CASHIER','inventory.return.request'),
('NAIL_TECHNICIAN','inventory.item.read'),('NAIL_TECHNICIAN','inventory.service.reserve'),('NAIL_TECHNICIAN','inventory.service.consume'),
('ACCOUNTANT','inventory.item.read'),('ACCOUNTANT','inventory.stock.read'),('ACCOUNTANT','inventory.cost.read'),('ACCOUNTANT','inventory.ledger.read'),('ACCOUNTANT','inventory.supplier.read'),('ACCOUNTANT','inventory.purchase_order.read'),('ACCOUNTANT','inventory.receipt.read'),('ACCOUNTANT','inventory.report.read'),('ACCOUNTANT','inventory.export') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('0018_inventory_supplier_purchase_operations');
COMMIT;
