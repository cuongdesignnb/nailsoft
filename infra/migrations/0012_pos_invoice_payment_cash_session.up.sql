BEGIN;

CREATE TABLE pos_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  code varchar(80) NOT NULL,
  name varchar(200) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  device_binding_required boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,branch_id,code),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE pos_register_device_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  register_id uuid NOT NULL,
  device_id varchar(200) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  bound_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,register_id,device_id),
  FOREIGN KEY(tenant_id,register_id) REFERENCES pos_registers(tenant_id,id)
);

CREATE TABLE cash_drawers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  register_id uuid NOT NULL,
  code varchar(80) NOT NULL,
  name varchar(200) NOT NULL,
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,branch_id,code),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,register_id) REFERENCES pos_registers(tenant_id,id)
);

CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  register_id uuid NOT NULL,
  cash_drawer_id uuid NOT NULL,
  cashier_user_id uuid NOT NULL REFERENCES users(id),
  business_date date NOT NULL,
  timezone varchar(100) NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','CLOSED','CANCELLED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float_minor bigint NOT NULL CHECK (opening_float_minor >= 0),
  expected_cash_minor bigint NOT NULL DEFAULT 0 CHECK (expected_cash_minor >= 0),
  declared_cash_minor bigint CHECK (declared_cash_minor >= 0),
  variance_minor bigint,
  variance_threshold_minor bigint NOT NULL CHECK (variance_threshold_minor >= 0),
  variance_reason text,
  variance_approved_by_user_id uuid REFERENCES users(id),
  closing_started_at timestamptz,
  closed_at timestamptz,
  closed_by_user_id uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,register_id) REFERENCES pos_registers(tenant_id,id),
  FOREIGN KEY(tenant_id,cash_drawer_id) REFERENCES cash_drawers(tenant_id,id),
  CHECK (status <> 'CLOSED' OR (declared_cash_minor IS NOT NULL AND variance_minor IS NOT NULL AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX cash_sessions_one_active_drawer
  ON cash_sessions(tenant_id,cash_drawer_id) WHERE status IN ('OPEN','CLOSING');
CREATE UNIQUE INDEX cash_sessions_cashier_register_active
  ON cash_sessions(tenant_id,register_id,cashier_user_id) WHERE status IN ('OPEN','CLOSING');
CREATE INDEX cash_sessions_branch_date_idx ON cash_sessions(tenant_id,branch_id,business_date,status);

CREATE TABLE tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid,
  code varchar(80) NOT NULL,
  name varchar(200) NOT NULL,
  calculation_mode text NOT NULL CHECK (calculation_mode IN ('EXCLUSIVE','INCLUSIVE','NONE')),
  rate_basis_points integer NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 100000),
  rounding_mode text NOT NULL DEFAULT 'HALF_UP' CHECK (rounding_mode IN ('HALF_UP','HALF_EVEN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,code,effective_from),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE pos_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  register_id uuid,
  cash_session_id uuid,
  appointment_id uuid,
  customer_id uuid,
  order_number varchar(80) NOT NULL,
  source text NOT NULL CHECK (source IN ('APPOINTMENT','WALK_IN','COUNTER_SALE','MANUAL')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY_FOR_PAYMENT','PARTIALLY_PAID','PAID','VOIDED','EXPIRED')),
  currency char(3) NOT NULL,
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  taxable_minor bigint NOT NULL DEFAULT 0 CHECK (taxable_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  tip_minor bigint NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  amount_paid_minor bigint NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  amount_due_minor bigint NOT NULL DEFAULT 0 CHECK (amount_due_minor >= 0),
  pricing_snapshot_json jsonb NOT NULL DEFAULT '{}',
  tax_snapshot_json jsonb NOT NULL DEFAULT '{}',
  customer_snapshot_json jsonb NOT NULL DEFAULT '{}',
  appointment_snapshot_json jsonb,
  pricing_locked_at timestamptz,
  finalized_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  void_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,order_number),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,register_id) REFERENCES pos_registers(tenant_id,id),
  FOREIGN KEY(tenant_id,cash_session_id) REFERENCES cash_sessions(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  CHECK (amount_due_minor = total_minor + tip_minor - amount_paid_minor),
  CHECK (status <> 'PAID' OR amount_due_minor = 0),
  CHECK (status <> 'VOIDED' OR (amount_paid_minor = 0 AND voided_at IS NOT NULL AND length(trim(void_reason)) > 0))
);
CREATE UNIQUE INDEX pos_orders_one_active_appointment
  ON pos_orders(tenant_id,appointment_id)
  WHERE appointment_id IS NOT NULL AND status IN ('DRAFT','READY_FOR_PAYMENT','PARTIALLY_PAID');
CREATE INDEX pos_orders_branch_created_idx ON pos_orders(tenant_id,branch_id,created_at DESC,id);

CREATE TABLE pos_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pos_order_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  line_type text NOT NULL CHECK (line_type IN ('SERVICE','MANUAL_SERVICE','ADJUSTMENT')),
  appointment_item_id uuid,
  service_session_id uuid,
  service_id uuid,
  description_snapshot_json jsonb NOT NULL,
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  gross_minor bigint NOT NULL CHECK (gross_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  taxable_minor bigint NOT NULL DEFAULT 0 CHECK (taxable_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  net_minor bigint NOT NULL DEFAULT 0 CHECK (net_minor >= 0),
  tax_profile_snapshot_json jsonb NOT NULL DEFAULT '{}',
  source_snapshot_json jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
  void_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,pos_order_id,line_no),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id),
  FOREIGN KEY(tenant_id,service_session_id) REFERENCES service_sessions(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id),
  CHECK (discount_minor <= gross_minor),
  CHECK (status <> 'VOIDED' OR length(trim(void_reason)) > 0)
);
CREATE UNIQUE INDEX pos_order_lines_one_appointment_item
  ON pos_order_lines(tenant_id,pos_order_id,appointment_item_id)
  WHERE appointment_item_id IS NOT NULL AND status='ACTIVE';

CREATE TABLE pos_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pos_order_id uuid NOT NULL,
  order_line_id uuid,
  discount_type text NOT NULL CHECK (discount_type IN ('FIXED','PERCENT')),
  value_numeric numeric(14,4) NOT NULL CHECK (value_numeric >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  reason_code varchar(80) NOT NULL,
  note text,
  approved_by_user_id uuid REFERENCES users(id),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,order_line_id) REFERENCES pos_order_lines(tenant_id,id)
);

CREATE TABLE pos_discount_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  pos_order_id uuid NOT NULL,
  order_line_id uuid,
  discount_type text NOT NULL CHECK (discount_type IN ('FIXED','PERCENT')),
  value_numeric numeric(14,4) NOT NULL CHECK (value_numeric >= 0),
  reason_code varchar(80) NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  decided_by_user_id uuid REFERENCES users(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,order_line_id) REFERENCES pos_order_lines(tenant_id,id),
  CHECK (status='PENDING' OR (decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE pos_order_pricing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pos_order_id uuid NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  pricing_snapshot_json jsonb NOT NULL,
  reason_code varchar(80) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  request_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,pos_order_id,revision_no),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id)
);

CREATE TABLE pos_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pos_order_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  source text NOT NULL CHECK (source IN ('CUSTOMER','CASHIER_ENTRY','TERMINAL')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  CHECK (status <> 'VOIDED' OR voided_at IS NOT NULL)
);
CREATE UNIQUE INDEX pos_tips_one_active_order ON pos_tips(tenant_id,pos_order_id) WHERE status='ACTIVE';

CREATE TABLE pos_tip_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pos_tip_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  appointment_item_id uuid,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  allocation_basis text NOT NULL CHECK (allocation_basis IN ('MANUAL','WORK_SECONDS','EQUAL')),
  contribution_snapshot_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,pos_tip_id,staff_id,appointment_item_id),
  FOREIGN KEY(tenant_id,pos_tip_id) REFERENCES pos_tips(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  pos_order_id uuid NOT NULL,
  payment_reference varchar(100) NOT NULL,
  tender_type text NOT NULL CHECK (tender_type IN ('CASH','CARD_EXTERNAL','BANK_TRANSFER','OTHER_EXTERNAL')),
  status text NOT NULL CHECK (status IN ('PENDING','AUTHORIZED','CAPTURED','FAILED','CANCELLED','REVERSED_TECHNICAL')),
  currency char(3) NOT NULL,
  requested_minor bigint NOT NULL CHECK (requested_minor > 0),
  captured_minor bigint NOT NULL DEFAULT 0 CHECK (captured_minor >= 0),
  cash_received_minor bigint,
  change_due_minor bigint,
  provider varchar(100),
  provider_transaction_id varchar(200),
  terminal_id varchar(120),
  card_brand varchar(40),
  card_last4 varchar(4),
  approval_code varchar(80),
  external_evidence_json jsonb NOT NULL DEFAULT '{}',
  failure_code varchar(100),
  failure_message varchar(500),
  cash_session_id uuid,
  idempotency_key_hash varchar(128) NOT NULL,
  request_hash varchar(128) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid REFERENCES users(id),
  captured_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,payment_reference),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,cash_session_id) REFERENCES cash_sessions(tenant_id,id),
  CHECK (captured_minor <= requested_minor),
  CHECK (status <> 'CAPTURED' OR (captured_minor > 0 AND captured_at IS NOT NULL)),
  CHECK (tender_type <> 'CASH' OR (status <> 'CAPTURED' OR cash_session_id IS NOT NULL)),
  CHECK (cash_received_minor IS NULL OR cash_received_minor >= captured_minor),
  CHECK (change_due_minor IS NULL OR change_due_minor = cash_received_minor - captured_minor),
  CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$')
);
CREATE UNIQUE INDEX payments_provider_reference_unique
  ON payments(tenant_id,provider,provider_transaction_id)
  WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;
CREATE INDEX payments_order_idx ON payments(tenant_id,pos_order_id,created_at,id);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  request_json_redacted jsonb NOT NULL DEFAULT '{}',
  provider_response_json_redacted jsonb NOT NULL DEFAULT '{}',
  result text NOT NULL CHECK (result IN ('SUCCESS','FAILED','UNKNOWN')),
  error_code varchar(100),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,payment_id,attempt_no),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id)
);

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_id uuid NOT NULL,
  pos_order_id uuid NOT NULL,
  allocation_type text NOT NULL CHECK (allocation_type IN ('ORDER_TOTAL','TIP','DEPOSIT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id)
);

CREATE TABLE cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  cash_session_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('OPENING_FLOAT','CASH_SALE','CASH_IN','CASH_OUT','CASH_DROP','CLOSING_ADJUSTMENT')),
  direction text NOT NULL CHECK (direction IN ('IN','OUT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  related_payment_id uuid,
  reason_code varchar(80) NOT NULL,
  note text,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  request_id varchar(160) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,cash_session_id) REFERENCES cash_sessions(tenant_id,id),
  FOREIGN KEY(tenant_id,related_payment_id) REFERENCES payments(tenant_id,id)
);
CREATE INDEX cash_movements_session_idx ON cash_movements(tenant_id,cash_session_id,occurred_at,id);

CREATE TABLE invoice_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 9999),
  prefix varchar(40) NOT NULL,
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,branch_id,fiscal_year),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  pos_order_id uuid NOT NULL,
  invoice_number varchar(100) NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','ISSUED','VOIDED_BEFORE_PAYMENT')),
  currency char(3) NOT NULL,
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  taxable_minor bigint NOT NULL CHECK (taxable_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  tip_minor bigint NOT NULL CHECK (tip_minor >= 0),
  paid_minor bigint NOT NULL CHECK (paid_minor >= 0),
  customer_snapshot_json jsonb NOT NULL DEFAULT '{}',
  branch_snapshot_json jsonb NOT NULL DEFAULT '{}',
  tax_snapshot_json jsonb NOT NULL DEFAULT '{}',
  issued_at timestamptz,
  issued_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  void_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,pos_order_id),
  UNIQUE(tenant_id,branch_id,invoice_number),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  CHECK (status <> 'ISSUED' OR (issued_at IS NOT NULL AND issued_by_user_id IS NOT NULL)),
  CHECK (status <> 'VOIDED_BEFORE_PAYMENT' OR (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND length(trim(void_reason)) > 0))
);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  source_order_line_id uuid NOT NULL,
  description_snapshot_json jsonb NOT NULL,
  quantity numeric(12,4) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  taxable_minor bigint NOT NULL CHECK (taxable_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  net_minor bigint NOT NULL CHECK (net_minor >= 0),
  tax_snapshot_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,invoice_id,line_no),
  UNIQUE(tenant_id,invoice_id,source_order_line_id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,source_order_line_id) REFERENCES pos_order_lines(tenant_id,id)
);

CREATE TABLE invoice_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('EMAIL','SMS_LINK','PRINT')),
  destination_redacted varchar(254),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','DISABLED')),
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  request_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id)
);

CREATE TABLE pos_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pos_order_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('DRAFT','READY_FOR_PAYMENT','PARTIALLY_PAID','PAID','VOIDED','EXPIRED')),
  actor_user_id uuid REFERENCES users(id),
  reason_code varchar(80),
  note text,
  request_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id)
);
CREATE INDEX pos_order_history_idx ON pos_order_status_history(tenant_id,pos_order_id,created_at,id);

CREATE TABLE financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  event_type varchar(100) NOT NULL,
  aggregate_type varchar(80) NOT NULL,
  aggregate_id uuid NOT NULL,
  amount_minor bigint,
  currency char(3) NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}',
  actor_user_id uuid REFERENCES users(id),
  request_id varchar(160) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX financial_events_branch_time_idx ON financial_events(tenant_id,branch_id,occurred_at,id);

CREATE TABLE payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  provider varchar(100) NOT NULL,
  provider_event_id varchar(200) NOT NULL,
  signature_hash varchar(128) NOT NULL,
  status text NOT NULL CHECK (status IN ('VERIFIED','REJECTED','PROCESSED','IGNORED')),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

CREATE FUNCTION sprint6_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sprint 6 financial evidence is append-only' USING ERRCODE='55000';
END $$;

CREATE TRIGGER cash_movements_append_only BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER pos_discounts_append_only BEFORE UPDATE OR DELETE ON pos_discounts FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER pricing_revisions_append_only BEFORE UPDATE OR DELETE ON pos_order_pricing_revisions FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER tip_allocations_append_only BEFORE UPDATE OR DELETE ON pos_tip_allocations FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER payment_attempts_append_only BEFORE UPDATE OR DELETE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER payment_allocations_append_only BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER invoice_lines_append_only BEFORE UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER order_history_append_only BEFORE UPDATE OR DELETE ON pos_order_status_history FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();
CREATE TRIGGER financial_events_append_only BEFORE UPDATE OR DELETE ON financial_events FOR EACH ROW EXECUTE FUNCTION sprint6_append_only_guard();

CREATE FUNCTION sprint6_payment_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='CAPTURED' THEN
    RAISE EXCEPTION 'Captured payment is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER captured_payment_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION sprint6_payment_immutable_guard();

CREATE FUNCTION sprint6_invoice_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='ISSUED' THEN
    RAISE EXCEPTION 'Issued invoice is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issued_invoice_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION sprint6_invoice_immutable_guard();

INSERT INTO permissions(code,description) VALUES
('pos.order.read','Read POS orders'),('pos.order.create','Create appointment POS orders'),('pos.order.update','Update unlocked POS orders'),('pos.order.finalize','Finalize POS orders'),('pos.order.void','Void unpaid POS orders'),
('pos.discount.apply','Apply manual discounts'),('pos.discount.approve','Approve threshold discounts'),
('pos.tip.set','Set order tip'),('pos.tip.allocate','Allocate tips'),
('payment.read','Read payment evidence'),('payment.capture_cash','Capture cash payment'),('payment.record_external','Record external payment evidence'),('payment.view_external_metadata','Read redacted external metadata'),
('invoice.read','Read invoices'),('invoice.issue','Issue invoice'),('invoice.print','Print receipt'),('invoice.deliver','Request receipt delivery'),
('cash_session.read','Read cash sessions'),('cash_session.open','Open cash session'),('cash_session.move_cash','Record cash movements'),('cash_session.begin_close','Begin cash close'),('cash_session.declare','Declare cash count'),('cash_session.close','Close cash session'),('cash_session.reopen','Reopen a closing session'),('cash_session.approve_variance','Approve high variance'),
('financial.reconciliation.read','Read daily reconciliation'),('financial.summary.read','Read financial summary')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role,permission_code)
SELECT role,code FROM (VALUES ('SALON_OWNER'),('BRANCH_MANAGER')) r(role) CROSS JOIN permissions p
WHERE p.code LIKE 'pos.%' OR p.code LIKE 'payment.%' OR p.code LIKE 'invoice.%' OR p.code LIKE 'cash_session.%' OR p.code LIKE 'financial.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role,permission_code) VALUES
('CASHIER','pos.order.read'),('CASHIER','pos.order.create'),('CASHIER','pos.order.update'),('CASHIER','pos.order.finalize'),('CASHIER','pos.discount.apply'),('CASHIER','pos.tip.set'),('CASHIER','pos.tip.allocate'),('CASHIER','payment.read'),('CASHIER','payment.capture_cash'),('CASHIER','payment.record_external'),('CASHIER','payment.view_external_metadata'),('CASHIER','invoice.read'),('CASHIER','invoice.issue'),('CASHIER','invoice.print'),('CASHIER','invoice.deliver'),('CASHIER','cash_session.read'),('CASHIER','cash_session.open'),('CASHIER','cash_session.move_cash'),('CASHIER','cash_session.begin_close'),('CASHIER','cash_session.declare'),('CASHIER','cash_session.close'),
('CASHIER','branch.read'),
('RECEPTIONIST','pos.order.read'),('RECEPTIONIST','invoice.read'),
('ACCOUNTANT','pos.order.read'),('ACCOUNTANT','payment.read'),('ACCOUNTANT','payment.view_external_metadata'),('ACCOUNTANT','invoice.read'),('ACCOUNTANT','invoice.print'),('ACCOUNTANT','financial.reconciliation.read'),('ACCOUNTANT','financial.summary.read')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0012_pos_invoice_payment_cash_session');
COMMIT;
