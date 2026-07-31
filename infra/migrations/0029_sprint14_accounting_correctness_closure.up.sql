BEGIN;

-- Command-level idempotency is independent from source event idempotency.  The
-- request fingerprint is compared before a stored response is replayed.
CREATE TABLE accounting_command_idempotency(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'COMPLETED' CHECK(state IN('PROCESSING','COMPLETED','FAILED')),
  response_json jsonb,
  error_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(tenant_id,operation,idempotency_key)
);
CREATE INDEX accounting_command_idempotency_created_idx ON accounting_command_idempotency(tenant_id,created_at);

ALTER TABLE accounting_books ADD COLUMN IF NOT EXISTS journal_number_next bigint NOT NULL DEFAULT 1 CHECK(journal_number_next>0);
CREATE TABLE accounting_journal_number_sequences(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  book_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK(next_value>0),
  UNIQUE(tenant_id,book_id,fiscal_year_id),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id),
  FOREIGN KEY(fiscal_year_id) REFERENCES accounting_fiscal_years(id)
);

ALTER TABLE accounting_posting_candidates ADD COLUMN IF NOT EXISTS lease_owner text, ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz, ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS last_error_json jsonb;
CREATE INDEX accounting_posting_candidates_lease_idx ON accounting_posting_candidates(tenant_id,state,lease_expires_at,created_at) WHERE state IN('PENDING','MAPPING','READY','POSTING','FAILED');

ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS close_requested_by_user_id uuid REFERENCES users(id), ADD COLUMN IF NOT EXISTS close_approved_by_user_id uuid REFERENCES users(id), ADD COLUMN IF NOT EXISTS reopen_requested_by_user_id uuid REFERENCES users(id), ADD COLUMN IF NOT EXISTS reopen_approved_by_user_id uuid REFERENCES users(id);

CREATE OR REPLACE FUNCTION accounting_posted_line_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT state INTO s FROM accounting_journals WHERE id=COALESCE(NEW.journal_id,OLD.journal_id);
  IF s IN('POSTED','REVERSED') THEN
    RAISE EXCEPTION 'ACCOUNTING_JOURNAL_POSTED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS accounting_posted_line_guard ON accounting_journal_lines;
CREATE TRIGGER accounting_posted_line_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_journal_lines FOR EACH ROW EXECUTE FUNCTION accounting_posted_line_immutable_guard();

CREATE OR REPLACE FUNCTION accounting_posted_journal_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked boolean;
BEGIN
  IF OLD.state IN('POSTED','REVERSED') THEN
    IF OLD.state='POSTED' AND NEW.state='REVERSED' THEN
      SELECT EXISTS(SELECT 1 FROM accounting_journal_reversal_links l JOIN accounting_journals r ON r.tenant_id=l.tenant_id AND r.id=l.reversal_journal_id WHERE l.tenant_id=OLD.tenant_id AND l.original_journal_id=OLD.id AND r.state='POSTED') INTO linked;
      IF NOT linked THEN RAISE EXCEPTION 'ACCOUNTING_REVERSAL_NOT_POSTED' USING ERRCODE='55000'; END IF;
      IF (to_jsonb(NEW)-ARRAY['state','updated_at','version'])<>(to_jsonb(OLD)-ARRAY['state','updated_at','version']) THEN RAISE EXCEPTION 'ACCOUNTING_JOURNAL_POSTED_IMMUTABLE' USING ERRCODE='55000'; END IF;
    ELSE
      IF (to_jsonb(NEW)-ARRAY['updated_at','version'])<>(to_jsonb(OLD)-ARRAY['updated_at','version']) THEN RAISE EXCEPTION 'ACCOUNTING_JOURNAL_POSTED_IMMUTABLE' USING ERRCODE='55000'; END IF;
    END IF;
  END IF;
  IF NEW.state='POSTED' AND NEW.journal_number IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_JOURNAL_NUMBER_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_journal_post_guard ON accounting_journals;
CREATE TRIGGER accounting_journal_post_guard BEFORE UPDATE ON accounting_journals FOR EACH ROW EXECUTE FUNCTION accounting_posted_journal_immutable_guard();

CREATE OR REPLACE FUNCTION accounting_journal_post_validation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n integer; p record;
BEGIN
  IF NEW.state='POSTED' AND OLD.state IS DISTINCT FROM 'POSTED' THEN
    SELECT * INTO p FROM accounting_periods WHERE tenant_id=NEW.tenant_id AND id=NEW.period_id FOR UPDATE;
    IF p.id IS NULL OR p.book_id<>NEW.book_id THEN RAISE EXCEPTION 'ACCOUNTING_PERIOD_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
    IF p.state NOT IN('OPEN','REOPENED') THEN RAISE EXCEPTION 'ACCOUNTING_PERIOD_NOT_POSTABLE' USING ERRCODE='55000'; END IF;
    IF NEW.accounting_date NOT BETWEEN p.starts_on AND p.ends_on THEN RAISE EXCEPTION 'ACCOUNTING_DATE_OUTSIDE_PERIOD' USING ERRCODE='23514'; END IF;
    SELECT count(*),COALESCE(sum(functional_debit_minor),0),COALESCE(sum(functional_credit_minor),0) INTO n,d,c FROM accounting_journal_lines WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.id;
    IF n<2 OR d<=0 OR d<>c THEN RAISE EXCEPTION 'ACCOUNTING_JOURNAL_NOT_BALANCED' USING ERRCODE='23514'; END IF;
    NEW.posted_at=COALESCE(NEW.posted_at,now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_journal_post_validation ON accounting_journals;
CREATE TRIGGER accounting_journal_post_validation BEFORE UPDATE ON accounting_journals FOR EACH ROW EXECUTE FUNCTION accounting_journal_post_validation();

CREATE OR REPLACE FUNCTION accounting_period_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM accounting_fiscal_years f WHERE f.tenant_id=NEW.tenant_id AND f.id=NEW.fiscal_year_id AND f.book_id=NEW.book_id AND NEW.starts_on>=f.starts_on AND NEW.ends_on<=f.ends_on) THEN RAISE EXCEPTION 'ACCOUNTING_PERIOD_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_period_scope_guard BEFORE INSERT OR UPDATE ON accounting_periods FOR EACH ROW EXECUTE FUNCTION accounting_period_scope_guard();

CREATE OR REPLACE FUNCTION accounting_account_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g record; p record;
BEGIN
  IF NEW.group_id IS NOT NULL THEN SELECT * INTO g FROM accounting_account_groups WHERE id=NEW.group_id; IF g.id IS NULL OR g.tenant_id<>NEW.tenant_id OR g.book_id<>NEW.book_id THEN RAISE EXCEPTION 'ACCOUNTING_ACCOUNT_SCOPE_INVALID' USING ERRCODE='23503'; END IF; END IF;
  IF NEW.parent_account_id IS NOT NULL THEN SELECT * INTO p FROM accounting_accounts WHERE id=NEW.parent_account_id; IF p.id IS NULL OR p.tenant_id<>NEW.tenant_id OR p.book_id<>NEW.book_id OR p.id=NEW.id THEN RAISE EXCEPTION 'ACCOUNTING_ACCOUNT_SCOPE_INVALID' USING ERRCODE='23503'; END IF; END IF;
  IF NEW.parent_account_id IS NOT NULL AND EXISTS(WITH RECURSIVE chain(id,parent_account_id) AS (SELECT id,parent_account_id FROM accounting_accounts WHERE id=NEW.parent_account_id UNION ALL SELECT a.id,a.parent_account_id FROM accounting_accounts a JOIN chain x ON a.id=x.parent_account_id) SELECT 1 FROM chain WHERE id=NEW.id) THEN RAISE EXCEPTION 'ACCOUNTING_ACCOUNT_CYCLE' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM accounting_journal_lines l JOIN accounting_journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id WHERE l.account_id=OLD.id AND j.state='POSTED') AND (NEW.account_type IS DISTINCT FROM OLD.account_type OR NEW.control_class IS DISTINCT FROM OLD.control_class OR NEW.book_id IS DISTINCT FROM OLD.book_id) THEN RAISE EXCEPTION 'ACCOUNTING_ACCOUNT_ACTIVITY_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active AND (NEW.control_class IS NOT NULL OR EXISTS(SELECT 1 FROM accounting_posting_rule_versions v WHERE v.tenant_id=OLD.tenant_id AND v.state='ACTIVE' AND v.mapping_json::text LIKE '%'||OLD.id::text||'%')) THEN RAISE EXCEPTION 'ACCOUNTING_CONTROL_ACCOUNT_IN_USE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_account_scope_guard BEFORE INSERT OR UPDATE ON accounting_accounts FOR EACH ROW EXECUTE FUNCTION accounting_account_scope_guard();

CREATE OR REPLACE FUNCTION accounting_journal_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM accounting_periods p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.period_id AND p.book_id=NEW.book_id) THEN RAISE EXCEPTION 'ACCOUNTING_JOURNAL_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
  IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting_cost_centers c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.cost_center_id AND c.book_id=NEW.book_id) THEN RAISE EXCEPTION 'ACCOUNTING_JOURNAL_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_journal_scope_guard BEFORE INSERT OR UPDATE ON accounting_journals FOR EACH ROW EXECUTE FUNCTION accounting_journal_scope_guard();

CREATE OR REPLACE FUNCTION accounting_line_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j record;
BEGIN
  SELECT * INTO j FROM accounting_journals WHERE tenant_id=NEW.tenant_id AND id=NEW.journal_id;
  IF j.id IS NULL OR NOT EXISTS(SELECT 1 FROM accounting_accounts a WHERE a.tenant_id=NEW.tenant_id AND a.id=NEW.account_id AND a.book_id=j.book_id) THEN RAISE EXCEPTION 'ACCOUNTING_LINE_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
  IF NEW.tax_code_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting_tax_codes t WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.tax_code_id AND t.book_id=j.book_id) THEN RAISE EXCEPTION 'ACCOUNTING_LINE_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
  IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting_cost_centers c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.cost_center_id AND c.book_id=j.book_id) THEN RAISE EXCEPTION 'ACCOUNTING_LINE_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_line_scope_guard BEFORE INSERT OR UPDATE ON accounting_journal_lines FOR EACH ROW EXECUTE FUNCTION accounting_line_scope_guard();

CREATE OR REPLACE FUNCTION accounting_opening_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM accounting_opening_balance_imports i JOIN accounting_accounts a ON a.tenant_id=i.tenant_id AND a.id=NEW.account_id WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.import_id AND a.book_id=i.book_id) THEN RAISE EXCEPTION 'ACCOUNTING_OPENING_SCOPE_INVALID' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_opening_scope_guard BEFORE INSERT OR UPDATE ON accounting_opening_balance_rows FOR EACH ROW EXECUTE FUNCTION accounting_opening_scope_guard();

CREATE OR REPLACE FUNCTION accounting_snapshot_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='accounting_statement_snapshots' AND OLD.state='FINAL' AND (to_jsonb(NEW)-ARRAY['updated_at'])<>(to_jsonb(OLD)-ARRAY['updated_at']) THEN RAISE EXCEPTION 'ACCOUNTING_STATEMENT_FINAL_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='accounting_statement_snapshot_lines' AND TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM accounting_statement_snapshots s WHERE s.tenant_id=OLD.tenant_id AND s.id=OLD.snapshot_id AND s.state='FINAL') THEN RAISE EXCEPTION 'ACCOUNTING_STATEMENT_FINAL_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER accounting_statement_header_immutable BEFORE UPDATE OR DELETE ON accounting_statement_snapshots FOR EACH ROW EXECUTE FUNCTION accounting_snapshot_immutable_guard();
CREATE TRIGGER accounting_statement_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON accounting_statement_snapshot_lines FOR EACH ROW EXECUTE FUNCTION accounting_snapshot_immutable_guard();

CREATE OR REPLACE FUNCTION accounting_bank_statement_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ACCOUNTING_BANK_STATEMENT_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER accounting_bank_statement_line_append_only BEFORE UPDATE OR DELETE ON accounting_bank_statement_lines FOR EACH ROW EXECUTE FUNCTION accounting_bank_statement_append_only_guard();

CREATE OR REPLACE FUNCTION accounting_bank_match_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint; cap bigint;
BEGIN
  SELECT COALESCE(sum(amount_minor),0) INTO total FROM accounting_bank_match_allocations WHERE tenant_id=NEW.tenant_id AND statement_line_id=NEW.statement_line_id AND id<>COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid);
  SELECT abs(amount_minor) INTO cap FROM accounting_bank_statement_lines WHERE tenant_id=NEW.tenant_id AND id=NEW.statement_line_id FOR UPDATE;
  IF cap IS NULL OR total+NEW.amount_minor>cap THEN RAISE EXCEPTION 'ACCOUNTING_BANK_MATCH_CAP_EXCEEDED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_bank_match_cap_guard BEFORE INSERT OR UPDATE ON accounting_bank_match_allocations FOR EACH ROW EXECUTE FUNCTION accounting_bank_match_cap_guard();

INSERT INTO permissions(code,description) SELECT code,'Sprint 14 closure correctness permission' FROM unnest(ARRAY['accounting.journal.submit','accounting.journal.approve','accounting.journal.post','accounting.journal.reverse','accounting.control_account.manual_post','accounting.opening_balance.approve','accounting.bank_reconciliation.close','accounting.bank_reconciliation.void']) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code IN('accounting.journal.submit','accounting.journal.approve','accounting.journal.post','accounting.journal.reverse','accounting.control_account.manual_post','accounting.opening_balance.approve','accounting.bank_reconciliation.close','accounting.bank_reconciliation.void') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0029_sprint14_accounting_correctness_closure');
COMMIT;
