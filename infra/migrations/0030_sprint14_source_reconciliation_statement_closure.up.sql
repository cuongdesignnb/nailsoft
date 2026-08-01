BEGIN;

ALTER TABLE accounting_posting_candidates
  ADD COLUMN IF NOT EXISTS source_event_type text,
  ADD COLUMN IF NOT EXISTS source_payload_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS adapter_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;
ALTER TABLE accounting_bank_reconciliations
  ADD COLUMN IF NOT EXISTS void_requested_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_approved_by_user_id uuid REFERENCES users(id);

CREATE TABLE accounting_source_adapter_mappings(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL,
  source_type text NOT NULL, event_type text NOT NULL, version_no integer NOT NULL,
  mapping_json jsonb NOT NULL DEFAULT '{}', fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','ACTIVE','SUPERSEDED','RETIRED')),
  effective_from timestamptz NOT NULL DEFAULT now(), effective_to timestamptz,
  created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,source_type,event_type,version_no),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);
CREATE UNIQUE INDEX accounting_source_mapping_active_uq ON accounting_source_adapter_mappings(book_id,source_type,event_type) WHERE state='ACTIVE';

CREATE TABLE accounting_source_posting_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, candidate_id uuid NOT NULL,
  from_state text, to_state text NOT NULL, journal_id uuid, actor_type text NOT NULL DEFAULT 'WORKER',
  source_fingerprint text NOT NULL, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,candidate_id) REFERENCES accounting_posting_candidates(tenant_id,id),
  FOREIGN KEY(tenant_id,journal_id) REFERENCES accounting_journals(tenant_id,id)
);
CREATE INDEX accounting_source_history_candidate_idx ON accounting_source_posting_history(tenant_id,candidate_id,created_at);
DROP TRIGGER IF EXISTS accounting_source_posting_history_append_only ON accounting_source_posting_history;
CREATE TRIGGER accounting_source_posting_history_append_only BEFORE UPDATE OR DELETE ON accounting_source_posting_history FOR EACH ROW EXECUTE FUNCTION accounting_append_only_guard();

CREATE TABLE accounting_bank_reconciliation_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, reconciliation_id uuid NOT NULL,
  from_state text, to_state text NOT NULL, actor_user_id uuid REFERENCES users(id), reason text NOT NULL,
  request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,reconciliation_id) REFERENCES accounting_bank_reconciliations(tenant_id,id)
);
DROP TRIGGER IF EXISTS accounting_bank_reconciliation_history_append_only ON accounting_bank_reconciliation_history;
CREATE TRIGGER accounting_bank_reconciliation_history_append_only BEFORE UPDATE OR DELETE ON accounting_bank_reconciliation_history FOR EACH ROW EXECUTE FUNCTION accounting_append_only_guard();

CREATE OR REPLACE FUNCTION accounting_bank_match_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; l record; b record;
BEGIN
  SELECT * INTO r FROM accounting_bank_reconciliations WHERE tenant_id=NEW.tenant_id AND id=NEW.reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNTING_BANK_RECONCILIATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO b FROM accounting_bank_accounts WHERE tenant_id=r.tenant_id AND id=r.bank_account_id;
  IF NEW.journal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting_journals j WHERE j.tenant_id=NEW.tenant_id AND j.id=NEW.journal_id AND j.book_id=b.book_id) THEN
    RAISE EXCEPTION 'ACCOUNTING_BANK_JOURNAL_SCOPE_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_bank_match_scope_guard ON accounting_bank_matches;
CREATE TRIGGER accounting_bank_match_scope_guard BEFORE INSERT OR UPDATE ON accounting_bank_matches FOR EACH ROW EXECUTE FUNCTION accounting_bank_match_scope_guard();

CREATE OR REPLACE FUNCTION accounting_bank_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.state IN('CLOSED','VOIDED') AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.statement_balance_minor IS DISTINCT FROM OLD.statement_balance_minor OR NEW.ledger_balance_minor IS DISTINCT FROM OLD.ledger_balance_minor OR NEW.difference_minor IS DISTINCT FROM OLD.difference_minor) THEN
    RAISE EXCEPTION 'ACCOUNTING_RECONCILIATION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF NEW.state='CLOSED' AND (NEW.difference_minor<>0 OR NEW.closed_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'ACCOUNTING_RECONCILIATION_NOT_BALANCED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_bank_reconciliation_guard ON accounting_bank_reconciliations;
CREATE TRIGGER accounting_bank_reconciliation_guard BEFORE INSERT OR UPDATE ON accounting_bank_reconciliations FOR EACH ROW EXECUTE FUNCTION accounting_bank_reconciliation_guard();

CREATE OR REPLACE FUNCTION accounting_bank_line_match_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amount bigint; allocated bigint;
BEGIN
  SELECT abs(amount_minor) INTO amount FROM accounting_bank_statement_lines WHERE tenant_id=NEW.tenant_id AND id=NEW.statement_line_id FOR UPDATE;
  IF amount IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_BANK_STATEMENT_LINE_NOT_FOUND' USING ERRCODE='23503'; END IF;
  SELECT coalesce(sum(amount_minor),0) INTO allocated FROM accounting_bank_match_allocations WHERE tenant_id=NEW.tenant_id AND statement_line_id=NEW.statement_line_id AND id<>coalesce(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid);
  IF allocated+NEW.amount_minor>amount THEN RAISE EXCEPTION 'ACCOUNTING_BANK_MATCH_CAP_EXCEEDED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_bank_line_match_cap_guard ON accounting_bank_match_allocations;
CREATE TRIGGER accounting_bank_line_match_cap_guard BEFORE INSERT OR UPDATE ON accounting_bank_match_allocations FOR EACH ROW EXECUTE FUNCTION accounting_bank_line_match_cap_guard();

INSERT INTO permissions(code,description) SELECT code,'Sprint 14 source adapter and reconciliation closure permission' FROM unnest(ARRAY[
  'accounting.source_posting.create','accounting.source_posting.read','accounting.source_mapping.read','accounting.source_mapping.manage','accounting.bank_match.manage','accounting.statement.generate'
]) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code IN('accounting.source_posting.create','accounting.source_posting.read','accounting.source_mapping.read','accounting.source_mapping.manage','accounting.bank_match.manage','accounting.statement.generate') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'ACCOUNTANT',code FROM permissions WHERE code IN('accounting.source_posting.create','accounting.source_posting.read','accounting.source_mapping.read','accounting.source_mapping.manage','accounting.bank_match.manage','accounting.statement.generate') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0030_sprint14_source_reconciliation_statement_closure');
COMMIT;
