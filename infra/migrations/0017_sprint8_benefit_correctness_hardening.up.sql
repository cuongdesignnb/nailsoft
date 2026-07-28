BEGIN;

-- Package applications are unique per covered order line. Other benefit types
-- remain unique per order/type.
ALTER TABLE pos_order_benefit_applications
  ADD COLUMN covered_order_line_id uuid;
UPDATE pos_order_benefit_applications
SET covered_order_line_id=(allocation_json->0->>'orderLineId')::uuid
WHERE benefit_type='PACKAGE' AND jsonb_array_length(allocation_json)>0;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pos_order_benefit_applications WHERE benefit_type='PACKAGE' AND covered_order_line_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill PACKAGE benefit order-line allocation';
  END IF;
END $$;
ALTER TABLE pos_order_benefit_applications
  ADD CONSTRAINT benefit_application_covered_line_fk
    FOREIGN KEY(tenant_id,covered_order_line_id) REFERENCES pos_order_lines(tenant_id,id),
  ADD CONSTRAINT benefit_application_package_line_check
    CHECK(benefit_type<>'PACKAGE' OR covered_order_line_id IS NOT NULL);
DROP INDEX pos_order_one_active_benefit_type;
CREATE UNIQUE INDEX pos_order_one_active_nonpackage_benefit_type
  ON pos_order_benefit_applications(tenant_id,pos_order_id,benefit_type)
  WHERE status='RESERVED' AND benefit_type<>'PACKAGE';
CREATE UNIQUE INDEX pos_order_one_active_package_per_line
  ON pos_order_benefit_applications(tenant_id,pos_order_id,covered_order_line_id)
  WHERE status='RESERVED' AND benefit_type='PACKAGE';

-- Preserve the requested/accepted loyalty redemption contract and allocate
-- FIFO lots when the reservation is created, not when it is committed.
ALTER TABLE loyalty_reservations
  ADD COLUMN requested_points bigint,
  ADD COLUMN accepted_points bigint,
  ADD COLUMN unused_points bigint;
UPDATE loyalty_reservations
SET requested_points=points,accepted_points=points,unused_points=0;
ALTER TABLE loyalty_reservations
  ALTER COLUMN requested_points SET NOT NULL,
  ALTER COLUMN accepted_points SET NOT NULL,
  ALTER COLUMN unused_points SET NOT NULL,
  ADD CONSTRAINT loyalty_reservation_point_contract_check
    CHECK(requested_points>0 AND accepted_points=points AND accepted_points>0 AND unused_points=requested_points-accepted_points AND unused_points>=0);

ALTER TABLE loyalty_point_lots
  ADD COLUMN reserved_points bigint NOT NULL DEFAULT 0 CHECK(reserved_points>=0),
  DROP CONSTRAINT loyalty_point_lots_status_check,
  ADD CONSTRAINT loyalty_point_lots_status_check CHECK(status IN('AVAILABLE','RESERVED','EXHAUSTED','EXPIRED')),
  ADD CONSTRAINT loyalty_point_lots_balance_check CHECK(available_points+reserved_points<=original_points);
ALTER TABLE loyalty_redemption_lot_allocations
  ADD COLUMN status text NOT NULL DEFAULT 'COMMITTED' CHECK(status IN('RESERVED','COMMITTED','RELEASED','EXPIRED')),
  ADD COLUMN consumed_at timestamptz,
  ADD COLUMN released_at timestamptz;
UPDATE loyalty_redemption_lot_allocations SET consumed_at=created_at WHERE status='COMMITTED';
CREATE INDEX loyalty_reserved_lot_allocations_idx
  ON loyalty_redemption_lot_allocations(tenant_id,reservation_id,status);

-- Serialized projection for campaign/customer capacity. Numeric net usage
-- allows proportional voucher reversals without pretending a partial refund
-- restored a whole code use.
ALTER TABLE voucher_redemption_entries
  ALTER COLUMN use_delta TYPE numeric(12,6) USING use_delta::numeric;
CREATE TABLE voucher_customer_usage (
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  active_reservations integer NOT NULL DEFAULT 0 CHECK(active_reservations>=0),
  net_committed_uses numeric(12,6) NOT NULL DEFAULT 0 CHECK(net_committed_uses>=0),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,campaign_id,customer_id),
  FOREIGN KEY(tenant_id,campaign_id) REFERENCES voucher_campaigns(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
INSERT INTO voucher_customer_usage(tenant_id,campaign_id,customer_id,active_reservations,net_committed_uses)
SELECT c.tenant_id,c.campaign_id,c.customer_id,
  (SELECT count(*)::int FROM voucher_reservations r
   WHERE r.tenant_id=c.tenant_id AND r.campaign_id=c.campaign_id AND r.customer_id=c.customer_id AND r.status='ACTIVE'),
  GREATEST(0,COALESCE((SELECT sum(e.use_delta) FROM voucher_redemption_entries e
    JOIN voucher_codes vc ON vc.tenant_id=e.tenant_id AND vc.id=e.voucher_code_id
    WHERE e.tenant_id=c.tenant_id AND vc.campaign_id=c.campaign_id AND e.customer_id=c.customer_id),0))
FROM (SELECT DISTINCT tenant_id,campaign_id,customer_id FROM voucher_reservations) c;

-- Immutable line/application settlement evidence used by refund reversal.
CREATE TABLE benefit_application_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  benefit_application_id uuid NOT NULL,
  pos_order_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  invoice_line_id uuid,
  allocated_amount_minor bigint NOT NULL CHECK(allocated_amount_minor>=0),
  allocated_points bigint NOT NULL DEFAULT 0 CHECK(allocated_points>=0),
  allocated_units integer NOT NULL DEFAULT 0 CHECK(allocated_units>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,benefit_application_id,order_line_id),
  FOREIGN KEY(tenant_id,benefit_application_id) REFERENCES pos_order_benefit_applications(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,order_line_id) REFERENCES pos_order_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_line_id) REFERENCES invoice_lines(tenant_id,id)
);
INSERT INTO benefit_application_allocations(
  tenant_id,benefit_application_id,pos_order_id,order_line_id,invoice_line_id,
  allocated_amount_minor,allocated_units
)
SELECT a.tenant_id,a.id,a.pos_order_id,a.covered_order_line_id,il.id,a.amount_minor,a.units
FROM pos_order_benefit_applications a
LEFT JOIN invoices i ON i.tenant_id=a.tenant_id AND i.pos_order_id=a.pos_order_id
LEFT JOIN invoice_lines il ON il.tenant_id=i.tenant_id AND il.invoice_id=i.id AND il.source_order_line_id=a.covered_order_line_id
WHERE a.benefit_type='PACKAGE';

CREATE TABLE benefit_refund_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  refund_id uuid NOT NULL,
  refund_item_id uuid NOT NULL,
  benefit_application_id uuid NOT NULL,
  application_allocation_id uuid NOT NULL,
  refunded_line_minor bigint NOT NULL CHECK(refunded_line_minor>0),
  reversed_benefit_minor bigint NOT NULL DEFAULT 0 CHECK(reversed_benefit_minor>=0),
  restored_points bigint NOT NULL DEFAULT 0 CHECK(restored_points>=0),
  restored_units integer NOT NULL DEFAULT 0 CHECK(restored_units>=0),
  restored_use numeric(12,6) NOT NULL DEFAULT 0 CHECK(restored_use>=0 AND restored_use<=1),
  outcome text NOT NULL CHECK(outcome IN('REVERSED','NO_ACTION','MANUAL_REVIEW')),
  policy_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,refund_id,application_allocation_id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_item_id) REFERENCES refund_items(tenant_id,id),
  FOREIGN KEY(tenant_id,benefit_application_id) REFERENCES pos_order_benefit_applications(tenant_id,id),
  FOREIGN KEY(tenant_id,application_allocation_id) REFERENCES benefit_application_allocations(tenant_id,id)
);
CREATE TRIGGER benefit_application_allocations_append_only
  BEFORE UPDATE OR DELETE ON benefit_application_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint8_append_only_guard();
CREATE TRIGGER benefit_refund_allocations_append_only
  BEFORE UPDATE OR DELETE ON benefit_refund_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint8_append_only_guard();

-- Manual assignments are protected from automatic tier evaluation.
ALTER TABLE customer_membership_assignments
  ADD COLUMN assignment_source text NOT NULL DEFAULT 'AUTOMATIC' CHECK(assignment_source IN('AUTOMATIC','MANUAL')),
  ADD COLUMN grace_until timestamptz;
UPDATE customer_membership_assignments
SET assignment_source=CASE WHEN COALESCE(reason_code,'') LIKE 'MANUAL%' THEN 'MANUAL' ELSE 'AUTOMATIC' END;

-- One source of truth for rolling and lifetime membership metrics. Refund tip
-- is excluded because it was never eligible spend.
CREATE FUNCTION sprint8_membership_metrics(
  p_tenant uuid,p_customer uuid,p_as_of timestamptz,p_window_days integer DEFAULT NULL
) RETURNS TABLE(spend_minor bigint,visit_count bigint)
LANGUAGE sql STABLE AS $$
  WITH evidence AS (
    SELECT i.id,i.total_minor,i.issued_at,
      COALESCE((SELECT sum(r.service_refund_minor+r.tax_refund_minor)
        FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id
        AND r.status='COMPLETED' AND r.completed_at<=p_as_of),0)::bigint refunded_minor
    FROM invoices i JOIN pos_orders o ON o.tenant_id=i.tenant_id AND o.id=i.pos_order_id
    WHERE i.tenant_id=p_tenant AND o.customer_id=p_customer AND i.status='ISSUED'
      AND i.issued_at<=p_as_of
      AND (p_window_days IS NULL OR i.issued_at>p_as_of-make_interval(days=>p_window_days))
  ), net AS (
    SELECT GREATEST(total_minor-refunded_minor,0)::bigint amount FROM evidence
  )
  SELECT COALESCE(sum(amount),0)::bigint,count(*) FILTER(WHERE amount>0)::bigint FROM net
$$;

-- Failed work is isolated and has bounded retry/dead-letter metadata.
ALTER TABLE benefit_jobs
  DROP CONSTRAINT benefit_jobs_status_check,
  ADD CONSTRAINT benefit_jobs_status_check CHECK(status IN('PENDING','PROCESSING','COMPLETED','FAILED','DEAD_LETTER')),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 100),
  ADD COLUMN last_error_code varchar(100),
  ADD COLUMN last_error_message varchar(500),
  ADD COLUMN completed_at timestamptz;
CREATE INDEX benefit_jobs_lease_recovery_idx ON benefit_jobs(lease_until,id) WHERE status='PROCESSING';

INSERT INTO schema_migrations(version) VALUES('0017_sprint8_benefit_correctness_hardening');
COMMIT;
