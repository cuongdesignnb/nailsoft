BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE voucher_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(200) NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','PAUSED','ENDED','CANCELLED')),
  discount_type text NOT NULL CHECK(discount_type IN('FIXED','PERCENT')),
  discount_value bigint NOT NULL CHECK(discount_value>0),
  currency char(3),
  minimum_spend_minor bigint NOT NULL DEFAULT 0 CHECK(minimum_spend_minor>=0),
  maximum_discount_minor bigint CHECK(maximum_discount_minor IS NULL OR maximum_discount_minor>0),
  total_use_limit bigint CHECK(total_use_limit IS NULL OR total_use_limit>0),
  reserved_count bigint NOT NULL DEFAULT 0 CHECK(reserved_count>=0),
  used_count bigint NOT NULL DEFAULT 0 CHECK(used_count>=0),
  per_customer_use_limit integer CHECK(per_customer_use_limit IS NULL OR per_customer_use_limit>0),
  code_use_limit integer NOT NULL DEFAULT 1 CHECK(code_use_limit>0),
  stack_policy text NOT NULL DEFAULT 'ONE_VOUCHER_PER_ORDER' CHECK(stack_policy='ONE_VOUCHER_PER_ORDER'),
  membership_tier_ids uuid[] NOT NULL DEFAULT '{}',
  eligibility_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  refund_policy text NOT NULL DEFAULT 'DO_NOT_RESTORE' CHECK(refund_policy IN('RESTORE_USE','DO_NOT_RESTORE','PROPORTIONAL_RESTORE')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  CHECK(valid_until>valid_from),
  CHECK(discount_type<>'PERCENT' OR discount_value<=10000),
  CHECK(discount_type<>'FIXED' OR currency IS NOT NULL),
  CHECK(total_use_limit IS NULL OR reserved_count+used_count<=total_use_limit)
);
CREATE INDEX voucher_campaigns_active_idx ON voucher_campaigns(tenant_id,valid_from,valid_until) WHERE status='ACTIVE';

CREATE TABLE voucher_campaign_branches (
  tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, branch_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,campaign_id,branch_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES voucher_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE voucher_campaign_services (
  tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, service_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,campaign_id,service_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES voucher_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id)
);
CREATE TABLE voucher_campaign_customers (
  tenant_id uuid NOT NULL, campaign_id uuid NOT NULL, customer_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,campaign_id,customer_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES voucher_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE voucher_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL,
  customer_id uuid,
  code_hash varchar(128) NOT NULL,
  code_last4 varchar(4) NOT NULL,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','RESERVED','PARTIALLY_USED','USED','EXPIRED','CANCELLED')),
  use_limit integer NOT NULL DEFAULT 1 CHECK(use_limit>0),
  reserved_count integer NOT NULL DEFAULT 0 CHECK(reserved_count>=0),
  used_count integer NOT NULL DEFAULT 0 CHECK(used_count>=0),
  generation_key varchar(200) NOT NULL,
  expires_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  issued_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code_hash), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES voucher_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  CHECK(reserved_count+used_count<=use_limit)
);
CREATE INDEX voucher_codes_wallet_idx ON voucher_codes(tenant_id,customer_id,status,expires_at);

CREATE TABLE voucher_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  voucher_code_id uuid NOT NULL, campaign_id uuid NOT NULL, customer_id uuid NOT NULL,
  branch_id uuid NOT NULL, pos_order_id uuid, appointment_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMMITTED','RELEASED','EXPIRED','CANCELLED')),
  discount_minor bigint NOT NULL CHECK(discount_minor>0), currency char(3) NOT NULL,
  policy_snapshot_json jsonb NOT NULL, generation_key varchar(200) NOT NULL,
  expires_at timestamptz NOT NULL, committed_at timestamptz, released_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,voucher_code_id) REFERENCES voucher_codes(tenant_id,id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES voucher_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id),
  CHECK((pos_order_id IS NOT NULL)::int+(appointment_id IS NOT NULL)::int=1),
  CHECK(expires_at>created_at),
  CHECK(status<>'COMMITTED' OR committed_at IS NOT NULL),
  CHECK(status NOT IN('RELEASED','CANCELLED') OR released_at IS NOT NULL)
);
CREATE UNIQUE INDEX voucher_one_active_order ON voucher_reservations(tenant_id,pos_order_id) WHERE status='ACTIVE' AND pos_order_id IS NOT NULL;
CREATE INDEX voucher_reservations_expiry_idx ON voucher_reservations(status,expires_at) WHERE status='ACTIVE';

CREATE TABLE voucher_redemption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  voucher_code_id uuid NOT NULL, reservation_id uuid, customer_id uuid NOT NULL,
  pos_order_id uuid, refund_id uuid, credit_note_id uuid,
  entry_type text NOT NULL CHECK(entry_type IN('COMMIT','RELEASE','EXPIRE','REVERSAL')),
  use_delta integer NOT NULL CHECK(use_delta<>0), discount_minor bigint NOT NULL CHECK(discount_minor>=0),
  policy_snapshot_json jsonb NOT NULL, generation_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,voucher_code_id) REFERENCES voucher_codes(tenant_id,id),
  FOREIGN KEY(tenant_id,reservation_id) REFERENCES voucher_reservations(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,credit_note_id) REFERENCES credit_notes(tenant_id,id)
);

ALTER TABLE loyalty_programs
  ADD COLUMN IF NOT EXISTS earn_basis text,
  ADD COLUMN IF NOT EXISTS spend_minor_per_point bigint,
  ADD COLUMN IF NOT EXISTS redemption_points bigint,
  ADD COLUMN IF NOT EXISTS redemption_minor bigint,
  ADD COLUMN IF NOT EXISTS settlement_delay_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_valid_days integer,
  ADD COLUMN IF NOT EXISTS negative_balance_policy text NOT NULL DEFAULT 'ALLOW_AND_BLOCK_REDEMPTION',
  ADD COLUMN IF NOT EXISTS effective_from timestamptz,
  ADD COLUMN IF NOT EXISTS effective_to timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS supersedes_program_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE loyalty_programs SET earn_basis=COALESCE(earn_basis,'NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP'),spend_minor_per_point=COALESCE(spend_minor_per_point,10000),redemption_points=COALESCE(redemption_points,1),redemption_minor=COALESCE(redemption_minor,100),effective_from=COALESCE(effective_from,now()),created_by_user_id=COALESCE(created_by_user_id,(SELECT u.id FROM users u WHERE u.origin_tenant_id=loyalty_programs.tenant_id ORDER BY u.id LIMIT 1));
ALTER TABLE loyalty_programs ALTER COLUMN earn_basis SET NOT NULL,ALTER COLUMN spend_minor_per_point SET NOT NULL,ALTER COLUMN redemption_points SET NOT NULL,ALTER COLUMN redemption_minor SET NOT NULL,ALTER COLUMN effective_from SET NOT NULL,ALTER COLUMN created_by_user_id SET NOT NULL,
  ADD CONSTRAINT loyalty_programs_tenant_id_id_key UNIQUE(tenant_id,id),
  ADD CONSTRAINT loyalty_programs_earn_basis_check CHECK(earn_basis IN('NET_ORDER_AFTER_DISCOUNT_BEFORE_TIP','NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX','FIXED_PER_COMPLETED_SERVICE')),
  ADD CONSTRAINT loyalty_programs_ratio_check CHECK(spend_minor_per_point>0 AND redemption_points>0 AND redemption_minor>0),
  ADD CONSTRAINT loyalty_programs_status_check CHECK(status IN('ACTIVE','INACTIVE')),
  ADD CONSTRAINT loyalty_programs_effective_check CHECK(effective_to IS NULL OR effective_to>effective_from),
  ADD CONSTRAINT loyalty_programs_creator_fk FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  ADD CONSTRAINT loyalty_programs_supersedes_fk FOREIGN KEY(tenant_id,supersedes_program_id) REFERENCES loyalty_programs(tenant_id,id);

CREATE TABLE loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL,
  pending_points bigint NOT NULL DEFAULT 0, available_points bigint NOT NULL DEFAULT 0,
  reserved_points bigint NOT NULL DEFAULT 0 CHECK(reserved_points>=0), lifetime_earned_points bigint NOT NULL DEFAULT 0 CHECK(lifetime_earned_points>=0),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,customer_id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  CHECK(reserved_points<=GREATEST(available_points,0))
);
CREATE TABLE loyalty_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL,
  customer_id uuid NOT NULL, pos_order_id uuid NOT NULL, points bigint NOT NULL CHECK(points>0), amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMMITTED','RELEASED','EXPIRED','CANCELLED')),
  policy_snapshot_json jsonb NOT NULL, generation_key varchar(200) NOT NULL, expires_at timestamptz NOT NULL,
  committed_at timestamptz, released_at timestamptz, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,account_id) REFERENCES loyalty_accounts(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id), CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX loyalty_one_active_order ON loyalty_reservations(tenant_id,pos_order_id) WHERE status='ACTIVE';
CREATE INDEX loyalty_reservations_expiry_idx ON loyalty_reservations(status,expires_at) WHERE status='ACTIVE';
CREATE TABLE loyalty_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL,
  customer_id uuid NOT NULL, program_id uuid, reservation_id uuid, pos_order_id uuid, invoice_id uuid, refund_id uuid, credit_note_id uuid,
  entry_type text NOT NULL CHECK(entry_type IN('EARN_PENDING','EARN_AVAILABLE','REDEEM_RESERVE','REDEEM_COMMIT','REDEEM_RELEASE','EXPIRE','REFUND_REVERSAL','MANUAL_ADJUSTMENT','MIGRATION')),
  pending_delta bigint NOT NULL DEFAULT 0, available_delta bigint NOT NULL DEFAULT 0, reserved_delta bigint NOT NULL DEFAULT 0,
  lifetime_delta bigint NOT NULL DEFAULT 0, expires_at timestamptz, policy_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_key varchar(200) NOT NULL, created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,account_id) REFERENCES loyalty_accounts(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,program_id) REFERENCES loyalty_programs(tenant_id,id), FOREIGN KEY(tenant_id,reservation_id) REFERENCES loyalty_reservations(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id), FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id), FOREIGN KEY(tenant_id,credit_note_id) REFERENCES credit_notes(tenant_id,id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id), CHECK(pending_delta<>0 OR available_delta<>0 OR reserved_delta<>0 OR lifetime_delta<>0)
);
CREATE INDEX loyalty_ledger_customer_idx ON loyalty_ledger_entries(tenant_id,customer_id,created_at DESC,id);
CREATE TABLE loyalty_point_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL,
  source_ledger_entry_id uuid NOT NULL, original_points bigint NOT NULL CHECK(original_points>0), available_points bigint NOT NULL CHECK(available_points>=0),
  expires_at timestamptz, status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN('AVAILABLE','EXHAUSTED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,source_ledger_entry_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES loyalty_accounts(tenant_id,id), FOREIGN KEY(tenant_id,source_ledger_entry_id) REFERENCES loyalty_ledger_entries(tenant_id,id),
  CHECK(available_points<=original_points)
);
CREATE INDEX loyalty_lots_fifo_idx ON loyalty_point_lots(tenant_id,account_id,expires_at,created_at) WHERE status='AVAILABLE';
CREATE TABLE loyalty_redemption_lot_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), reservation_id uuid NOT NULL, lot_id uuid NOT NULL,
  points bigint NOT NULL CHECK(points>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,reservation_id,lot_id),
  FOREIGN KEY(tenant_id,reservation_id) REFERENCES loyalty_reservations(tenant_id,id), FOREIGN KEY(tenant_id,lot_id) REFERENCES loyalty_point_lots(tenant_id,id)
);
CREATE TABLE loyalty_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL,
  account_id uuid NOT NULL, points_delta bigint NOT NULL CHECK(points_delta<>0), reason_code varchar(80) NOT NULL, note text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by_user_id uuid NOT NULL REFERENCES users(id), decided_by_user_id uuid REFERENCES users(id), decision_reason text,
  ledger_entry_id uuid, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,ledger_entry_id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES loyalty_accounts(tenant_id,id), FOREIGN KEY(tenant_id,ledger_entry_id) REFERENCES loyalty_ledger_entries(tenant_id,id),
  CHECK(status='PENDING' OR decided_at IS NOT NULL), CHECK(status<>'APPROVED' OR (decided_by_user_id IS NOT NULL AND decided_by_user_id<>requested_by_user_id AND ledger_entry_id IS NOT NULL))
);

CREATE TABLE membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code varchar(80) NOT NULL,
  name_json jsonb NOT NULL, qualification_type text NOT NULL CHECK(qualification_type IN('MANUAL','ROLLING_SPEND','VISIT_COUNT','LIFETIME_SPEND','POINTS_EARNED')),
  qualification_threshold bigint NOT NULL DEFAULT 0 CHECK(qualification_threshold>=0), rolling_window_days integer,
  benefits_json jsonb NOT NULL DEFAULT '[]'::jsonb, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')),
  priority integer NOT NULL DEFAULT 0, effective_from timestamptz NOT NULL, effective_to timestamptz,
  version integer NOT NULL DEFAULT 1, supersedes_tier_id uuid, created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code,version), FOREIGN KEY(tenant_id,supersedes_tier_id) REFERENCES membership_tiers(tenant_id,id),
  CHECK(effective_to IS NULL OR effective_to>effective_from), CHECK(qualification_type<>'ROLLING_SPEND' OR rolling_window_days>0)
);
CREATE TABLE customer_membership_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL, tier_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN('PENDING','ACTIVE','EXPIRED','REVOKED','SUPERSEDED')),
  effective_from timestamptz NOT NULL, effective_to timestamptz, benefit_snapshot_json jsonb NOT NULL,
  qualification_snapshot_json jsonb NOT NULL, supersedes_assignment_id uuid, reason_code varchar(80),
  assigned_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,tier_id) REFERENCES membership_tiers(tenant_id,id),
  FOREIGN KEY(tenant_id,supersedes_assignment_id) REFERENCES customer_membership_assignments(tenant_id,id), FOREIGN KEY(assigned_by_user_id) REFERENCES users(id),
  CHECK(effective_to IS NULL OR effective_to>effective_from)
);
ALTER TABLE customer_membership_assignments ADD CONSTRAINT membership_assignment_effective_no_overlap EXCLUDE USING gist
  (tenant_id WITH =,customer_id WITH =,tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)') WITH &&) WHERE(status='ACTIVE');
CREATE INDEX membership_assignments_customer_idx ON customer_membership_assignments(tenant_id,customer_id,effective_from DESC);
CREATE TABLE customer_membership_metrics (
  tenant_id uuid NOT NULL, customer_id uuid NOT NULL, rolling_spend_minor bigint NOT NULL DEFAULT 0,
  lifetime_spend_minor bigint NOT NULL DEFAULT 0, visit_count bigint NOT NULL DEFAULT 0, points_earned bigint NOT NULL DEFAULT 0,
  window_started_at timestamptz, last_evaluated_at timestamptz, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY(tenant_id,customer_id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);

CREATE TABLE service_package_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code varchar(80) NOT NULL,
  name_json jsonb NOT NULL, description_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','INACTIVE','ARCHIVED')),
  entitlement_type text NOT NULL DEFAULT 'SERVICE_UNITS' CHECK(entitlement_type='SERVICE_UNITS'),
  granted_units integer NOT NULL CHECK(granted_units>0), units_per_redemption integer NOT NULL DEFAULT 1 CHECK(units_per_redemption>0),
  price_minor bigint NOT NULL DEFAULT 0 CHECK(price_minor>=0), currency char(3) NOT NULL, validity_days integer NOT NULL CHECK(validity_days>0),
  refund_policy text NOT NULL DEFAULT 'RESTORE_UNIT' CHECK(refund_policy IN('RESTORE_UNIT','DO_NOT_RESTORE','MANUAL_REVIEW')),
  policy_json jsonb NOT NULL DEFAULT '{}'::jsonb, version integer NOT NULL DEFAULT 1, supersedes_product_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code,version), FOREIGN KEY(tenant_id,supersedes_product_id) REFERENCES service_package_products(tenant_id,id)
);
CREATE TABLE service_package_eligibility_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), package_product_id uuid NOT NULL,
  service_id uuid, category_id uuid, branch_id uuid, units_per_redemption integer NOT NULL CHECK(units_per_redemption>0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,package_product_id) REFERENCES service_package_products(tenant_id,id), FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id),
  FOREIGN KEY(tenant_id,category_id) REFERENCES service_categories(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  CHECK(service_id IS NOT NULL OR category_id IS NOT NULL)
);
CREATE TABLE customer_package_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL,
  package_product_id uuid NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','EXHAUSTED','EXPIRED','CANCELLED')),
  granted_units integer NOT NULL CHECK(granted_units>0), adjustment_units integer NOT NULL DEFAULT 0,
  available_units integer NOT NULL CHECK(available_units>=0), reserved_units integer NOT NULL DEFAULT 0 CHECK(reserved_units>=0), consumed_units integer NOT NULL DEFAULT 0 CHECK(consumed_units>=0),
  allocated_unit_value_minor bigint NOT NULL DEFAULT 0 CHECK(allocated_unit_value_minor>=0), currency char(3) NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, policy_snapshot_json jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, generation_key varchar(200) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,package_product_id) REFERENCES service_package_products(tenant_id,id),
  CHECK(expires_at>issued_at), CHECK(available_units+reserved_units+consumed_units=granted_units+adjustment_units)
);
CREATE INDEX package_entitlements_wallet_idx ON customer_package_entitlements(tenant_id,customer_id,status,expires_at);
CREATE TABLE package_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), entitlement_id uuid NOT NULL,
  customer_id uuid NOT NULL, branch_id uuid NOT NULL, appointment_id uuid, appointment_item_id uuid, pos_order_id uuid,
  service_id uuid NOT NULL, units integer NOT NULL CHECK(units>0), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMMITTED','RELEASED','EXPIRED','CANCELLED')),
  policy_snapshot_json jsonb NOT NULL, generation_key varchar(200) NOT NULL, expires_at timestamptz NOT NULL,
  committed_at timestamptz, released_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,entitlement_id) REFERENCES customer_package_entitlements(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id), FOREIGN KEY(tenant_id,appointment_item_id) REFERENCES appointment_items(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id), FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id), CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX package_one_active_appointment_item ON package_reservations(tenant_id,appointment_item_id) WHERE status='ACTIVE' AND appointment_item_id IS NOT NULL;
CREATE INDEX package_reservations_expiry_idx ON package_reservations(status,expires_at) WHERE status='ACTIVE';
CREATE TABLE package_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), entitlement_id uuid NOT NULL,
  customer_id uuid NOT NULL, reservation_id uuid, pos_order_id uuid, appointment_id uuid, refund_id uuid, credit_note_id uuid,
  entry_type text NOT NULL CHECK(entry_type IN('ISSUE','PURCHASE','RESERVE','COMMIT','RELEASE','EXPIRE','REFUND_REVERSAL','MANUAL_ADJUSTMENT')),
  available_delta integer NOT NULL DEFAULT 0, reserved_delta integer NOT NULL DEFAULT 0, consumed_delta integer NOT NULL DEFAULT 0,
  policy_snapshot_json jsonb NOT NULL, generation_key varchar(200) NOT NULL, created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,entitlement_id) REFERENCES customer_package_entitlements(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,reservation_id) REFERENCES package_reservations(tenant_id,id), FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,appointment_id) REFERENCES appointments(tenant_id,id), FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,credit_note_id) REFERENCES credit_notes(tenant_id,id), FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  CHECK(available_delta<>0 OR reserved_delta<>0 OR consumed_delta<>0)
);
CREATE INDEX package_ledger_entitlement_idx ON package_ledger_entries(tenant_id,entitlement_id,created_at,id);

CREATE TABLE pos_order_benefit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), pos_order_id uuid NOT NULL,
  customer_id uuid NOT NULL, benefit_type text NOT NULL CHECK(benefit_type IN('PACKAGE','MEMBERSHIP','VOUCHER','LOYALTY')),
  source_entity_id uuid NOT NULL, reservation_id uuid, status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN('RESERVED','COMMITTED','RELEASED','REVERSED')),
  sequence_no integer NOT NULL CHECK(sequence_no BETWEEN 1 AND 4), amount_minor bigint NOT NULL DEFAULT 0 CHECK(amount_minor>=0), units integer NOT NULL DEFAULT 0 CHECK(units>=0),
  allocation_json jsonb NOT NULL DEFAULT '[]'::jsonb, policy_snapshot_json jsonb NOT NULL, generation_key varchar(200) NOT NULL,
  expires_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE UNIQUE INDEX pos_order_one_active_benefit_type ON pos_order_benefit_applications(tenant_id,pos_order_id,benefit_type) WHERE status='RESERVED';
CREATE TABLE benefit_reversal_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), refund_id uuid NOT NULL,
  benefit_type text NOT NULL, source_entity_id uuid NOT NULL, conflict_code varchar(100) NOT NULL, context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RESOLVED')), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,refund_id,benefit_type,source_entity_id,conflict_code), FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id)
);
CREATE TABLE benefit_liability_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), local_date date NOT NULL,
  currency char(3) NOT NULL, loyalty_available_points bigint NOT NULL DEFAULT 0, loyalty_liability_minor bigint NOT NULL DEFAULT 0,
  package_remaining_units bigint NOT NULL DEFAULT 0, package_liability_minor bigint NOT NULL DEFAULT 0,
  membership_active_count bigint NOT NULL DEFAULT 0, voucher_reserved_count bigint NOT NULL DEFAULT 0,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb, generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,local_date,currency)
);
CREATE TABLE benefit_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), job_type text NOT NULL CHECK(job_type IN('RESERVATION_EXPIRY','VOUCHER_EXPIRY','LOYALTY_SETTLEMENT','LOYALTY_EXPIRY','PACKAGE_EXPIRY','MEMBERSHIP_EVALUATION')),
  aggregate_id uuid NOT NULL, generation_key varchar(200) NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','COMPLETED','FAILED')),
  run_at timestamptz NOT NULL, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key)
);
CREATE INDEX benefit_jobs_poll_idx ON benefit_jobs(run_at,id) WHERE status IN('PENDING','FAILED');
CREATE TABLE benefit_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  export_type text NOT NULL CHECK(export_type IN('VOUCHERS','LOYALTY','MEMBERSHIP','PACKAGES','LIABILITY','EXPIRING')),
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','READY','FAILED','EXPIRED')),
  storage_key varchar(500), checksum varchar(128), expires_at timestamptz, requested_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, UNIQUE(tenant_id,id)
);

CREATE FUNCTION sprint8_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Sprint 8 benefit ledger is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER voucher_entries_append_only BEFORE UPDATE OR DELETE ON voucher_redemption_entries FOR EACH ROW EXECUTE FUNCTION sprint8_append_only_guard();
CREATE TRIGGER loyalty_ledger_append_only BEFORE UPDATE OR DELETE ON loyalty_ledger_entries FOR EACH ROW EXECUTE FUNCTION sprint8_append_only_guard();
CREATE TRIGGER package_ledger_append_only BEFORE UPDATE OR DELETE ON package_ledger_entries FOR EACH ROW EXECUTE FUNCTION sprint8_append_only_guard();
CREATE TRIGGER benefit_liability_append_only BEFORE UPDATE OR DELETE ON benefit_liability_daily_snapshots FOR EACH ROW EXECUTE FUNCTION sprint8_append_only_guard();

CREATE FUNCTION sprint8_release_cancelled_appointment_packages() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r package_reservations%ROWTYPE;
BEGIN
  IF NEW.status IN('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON','EXPIRED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    FOR r IN SELECT * FROM package_reservations WHERE tenant_id=NEW.tenant_id AND appointment_id=NEW.id AND status='ACTIVE' FOR UPDATE LOOP
      UPDATE customer_package_entitlements SET available_units=available_units+r.units,reserved_units=reserved_units-r.units,version=version+1,updated_at=now()
       WHERE tenant_id=r.tenant_id AND id=r.entitlement_id;
      UPDATE package_reservations SET status=CASE WHEN NEW.status='EXPIRED' THEN 'EXPIRED' ELSE 'RELEASED' END,released_at=now(),version=version+1,updated_at=now()
       WHERE tenant_id=r.tenant_id AND id=r.id;
      INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,reservation_id,appointment_id,entry_type,available_delta,reserved_delta,policy_snapshot_json,generation_key,created_by_user_id)
      VALUES(r.tenant_id,r.entitlement_id,r.customer_id,r.id,r.appointment_id,'RELEASE',r.units,-r.units,r.policy_snapshot_json,'appointment-release:'||NEW.id::text||':'||r.id::text,NEW.updated_by_user_id)
      ON CONFLICT(tenant_id,generation_key) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_package_release AFTER UPDATE OF status ON appointments FOR EACH ROW EXECUTE FUNCTION sprint8_release_cancelled_appointment_packages();

INSERT INTO permissions(code,description) VALUES
('voucher.campaign.read','Read voucher campaigns'),('voucher.campaign.manage','Manage voucher campaigns'),('voucher.code.read','Read voucher code metadata'),('voucher.code.issue','Issue voucher codes'),('voucher.code.assign','Assign voucher codes'),('voucher.code.cancel','Cancel voucher codes'),('voucher.redeem','Reserve and redeem vouchers'),
('loyalty.program.read','Read loyalty programs'),('loyalty.program.manage','Manage loyalty programs'),('loyalty.account.read','Read loyalty account'),('loyalty.ledger.read','Read loyalty ledger'),('loyalty.redeem','Reserve loyalty points'),('loyalty.adjustment.request','Request loyalty adjustment'),('loyalty.adjustment.approve','Approve loyalty adjustment'),
('membership.tier.read','Read membership tiers'),('membership.tier.manage','Manage membership tiers'),('membership.assignment.read','Read membership assignments'),('membership.assignment.manage','Manage membership assignments'),('membership.evaluate','Evaluate membership tier'),
('package.catalog.read','Read service package catalog'),('package.catalog.manage','Manage service package catalog'),('package.entitlement.read','Read package entitlement'),('package.entitlement.issue','Issue package entitlement'),('package.entitlement.adjust','Adjust package entitlement'),('package.reserve','Reserve package units'),('package.redeem','Redeem package units'),
('benefit.eligibility.read','Read benefit eligibility'),('benefit.apply','Apply benefit'),('benefit.release','Release benefit'),('benefit.liability.read','Read benefit liability'),('benefit.report.read','Read benefit reports')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT role,code FROM (VALUES('SALON_OWNER')) r(role) CROSS JOIN permissions p WHERE p.code LIKE 'voucher.%' OR p.code LIKE 'loyalty.%' OR p.code LIKE 'membership.%' OR p.code LIKE 'package.%' OR p.code LIKE 'benefit.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT role,code FROM (VALUES('BRANCH_MANAGER')) r(role) CROSS JOIN permissions p WHERE p.code LIKE 'voucher.%' OR p.code LIKE 'loyalty.%' OR p.code LIKE 'membership.%' OR p.code LIKE 'package.%' OR p.code LIKE 'benefit.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('RECEPTIONIST','voucher.code.read'),('RECEPTIONIST','loyalty.account.read'),('RECEPTIONIST','membership.assignment.read'),('RECEPTIONIST','package.entitlement.read'),('RECEPTIONIST','package.reserve'),('RECEPTIONIST','benefit.eligibility.read'),
('CASHIER','voucher.code.read'),('CASHIER','voucher.redeem'),('CASHIER','loyalty.account.read'),('CASHIER','loyalty.redeem'),('CASHIER','membership.assignment.read'),('CASHIER','package.entitlement.read'),('CASHIER','package.reserve'),('CASHIER','package.redeem'),('CASHIER','benefit.eligibility.read'),('CASHIER','benefit.apply'),('CASHIER','benefit.release'),
('NAIL_TECHNICIAN','package.entitlement.read'),
('ACCOUNTANT','voucher.campaign.read'),('ACCOUNTANT','voucher.code.read'),('ACCOUNTANT','loyalty.program.read'),('ACCOUNTANT','loyalty.account.read'),('ACCOUNTANT','loyalty.ledger.read'),('ACCOUNTANT','membership.tier.read'),('ACCOUNTANT','membership.assignment.read'),('ACCOUNTANT','package.catalog.read'),('ACCOUNTANT','package.entitlement.read'),('ACCOUNTANT','benefit.liability.read'),('ACCOUNTANT','benefit.report.read'),
('MARKETING','voucher.campaign.read'),('MARKETING','voucher.campaign.manage'),('MARKETING','voucher.code.read'),('MARKETING','voucher.code.issue'),('MARKETING','voucher.code.assign'),('MARKETING','voucher.code.cancel'),('MARKETING','loyalty.program.read'),('MARKETING','loyalty.program.manage'),('MARKETING','membership.tier.read'),('MARKETING','membership.tier.manage'),('MARKETING','package.catalog.read')
,
('CUSTOMER','loyalty.account.read'),('CUSTOMER','loyalty.ledger.read'),('CUSTOMER','membership.assignment.read'),('CUSTOMER','package.entitlement.read')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0016_voucher_loyalty_membership_package');
COMMIT;
