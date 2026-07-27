BEGIN;

CREATE TABLE refund_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  fiscal_year integer NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 9999),
  prefix varchar(20) NOT NULL DEFAULT 'RF',
  last_number bigint NOT NULL DEFAULT 0 CHECK(last_number>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,branch_id,fiscal_year),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  branch_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  pos_order_id uuid NOT NULL,
  customer_id uuid,
  refund_reference varchar(80) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PENDING_APPROVAL','APPROVED','PROCESSING','COMPLETED','FAILED','UNKNOWN','REJECTED','CANCELLED')),
  currency char(3) NOT NULL,
  requested_minor bigint NOT NULL CHECK(requested_minor>=0),
  approved_minor bigint CHECK(approved_minor>=0),
  completed_minor bigint NOT NULL DEFAULT 0 CHECK(completed_minor>=0),
  service_refund_minor bigint NOT NULL DEFAULT 0 CHECK(service_refund_minor>=0),
  tax_refund_minor bigint NOT NULL DEFAULT 0 CHECK(tax_refund_minor>=0),
  tip_refund_minor bigint NOT NULL DEFAULT 0 CHECK(tip_refund_minor>=0),
  reason_code varchar(80) NOT NULL,
  reason_text text NOT NULL,
  policy_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  approval_reason text,
  rejected_by_user_id uuid,
  rejection_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  processing_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,refund_reference),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id),
  FOREIGN KEY(tenant_id,pos_order_id) REFERENCES pos_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id),
  FOREIGN KEY(approved_by_user_id) REFERENCES users(id),
  FOREIGN KEY(rejected_by_user_id) REFERENCES users(id),
  CHECK(completed_minor<=requested_minor),
  CHECK(approved_minor IS NULL OR completed_minor<=approved_minor),
  CHECK(status<>'COMPLETED' OR (completed_minor>0 AND completed_at IS NOT NULL)),
  CHECK(status<>'COMPLETED' OR completed_minor=service_refund_minor+tax_refund_minor+tip_refund_minor),
  CHECK(status<>'APPROVED' OR (approved_minor IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK(status<>'REJECTED' OR (rejected_by_user_id IS NOT NULL AND rejection_reason IS NOT NULL)),
  CHECK(status<>'CANCELLED' OR cancelled_at IS NOT NULL)
);

CREATE TABLE refund_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  refund_id uuid NOT NULL,
  item_type text NOT NULL CHECK(item_type IN('INVOICE_LINE','TIP')),
  invoice_line_id uuid,
  quantity numeric(12,3) CHECK(quantity IS NULL OR quantity>0),
  gross_refund_minor bigint NOT NULL CHECK(gross_refund_minor>=0),
  discount_reversal_minor bigint NOT NULL DEFAULT 0 CHECK(discount_reversal_minor>=0),
  taxable_refund_minor bigint NOT NULL CHECK(taxable_refund_minor>=0),
  tax_refund_minor bigint NOT NULL CHECK(tax_refund_minor>=0),
  tip_refund_minor bigint NOT NULL DEFAULT 0 CHECK(tip_refund_minor>=0),
  total_refund_minor bigint NOT NULL CHECK(total_refund_minor>0),
  source_snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_line_id) REFERENCES invoice_lines(tenant_id,id),
  CHECK((item_type='INVOICE_LINE' AND invoice_line_id IS NOT NULL) OR (item_type='TIP' AND invoice_line_id IS NULL)),
  CHECK(total_refund_minor=taxable_refund_minor+tax_refund_minor+tip_refund_minor)
);

CREATE TABLE refund_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  refund_id uuid NOT NULL,
  original_payment_id uuid NOT NULL,
  tender_type text NOT NULL CHECK(tender_type IN('CASH','CARD_EXTERNAL','BANK_TRANSFER','OTHER_EXTERNAL')),
  planned_minor bigint NOT NULL CHECK(planned_minor>0),
  completed_minor bigint NOT NULL DEFAULT 0 CHECK(completed_minor>=0),
  refund_register_id uuid,
  cash_session_id uuid,
  provider varchar(100),
  provider_refund_id varchar(200),
  status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN('PLANNED','PROCESSING','COMPLETED','FAILED','UNKNOWN')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,refund_id,original_payment_id),
  UNIQUE(provider,provider_refund_id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,original_payment_id) REFERENCES payments(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_register_id) REFERENCES pos_registers(tenant_id,id),
  FOREIGN KEY(tenant_id,cash_session_id) REFERENCES cash_sessions(tenant_id,id),
  CHECK(completed_minor<=planned_minor),
  CHECK(tender_type<>'CASH' OR (refund_register_id IS NOT NULL AND cash_session_id IS NOT NULL)),
  CHECK(status<>'COMPLETED' OR (completed_minor>0 AND completed_at IS NOT NULL))
);

CREATE TABLE refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  refund_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK(attempt_no>0),
  provider varchar(100) NOT NULL,
  provider_idempotency_key_hash varchar(128) NOT NULL,
  request_json_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_json_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text NOT NULL CHECK(result IN('SUCCESS','FAILED','UNKNOWN')),
  error_code varchar(100),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,allocation_id,attempt_no),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,allocation_id) REFERENCES refund_payment_allocations(tenant_id,id)
);

CREATE TABLE refund_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  refund_id uuid NOT NULL, from_status text, to_status text NOT NULL,
  actor_user_id uuid, actor_type text NOT NULL CHECK(actor_type IN('USER','SYSTEM','PROVIDER')),
  reason_code varchar(80), note text, request_id varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE TABLE refund_tip_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  refund_item_id uuid NOT NULL, original_tip_allocation_id uuid NOT NULL, staff_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  allocation_basis text NOT NULL CHECK(allocation_basis IN('PRO_RATA_ORIGINAL','MANUAL')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,refund_item_id,original_tip_allocation_id),
  FOREIGN KEY(tenant_id,refund_item_id) REFERENCES refund_items(tenant_id,id),
  FOREIGN KEY(tenant_id,original_tip_allocation_id) REFERENCES pos_tip_allocations(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id)
);

CREATE TABLE credit_note_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  fiscal_year integer NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 9999), prefix varchar(20) NOT NULL DEFAULT 'CN',
  last_number bigint NOT NULL DEFAULT 0 CHECK(last_number>=0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,branch_id,fiscal_year), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);

CREATE TABLE credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  refund_id uuid NOT NULL, original_invoice_id uuid NOT NULL, credit_note_number varchar(80) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ISSUED')), currency char(3) NOT NULL,
  gross_minor bigint NOT NULL CHECK(gross_minor>=0), discount_reversal_minor bigint NOT NULL CHECK(discount_reversal_minor>=0),
  taxable_minor bigint NOT NULL CHECK(taxable_minor>=0), tax_minor bigint NOT NULL CHECK(tax_minor>=0),
  tip_minor bigint NOT NULL CHECK(tip_minor>=0), total_minor bigint NOT NULL CHECK(total_minor>0),
  customer_snapshot_json jsonb NOT NULL, branch_snapshot_json jsonb NOT NULL, original_invoice_snapshot_json jsonb NOT NULL,
  issued_at timestamptz, issued_by_user_id uuid, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,refund_id), UNIQUE(tenant_id,branch_id,credit_note_number),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id),
  FOREIGN KEY(tenant_id,original_invoice_id) REFERENCES invoices(tenant_id,id), FOREIGN KEY(issued_by_user_id) REFERENCES users(id),
  CHECK(total_minor=taxable_minor+tax_minor+tip_minor), CHECK(status<>'ISSUED' OR (issued_at IS NOT NULL AND issued_by_user_id IS NOT NULL))
);

CREATE TABLE credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), credit_note_id uuid NOT NULL,
  line_no integer NOT NULL CHECK(line_no>0), refund_item_id uuid NOT NULL, original_invoice_line_id uuid,
  description_snapshot_json jsonb NOT NULL, quantity numeric(12,3), gross_minor bigint NOT NULL CHECK(gross_minor>=0),
  discount_reversal_minor bigint NOT NULL CHECK(discount_reversal_minor>=0), taxable_minor bigint NOT NULL CHECK(taxable_minor>=0),
  tax_minor bigint NOT NULL CHECK(tax_minor>=0), tip_minor bigint NOT NULL CHECK(tip_minor>=0), total_minor bigint NOT NULL CHECK(total_minor>0),
  tax_snapshot_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,credit_note_id,line_no),
  FOREIGN KEY(tenant_id,credit_note_id) REFERENCES credit_notes(tenant_id,id), FOREIGN KEY(tenant_id,refund_item_id) REFERENCES refund_items(tenant_id,id),
  FOREIGN KEY(tenant_id,original_invoice_line_id) REFERENCES invoice_lines(tenant_id,id), CHECK(total_minor=taxable_minor+tax_minor+tip_minor)
);

-- Evolve the Sprint 0 placeholder table in place so legacy rules remain
-- traceable. Legacy name/rule_json columns are retained for rollback.
ALTER TABLE commission_rules
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN rule_json DROP NOT NULL,
  ADD COLUMN branch_id uuid,
  ADD COLUMN staff_id uuid,
  ADD COLUMN service_id uuid,
  ADD COLUMN rule_code varchar(80),
  ADD COLUMN rule_type text,
  ADD COLUMN base_mode text,
  ADD COLUMN percent_basis_points integer,
  ADD COLUMN fixed_minor bigint,
  ADD COLUMN currency char(3),
  ADD COLUMN priority integer NOT NULL DEFAULT 0,
  ADD COLUMN policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN effective_from timestamptz,
  ADD COLUMN effective_to timestamptz,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN created_by_user_id uuid,
  ADD COLUMN supersedes_rule_id uuid,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE commission_rules r SET
  rule_code=COALESCE(NULLIF(regexp_replace(upper(r.name),'[^A-Z0-9]+','-','g'),''),'LEGACY-'||r.id::text),
  rule_type='SERVICE_PERCENT',base_mode='NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX',percent_basis_points=0,
  policy_json=COALESCE(r.rule_json,'{}'::jsonb),effective_from='1970-01-01 00:00:00+00',
  status=CASE WHEN upper(r.status)='ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
  created_by_user_id=(SELECT u.id FROM users u WHERE u.origin_tenant_id=r.tenant_id ORDER BY u.id LIMIT 1);
ALTER TABLE commission_rules
  ALTER COLUMN rule_code SET NOT NULL,
  ALTER COLUMN rule_type SET NOT NULL,
  ALTER COLUMN base_mode SET NOT NULL,
  ALTER COLUMN effective_from SET NOT NULL,
  ALTER COLUMN created_by_user_id SET NOT NULL,
  ADD CONSTRAINT commission_rules_tenant_id_id_key UNIQUE(tenant_id,id),
  ADD CONSTRAINT commission_rules_tenant_code_version_key UNIQUE(tenant_id,rule_code,version),
  ADD CONSTRAINT commission_rules_branch_fk FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  ADD CONSTRAINT commission_rules_staff_fk FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  ADD CONSTRAINT commission_rules_service_fk FOREIGN KEY(tenant_id,service_id) REFERENCES services(tenant_id,id),
  ADD CONSTRAINT commission_rules_created_by_fk FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  ADD CONSTRAINT commission_rules_supersedes_fk FOREIGN KEY(tenant_id,supersedes_rule_id) REFERENCES commission_rules(tenant_id,id),
  ADD CONSTRAINT commission_rules_status_check CHECK(status IN('ACTIVE','INACTIVE')),
  ADD CONSTRAINT commission_rules_type_check CHECK(rule_type IN('SERVICE_PERCENT','SERVICE_FIXED')),
  ADD CONSTRAINT commission_rules_base_check CHECK(base_mode IN('NET_SERVICE_AFTER_DISCOUNT_BEFORE_TAX','GROSS_SERVICE_BEFORE_DISCOUNT','FIXED_PER_COMPLETED_SERVICE')),
  ADD CONSTRAINT commission_rules_percent_check CHECK(percent_basis_points IS NULL OR percent_basis_points BETWEEN 0 AND 10000),
  ADD CONSTRAINT commission_rules_fixed_check CHECK(fixed_minor IS NULL OR fixed_minor>=0),
  ADD CONSTRAINT commission_rules_version_check CHECK(version>0),
  ADD CONSTRAINT commission_rules_effective_check CHECK(effective_to IS NULL OR effective_to>effective_from),
  ADD CONSTRAINT commission_rules_value_check CHECK((rule_type='SERVICE_PERCENT' AND percent_basis_points IS NOT NULL AND fixed_minor IS NULL) OR (rule_type='SERVICE_FIXED' AND fixed_minor IS NOT NULL AND percent_basis_points IS NULL));

CREATE TABLE commission_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), code varchar(80) NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','REVIEW','LOCKED')),
  currency char(3) NOT NULL, totals_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb, integrity_hash varchar(128),
  review_started_at timestamptz, review_started_by_user_id uuid, locked_at timestamptz, locked_by_user_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), FOREIGN KEY(review_started_by_user_id) REFERENCES users(id),
  FOREIGN KEY(locked_by_user_id) REFERENCES users(id), CHECK(end_date>=start_date),
  CHECK(status<>'LOCKED' OR (locked_at IS NOT NULL AND locked_by_user_id IS NOT NULL AND integrity_hash IS NOT NULL))
);
ALTER TABLE commission_periods ADD CONSTRAINT commission_periods_no_overlap EXCLUDE USING gist
  (tenant_id WITH =, daterange(start_date,end_date,'[]') WITH &&);

CREATE TABLE commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, staff_id uuid NOT NULL,
  invoice_id uuid NOT NULL, invoice_line_id uuid, service_session_id uuid, original_entry_id uuid, refund_id uuid, credit_note_id uuid,
  entry_type text NOT NULL CHECK(entry_type IN('EARNING','REFUND_REVERSAL','LOCKED_PERIOD_REFUND_ADJUSTMENT','MANUAL_ADJUSTMENT')),
  business_date date NOT NULL, currency char(3) NOT NULL, base_minor bigint NOT NULL, commission_minor bigint NOT NULL,
  contribution_basis_json jsonb NOT NULL, rule_snapshot_json jsonb NOT NULL, source_snapshot_json jsonb NOT NULL,
  generation_key varchar(200) NOT NULL, status text NOT NULL CHECK(status IN('GENERATED','REVIEWED','LOCKED','UNRESOLVED')),
  period_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,generation_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id), FOREIGN KEY(tenant_id,invoice_line_id) REFERENCES invoice_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,service_session_id) REFERENCES service_sessions(tenant_id,id), FOREIGN KEY(tenant_id,original_entry_id) REFERENCES commission_entries(tenant_id,id),
  FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id), FOREIGN KEY(tenant_id,credit_note_id) REFERENCES credit_notes(tenant_id,id),
  FOREIGN KEY(tenant_id,period_id) REFERENCES commission_periods(tenant_id,id)
);

CREATE TABLE commission_generation_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), invoice_id uuid NOT NULL,
  invoice_line_id uuid, staff_id uuid, conflict_code varchar(100) NOT NULL, context_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RESOLVED','WAIVED')), resolved_by_user_id uuid,
  resolution_note text, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id), FOREIGN KEY(tenant_id,invoice_line_id) REFERENCES invoice_lines(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id), FOREIGN KEY(resolved_by_user_id) REFERENCES users(id)
);

CREATE TABLE commission_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), staff_id uuid NOT NULL,
  target_period_id uuid NOT NULL, posting_period_id uuid, amount_minor bigint NOT NULL CHECK(amount_minor<>0), currency char(3) NOT NULL,
  reason_code varchar(80) NOT NULL, note text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by_user_id uuid NOT NULL, decided_by_user_id uuid, decision_reason text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  version integer NOT NULL DEFAULT 1, UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id),
  FOREIGN KEY(tenant_id,target_period_id) REFERENCES commission_periods(tenant_id,id), FOREIGN KEY(tenant_id,posting_period_id) REFERENCES commission_periods(tenant_id,id),
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id), FOREIGN KEY(decided_by_user_id) REFERENCES users(id),
  CHECK(status='PENDING' OR status='CANCELLED' OR (decided_by_user_id IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE commission_period_staff_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), period_id uuid NOT NULL, staff_id uuid NOT NULL,
  currency char(3) NOT NULL, earning_minor bigint NOT NULL, refund_reversal_minor bigint NOT NULL, manual_adjustment_minor bigint NOT NULL,
  payable_minor bigint NOT NULL, detail_hash varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,period_id,staff_id), FOREIGN KEY(tenant_id,period_id) REFERENCES commission_periods(tenant_id,id),
  FOREIGN KEY(tenant_id,staff_id) REFERENCES staff_profiles(tenant_id,id)
);

CREATE TABLE financial_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid,
  export_type text NOT NULL CHECK(export_type IN('REFUNDS','CREDIT_NOTES','COMMISSION_ENTRIES','COMMISSION_STATEMENTS','NET_SALES')),
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','READY','FAILED','EXPIRED')),
  storage_key varchar(500), requested_by_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, expires_at timestamptz,
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(requested_by_user_id) REFERENCES users(id)
);

ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_movement_type_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_movement_type_check
  CHECK(movement_type IN('OPENING_FLOAT','CASH_SALE','CASH_IN','CASH_OUT','CASH_DROP','CLOSING_ADJUSTMENT','CASH_REFUND'));
ALTER TABLE cash_movements ADD COLUMN related_refund_id uuid;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_refund_fk FOREIGN KEY(tenant_id,related_refund_id) REFERENCES refunds(tenant_id,id);
CREATE UNIQUE INDEX cash_movements_one_refund_idx ON cash_movements(tenant_id,related_refund_id) WHERE related_refund_id IS NOT NULL;

CREATE VIEW invoice_refund_summary AS
SELECT i.tenant_id,i.id invoice_id,
       COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0)::bigint captured_minor,
       COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)::bigint completed_refund_minor,
       GREATEST(0,COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0)-COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0))::bigint refundable_minor,
       CASE WHEN COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)=0 THEN 'PAID'
            WHEN COALESCE((SELECT sum(r.completed_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0)>=COALESCE((SELECT sum(p.captured_minor) FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id AND p.status='CAPTURED'),0) THEN 'REFUNDED'
            ELSE 'PARTIALLY_REFUNDED' END financial_status
FROM invoices i WHERE i.status='ISSUED';

CREATE VIEW payment_refund_balance AS
SELECT p.tenant_id,p.id payment_id,p.captured_minor,
       COALESCE((SELECT sum(a.completed_minor) FROM refund_payment_allocations a WHERE a.tenant_id=p.tenant_id AND a.original_payment_id=p.id AND a.status='COMPLETED'),0)::bigint completed_refund_minor,
       GREATEST(0,p.captured_minor-COALESCE((SELECT sum(a.completed_minor) FROM refund_payment_allocations a WHERE a.tenant_id=p.tenant_id AND a.original_payment_id=p.id AND a.status='COMPLETED'),0))::bigint refundable_minor
FROM payments p WHERE p.status='CAPTURED';

CREATE VIEW invoice_line_refund_balance AS
SELECT l.tenant_id,l.id invoice_line_id,l.net_minor line_net_minor,
       COALESCE((SELECT sum(ri.total_refund_minor) FROM refund_items ri JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id WHERE ri.tenant_id=l.tenant_id AND ri.invoice_line_id=l.id AND r.status='COMPLETED'),0)::bigint completed_refund_minor,
       GREATEST(0,l.net_minor-COALESCE((SELECT sum(ri.total_refund_minor) FROM refund_items ri JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id WHERE ri.tenant_id=l.tenant_id AND ri.invoice_line_id=l.id AND r.status='COMPLETED'),0))::bigint refundable_minor
FROM invoice_lines l;

CREATE VIEW staff_net_tip AS
SELECT t.tenant_id,t.staff_id,sum(t.amount_minor)::bigint gross_tip_minor,
       COALESCE((SELECT sum(rta.amount_minor) FROM refund_tip_allocations rta JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id WHERE rta.tenant_id=t.tenant_id AND rta.staff_id=t.staff_id AND r.status='COMPLETED'),0)::bigint refunded_tip_minor,
       (sum(t.amount_minor)-COALESCE((SELECT sum(rta.amount_minor) FROM refund_tip_allocations rta JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id WHERE rta.tenant_id=t.tenant_id AND rta.staff_id=t.staff_id AND r.status='COMPLETED'),0))::bigint net_tip_minor
FROM pos_tip_allocations t GROUP BY t.tenant_id,t.staff_id;

CREATE FUNCTION sprint7_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'financial history is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER refund_items_append_only BEFORE UPDATE OR DELETE ON refund_items FOR EACH ROW EXECUTE FUNCTION sprint7_append_only_guard();
CREATE TRIGGER refund_attempts_append_only BEFORE UPDATE OR DELETE ON refund_attempts FOR EACH ROW EXECUTE FUNCTION sprint7_append_only_guard();
CREATE TRIGGER refund_history_append_only BEFORE UPDATE OR DELETE ON refund_status_history FOR EACH ROW EXECUTE FUNCTION sprint7_append_only_guard();
CREATE TRIGGER refund_tip_allocations_append_only BEFORE UPDATE OR DELETE ON refund_tip_allocations FOR EACH ROW EXECUTE FUNCTION sprint7_append_only_guard();
CREATE TRIGGER commission_entries_append_only BEFORE UPDATE OR DELETE ON commission_entries FOR EACH ROW EXECUTE FUNCTION sprint7_append_only_guard();
CREATE TRIGGER commission_snapshots_append_only BEFORE UPDATE OR DELETE ON commission_period_staff_snapshots FOR EACH ROW EXECUTE FUNCTION sprint7_append_only_guard();

CREATE FUNCTION sprint7_credit_note_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.status='ISSUED' THEN RAISE EXCEPTION 'issued credit note is immutable' USING ERRCODE='55000'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER credit_note_immutable BEFORE UPDATE OR DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION sprint7_credit_note_immutable();
CREATE FUNCTION sprint7_credit_note_line_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM credit_notes c WHERE c.tenant_id=OLD.tenant_id AND c.id=OLD.credit_note_id AND c.status='ISSUED') THEN RAISE EXCEPTION 'issued credit note line is immutable' USING ERRCODE='55000'; END IF; RETURN OLD;
END $$;
CREATE TRIGGER credit_note_line_immutable BEFORE UPDATE OR DELETE ON credit_note_lines FOR EACH ROW EXECUTE FUNCTION sprint7_credit_note_line_immutable();

CREATE INDEX refunds_invoice_status_idx ON refunds(tenant_id,invoice_id,status,created_at DESC);
CREATE INDEX refunds_branch_date_idx ON refunds(tenant_id,branch_id,requested_at DESC,id);
CREATE INDEX refund_allocations_payment_idx ON refund_payment_allocations(tenant_id,original_payment_id,status);
CREATE INDEX refund_history_lookup_idx ON refund_status_history(tenant_id,refund_id,created_at,id);
CREATE INDEX commission_rules_resolution_idx ON commission_rules(tenant_id,status,effective_from,effective_to,priority DESC);
CREATE INDEX commission_entries_staff_date_idx ON commission_entries(tenant_id,staff_id,business_date,id);
CREATE INDEX commission_entries_period_idx ON commission_entries(tenant_id,period_id,staff_id,id);
CREATE INDEX commission_conflicts_status_idx ON commission_generation_conflicts(tenant_id,status,created_at);
CREATE INDEX financial_exports_status_idx ON financial_export_jobs(tenant_id,status,created_at);

INSERT INTO permissions(code,description) VALUES
('refund.read','Read refunds'),('refund.request','Request refunds'),('refund.approve','Approve refunds'),('refund.reject','Reject refunds'),
('refund.cancel','Cancel refunds'),('refund.execute_cash','Execute cash refunds'),('refund.execute_external','Execute external refunds'),
('refund.override_window','Override refund window'),('refund.view_provider_metadata','View safe provider metadata'),
('credit_note.read','Read credit notes'),('credit_note.print','Print credit notes'),('credit_note.deliver','Deliver credit notes'),
('commission.rule.read','Read commission rules'),('commission.rule.manage','Manage commission rules'),
('commission.entry.read_branch','Read branch commission entries'),('commission.entry.read_own','Read own commission entries'),
('commission.period.read','Read commission periods'),('commission.period.manage','Manage commission periods'),('commission.period.lock','Lock commission periods'),
('commission.adjustment.request','Request commission adjustment'),('commission.adjustment.approve','Approve commission adjustment'),
('commission.statement.read_own','Read own commission statements'),('financial.refund_report.read','Read refund reports'),
('financial.commission_report.read','Read commission reports'),('financial.export','Export financial reports') ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role,permission_code)
SELECT r.role,p.code FROM (VALUES('SALON_OWNER')) r(role) CROSS JOIN permissions p
WHERE p.code LIKE 'refund.%' OR p.code LIKE 'credit_note.%' OR p.code LIKE 'commission.%' OR p.code IN('financial.refund_report.read','financial.commission_report.read','financial.export') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) VALUES
('BRANCH_MANAGER','refund.read'),('BRANCH_MANAGER','refund.request'),('BRANCH_MANAGER','refund.approve'),('BRANCH_MANAGER','refund.reject'),('BRANCH_MANAGER','refund.cancel'),('BRANCH_MANAGER','refund.execute_cash'),('BRANCH_MANAGER','refund.execute_external'),('BRANCH_MANAGER','credit_note.read'),('BRANCH_MANAGER','credit_note.print'),('BRANCH_MANAGER','credit_note.deliver'),('BRANCH_MANAGER','commission.rule.read'),('BRANCH_MANAGER','commission.entry.read_branch'),('BRANCH_MANAGER','commission.period.read'),('BRANCH_MANAGER','financial.refund_report.read'),('BRANCH_MANAGER','financial.commission_report.read'),
('CASHIER','refund.read'),('CASHIER','refund.request'),('CASHIER','refund.execute_cash'),('CASHIER','refund.execute_external'),('CASHIER','credit_note.read'),('CASHIER','credit_note.print'),
('RECEPTIONIST','refund.read'),('RECEPTIONIST','refund.request'),
('ACCOUNTANT','refund.read'),('ACCOUNTANT','refund.request'),('ACCOUNTANT','refund.approve'),('ACCOUNTANT','refund.reject'),('ACCOUNTANT','credit_note.read'),('ACCOUNTANT','credit_note.print'),('ACCOUNTANT','credit_note.deliver'),('ACCOUNTANT','commission.rule.read'),('ACCOUNTANT','commission.rule.manage'),('ACCOUNTANT','commission.entry.read_branch'),('ACCOUNTANT','commission.period.read'),('ACCOUNTANT','commission.period.manage'),('ACCOUNTANT','commission.adjustment.request'),('ACCOUNTANT','commission.adjustment.approve'),('ACCOUNTANT','financial.refund_report.read'),('ACCOUNTANT','financial.commission_report.read'),('ACCOUNTANT','financial.export'),
('NAIL_TECHNICIAN','commission.entry.read_own'),('NAIL_TECHNICIAN','commission.statement.read_own') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0014_refund_credit_note_commission_reporting');
COMMIT;
