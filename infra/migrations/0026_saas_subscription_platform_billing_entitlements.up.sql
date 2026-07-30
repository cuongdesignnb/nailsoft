BEGIN;

ALTER TABLE tenants
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN access_mode text NOT NULL DEFAULT 'FULL',
  ADD COLUMN lifecycle_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT tenants_lifecycle_status_check CHECK(lifecycle_status IN('PROVISIONING','ACTIVE','GRACE','READ_ONLY','SUSPENDED','CANCELLATION_PENDING','TERMINATION_PENDING','TERMINATED')),
  ADD CONSTRAINT tenants_access_mode_check CHECK(access_mode IN('FULL','GRACE','READ_ONLY','BILLING_ONLY','SUSPENDED','TERMINATED'));

CREATE TABLE platform_products(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','RETIRED')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_plans(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES platform_products(id),
  code text NOT NULL UNIQUE, name text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','RETIRED','ARCHIVED')),
  legacy_only boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_plan_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES platform_plans(id), version_no integer NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','SUPERSEDED','RETIRED')),
  entitlement_snapshot_json jsonb NOT NULL DEFAULT '{}', quota_snapshot_json jsonb NOT NULL DEFAULT '{}', fingerprint text NOT NULL,
  activated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(plan_id,version_no), UNIQUE(id,plan_id)
);
CREATE TABLE platform_prices(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id), code text NOT NULL UNIQUE,
  price_type text NOT NULL CHECK(price_type IN('FLAT','PER_BRANCH','PER_ACTIVE_USER','PER_ACTIVE_STAFF','METERED','ADD_ON')),
  billing_interval text NOT NULL CHECK(billing_interval IN('MONTHLY','YEARLY','CUSTOM')), interval_count integer NOT NULL DEFAULT 1 CHECK(interval_count>0),
  unit_amount_minor bigint NOT NULL CHECK(unit_amount_minor>=0), currency char(3) NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ACTIVE','RETIRED')),
  meter_code text, fingerprint text NOT NULL, activated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_price_tiers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), price_id uuid NOT NULL REFERENCES platform_prices(id), up_to_quantity bigint,
  unit_amount_minor bigint NOT NULL CHECK(unit_amount_minor>=0), flat_amount_minor bigint NOT NULL DEFAULT 0 CHECK(flat_amount_minor>=0),
  CHECK(up_to_quantity IS NULL OR up_to_quantity>0), UNIQUE(price_id,up_to_quantity)
);
CREATE TABLE platform_entitlement_definitions(
  code text PRIMARY KEY, kind text NOT NULL CHECK(kind IN('FEATURE','QUOTA')), description text NOT NULL,
  unit text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_plan_entitlements(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id), entitlement_code text NOT NULL REFERENCES platform_entitlement_definitions(code),
  enabled boolean, quota_limit bigint, unlimited boolean NOT NULL DEFAULT false,
  CHECK((enabled IS NOT NULL AND quota_limit IS NULL AND unlimited=false) OR (enabled IS NULL AND ((quota_limit IS NOT NULL AND quota_limit>=0) OR unlimited=true))),
  UNIQUE(plan_version_id,entitlement_code)
);
CREATE TABLE platform_discount_definitions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, discount_type text NOT NULL CHECK(discount_type IN('FIXED_AMOUNT','PERCENTAGE_RATIONAL','FREE_TRIAL_EXTENSION')),
  amount_minor bigint, numerator bigint, denominator bigint, currency char(3), starts_at timestamptz, ends_at timestamptz,
  redemption_limit integer, plan_eligibility_json jsonb NOT NULL DEFAULT '[]', evidence_json jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
  CHECK(denominator IS NULL OR denominator>0), CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE platform_discount_redemptions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), discount_id uuid NOT NULL REFERENCES platform_discount_definitions(id),
  subscription_id uuid, evidence_snapshot_json jsonb NOT NULL, redeemed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,discount_id,subscription_id)
);

CREATE TABLE platform_billing_accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id), legal_name text NOT NULL,
  billing_email text, billing_contact_name text, billing_address_redacted_json jsonb NOT NULL DEFAULT '{}', tax_id_reference text,
  currency char(3) NOT NULL, locale text NOT NULL DEFAULT 'en-US', timezone text NOT NULL DEFAULT 'UTC',
  state text NOT NULL DEFAULT 'INCOMPLETE' CHECK(state IN('INCOMPLETE','ACTIVE','DELINQUENT','SUSPENDED','CLOSED')),
  collection_mode text NOT NULL CHECK(collection_mode IN('AUTOMATIC','MANUAL_INVOICE','DISABLED')),
  default_payment_method_id uuid, invoice_prefix text NOT NULL, invoice_sequence_version integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE platform_billing_contacts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), billing_account_id uuid NOT NULL,
  name text NOT NULL, email text NOT NULL, role text NOT NULL DEFAULT 'BILLING', active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,billing_account_id) REFERENCES platform_billing_accounts(tenant_id,id)
);
CREATE TABLE platform_payment_methods(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), billing_account_id uuid NOT NULL,
  provider text NOT NULL, provider_reference text NOT NULL, method_type text NOT NULL, display_json jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('PENDING','ACTIVE','EXPIRED','REVOKED')), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_reference), FOREIGN KEY(tenant_id,billing_account_id) REFERENCES platform_billing_accounts(tenant_id,id)
);

CREATE TABLE platform_subscriptions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), billing_account_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES platform_products(id), plan_id uuid NOT NULL REFERENCES platform_plans(id), plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id),
  status text NOT NULL CHECK(status IN('DRAFT','TRIALING','ACTIVE','PAST_DUE','GRACE','READ_ONLY','SUSPENDED','CANCEL_AT_PERIOD_END','CANCELLED','TERMINATION_PENDING','TERMINATED')),
  collection_mode text NOT NULL CHECK(collection_mode IN('AUTOMATIC','MANUAL_INVOICE','DISABLED')), current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL, trial_started_at timestamptz, trial_ends_at timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,billing_account_id) REFERENCES platform_billing_accounts(tenant_id,id), CHECK(current_period_end>current_period_start)
);
CREATE UNIQUE INDEX platform_one_live_subscription ON platform_subscriptions(tenant_id,product_id) WHERE status NOT IN('CANCELLED','TERMINATED');
CREATE UNIQUE INDEX platform_one_trial_per_tenant_product ON platform_subscriptions(tenant_id,product_id) WHERE trial_started_at IS NOT NULL;
CREATE TABLE platform_subscription_periods(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), subscription_id uuid NOT NULL REFERENCES platform_subscriptions(id),
  period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, billing_timezone text NOT NULL, plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id),
  price_snapshot_json jsonb NOT NULL, quantities_snapshot_json jsonb NOT NULL DEFAULT '{}', entitlement_snapshot_json jsonb NOT NULL,
  quota_snapshot_json jsonb NOT NULL, meter_snapshot_json jsonb NOT NULL DEFAULT '{}', discount_snapshot_json jsonb NOT NULL DEFAULT '{}', tax_policy_snapshot_json jsonb NOT NULL DEFAULT '{}',
  fingerprint text NOT NULL, invoice_id uuid, locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id,period_start), CHECK(period_end>period_start)
);
CREATE TABLE platform_subscription_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), subscription_id uuid NOT NULL REFERENCES platform_subscriptions(id),
  price_id uuid NOT NULL REFERENCES platform_prices(id), quantity bigint NOT NULL CHECK(quantity>=0), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','SCHEDULED','CANCELLED')),
  starts_at timestamptz NOT NULL, ends_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE platform_subscription_changes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), subscription_id uuid NOT NULL REFERENCES platform_subscriptions(id),
  change_type text NOT NULL CHECK(change_type IN('UPGRADE','DOWNGRADE','INTERVAL_CHANGE','QUANTITY_CHANGE','ADD_ON_CHANGE')),
  effective_mode text NOT NULL CHECK(effective_mode IN('IMMEDIATE','NEXT_PERIOD')), from_plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id),
  to_plan_version_id uuid NOT NULL REFERENCES platform_plan_versions(id), proration_minor bigint NOT NULL DEFAULT 0, currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPLIED','CANCELLED')), evidence_json jsonb NOT NULL DEFAULT '{}',
  effective_at timestamptz NOT NULL, applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_subscription_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), subscription_id uuid NOT NULL REFERENCES platform_subscriptions(id),
  from_status text, to_status text NOT NULL, actor_user_id uuid, reason text, request_id text NOT NULL, snapshot_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_entitlement_overrides(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), entitlement_code text NOT NULL REFERENCES platform_entitlement_definitions(code),
  enabled boolean, quota_limit bigint, unlimited boolean NOT NULL DEFAULT false, reason text NOT NULL, ticket_reference text NOT NULL,
  starts_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, approved_by_user_id uuid NOT NULL, revoked_at timestamptz, revoked_by_user_id uuid,
  created_by_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>starts_at)
);
CREATE TABLE platform_entitlement_projections(
  tenant_id uuid NOT NULL REFERENCES tenants(id), entitlement_code text NOT NULL REFERENCES platform_entitlement_definitions(code),
  enabled boolean, quota_limit bigint, unlimited boolean NOT NULL DEFAULT false, source_type text NOT NULL, source_id uuid,
  version bigint NOT NULL DEFAULT 1, fingerprint text NOT NULL, rebuilt_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,entitlement_code)
);
CREATE TABLE platform_quota_reservations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), entitlement_code text NOT NULL REFERENCES platform_entitlement_definitions(code),
  resource_type text NOT NULL, resource_id uuid, quantity bigint NOT NULL DEFAULT 1 CHECK(quantity>0), status text NOT NULL DEFAULT 'HELD' CHECK(status IN('HELD','COMMITTED','RELEASED','EXPIRED')),
  idempotency_fingerprint text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,idempotency_fingerprint)
);

CREATE TABLE platform_usage_meter_definitions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, unit text NOT NULL, aggregation text NOT NULL CHECK(aggregation IN('SUM','MAX','LAST')),
  version integer NOT NULL DEFAULT 1, late_event_policy text NOT NULL DEFAULT 'NEXT_PERIOD' CHECK(late_event_policy IN('REJECT','NEXT_PERIOD','CREDIT_NOTE')), active boolean NOT NULL DEFAULT true
);
CREATE TABLE platform_usage_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), meter_id uuid NOT NULL REFERENCES platform_usage_meter_definitions(id),
  source_type text NOT NULL, source_id text NOT NULL, source_fingerprint text NOT NULL, quantity bigint NOT NULL CHECK(quantity>=0), occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'RECORDED' CHECK(status IN('RECORDED','AGGREGATED','BILLED','CORRECTED','VOIDED')), metadata_json jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,meter_id,source_fingerprint)
);
CREATE TABLE platform_usage_aggregates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), meter_id uuid NOT NULL REFERENCES platform_usage_meter_definitions(id),
  period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, quantity bigint NOT NULL DEFAULT 0, version bigint NOT NULL DEFAULT 1,
  fingerprint text NOT NULL, finalized_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,meter_id,period_start)
);
CREATE TABLE platform_usage_corrections(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), usage_event_id uuid NOT NULL REFERENCES platform_usage_events(id),
  delta_quantity bigint NOT NULL CHECK(delta_quantity<>0), reason text NOT NULL, ticket_reference text NOT NULL, approved_by_user_id uuid NOT NULL,
  apply_mode text NOT NULL CHECK(apply_mode IN('NEXT_PERIOD','CREDIT_NOTE')), created_by_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_invoice_number_sequences(
  billing_account_id uuid PRIMARY KEY REFERENCES platform_billing_accounts(id), next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0), version integer NOT NULL DEFAULT 1
);
CREATE TABLE platform_invoices(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), billing_account_id uuid NOT NULL,
  subscription_id uuid REFERENCES platform_subscriptions(id), subscription_period_id uuid REFERENCES platform_subscription_periods(id), invoice_number text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','OPEN','PARTIALLY_PAID','PAID','PAST_DUE','VOID','UNCOLLECTIBLE','CREDITED')),
  currency char(3) NOT NULL, subtotal_minor bigint NOT NULL DEFAULT 0, discount_minor bigint NOT NULL DEFAULT 0, credit_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0, total_minor bigint NOT NULL DEFAULT 0, paid_minor bigint NOT NULL DEFAULT 0, refunded_minor bigint NOT NULL DEFAULT 0,
  tax_mode text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK(tax_mode IN('EXCLUSIVE','INCLUSIVE','NOT_APPLICABLE')),
  due_at timestamptz, finalized_at timestamptz, fingerprint text, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,invoice_number), UNIQUE(subscription_period_id), FOREIGN KEY(tenant_id,billing_account_id) REFERENCES platform_billing_accounts(tenant_id,id),
  CHECK(total_minor=subtotal_minor-discount_minor-credit_minor+tax_minor), CHECK(paid_minor>=0 AND refunded_minor>=0 AND refunded_minor<=paid_minor)
);
ALTER TABLE platform_subscription_periods ADD CONSTRAINT platform_period_invoice_fk FOREIGN KEY(invoice_id) REFERENCES platform_invoices(id);
CREATE TABLE platform_invoice_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL REFERENCES platform_invoices(id),
  line_type text NOT NULL CHECK(line_type IN('BASE_PLAN','SEAT','BRANCH','ADD_ON','METERED_USAGE','PRORATION','DISCOUNT','ACCOUNT_CREDIT','TAX','MANUAL_ADJUSTMENT','CREDIT_NOTE_APPLICATION')),
  description text NOT NULL, quantity bigint NOT NULL, unit_amount_minor bigint NOT NULL, total_minor bigint NOT NULL,
  source_type text, source_id uuid, snapshot_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(total_minor=quantity*unit_amount_minor)
);
CREATE TABLE platform_credit_notes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL REFERENCES platform_invoices(id),
  number text, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','FINALIZED','VOID')), currency char(3) NOT NULL,
  total_minor bigint NOT NULL DEFAULT 0 CHECK(total_minor>=0), reason text NOT NULL, evidence_json jsonb NOT NULL DEFAULT '{}', finalized_at timestamptz, fingerprint text,
  created_by_user_id uuid NOT NULL, approved_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,number)
);
CREATE TABLE platform_credit_note_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), credit_note_id uuid NOT NULL REFERENCES platform_credit_notes(id),
  description text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), source_invoice_line_id uuid REFERENCES platform_invoice_lines(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_billing_credit_ledger(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), billing_account_id uuid NOT NULL,
  entry_type text NOT NULL CHECK(entry_type IN('CREDIT_NOTE','OVERPAYMENT','MANUAL_CREDIT','PRORATION_CREDIT','CREDIT_APPLICATION','CREDIT_REVERSAL')),
  amount_minor bigint NOT NULL CHECK(amount_minor<>0), currency char(3) NOT NULL, source_type text NOT NULL, source_id uuid NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}', created_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,source_type,source_id,entry_type), FOREIGN KEY(tenant_id,billing_account_id) REFERENCES platform_billing_accounts(tenant_id,id)
);

CREATE TABLE platform_payment_intents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL REFERENCES platform_invoices(id),
  payment_method_id uuid REFERENCES platform_payment_methods(id), amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'REQUIRES_PAYMENT_METHOD' CHECK(status IN('REQUIRES_PAYMENT_METHOD','REQUIRES_CONFIRMATION','PROCESSING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN','MANUAL_REVIEW','REFUNDED','PARTIALLY_REFUNDED','DISPUTED')),
  provider text NOT NULL, provider_key text NOT NULL UNIQUE, provider_reference text, evidence_hash text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX platform_manual_payment_evidence_unique ON platform_payment_intents(evidence_hash) WHERE evidence_hash IS NOT NULL;
CREATE TABLE platform_payment_attempts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payment_intent_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK(attempt_no>0), request_json jsonb NOT NULL, response_redacted_json jsonb, outcome text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, UNIQUE(payment_intent_id,attempt_no),
  FOREIGN KEY(tenant_id,payment_intent_id) REFERENCES platform_payment_intents(tenant_id,id)
);
CREATE TABLE platform_payment_provider_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, provider_event_id text NOT NULL, signature_fingerprint text NOT NULL,
  payload_redacted_json jsonb NOT NULL, status text NOT NULL DEFAULT 'RECEIVED' CHECK(status IN('RECEIVED','PROCESSED','REJECTED','MANUAL_REVIEW')),
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, UNIQUE(provider,provider_event_id)
);
CREATE TABLE platform_refunds(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payment_intent_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL, status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','APPROVED','PROCESSING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')),
  reason text NOT NULL, evidence_json jsonb NOT NULL DEFAULT '{}', provider_key text NOT NULL UNIQUE, provider_reference text,
  requested_by_user_id uuid NOT NULL, approved_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,payment_intent_id) REFERENCES platform_payment_intents(tenant_id,id), CHECK(approved_by_user_id IS NULL OR approved_by_user_id<>requested_by_user_id)
);
CREATE TABLE platform_payment_reconciliations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), payment_intent_id uuid NOT NULL,
  expected_status text NOT NULL, observed_status text, provider_evidence_json jsonb NOT NULL DEFAULT '{}', outcome text NOT NULL CHECK(outcome IN('PENDING','MATCHED','VARIANCE','MANUAL_REVIEW')),
  reconciled_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,payment_intent_id) REFERENCES platform_payment_intents(tenant_id,id)
);

CREATE TABLE platform_dunning_policies(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, version integer NOT NULL, stages_json jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_dunning_cases(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL REFERENCES platform_invoices(id),
  policy_id uuid NOT NULL REFERENCES platform_dunning_policies(id), status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RESOLVED','CANCELLED')),
  current_stage text, next_action_at timestamptz, generation_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_dunning_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), dunning_case_id uuid NOT NULL REFERENCES platform_dunning_cases(id),
  from_stage text, to_stage text NOT NULL, generation_key text NOT NULL UNIQUE, evidence_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_access_mode_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), from_mode text, to_mode text NOT NULL,
  reason text NOT NULL, source_type text NOT NULL, source_id uuid, actor_user_id uuid, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_termination_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','RETENTION','EXPORT_READY','APPROVED','TERMINATED','CANCELLED')),
  reason text NOT NULL, retention_until timestamptz NOT NULL, legal_hold boolean NOT NULL DEFAULT false, export_ready boolean NOT NULL DEFAULT false,
  requested_by_user_id uuid NOT NULL, approved_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_onboarding_checklists(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), item_code text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','COMPLETED','SKIPPED')), completed_at timestamptz, evidence_json jsonb NOT NULL DEFAULT '{}', UNIQUE(tenant_id,item_code)
);

CREATE TABLE platform_support_access_grants(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), support_user_id uuid NOT NULL, tenant_approver_user_id uuid,
  state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN('REQUESTED','APPROVED','ACTIVE','EXPIRED','REVOKED','DENIED')),
  ticket_reference text NOT NULL, reason text NOT NULL, permission_scope_json jsonb NOT NULL, branch_scope_json jsonb NOT NULL DEFAULT '[]', data_classification_scope_json jsonb NOT NULL DEFAULT '[]',
  starts_at timestamptz, expires_at timestamptz NOT NULL, session_ttl_seconds integer NOT NULL CHECK(session_ttl_seconds BETWEEN 60 AND 14400),
  requested_by_user_id uuid NOT NULL, approved_at timestamptz, revoked_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(tenant_approver_user_id IS NULL OR tenant_approver_user_id<>support_user_id)
);
CREATE TABLE platform_support_access_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), grant_id uuid NOT NULL REFERENCES platform_support_access_grants(id),
  from_state text, to_state text NOT NULL, actor_user_id uuid NOT NULL, reason text, request_id text NOT NULL, snapshot_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_support_sessions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), grant_id uuid NOT NULL REFERENCES platform_support_access_grants(id),
  support_user_id uuid NOT NULL, token_hash text NOT NULL UNIQUE, state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN('ACTIVE','ENDED','EXPIRED','REVOKED')),
  started_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, ended_at timestamptz, last_seen_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>started_at)
);
CREATE UNIQUE INDEX platform_one_active_support_session ON platform_support_sessions(grant_id,support_user_id) WHERE state='ACTIVE';
CREATE TABLE platform_break_glass_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), requested_by_user_id uuid NOT NULL,
  first_approver_user_id uuid, second_approver_user_id uuid, incident_reference text NOT NULL, reason text NOT NULL,
  state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN('REQUESTED','APPROVED','ACTIVE','EXPIRED','REVOKED','DENIED')),
  expires_at timestamptz NOT NULL, tenant_notified_at timestamptz, review_due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(first_approver_user_id IS NULL OR first_approver_user_id<>requested_by_user_id), CHECK(second_approver_user_id IS NULL OR second_approver_user_id<>requested_by_user_id),
  CHECK(second_approver_user_id IS NULL OR first_approver_user_id IS NULL OR second_approver_user_id<>first_approver_user_id)
);
CREATE TABLE platform_billing_export_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), requested_by_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','READY','FAILED','EXPIRED')), storage_key text, expires_at timestamptz,
  filter_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION sprint13_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PLATFORM_LEDGER_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER platform_credit_ledger_append_only BEFORE UPDATE OR DELETE ON platform_billing_credit_ledger FOR EACH ROW EXECUTE FUNCTION sprint13_append_only_guard();
CREATE TRIGGER platform_usage_corrections_append_only BEFORE UPDATE OR DELETE ON platform_usage_corrections FOR EACH ROW EXECUTE FUNCTION sprint13_append_only_guard();
CREATE TRIGGER platform_subscription_history_append_only BEFORE UPDATE OR DELETE ON platform_subscription_history FOR EACH ROW EXECUTE FUNCTION sprint13_append_only_guard();
CREATE TRIGGER platform_support_history_append_only BEFORE UPDATE OR DELETE ON platform_support_access_history FOR EACH ROW EXECUTE FUNCTION sprint13_append_only_guard();

CREATE FUNCTION sprint13_used_catalog_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PLATFORM_PLAN_VERSION_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF OLD.status IN('ACTIVE','SUPERSEDED','RETIRED') AND
     (NEW.plan_id,NEW.version_no,NEW.entitlement_snapshot_json,NEW.quota_snapshot_json,NEW.fingerprint)
       IS DISTINCT FROM
     (OLD.plan_id,OLD.version_no,OLD.entitlement_snapshot_json,OLD.quota_snapshot_json,OLD.fingerprint)
  THEN RAISE EXCEPTION 'PLATFORM_PLAN_VERSION_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_plan_version_immutable BEFORE UPDATE OR DELETE ON platform_plan_versions FOR EACH ROW EXECUTE FUNCTION sprint13_used_catalog_immutable();
CREATE FUNCTION sprint13_used_price_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.status IN('ACTIVE','RETIRED') THEN RAISE EXCEPTION 'PLATFORM_PRICE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF OLD.status IN('ACTIVE','RETIRED') AND
     (NEW.plan_version_id,NEW.code,NEW.price_type,NEW.billing_interval,NEW.interval_count,NEW.unit_amount_minor,NEW.currency,NEW.meter_code,NEW.fingerprint)
       IS DISTINCT FROM
     (OLD.plan_version_id,OLD.code,OLD.price_type,OLD.billing_interval,OLD.interval_count,OLD.unit_amount_minor,OLD.currency,OLD.meter_code,OLD.fingerprint)
  THEN RAISE EXCEPTION 'PLATFORM_PRICE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_price_immutable BEFORE UPDATE OR DELETE ON platform_prices FOR EACH ROW EXECUTE FUNCTION sprint13_used_price_immutable();
CREATE FUNCTION sprint13_final_invoice_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM platform_invoices i WHERE i.id=COALESCE(NEW.invoice_id,OLD.invoice_id) AND i.finalized_at IS NOT NULL) THEN RAISE EXCEPTION 'PLATFORM_INVOICE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER platform_invoice_lines_immutable BEFORE UPDATE OR DELETE ON platform_invoice_lines FOR EACH ROW EXECUTE FUNCTION sprint13_final_invoice_immutable();
CREATE FUNCTION sprint13_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL AND ((to_jsonb(NEW)-ARRAY['status','paid_minor','refunded_minor','updated_at','version'])<>(to_jsonb(OLD)-ARRAY['status','paid_minor','refunded_minor','updated_at','version'])) THEN RAISE EXCEPTION 'PLATFORM_INVOICE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_invoice_immutable BEFORE UPDATE OR DELETE ON platform_invoices FOR EACH ROW EXECUTE FUNCTION sprint13_invoice_guard();

INSERT INTO platform_entitlement_definitions(code,kind,description,unit) VALUES
('booking.enabled','FEATURE','Booking module',NULL),('pos.enabled','FEATURE','POS module',NULL),('inventory.enabled','FEATURE','Inventory module',NULL),
('gift_card.enabled','FEATURE','Gift cards',NULL),('loyalty.enabled','FEATURE','Loyalty',NULL),('marketing.enabled','FEATURE','Marketing',NULL),
('reviews.enabled','FEATURE','Reviews',NULL),('service_recovery.enabled','FEATURE','Service recovery',NULL),('payroll.enabled','FEATURE','Payroll',NULL),
('owner_mobile.enabled','FEATURE','Owner mobile',NULL),('staff_mobile.enabled','FEATURE','Staff mobile',NULL),('api.enabled','FEATURE','API',NULL),
('multi_branch.enabled','FEATURE','Multi branch',NULL),('branches.max','QUOTA','Maximum active branches','branches'),
('active_users.max','QUOTA','Maximum active users','users'),('active_staff.max','QUOTA','Maximum active staff','staff'),
('monthly_bookings.max','QUOTA','Monthly bookings','bookings'),('marketing_email_monthly.max','QUOTA','Monthly marketing email','emails'),
('storage_bytes.max','QUOTA','Storage bytes','bytes'),('api_requests_monthly.max','QUOTA','Monthly API requests','requests');

INSERT INTO platform_products(id,code,name) VALUES('13000000-0000-4000-8000-000000000001','NAILSOFT','Nailsoft Platform');
INSERT INTO platform_plans(id,product_id,code,name,status,legacy_only) VALUES
('13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000001','LEGACY_INTERNAL','Legacy Internal','PUBLISHED',true),
('13000000-0000-4000-8000-000000000011','13000000-0000-4000-8000-000000000001','STARTER','Starter','PUBLISHED',false),
('13000000-0000-4000-8000-000000000012','13000000-0000-4000-8000-000000000001','GROWTH','Growth','PUBLISHED',false),
('13000000-0000-4000-8000-000000000013','13000000-0000-4000-8000-000000000001','PRO','Pro','PUBLISHED',false),
('13000000-0000-4000-8000-000000000014','13000000-0000-4000-8000-000000000001','ENTERPRISE','Enterprise','PUBLISHED',false);
INSERT INTO platform_plan_versions(id,plan_id,version_no,status,entitlement_snapshot_json,quota_snapshot_json,fingerprint,activated_at)
SELECT ('13000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,p.id,1,'ACTIVE','{}','{}',encode(digest(p.code||':1','sha256'),'hex'),now()
FROM platform_plans p JOIN (VALUES(10,0),(11,1),(12,2),(13,3),(14,4)) v(suffix,n) ON p.id=('13000000-0000-4000-8000-'||lpad(v.suffix::text,12,'0'))::uuid;
INSERT INTO platform_plan_entitlements(plan_version_id,entitlement_code,enabled,quota_limit,unlimited)
SELECT v.id,d.code,CASE WHEN d.kind='FEATURE' THEN true END,CASE WHEN d.kind='QUOTA' AND p.code='STARTER' THEN CASE d.code WHEN 'branches.max' THEN 1 WHEN 'active_users.max' THEN 5 WHEN 'active_staff.max' THEN 10 WHEN 'monthly_bookings.max' THEN 500 WHEN 'marketing_email_monthly.max' THEN 1000 WHEN 'storage_bytes.max' THEN 1073741824 WHEN 'api_requests_monthly.max' THEN 10000 END END,
  d.kind='QUOTA' AND p.code<>'STARTER'
FROM platform_plan_versions v JOIN platform_plans p ON p.id=v.plan_id CROSS JOIN platform_entitlement_definitions d;
INSERT INTO platform_prices(id,plan_version_id,code,price_type,billing_interval,unit_amount_minor,currency,status,fingerprint,activated_at)
SELECT gen_random_uuid(),v.id,p.code||'_MONTHLY_USD','FLAT','MONTHLY',CASE p.code WHEN 'LEGACY_INTERNAL' THEN 0 WHEN 'STARTER' THEN 4900 WHEN 'GROWTH' THEN 9900 WHEN 'PRO' THEN 19900 ELSE 0 END,'USD','ACTIVE',encode(digest(p.code||':MONTHLY:USD','sha256'),'hex'),now()
FROM platform_plan_versions v JOIN platform_plans p ON p.id=v.plan_id;

INSERT INTO platform_billing_accounts(id,tenant_id,legal_name,billing_email,currency,locale,timezone,state,collection_mode,invoice_prefix)
SELECT gen_random_uuid(),t.id,t.name,NULL,t.currency,t.default_locale,t.timezone,'ACTIVE','DISABLED','LEG-'||upper(substr(replace(t.slug,'-',''),1,8)) FROM tenants t;
INSERT INTO platform_invoice_number_sequences(billing_account_id) SELECT id FROM platform_billing_accounts;
INSERT INTO platform_subscriptions(id,tenant_id,billing_account_id,product_id,plan_id,plan_version_id,status,collection_mode,current_period_start,current_period_end)
SELECT gen_random_uuid(),a.tenant_id,a.id,'13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000100','ACTIVE','DISABLED',date_trunc('month',now()),date_trunc('month',now())+interval '100 years' FROM platform_billing_accounts a;
INSERT INTO platform_subscription_periods(tenant_id,subscription_id,period_start,period_end,billing_timezone,plan_version_id,price_snapshot_json,entitlement_snapshot_json,quota_snapshot_json,fingerprint,locked_at)
SELECT s.tenant_id,s.id,s.current_period_start,s.current_period_end,a.timezone,s.plan_version_id,'{"unitAmountMinor":0,"currency":"USD","collectionMode":"DISABLED"}',
  '{"legacy":true,"allSprint1To12Features":true}','{"unlimited":true}',encode(digest(s.id::text||':legacy','sha256'),'hex'),now()
FROM platform_subscriptions s JOIN platform_billing_accounts a ON a.id=s.billing_account_id;
INSERT INTO platform_entitlement_projections(tenant_id,entitlement_code,enabled,quota_limit,unlimited,source_type,source_id,fingerprint)
SELECT t.id,d.code,CASE WHEN d.kind='FEATURE' THEN true END,NULL,d.kind='QUOTA','LEGACY_MIGRATION',s.id,encode(digest(t.id::text||':'||d.code||':legacy','sha256'),'hex')
FROM tenants t CROSS JOIN platform_entitlement_definitions d JOIN platform_subscriptions s ON s.tenant_id=t.id;

INSERT INTO platform_usage_meter_definitions(code,unit,aggregation) VALUES
('ACTIVE_BRANCH_DAY','branch_day','SUM'),('ACTIVE_USER_DAY','user_day','SUM'),('BOOKING_CREATED','booking','SUM'),('MARKETING_EMAIL_SENT','email','SUM'),('STORAGE_BYTE_HOUR','byte_hour','SUM'),('API_REQUEST','request','SUM');
INSERT INTO platform_dunning_policies(code,version,stages_json,fingerprint) VALUES('DEFAULT_EMAIL_ONLY',1,'[{"stage":"DUE_REMINDER","days":0},{"stage":"PAYMENT_FAILED","days":1},{"stage":"GRACE_STARTED","days":3},{"stage":"READ_ONLY_STARTED","days":10}]',encode(digest('DEFAULT_EMAIL_ONLY:1','sha256'),'hex'));

INSERT INTO permissions(code,description) SELECT code,'Sprint 13 platform billing permission' FROM unnest(ARRAY[
'platform.plan.read','platform.plan.manage','platform.price.read','platform.price.manage','platform.tenant.read','platform.tenant.lifecycle.manage',
'platform.billing_account.read','platform.billing_account.manage','platform.subscription.read','platform.subscription.create','platform.subscription.change','platform.subscription.cancel','platform.subscription.reactivate',
'platform.invoice.read','platform.invoice.generate','platform.invoice.finalize','platform.invoice.void','platform.credit_note.manage','platform.payment.read','platform.payment.collect','platform.payment.retry','platform.payment.refund','platform.payment.manual_record','platform.payment.reconcile',
'platform.entitlement.read','platform.entitlement.override','platform.usage.read','platform.usage.correct','platform.support_grant.read','platform.support_grant.request','platform.support_grant.approve','platform.support_grant.revoke','platform.support_session.start','platform.report.read','platform.export',
'tenant.billing.read','tenant.billing.manage','tenant.support_grant.read','tenant.support_grant.approve'
]) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT 'PLATFORM_SUPER_ADMIN',code FROM permissions WHERE code LIKE 'platform.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code)
SELECT 'SALON_OWNER',code FROM permissions WHERE code LIKE 'tenant.%' ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0026_saas_subscription_platform_billing_entitlements');
COMMIT;
