BEGIN;

ALTER TABLE stored_value_settings
  ADD COLUMN daily_reload_limit_minor bigint NOT NULL DEFAULT 25000000 CHECK(daily_reload_limit_minor>0),
  ADD COLUMN reserve_attempt_limit integer NOT NULL DEFAULT 10 CHECK(reserve_attempt_limit BETWEEN 3 AND 100);

ALTER TABLE gift_cards
  ADD COLUMN issuance_branch_id uuid,
  ADD COLUMN last_activity_branch_id uuid,
  ADD COLUMN replaces_gift_card_id uuid,
  ADD COLUMN replacement_reason varchar(1000),
  ADD COLUMN replacement_authorization_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN legal_policy_id uuid,
  ADD COLUMN legal_policy_version integer,
  ADD COLUMN jurisdiction varchar(80),
  ADD COLUMN expiration_mode text NOT NULL DEFAULT 'NO_EXPIRATION'
    CHECK(expiration_mode IN('NO_EXPIRATION','FIXED_DATE','DAYS_AFTER_ACTIVATION','DAYS_AFTER_LAST_ACTIVITY'));

UPDATE gift_cards g SET
  issuance_branch_id=o.branch_id,
  last_activity_branch_id=o.branch_id
FROM pos_orders o
WHERE o.tenant_id=g.tenant_id AND o.id=g.source_order_id;

UPDATE gift_cards SET
  legal_policy_id=NULLIF(policy_snapshot_json->>'legalPolicyId','')::uuid,
  legal_policy_version=NULLIF(policy_snapshot_json->>'legalPolicyVersion','')::integer,
  jurisdiction=policy_snapshot_json->>'jurisdiction',
  expiration_mode=COALESCE(NULLIF(policy_snapshot_json->>'expirationMode',''),'NO_EXPIRATION');

ALTER TABLE gift_cards
  ADD CONSTRAINT gift_cards_issuance_branch_fk FOREIGN KEY(tenant_id,issuance_branch_id) REFERENCES branches(tenant_id,id),
  ADD CONSTRAINT gift_cards_last_activity_branch_fk FOREIGN KEY(tenant_id,last_activity_branch_id) REFERENCES branches(tenant_id,id),
  ADD CONSTRAINT gift_cards_replaces_fk FOREIGN KEY(tenant_id,replaces_gift_card_id) REFERENCES gift_cards(tenant_id,id),
  ADD CONSTRAINT gift_cards_legal_policy_fk FOREIGN KEY(tenant_id,legal_policy_id) REFERENCES stored_value_legal_policies(tenant_id,id);
CREATE INDEX gift_cards_branch_scope_idx ON gift_cards(tenant_id,COALESCE(last_activity_branch_id,issuance_branch_id),created_at DESC,id);

ALTER TABLE stored_value_reservations
  ADD COLUMN branch_id uuid,
  ADD COLUMN eligibility_snapshot_json jsonb NOT NULL DEFAULT '{}';
UPDATE stored_value_reservations r SET branch_id=o.branch_id
FROM pos_orders o WHERE o.tenant_id=r.tenant_id AND o.id=r.order_id;
ALTER TABLE stored_value_reservations ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE stored_value_reservations ADD CONSTRAINT stored_value_reservation_branch_fk
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id);

ALTER TABLE pos_order_stored_value_applications
  ADD COLUMN redemption_plan_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN eligibility_snapshot_json jsonb NOT NULL DEFAULT '{}';

ALTER TABLE stored_value_ledger_entries ADD COLUMN branch_id uuid;
UPDATE stored_value_ledger_entries l SET branch_id=o.branch_id
FROM pos_orders o WHERE o.tenant_id=l.tenant_id AND o.id=l.order_id;
UPDATE stored_value_ledger_entries l SET branch_id=r.branch_id
FROM refunds r WHERE l.branch_id IS NULL AND r.tenant_id=l.tenant_id AND r.id=l.refund_id;
ALTER TABLE stored_value_ledger_entries ADD CONSTRAINT stored_value_ledger_branch_fk
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id);
CREATE INDEX stored_value_ledger_branch_idx ON stored_value_ledger_entries(tenant_id,branch_id,occurred_at DESC,id);

CREATE TABLE stored_value_funding_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, payment_id uuid NOT NULL,
  order_id uuid NOT NULL, order_line_id uuid NOT NULL, gift_card_id uuid NOT NULL, branch_id uuid NOT NULL,
  funding_type text NOT NULL CHECK(funding_type IN('ACTIVATION','RELOAD')),
  allocated_minor bigint NOT NULL CHECK(allocated_minor>0), currency char(3) NOT NULL,
  generation_key varchar(180) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id),
  FOREIGN KEY(tenant_id,order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,order_line_id) REFERENCES pos_order_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX stored_value_funding_payment_idx ON stored_value_funding_allocations(tenant_id,payment_id,id);
CREATE INDEX stored_value_funding_card_idx ON stored_value_funding_allocations(tenant_id,gift_card_id,created_at,id);
CREATE TRIGGER stored_value_funding_append_only BEFORE UPDATE OR DELETE ON stored_value_funding_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint10_append_only_guard();

CREATE FUNCTION sprint10_funding_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE; allocated bigint; line_allocated bigint; order_funded bigint; line_row pos_order_lines%ROWTYPE;
BEGIN
  SELECT * INTO p FROM payments WHERE tenant_id=NEW.tenant_id AND id=NEW.payment_id FOR UPDATE;
  IF NOT FOUND OR p.status<>'CAPTURED' OR p.pos_order_id<>NEW.order_id OR p.branch_id<>NEW.branch_id OR p.currency<>NEW.currency THEN
    RAISE EXCEPTION 'STORED_VALUE_FUNDING_NOT_CAPTURED' USING ERRCODE='23514';
  END IF;
  SELECT * INTO line_row FROM pos_order_lines WHERE tenant_id=NEW.tenant_id AND id=NEW.order_line_id;
  IF NOT FOUND OR line_row.pos_order_id<>NEW.order_id OR line_row.line_type<>'GIFT_CARD' OR line_row.gift_card_id<>NEW.gift_card_id THEN
    RAISE EXCEPTION 'STORED_VALUE_FUNDING_LINE_INVALID' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(allocated_minor),0) INTO allocated FROM stored_value_funding_allocations
   WHERE tenant_id=NEW.tenant_id AND payment_id=NEW.payment_id;
  SELECT COALESCE(sum(amount_minor),0) INTO order_funded FROM payment_allocations
   WHERE tenant_id=NEW.tenant_id AND payment_id=NEW.payment_id AND pos_order_id=NEW.order_id AND allocation_type='ORDER_TOTAL';
  IF allocated+NEW.allocated_minor>LEAST(p.captured_minor,order_funded) THEN
    RAISE EXCEPTION 'STORED_VALUE_FUNDING_OVERALLOCATED' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(allocated_minor),0) INTO line_allocated FROM stored_value_funding_allocations
   WHERE tenant_id=NEW.tenant_id AND order_line_id=NEW.order_line_id;
  IF line_allocated+NEW.allocated_minor>line_row.net_minor THEN
    RAISE EXCEPTION 'STORED_VALUE_FUNDING_LINE_OVERALLOCATED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stored_value_funding_allocation_guard BEFORE INSERT ON stored_value_funding_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint10_funding_allocation_guard();

-- Backfill only evidence that is already exact. Ambiguous legacy reloads or split
-- funding remain reconciliation exceptions; no payment attribution is invented.
WITH candidates AS (
  SELECT g.tenant_id,g.source_payment_id payment_id,g.source_order_id order_id,
         g.source_order_line_id order_line_id,g.id gift_card_id,o.branch_id,
         l.net_minor allocated_minor,g.currency,p.captured_minor,
         COALESCE((SELECT sum(pa.amount_minor) FROM payment_allocations pa
           WHERE pa.tenant_id=p.tenant_id AND pa.payment_id=p.id
             AND pa.pos_order_id=p.pos_order_id AND pa.allocation_type='ORDER_TOTAL'),0) order_funded_minor,
         sum(l.net_minor) OVER(PARTITION BY g.tenant_id,g.source_payment_id) payment_cards_minor
    FROM gift_cards g
    JOIN pos_orders o ON o.tenant_id=g.tenant_id AND o.id=g.source_order_id
    JOIN pos_order_lines l ON l.tenant_id=g.tenant_id AND l.id=g.source_order_line_id
    JOIN payments p ON p.tenant_id=g.tenant_id AND p.id=g.source_payment_id
   WHERE g.source_payment_id IS NOT NULL AND p.status='CAPTURED'
     AND l.line_type='GIFT_CARD' AND l.gift_card_id=g.id
)
INSERT INTO stored_value_funding_allocations(
  tenant_id,payment_id,order_id,order_line_id,gift_card_id,branch_id,funding_type,
  allocated_minor,currency,generation_key
)
SELECT tenant_id,payment_id,order_id,order_line_id,gift_card_id,branch_id,'ACTIVATION',
       allocated_minor,currency,'sprint10-backfill:activation:'||gift_card_id
FROM candidates
WHERE payment_cards_minor<=LEAST(captured_minor,order_funded_minor)
ORDER BY tenant_id,payment_id,order_line_id;

CREATE TABLE stored_value_settlement_line_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  application_id uuid NOT NULL, settlement_allocation_id uuid NOT NULL,
  order_line_id uuid NOT NULL, invoice_line_id uuid NOT NULL,
  allocated_minor bigint NOT NULL CHECK(allocated_minor>0), currency char(3) NOT NULL,
  eligibility_snapshot_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,settlement_allocation_id,invoice_line_id),
  FOREIGN KEY(tenant_id,application_id) REFERENCES pos_order_stored_value_applications(tenant_id,id),
  FOREIGN KEY(tenant_id,settlement_allocation_id) REFERENCES stored_value_settlement_allocations(tenant_id,id),
  FOREIGN KEY(tenant_id,order_line_id) REFERENCES pos_order_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_line_id) REFERENCES invoice_lines(tenant_id,id)
);
CREATE INDEX stored_value_settlement_line_invoice_idx ON stored_value_settlement_line_allocations(tenant_id,invoice_line_id,id);
CREATE TRIGGER stored_value_settlement_line_append_only BEFORE UPDATE OR DELETE ON stored_value_settlement_line_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint10_append_only_guard();

CREATE FUNCTION sprint10_settlement_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_amount bigint; allocated bigint;
BEGIN
  SELECT amount_minor INTO parent_amount FROM stored_value_settlement_allocations
   WHERE tenant_id=NEW.tenant_id AND id=NEW.settlement_allocation_id FOR UPDATE;
  SELECT COALESCE(sum(allocated_minor),0) INTO allocated FROM stored_value_settlement_line_allocations
   WHERE tenant_id=NEW.tenant_id AND settlement_allocation_id=NEW.settlement_allocation_id;
  IF parent_amount IS NULL OR allocated+NEW.allocated_minor>parent_amount THEN
    RAISE EXCEPTION 'STORED_VALUE_SETTLEMENT_LINE_OVERALLOCATED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stored_value_settlement_line_guard BEFORE INSERT ON stored_value_settlement_line_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint10_settlement_line_guard();

ALTER TABLE stored_value_refund_allocations ADD COLUMN settlement_line_allocation_id uuid;
ALTER TABLE stored_value_refund_allocations ADD CONSTRAINT stored_value_refund_line_fk
  FOREIGN KEY(tenant_id,settlement_line_allocation_id) REFERENCES stored_value_settlement_line_allocations(tenant_id,id);

CREATE FUNCTION sprint10_refund_line_restore_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_amount bigint; restored bigint;
BEGIN
  IF NEW.destination<>'ORIGINAL_STORED_VALUE' OR NEW.settlement_line_allocation_id IS NULL THEN RETURN NEW; END IF;
  SELECT allocated_minor INTO line_amount FROM stored_value_settlement_line_allocations
   WHERE tenant_id=NEW.tenant_id AND id=NEW.settlement_line_allocation_id FOR UPDATE;
  SELECT COALESCE(sum(amount_minor),0) INTO restored FROM stored_value_refund_allocations
   WHERE tenant_id=NEW.tenant_id AND settlement_line_allocation_id=NEW.settlement_line_allocation_id;
  IF line_amount IS NULL OR restored+NEW.amount_minor>line_amount THEN
    RAISE EXCEPTION 'STORED_VALUE_REFUND_LINE_OVER_RESTORE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stored_value_refund_line_restore_guard BEFORE INSERT ON stored_value_refund_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint10_refund_line_restore_guard();

CREATE TABLE refund_stored_value_line_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, refund_id uuid NOT NULL,
  settlement_allocation_id uuid NOT NULL, settlement_line_allocation_id uuid NOT NULL, account_id uuid NOT NULL,
  planned_minor bigint NOT NULL CHECK(planned_minor>0), completed_minor bigint NOT NULL DEFAULT 0
    CHECK(completed_minor>=0 AND completed_minor<=planned_minor), currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','COMPLETED','CANCELLED')),
  ledger_entry_id uuid, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,refund_id,settlement_line_allocation_id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,settlement_allocation_id) REFERENCES stored_value_settlement_allocations(tenant_id,id),
  FOREIGN KEY(tenant_id,settlement_line_allocation_id) REFERENCES stored_value_settlement_line_allocations(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id),
  FOREIGN KEY(tenant_id,ledger_entry_id) REFERENCES stored_value_ledger_entries(tenant_id,id)
);

CREATE TABLE stored_value_velocity_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, local_date date NOT NULL,
  action text NOT NULL CHECK(action IN('ISSUE','REDEEM','RELOAD','LOOKUP','RESERVE')),
  branch_id uuid NOT NULL, actor_user_id uuid NOT NULL, device_key_hash varchar(128) NOT NULL DEFAULT 'NO_DEVICE',
  customer_id uuid, account_id uuid, operation_count integer NOT NULL DEFAULT 0 CHECK(operation_count>=0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK(amount_minor>=0), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), CONSTRAINT stored_value_velocity_unique UNIQUE NULLS NOT DISTINCT(tenant_id,local_date,action,branch_id,actor_user_id,device_key_hash,customer_id,account_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);
CREATE INDEX stored_value_velocity_query_idx ON stored_value_velocity_counters(tenant_id,local_date,action,branch_id);

CREATE TABLE stored_value_high_value_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, action text NOT NULL,
  branch_id uuid NOT NULL, account_id uuid, gift_card_id uuid, amount_minor bigint NOT NULL CHECK(amount_minor>0),
  reason text NOT NULL CHECK(length(trim(reason))>=3), approved_by_user_id uuid NOT NULL,
  request_id varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,request_id,action),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES stored_value_accounts(tenant_id,id),
  FOREIGN KEY(tenant_id,gift_card_id) REFERENCES gift_cards(tenant_id,id),
  FOREIGN KEY(approved_by_user_id) REFERENCES users(id)
);
CREATE TRIGGER stored_value_high_value_append_only BEFORE UPDATE OR DELETE ON stored_value_high_value_approvals
  FOR EACH ROW EXECUTE FUNCTION sprint10_append_only_guard();

ALTER TABLE stored_value_adjustment_requests ADD COLUMN branch_id uuid;
ALTER TABLE stored_value_adjustment_requests ADD CONSTRAINT stored_value_adjustment_branch_fk
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id);

-- Existing records without deterministic order/line/branch attribution stay visible to owners
-- but are deliberately not given fabricated allocations. Reconciliation owns their resolution.
INSERT INTO stored_value_reconciliation_exceptions(
  tenant_id,account_id,exception_type,currency,expected_minor,actual_minor,details_json,generation_key
)
SELECT a.tenant_id,a.id,'FUNDING_ALLOCATION_BACKFILL_REQUIRED',a.currency,a.lifetime_issued_minor,0,
       jsonb_build_object('giftCardId',a.gift_card_id,'failClosed',true),
       'sprint10-closure:funding:'||a.id
FROM stored_value_accounts a JOIN gift_cards g ON g.tenant_id=a.tenant_id AND g.id=a.gift_card_id
WHERE a.account_type='GIFT_CARD' AND a.lifetime_issued_minor>0
  AND a.lifetime_issued_minor<>(SELECT COALESCE(sum(f.allocated_minor),0)
    FROM stored_value_funding_allocations f WHERE f.tenant_id=a.tenant_id AND f.gift_card_id=g.id)
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0020_sprint10_stored_value_correctness_hardening');
COMMIT;
