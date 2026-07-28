BEGIN;

CREATE FUNCTION sprint10_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'STORED_VALUE_LEDGER_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE FUNCTION sprint10_account_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.stored_value_posting',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'STORED_VALUE_DIRECT_BALANCE_UPDATE_DENIED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE stored_value_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id), feature_status text NOT NULL DEFAULT 'DISABLED' CHECK(feature_status IN('DISABLED','ENABLED')),
  high_value_approval_minor bigint NOT NULL DEFAULT 5000000 CHECK(high_value_approval_minor>=0), reservation_ttl_seconds integer NOT NULL DEFAULT 900 CHECK(reservation_ttl_seconds BETWEEN 60 AND 3600),
  daily_issue_limit_minor bigint NOT NULL DEFAULT 50000000 CHECK(daily_issue_limit_minor>0), daily_redeem_limit_minor bigint NOT NULL DEFAULT 50000000 CHECK(daily_redeem_limit_minor>0),
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO stored_value_settings(tenant_id) SELECT id FROM tenants ON CONFLICT DO NOTHING;

ALTER TABLE refunds ADD COLUMN refund_destination text NOT NULL DEFAULT 'ORIGINAL_TENDER'
  CHECK(refund_destination IN('ORIGINAL_TENDER','CUSTOMER_CREDIT'));

CREATE TABLE stored_value_legal_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), jurisdiction varchar(80) NOT NULL DEFAULT 'UNSPECIFIED',
  policy_version integer NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','SUPERSEDED','REJECTED')),
  expiration_mode text NOT NULL DEFAULT 'NO_EXPIRATION' CHECK(expiration_mode IN('NO_EXPIRATION','FIXED_DATE','DAYS_AFTER_ACTIVATION','DAYS_AFTER_LAST_ACTIVITY')),
  expiration_days integer CHECK(expiration_days IS NULL OR expiration_days>0), fixed_expiry_date date, grace_days integer NOT NULL DEFAULT 0 CHECK(grace_days>=0),
  notice_requirements_json jsonb NOT NULL DEFAULT '{}', dormancy_policy_json jsonb NOT NULL DEFAULT '{}', breakage_mode text NOT NULL DEFAULT 'NONE' CHECK(breakage_mode IN('NONE','MANUAL_REVIEW','APPROVED_POLICY')),
  legal_review_status text NOT NULL DEFAULT 'PENDING' CHECK(legal_review_status IN('PENDING','APPROVED','REJECTED')), effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES users(id), approved_by_user_id uuid REFERENCES users(id), approved_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,jurisdiction,policy_version),
  CHECK(effective_to IS NULL OR effective_to>effective_from), CHECK(status<>'APPROVED' OR (legal_review_status='APPROVED' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE stored_value_legal_policies ADD CONSTRAINT stored_value_legal_policy_no_overlap EXCLUDE USING gist
  (tenant_id WITH =,jurisdiction WITH =,tstzrange(effective_from,effective_to,'[)') WITH &&) WHERE(status='APPROVED');

CREATE TABLE gift_card_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), product_code varchar(80) NOT NULL, version_no integer NOT NULL DEFAULT 1,
  supersedes_product_id uuid, name_json jsonb NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','INACTIVE','ARCHIVED')),
  amount_mode text NOT NULL CHECK(amount_mode IN('FIXED','OPEN')), card_form text NOT NULL CHECK(card_form IN('PHYSICAL','DIGITAL','BOTH')), currency char(3) NOT NULL,
  minimum_amount_minor bigint NOT NULL CHECK(minimum_amount_minor>0), maximum_amount_minor bigint NOT NULL CHECK(maximum_amount_minor>=minimum_amount_minor),
  fixed_denominations_minor bigint[] NOT NULL DEFAULT '{}', maximum_balance_minor bigint NOT NULL CHECK(maximum_balance_minor>0), reloadable boolean NOT NULL DEFAULT false,
  assignment_policy text NOT NULL DEFAULT 'BEARER_OR_CUSTOMER' CHECK(assignment_policy IN('BEARER','CUSTOMER_REQUIRED','BEARER_OR_CUSTOMER')), pin_required boolean NOT NULL DEFAULT true,
  legal_policy_id uuid, branch_scope_json jsonb NOT NULL DEFAULT '{}', eligibility_policy_json jsonb NOT NULL DEFAULT '{}', purchase_policy_json jsonb NOT NULL DEFAULT '{"discount":"NONE","loyaltyEarn":false,"membershipDiscount":false,"voucher":false,"package":false,"giftCardPayment":false}',
  refund_policy_json jsonb NOT NULL DEFAULT '{"unused":"ALLOW","partial":"MANUAL_REVIEW","depleted":"DENY"}', replacement_policy_json jsonb NOT NULL DEFAULT '{}', limits_policy_json jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1, created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,product_code,version_no), FOREIGN KEY(tenant_id,supersedes_product_id) REFERENCES gift_card_products(tenant_id,id), FOREIGN KEY(tenant_id,legal_policy_id) REFERENCES stored_value_legal_policies(tenant_id,id),
  CHECK(amount_mode<>'FIXED' OR cardinality(fixed_denominations_minor)>0)
);

CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), product_id uuid NOT NULL, customer_id uuid,
  card_reference varchar(80) NOT NULL, number_hash varchar(128) NOT NULL, number_last4 varchar(4) NOT NULL, hash_key_version integer NOT NULL DEFAULT 1,
  pin_hash varchar(255), pin_version integer, failed_pin_attempts integer NOT NULL DEFAULT 0 CHECK(failed_pin_attempts>=0), locked_until timestamptz,
  form text NOT NULL CHECK(form IN('PHYSICAL','DIGITAL')), status text NOT NULL DEFAULT 'PENDING_ACTIVATION' CHECK(status IN('PENDING_ACTIVATION','ACTIVE','SUSPENDED','DEPLETED','EXPIRED','CANCELLED','REPLACED')),
  currency char(3) NOT NULL, activated_at timestamptz, expires_at timestamptz, source_order_id uuid, source_order_line_id uuid, source_payment_id uuid,
  policy_snapshot_json jsonb NOT NULL, replaced_by_gift_card_id uuid, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,card_reference), UNIQUE(tenant_id,number_hash), FOREIGN KEY(tenant_id,product_id) REFERENCES gift_card_products(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,source_order_id) REFERENCES pos_orders(tenant_id,id), FOREIGN KEY(tenant_id,source_order_line_id) REFERENCES pos_order_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,source_payment_id) REFERENCES payments(tenant_id,id), FOREIGN KEY(tenant_id,replaced_by_gift_card_id) REFERENCES gift_cards(tenant_id,id),
  CHECK(number_last4 ~ '^[0-9]{4}$'), CHECK(status<>'ACTIVE' OR activated_at IS NOT NULL)
);

CREATE TABLE stored_value_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_type text NOT NULL CHECK(account_type IN('GIFT_CARD','CUSTOMER_CREDIT')),
  gift_card_id uuid, customer_id uuid, currency char(3) NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','SUSPENDED','CLOSED')),
  pending_minor bigint NOT NULL DEFAULT 0 CHECK(pending_minor>=0), available_minor bigint NOT NULL DEFAULT 0 CHECK(available_minor>=0), reserved_minor bigint NOT NULL DEFAULT 0 CHECK(reserved_minor>=0),
  redeemed_minor bigint NOT NULL DEFAULT 0 CHECK(redeemed_minor>=0), expired_minor bigint NOT NULL DEFAULT 0 CHECK(expired_minor>=0), cancelled_minor bigint NOT NULL DEFAULT 0 CHECK(cancelled_minor>=0),
  lifetime_issued_minor bigint NOT NULL DEFAULT 0 CHECK(lifetime_issued_minor>=0), lifetime_redeemed_minor bigint NOT NULL DEFAULT 0 CHECK(lifetime_redeemed_minor>=0), version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,gift_card_id),
  FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  CHECK((account_type='GIFT_CARD' AND gift_card_id IS NOT NULL) OR (account_type='CUSTOMER_CREDIT' AND customer_id IS NOT NULL AND gift_card_id IS NULL))
);
CREATE UNIQUE INDEX stored_value_customer_credit_unique ON stored_value_accounts(tenant_id,customer_id,currency) WHERE account_type='CUSTOMER_CREDIT';
CREATE TRIGGER stored_value_account_projection_guard BEFORE UPDATE OF pending_minor,available_minor,reserved_minor,redeemed_minor,expired_minor,cancelled_minor,lifetime_issued_minor,lifetime_redeemed_minor ON stored_value_accounts FOR EACH ROW EXECUTE FUNCTION sprint10_account_projection_guard();

CREATE TABLE stored_value_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, account_id uuid NOT NULL,
  entry_type text NOT NULL CHECK(entry_type IN('ISSUE_PENDING','ACTIVATE','RELOAD_PENDING','RELOAD_COMMIT','RESERVE','REDEEM','RELEASE','REFUND_RESTORE','PURCHASE_CANCELLATION','MANUAL_CREDIT','MANUAL_DEBIT','SERVICE_RECOVERY_CREDIT','EXPIRE','FORFEIT','REPLACEMENT_OUT','REPLACEMENT_IN','MIGRATION','CORRECTION')),
  pending_delta_minor bigint NOT NULL DEFAULT 0, available_delta_minor bigint NOT NULL DEFAULT 0, reserved_delta_minor bigint NOT NULL DEFAULT 0, redeemed_delta_minor bigint NOT NULL DEFAULT 0,
  expired_delta_minor bigint NOT NULL DEFAULT 0, cancelled_delta_minor bigint NOT NULL DEFAULT 0, currency char(3) NOT NULL, source_entry_id uuid,
  order_id uuid, invoice_id uuid, payment_id uuid, refund_id uuid, credit_note_id uuid, reservation_id uuid, adjustment_request_id uuid,
  policy_snapshot_json jsonb NOT NULL DEFAULT '{}', generation_key varchar(180) NOT NULL, actor_user_id uuid REFERENCES users(id), occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,account_id,generation_key), FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id),
  FOREIGN KEY(tenant_id,order_id) REFERENCES pos_orders(tenant_id,id), FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id), FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id), FOREIGN KEY(tenant_id,credit_note_id) REFERENCES credit_notes(tenant_id,id),
  CHECK(pending_delta_minor<>0 OR available_delta_minor<>0 OR reserved_delta_minor<>0 OR redeemed_delta_minor<>0 OR expired_delta_minor<>0 OR cancelled_delta_minor<>0)
);
CREATE TRIGGER stored_value_ledger_append_only BEFORE UPDATE OR DELETE ON stored_value_ledger_entries FOR EACH ROW EXECUTE FUNCTION sprint10_append_only_guard();
CREATE INDEX stored_value_ledger_query_idx ON stored_value_ledger_entries(tenant_id,account_id,occurred_at DESC,id);

CREATE TABLE stored_value_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, account_id uuid NOT NULL, order_id uuid NOT NULL, customer_id uuid, currency char(3) NOT NULL,
  requested_minor bigint NOT NULL CHECK(requested_minor>0), accepted_minor bigint NOT NULL CHECK(accepted_minor>0 AND accepted_minor<=requested_minor),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMMITTED','RELEASED','EXPIRED','CANCELLED')), expires_at timestamptz NOT NULL,
  committed_at timestamptz, released_at timestamptz, version integer NOT NULL DEFAULT 1, generation_key varchar(180) NOT NULL, created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,account_id,generation_key), FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id), FOREIGN KEY(tenant_id,order_id) REFERENCES pos_orders(tenant_id,id), FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  CHECK(status<>'COMMITTED' OR committed_at IS NOT NULL), CHECK(status NOT IN('RELEASED','EXPIRED','CANCELLED') OR released_at IS NOT NULL)
);
CREATE UNIQUE INDEX stored_value_one_active_account_order ON stored_value_reservations(tenant_id,account_id,order_id) WHERE status='ACTIVE';
CREATE INDEX stored_value_reservation_expiry_idx ON stored_value_reservations(expires_at,id) WHERE status='ACTIVE';

CREATE TABLE pos_order_stored_value_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, order_id uuid NOT NULL, account_id uuid NOT NULL, reservation_id uuid NOT NULL,
  application_type text NOT NULL CHECK(application_type IN('GIFT_CARD','CUSTOMER_CREDIT')), status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN('RESERVED','COMMITTED','RELEASED','EXPIRED')),
  requested_minor bigint NOT NULL CHECK(requested_minor>0), accepted_minor bigint NOT NULL CHECK(accepted_minor>0), currency char(3) NOT NULL, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,reservation_id),
  FOREIGN KEY(tenant_id,order_id) REFERENCES pos_orders(tenant_id,id), FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id), FOREIGN KEY(tenant_id,reservation_id) REFERENCES stored_value_reservations(tenant_id,id)
);
CREATE UNIQUE INDEX pos_one_gift_card_application ON pos_order_stored_value_applications(tenant_id,order_id) WHERE application_type='GIFT_CARD' AND status='RESERVED';
CREATE UNIQUE INDEX pos_one_customer_credit_application ON pos_order_stored_value_applications(tenant_id,order_id) WHERE application_type='CUSTOMER_CREDIT' AND status='RESERVED';

CREATE TABLE stored_value_settlement_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, application_id uuid NOT NULL, account_id uuid NOT NULL, order_id uuid NOT NULL, invoice_id uuid,
  amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL, ledger_entry_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,application_id),
  FOREIGN KEY(tenant_id,application_id) REFERENCES pos_order_stored_value_applications(tenant_id,id), FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id),
  FOREIGN KEY(tenant_id,order_id) REFERENCES pos_orders(tenant_id,id), FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id), FOREIGN KEY(tenant_id,ledger_entry_id) REFERENCES stored_value_ledger_entries(tenant_id,id)
);
CREATE TRIGGER stored_value_settlement_append_only BEFORE UPDATE OR DELETE ON stored_value_settlement_allocations FOR EACH ROW EXECUTE FUNCTION sprint10_append_only_guard();

CREATE TABLE stored_value_refund_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, refund_id uuid NOT NULL, settlement_allocation_id uuid, account_id uuid NOT NULL,
  destination text NOT NULL CHECK(destination IN('ORIGINAL_STORED_VALUE','CUSTOMER_CREDIT')), amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL,
  ledger_entry_id uuid NOT NULL, generation_key varchar(180) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id), FOREIGN KEY(tenant_id,settlement_allocation_id) REFERENCES stored_value_settlement_allocations(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id), FOREIGN KEY(tenant_id,ledger_entry_id) REFERENCES stored_value_ledger_entries(tenant_id,id)
);
CREATE TRIGGER stored_value_refund_append_only BEFORE UPDATE OR DELETE ON stored_value_refund_allocations FOR EACH ROW EXECUTE FUNCTION sprint10_append_only_guard();

CREATE TABLE refund_stored_value_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, refund_id uuid NOT NULL, settlement_allocation_id uuid NOT NULL, account_id uuid NOT NULL,
  planned_minor bigint NOT NULL CHECK(planned_minor>0), completed_minor bigint NOT NULL DEFAULT 0 CHECK(completed_minor>=0 AND completed_minor<=planned_minor), currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','COMPLETED','CANCELLED')), ledger_entry_id uuid, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,refund_id,settlement_allocation_id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id), FOREIGN KEY(tenant_id,settlement_allocation_id) REFERENCES stored_value_settlement_allocations(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id), FOREIGN KEY(tenant_id,ledger_entry_id) REFERENCES stored_value_ledger_entries(tenant_id,id),
  CHECK(status<>'COMPLETED' OR (completed_minor=planned_minor AND completed_at IS NOT NULL AND ledger_entry_id IS NOT NULL))
);

CREATE TABLE gift_card_purchase_refund_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, refund_id uuid NOT NULL, gift_card_id uuid NOT NULL, account_id uuid NOT NULL,
  planned_minor bigint NOT NULL CHECK(planned_minor>0), completed_minor bigint NOT NULL DEFAULT 0 CHECK(completed_minor>=0 AND completed_minor<=planned_minor), currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','COMPLETED','CANCELLED')), ledger_entry_id uuid, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,refund_id,gift_card_id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id), FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id), FOREIGN KEY(tenant_id,ledger_entry_id) REFERENCES stored_value_ledger_entries(tenant_id,id),
  CHECK(status<>'COMPLETED' OR (completed_minor=planned_minor AND completed_at IS NOT NULL AND ledger_entry_id IS NOT NULL))
);

CREATE TABLE stored_value_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, customer_id uuid NOT NULL, account_id uuid, currency char(3) NOT NULL,
  adjustment_type text NOT NULL CHECK(adjustment_type IN('MANUAL_CREDIT','MANUAL_DEBIT','SERVICE_RECOVERY_CREDIT')), amount_minor bigint NOT NULL CHECK(amount_minor>0),
  reason_code varchar(80) NOT NULL, note text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by_user_id uuid NOT NULL REFERENCES users(id), decided_by_user_id uuid REFERENCES users(id), decision_reason text, ledger_entry_id uuid,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id), FOREIGN KEY(tenant_id,ledger_entry_id) REFERENCES stored_value_ledger_entries(tenant_id,id),
  CHECK(status='PENDING' OR status='CANCELLED' OR (decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)), CHECK(decided_by_user_id IS NULL OR decided_by_user_id<>requested_by_user_id)
);

CREATE TABLE gift_card_activation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, gift_card_id uuid NOT NULL, funding_payment_id uuid NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','COMMITTED','FAILED','DEAD_LETTER')),
  generation_key varchar(180) NOT NULL, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, error_code varchar(100), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id), FOREIGN KEY(tenant_id,funding_payment_id) REFERENCES payments(tenant_id,id)
);
CREATE TABLE gift_card_reload_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, gift_card_id uuid NOT NULL, funding_payment_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','COMMITTED','FAILED','DEAD_LETTER')), generation_key varchar(180) NOT NULL, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, error_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,funding_payment_id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id), FOREIGN KEY(tenant_id,funding_payment_id) REFERENCES payments(tenant_id,id)
);
CREATE TABLE gift_card_delivery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, gift_card_id uuid NOT NULL, channel text NOT NULL CHECK(channel IN('EMAIL','SMS','PRINT','NONE')),
  destination_masked varchar(200), status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENT','FAILED','DEAD_LETTER')), generation_key varchar(180) NOT NULL,
  attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, safe_error_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id)
);
CREATE TABLE stored_value_liability_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), snapshot_date date NOT NULL, currency char(3) NOT NULL,
  gift_card_available_minor bigint NOT NULL, gift_card_reserved_minor bigint NOT NULL, customer_credit_available_minor bigint NOT NULL, customer_credit_reserved_minor bigint NOT NULL,
  opening_liability_minor bigint NOT NULL, inflow_minor bigint NOT NULL, outflow_minor bigint NOT NULL, closing_liability_minor bigint NOT NULL, generation_key varchar(180) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,snapshot_date,currency), UNIQUE(tenant_id,generation_key), CHECK(opening_liability_minor+inflow_minor-outflow_minor=closing_liability_minor)
);
CREATE TABLE stored_value_reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid, exception_type varchar(100) NOT NULL, currency char(3) NOT NULL,
  expected_minor bigint NOT NULL, actual_minor bigint NOT NULL, details_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RESOLVED','IGNORED')),
  generation_key varchar(180) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key), FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id)
);
CREATE TABLE stored_value_lookup_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), lookup_key_hash varchar(128) NOT NULL, window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0, locked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,lookup_key_hash)
);
CREATE TABLE stored_value_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), export_type text NOT NULL, filters_json jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','COMPLETED','FAILED','DEAD_LETTER')),
  generation_key varchar(180) NOT NULL, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, result_storage_key varchar(500), safe_error_json jsonb NOT NULL DEFAULT '{}', created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key)
);

ALTER TABLE pos_order_lines DROP CONSTRAINT pos_order_lines_line_type_check;
ALTER TABLE pos_order_lines ADD CONSTRAINT pos_order_lines_line_type_check CHECK(line_type IN('SERVICE','MANUAL_SERVICE','ADJUSTMENT','PRODUCT','GIFT_CARD'));
ALTER TABLE pos_order_lines ADD COLUMN gift_card_product_id uuid, ADD COLUMN gift_card_id uuid;
ALTER TABLE pos_order_lines ADD CONSTRAINT pos_order_line_gift_card_product_fk FOREIGN KEY(tenant_id,gift_card_product_id) REFERENCES gift_card_products(tenant_id,id),
  ADD CONSTRAINT pos_order_line_gift_card_fk FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id);

CREATE OR REPLACE VIEW invoice_refund_summary AS
SELECT i.tenant_id,i.id invoice_id,
       (COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0)
        +COALESCE((SELECT sum(s.amount_minor) FROM stored_value_settlement_allocations s WHERE s.tenant_id=i.tenant_id AND s.order_id=i.pos_order_id),0))::bigint captured_minor,
       COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)::bigint completed_refund_minor,
       GREATEST(0,
         COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0)
         +COALESCE((SELECT sum(s.amount_minor) FROM stored_value_settlement_allocations s WHERE s.tenant_id=i.tenant_id AND s.order_id=i.pos_order_id),0)
         -COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0))::bigint refundable_minor,
       CASE WHEN COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)=0 THEN 'PAID'
            WHEN COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)>=
                 COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0)
                 +COALESCE((SELECT sum(s.amount_minor) FROM stored_value_settlement_allocations s WHERE s.tenant_id=i.tenant_id AND s.order_id=i.pos_order_id),0) THEN 'REFUNDED'
            ELSE 'PARTIALLY_REFUNDED' END financial_status
FROM invoices i WHERE i.status='ISSUED';

INSERT INTO permissions(code,description) SELECT code,'Sprint 10 stored-value permission' FROM unnest(ARRAY[
  'gift_card.product.read','gift_card.product.manage','gift_card.read','gift_card.issue','gift_card.activate','gift_card.suspend','gift_card.cancel','gift_card.replace','gift_card.reload','gift_card.balance.read','gift_card.ledger.read',
  'stored_value.eligibility.read','stored_value.reserve','stored_value.redeem','stored_value.release','customer_credit.read','customer_credit.ledger.read','customer_credit.adjustment.request','customer_credit.adjustment.approve','customer_credit.issue_from_refund',
  'stored_value.liability.read','stored_value.reconciliation.read','stored_value.report.read','stored_value.export','stored_value.legal_policy.read','stored_value.legal_policy.manage'
]) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code LIKE 'gift_card.%' OR code LIKE 'stored_value.%' OR code LIKE 'customer_credit.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'BRANCH_MANAGER',code FROM permissions WHERE code LIKE 'gift_card.%' OR code LIKE 'stored_value.%' OR code LIKE 'customer_credit.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
  ('RECEPTIONIST','gift_card.read'),('RECEPTIONIST','gift_card.balance.read'),('RECEPTIONIST','customer_credit.read'),
  ('CASHIER','gift_card.product.read'),('CASHIER','gift_card.read'),('CASHIER','gift_card.issue'),('CASHIER','gift_card.balance.read'),('CASHIER','stored_value.eligibility.read'),('CASHIER','stored_value.reserve'),('CASHIER','stored_value.redeem'),('CASHIER','stored_value.release'),('CASHIER','customer_credit.read'),
  ('ACCOUNTANT','gift_card.read'),('ACCOUNTANT','gift_card.balance.read'),('ACCOUNTANT','gift_card.ledger.read'),('ACCOUNTANT','customer_credit.read'),('ACCOUNTANT','customer_credit.ledger.read'),('ACCOUNTANT','stored_value.liability.read'),('ACCOUNTANT','stored_value.reconciliation.read'),('ACCOUNTANT','stored_value.report.read'),('ACCOUNTANT','stored_value.export'),('ACCOUNTANT','stored_value.legal_policy.read'),
  ('MARKETING','gift_card.product.read'),
  ('CUSTOMER','gift_card.read'),('CUSTOMER','gift_card.balance.read'),('CUSTOMER','gift_card.ledger.read'),('CUSTOMER','customer_credit.read'),('CUSTOMER','customer_credit.ledger.read') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0019_gift_card_customer_credit_stored_value');

COMMIT;
