BEGIN;

-- Sprint 15 correctness closure. 0031 remains immutable; this migration only
-- adds evidence, version guards and source-event idempotency.
ALTER TABLE procurement_purchase_request_approvals
  ADD COLUMN IF NOT EXISTS allocation_json jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS allocation_fingerprint text;
ALTER TABLE procurement_purchase_order_versions
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE procurement_purchase_order_lines
  ADD COLUMN IF NOT EXISTS economics_fingerprint text;
ALTER TABLE procurement_receipts
  ADD COLUMN IF NOT EXISTS reversal_requested_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversal_approved_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE procurement_bill_match_results
  ADD COLUMN IF NOT EXISTS tax_variance_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_variance_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency_result char(3),
  ADD COLUMN IF NOT EXISTS policy_version integer,
  ADD COLUMN IF NOT EXISTS po_fingerprint text,
  ADD COLUMN IF NOT EXISTS receipt_fingerprint text,
  ADD COLUMN IF NOT EXISTS bill_fingerprint text;
ALTER TABLE procurement_bill_match_overrides
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_fingerprint text,
  ADD COLUMN IF NOT EXISTS approved_snapshot_json jsonb;
ALTER TABLE procurement_payment_proposals
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE procurement_payment_reservations
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE procurement_vendor_payments
  ADD COLUMN IF NOT EXISTS allocation_plan_fingerprint text,
  ADD COLUMN IF NOT EXISTS reversal_requested_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversal_approved_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE procurement_vendor_credit_applications
  ADD COLUMN IF NOT EXISTS evidence_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id);
ALTER TABLE procurement_vendor_payments DROP CONSTRAINT IF EXISTS procurement_vendor_payments_status_check;
ALTER TABLE procurement_vendor_payments ADD CONSTRAINT procurement_vendor_payments_status_check CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','PROCESSING','SUCCEEDED','FAILED','UNKNOWN','MANUAL_REVIEW','REVERSAL_PENDING','REVERSED','CANCELLED'));
ALTER TABLE procurement_vendor_credit_notes DROP CONSTRAINT IF EXISTS procurement_vendor_credit_notes_status_check;
ALTER TABLE procurement_vendor_credit_notes ADD CONSTRAINT procurement_vendor_credit_notes_status_check CHECK(status IN('DRAFT','SUBMITTED','PENDING_APPROVAL','REJECTED','APPROVED','POSTING','POSTED','FAILED','PARTIALLY_APPLIED','APPLIED','VOID_PENDING','VOID'));

CREATE TABLE procurement_inventory_source_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  source_type text NOT NULL, source_id uuid NOT NULL, operation text NOT NULL,
  branch_id uuid NOT NULL, item_id uuid NOT NULL, location_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK(quantity>0), unit_cost_minor numeric(20,6) NOT NULL DEFAULT 0,
  inventory_ledger_entry_id uuid, compensates_event_id uuid, state text NOT NULL DEFAULT 'PENDING'
    CHECK(state IN('PENDING','POSTED','REVERSED','MANUAL_REVIEW')),
  fingerprint text NOT NULL, request_id text NOT NULL, created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
  UNIQUE(tenant_id,source_type,source_id,operation,item_id,location_id),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES inventory_items(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_locations(tenant_id,branch_id,id),
  FOREIGN KEY(tenant_id,inventory_ledger_entry_id) REFERENCES inventory_stock_ledger_entries(tenant_id,id),
  FOREIGN KEY(tenant_id,compensates_event_id) REFERENCES procurement_inventory_source_events(tenant_id,id)
);
CREATE INDEX procurement_inventory_source_events_source_idx ON procurement_inventory_source_events(tenant_id,source_type,source_id,state);

CREATE TABLE procurement_expense_bills(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL,
  vendor_id uuid, category_id uuid NOT NULL, bill_number text NOT NULL, currency char(3) NOT NULL,
  expense_date date NOT NULL, subtotal_minor bigint NOT NULL CHECK(subtotal_minor>=0), tax_minor bigint NOT NULL DEFAULT 0 CHECK(tax_minor>=0),
  total_minor bigint NOT NULL CHECK(total_minor>=0), status text NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN('DRAFT','SUBMITTED','PENDING_APPROVAL','APPROVED','POSTED','VOID_PENDING','VOIDED')),
  requested_by_user_id uuid NOT NULL, approved_by_user_id uuid, version integer NOT NULL DEFAULT 1,
  fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,bill_number),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,vendor_id) REFERENCES procurement_vendors(tenant_id,id),
  FOREIGN KEY(tenant_id,category_id) REFERENCES procurement_expense_categories(tenant_id,id),
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id), FOREIGN KEY(approved_by_user_id) REFERENCES users(id),
  CHECK(approved_by_user_id IS NULL OR approved_by_user_id<>requested_by_user_id)
);
CREATE TABLE procurement_expense_bill_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, expense_bill_id uuid NOT NULL,
  description text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>=0), account_id uuid,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,expense_bill_id) REFERENCES procurement_expense_bills(tenant_id,id)
);
CREATE TABLE procurement_ap_write_off_approvals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, open_item_id uuid NOT NULL,
  request_id uuid NOT NULL, approver_user_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN('APPROVED','REJECTED')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0), reason text NOT NULL, evidence_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,request_id,approver_user_id),
  FOREIGN KEY(tenant_id,open_item_id) REFERENCES procurement_ap_open_items(tenant_id,id), FOREIGN KEY(approver_user_id) REFERENCES users(id)
);
CREATE TABLE procurement_vendor_remittance_deliveries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vendor_payment_id uuid NOT NULL,
  destination text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENT','FAILED')),
  provider_message_id text, evidence_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
  UNIQUE(tenant_id,vendor_payment_id,destination), FOREIGN KEY(tenant_id,vendor_payment_id) REFERENCES procurement_vendor_payments(tenant_id,id)
);
CREATE TABLE procurement_po_email_deliveries(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, purchase_order_id uuid NOT NULL,
  destination text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENT','FAILED')),
  provider_message_id text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
  UNIQUE(tenant_id,purchase_order_id,destination), FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES procurement_purchase_orders(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS procurement_vendor_contacts_idx ON procurement_vendor_contacts(tenant_id,vendor_id,is_primary);
CREATE INDEX IF NOT EXISTS procurement_vendor_payment_methods_idx ON procurement_vendor_payment_methods(tenant_id,vendor_id,status);

CREATE OR REPLACE FUNCTION procurement_status_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'PROCUREMENT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF TG_TABLE_NAME='procurement_receipts' THEN allowed := (OLD.status,NEW.status) IN (('DRAFT','RECEIVED'),('DRAFT','REJECTED'),('RECEIVED','PARTIALLY_ACCEPTED'),('RECEIVED','ACCEPTED'),('RECEIVED','REJECTED'),('PARTIALLY_ACCEPTED','ACCEPTED'),('PARTIALLY_ACCEPTED','REVERSED'),('ACCEPTED','REVERSED'));
  ELSIF TG_TABLE_NAME='procurement_payment_proposals' THEN allowed := (OLD.status,NEW.status) IN (('DRAFT','PENDING_APPROVAL'),('DRAFT','CANCELLED'),('PENDING_APPROVAL','APPROVED'),('PENDING_APPROVAL','REJECTED'),('PENDING_APPROVAL','CANCELLED'),('APPROVED','PROCESSING'),('APPROVED','CANCELLED'),('PROCESSING','PARTIALLY_COMPLETED'),('PROCESSING','COMPLETED'),('PROCESSING','FAILED'));
  ELSIF TG_TABLE_NAME='procurement_vendor_payments' THEN allowed := (OLD.status,NEW.status) IN (('DRAFT','PENDING_APPROVAL'),('DRAFT','CANCELLED'),('PENDING_APPROVAL','APPROVED'),('PENDING_APPROVAL','FAILED'),('PENDING_APPROVAL','CANCELLED'),('APPROVED','PROCESSING'),('PROCESSING','SUCCEEDED'),('PROCESSING','FAILED'),('PROCESSING','UNKNOWN'),('UNKNOWN','MANUAL_REVIEW'),('UNKNOWN','SUCCEEDED'),('UNKNOWN','FAILED'),('SUCCEEDED','REVERSAL_PENDING'),('REVERSAL_PENDING','REVERSED'));
  ELSIF TG_TABLE_NAME='procurement_vendor_credit_notes' THEN allowed := (OLD.status,NEW.status) IN (('DRAFT','SUBMITTED'),('DRAFT','VOID'),('SUBMITTED','PENDING_APPROVAL'),('SUBMITTED','REJECTED'),('PENDING_APPROVAL','APPROVED'),('PENDING_APPROVAL','REJECTED'),('APPROVED','POSTING'),('POSTING','POSTED'),('POSTING','FAILED'),('POSTED','PARTIALLY_APPLIED'),('POSTED','APPLIED'),('POSTED','VOID_PENDING'));
  ELSIF TG_TABLE_NAME='procurement_vendor_returns' THEN allowed := (OLD.status,NEW.status) IN (('DRAFT','PENDING_APPROVAL'),('DRAFT','CANCELLED'),('PENDING_APPROVAL','APPROVED'),('PENDING_APPROVAL','REJECTED'),('APPROVED','DISPATCHED'),('APPROVED','CANCELLED'),('DISPATCHED','RECEIVED_BY_VENDOR'),('RECEIVED_BY_VENDOR','CREDIT_PENDING'),('RECEIVED_BY_VENDOR','COMPLETED'),('CREDIT_PENDING','COMPLETED'));
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'PROCUREMENT_STATUS_TRANSITION_INVALID' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procurement_receipt_transition_guard BEFORE UPDATE ON procurement_receipts FOR EACH ROW EXECUTE FUNCTION procurement_status_transition_guard();
CREATE TRIGGER procurement_payment_proposal_transition_guard BEFORE UPDATE ON procurement_payment_proposals FOR EACH ROW EXECUTE FUNCTION procurement_status_transition_guard();
CREATE TRIGGER procurement_vendor_payment_transition_guard BEFORE UPDATE ON procurement_vendor_payments FOR EACH ROW EXECUTE FUNCTION procurement_status_transition_guard();
CREATE TRIGGER procurement_credit_note_transition_guard BEFORE UPDATE ON procurement_vendor_credit_notes FOR EACH ROW EXECUTE FUNCTION procurement_status_transition_guard();
CREATE TRIGGER procurement_vendor_return_transition_guard BEFORE UPDATE ON procurement_vendor_returns FOR EACH ROW EXECUTE FUNCTION procurement_status_transition_guard();

CREATE OR REPLACE FUNCTION procurement_posted_bill_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('POSTED','PARTIALLY_PAID','PAID','CREDITED','VOID_PENDING','VOIDED') AND (NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.total_minor IS DISTINCT FROM OLD.total_minor OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor OR NEW.normalized_invoice_number IS DISTINCT FROM OLD.normalized_invoice_number) THEN
    RAISE EXCEPTION 'POSTED_BILL_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procurement_posted_bill_immutable BEFORE UPDATE ON procurement_vendor_bills FOR EACH ROW EXECUTE FUNCTION procurement_posted_bill_immutable();
CREATE OR REPLACE FUNCTION procurement_posted_bill_line_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill_status text;
BEGIN
  SELECT status INTO bill_status FROM procurement_vendor_bills WHERE tenant_id=COALESCE(NEW.tenant_id,OLD.tenant_id) AND id=COALESCE(NEW.vendor_bill_id,OLD.vendor_bill_id);
  IF bill_status IN ('POSTED','PARTIALLY_PAID','PAID','CREDITED','VOID_PENDING','VOIDED') AND (TG_OP='DELETE' OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.unit_price_minor IS DISTINCT FROM OLD.unit_price_minor OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor) THEN
    RAISE EXCEPTION 'POSTED_BILL_LINE_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER procurement_posted_bill_line_immutable BEFORE UPDATE OR DELETE ON procurement_vendor_bill_lines FOR EACH ROW EXECUTE FUNCTION procurement_posted_bill_line_immutable();

CREATE OR REPLACE FUNCTION procurement_partial_approval_po_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_row record; request_line record;
BEGIN
  SELECT pr.status INTO request_row FROM procurement_purchase_requests pr WHERE pr.tenant_id=NEW.tenant_id AND pr.id=(SELECT purchase_request_id FROM procurement_purchase_orders WHERE tenant_id=NEW.tenant_id AND id=NEW.purchase_order_id);
  IF request_row.status='PARTIALLY_APPROVED' THEN
    SELECT l.approved_quantity,l.approved_amount_minor INTO request_line FROM procurement_purchase_request_lines l JOIN procurement_purchase_orders po ON po.tenant_id=l.tenant_id AND po.purchase_request_id=(SELECT purchase_request_id FROM procurement_purchase_orders WHERE tenant_id=NEW.tenant_id AND id=NEW.purchase_order_id) WHERE l.tenant_id=NEW.tenant_id AND l.line_no=NEW.line_no;
    IF request_line.approved_quantity IS NULL OR request_line.approved_quantity<=0 OR request_line.approved_amount_minor<=0 THEN RAISE EXCEPTION 'UNAPPROVED_PURCHASE_REQUEST_LINE'; END IF;
    NEW.ordered_quantity := request_line.approved_quantity;
    NEW.amount_minor := request_line.approved_amount_minor;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER procurement_partial_approval_po_guard BEFORE INSERT ON procurement_purchase_order_lines FOR EACH ROW EXECUTE FUNCTION procurement_partial_approval_po_guard();

INSERT INTO permissions(code,description) SELECT code,'Sprint 15 correctness closure permission' FROM unnest(ARRAY[
 'procurement.receipt.reverse','procurement.bill.void','procurement.payment.reverse','procurement.expense.create','procurement.expense.approve','procurement.ap.write_off','procurement.report.read','procurement.vendor.contact.manage','procurement.vendor.payment_method.manage'
]) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT r.role,p.code FROM unnest(ARRAY['SALON_OWNER','BRANCH_MANAGER','ACCOUNTANT']) r(role) JOIN permissions p ON p.code IN('procurement.vendor.contact.manage','procurement.vendor.payment_method.manage','procurement.expense.create','procurement.expense.approve','procurement.ap.write_off','procurement.report.read') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('0032_sprint15_procurement_correctness_closure');
COMMIT;
