BEGIN;

-- A financial transaction is attributed to the register selected while the
-- order is still an unpaid draft. Existing rows are assigned deterministically
-- so upgrades preserve Sprint 6 data without inventing cross-branch links.
UPDATE pos_orders o
SET register_id = (
      SELECT r.id
      FROM pos_registers r
      WHERE r.tenant_id=o.tenant_id AND r.branch_id=o.branch_id
      ORDER BY (r.status='ACTIVE') DESC,r.code,r.id
      LIMIT 1
    ),
    updated_at = now()
WHERE o.register_id IS NULL AND o.status <> 'DRAFT';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pos_orders WHERE status <> 'DRAFT' AND register_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot attribute every finalized POS order to a register';
  END IF;
END $$;

ALTER TABLE cash_drawers
  ADD CONSTRAINT cash_drawers_tenant_id_id_register_key UNIQUE(tenant_id,id,register_id);
ALTER TABLE cash_sessions
  ADD CONSTRAINT cash_sessions_tenant_id_id_register_key UNIQUE(tenant_id,id,register_id),
  ADD CONSTRAINT cash_sessions_drawer_register_fk
    FOREIGN KEY(tenant_id,cash_drawer_id,register_id)
    REFERENCES cash_drawers(tenant_id,id,register_id);
ALTER TABLE pos_orders
  ADD CONSTRAINT pos_orders_tenant_id_id_register_key UNIQUE(tenant_id,id,register_id),
  ADD CONSTRAINT pos_orders_finalized_register_required
    CHECK (status='DRAFT' OR register_id IS NOT NULL);

ALTER TABLE payments ADD COLUMN register_id uuid;

-- Captured payments are immutable at runtime. Temporarily suspend the guard
-- only for this controlled, deterministic migration backfill.
ALTER TABLE payments DISABLE TRIGGER captured_payment_immutable;
UPDATE payments p
SET register_id = COALESCE(
  (SELECT cs.register_id
     FROM cash_sessions cs
    WHERE cs.tenant_id=p.tenant_id AND cs.id=p.cash_session_id),
  (SELECT o.register_id
     FROM pos_orders o
    WHERE o.tenant_id=p.tenant_id AND o.id=p.pos_order_id)
);
ALTER TABLE payments ENABLE TRIGGER captured_payment_immutable;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payments WHERE register_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot attribute every payment to a register';
  END IF;
END $$;

ALTER TABLE payments
  ALTER COLUMN register_id SET NOT NULL,
  ADD CONSTRAINT payments_register_fk
    FOREIGN KEY(tenant_id,register_id) REFERENCES pos_registers(tenant_id,id),
  ADD CONSTRAINT payments_order_register_fk
    FOREIGN KEY(tenant_id,pos_order_id,register_id)
    REFERENCES pos_orders(tenant_id,id,register_id),
  ADD CONSTRAINT payments_cash_session_register_fk
    FOREIGN KEY(tenant_id,cash_session_id,register_id)
    REFERENCES cash_sessions(tenant_id,id,register_id);

CREATE INDEX payments_register_captured_idx
  ON payments(tenant_id,branch_id,register_id,captured_at,id)
  WHERE status='CAPTURED';
CREATE INDEX payments_cashier_captured_idx
  ON payments(tenant_id,branch_id,created_by_user_id,captured_at,id)
  WHERE status='CAPTURED';

CREATE FUNCTION sprint6_order_register_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.register_id IS DISTINCT FROM OLD.register_id AND
     (OLD.status <> 'DRAFT' OR OLD.pricing_locked_at IS NOT NULL OR
      EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id=OLD.tenant_id AND p.pos_order_id=OLD.id)) THEN
    RAISE EXCEPTION 'POS order register is immutable after finalization or payment' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_order_register_immutable
  BEFORE UPDATE OF register_id ON pos_orders
  FOR EACH ROW EXECUTE FUNCTION sprint6_order_register_guard();

INSERT INTO schema_migrations(version)
VALUES('0013_sprint6_financial_attribution_hardening');
COMMIT;
