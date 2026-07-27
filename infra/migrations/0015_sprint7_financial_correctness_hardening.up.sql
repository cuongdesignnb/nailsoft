BEGIN;

ALTER TABLE refund_payment_allocations
  DROP CONSTRAINT refund_payment_allocations_provider_provider_refund_id_key,
  ADD COLUMN original_register_id uuid,
  ADD COLUMN original_cash_session_id uuid,
  ADD COLUMN execution_cash_session_id uuid;

CREATE FUNCTION sprint7_refund_cash_attribution_init() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tender_type='CASH' THEN
    NEW.original_register_id=COALESCE(NEW.original_register_id,NEW.refund_register_id);
    NEW.original_cash_session_id=COALESCE(NEW.original_cash_session_id,NEW.cash_session_id);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER refund_cash_attribution_init
  BEFORE INSERT ON refund_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION sprint7_refund_cash_attribution_init();

UPDATE refund_payment_allocations
SET original_register_id = refund_register_id,
    original_cash_session_id = cash_session_id
WHERE tender_type = 'CASH';

ALTER TABLE refund_payment_allocations
  ADD CONSTRAINT refund_allocations_original_register_fk
    FOREIGN KEY(tenant_id,original_register_id) REFERENCES pos_registers(tenant_id,id),
  ADD CONSTRAINT refund_allocations_original_session_fk
    FOREIGN KEY(tenant_id,original_cash_session_id) REFERENCES cash_sessions(tenant_id,id),
  ADD CONSTRAINT refund_allocations_execution_session_fk
    FOREIGN KEY(tenant_id,execution_cash_session_id) REFERENCES cash_sessions(tenant_id,id),
  ADD CONSTRAINT refund_allocations_cash_attribution_check CHECK(
    tender_type <> 'CASH' OR
    (original_register_id IS NOT NULL AND original_cash_session_id IS NOT NULL)
  );

CREATE UNIQUE INDEX refund_allocations_tenant_provider_reference_unique
  ON refund_payment_allocations(tenant_id,provider,provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

DROP VIEW staff_net_tip;
CREATE VIEW staff_net_tip AS
SELECT a.tenant_id,a.staff_id,sum(a.amount_minor)::bigint gross_tip_minor,
       COALESCE((
         SELECT sum(rta.amount_minor)
         FROM refund_tip_allocations rta
         JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id
         JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id
         WHERE rta.tenant_id=a.tenant_id AND rta.staff_id=a.staff_id AND r.status='COMPLETED'
       ),0)::bigint refunded_tip_minor,
       (sum(a.amount_minor)-COALESCE((
         SELECT sum(rta.amount_minor)
         FROM refund_tip_allocations rta
         JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id
         JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id
         WHERE rta.tenant_id=a.tenant_id AND rta.staff_id=a.staff_id AND r.status='COMPLETED'
       ),0))::bigint net_tip_minor
FROM pos_tip_allocations a
JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id
WHERE t.status='ACTIVE'
GROUP BY a.tenant_id,a.staff_id;

ALTER TABLE commission_entries
  ALTER COLUMN invoice_id DROP NOT NULL,
  ADD COLUMN adjustment_request_id uuid,
  ADD CONSTRAINT commission_entries_adjustment_request_fk
    FOREIGN KEY(tenant_id,adjustment_request_id)
    REFERENCES commission_adjustment_requests(tenant_id,id);

UPDATE commission_entries
SET adjustment_request_id=(source_snapshot_json->>'adjustmentRequestId')::uuid
WHERE entry_type='MANUAL_ADJUSTMENT'
  AND source_snapshot_json ? 'adjustmentRequestId';

ALTER TABLE commission_entries
  ADD CONSTRAINT commission_entries_source_attribution_check CHECK(
    (entry_type='MANUAL_ADJUSTMENT' AND adjustment_request_id IS NOT NULL)
    OR
    (entry_type<>'MANUAL_ADJUSTMENT' AND invoice_id IS NOT NULL AND adjustment_request_id IS NULL)
  );

CREATE UNIQUE INDEX commission_entries_one_adjustment_request
  ON commission_entries(tenant_id,adjustment_request_id)
  WHERE adjustment_request_id IS NOT NULL;

-- Legacy Sprint 0 fixtures could contain ambiguous active rules with exactly
-- the same normalized scope and priority. Keep the deterministic first rule
-- active and retain the others as immutable, queryable inactive history.
CREATE TABLE sprint7_rule_overlap_reconciliation(
  rule_id uuid PRIMARY KEY REFERENCES commission_rules(id),
  previous_status text NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sprint7_rule_overlap_reconciliation(rule_id,previous_status)
SELECT r.id,r.status FROM commission_rules r
WHERE r.status='ACTIVE' AND EXISTS(
  SELECT 1 FROM commission_rules winner
  WHERE winner.status='ACTIVE' AND winner.tenant_id=r.tenant_id
    AND COALESCE(winner.branch_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE(r.branch_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(winner.staff_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE(r.staff_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(winner.service_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE(r.service_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND winner.priority=r.priority
    AND tstzrange(winner.effective_from,COALESCE(winner.effective_to,'infinity'),'[)') && tstzrange(r.effective_from,COALESCE(r.effective_to,'infinity'),'[)')
    AND (winner.effective_from,winner.rule_code,winner.id)>(r.effective_from,r.rule_code,r.id)
);
UPDATE commission_rules r SET status='INACTIVE'
FROM sprint7_rule_overlap_reconciliation x WHERE x.rule_id=r.id;

ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_active_scope_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    (COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE(staff_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE(service_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    priority WITH =,
    (tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)')) WITH &&
  ) WHERE(status='ACTIVE');

CREATE OR REPLACE FUNCTION sprint7_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND TG_TABLE_NAME='commission_entries'
     AND OLD.period_id IS NULL
     AND NEW.period_id IS NOT NULL
     AND NEW.status='LOCKED'
     AND (to_jsonb(NEW)-ARRAY['period_id','status'])=(to_jsonb(OLD)-ARRAY['period_id','status'])
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'financial history is append-only' USING ERRCODE='55000';
END
$$;

CREATE INDEX commission_adjustments_period_status_idx
  ON commission_adjustment_requests(tenant_id,target_period_id,posting_period_id,status);
CREATE INDEX commission_entries_refund_original_idx
  ON commission_entries(tenant_id,original_entry_id,refund_id)
  WHERE original_entry_id IS NOT NULL;

INSERT INTO schema_migrations(version)
VALUES('0015_sprint7_financial_correctness_hardening');

COMMIT;
