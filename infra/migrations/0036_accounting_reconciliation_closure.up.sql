BEGIN;

-- Sprint 20 Wave 2: release-safe statement-line commands and reconciliation
-- adjustment lifecycle.  Existing rows remain readable; legacy adjustment
-- rows without posting details are intentionally not postable.
ALTER TABLE accounting_bank_statement_lines
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='accounting_bank_statement_lines_version_check'
      AND conrelid='accounting_bank_statement_lines'::regclass
  ) THEN
    ALTER TABLE accounting_bank_statement_lines
      ADD CONSTRAINT accounting_bank_statement_lines_version_check CHECK (version > 0);
  END IF;
END $$;

-- Statement lines are immutable except for the server-owned matching/exclusion
-- projection and its optimistic-concurrency version.  The service validates
-- the legal state transition and all accounting guards.
CREATE OR REPLACE FUNCTION accounting_bank_statement_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'ACCOUNTING_BANK_STATEMENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['match_state','matched_minor','version'])<>(to_jsonb(OLD)-ARRAY['match_state','matched_minor','version']) THEN
    RAISE EXCEPTION 'ACCOUNTING_BANK_STATEMENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'ACCOUNTING_BANK_STATEMENT_VERSION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_bank_statement_line_append_only ON accounting_bank_statement_lines;
CREATE TRIGGER accounting_bank_statement_line_append_only
  BEFORE UPDATE OR DELETE ON accounting_bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION accounting_bank_statement_append_only_guard();

ALTER TABLE accounting_reconciliation_adjustment_requests
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS offset_account_id uuid,
  ADD COLUMN IF NOT EXISTS accounting_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='accounting_reconciliation_adjustment_requests_tenant_id_key'
      AND conrelid='accounting_reconciliation_adjustment_requests'::regclass
  ) THEN
    ALTER TABLE accounting_reconciliation_adjustment_requests
      ADD CONSTRAINT accounting_reconciliation_adjustment_requests_tenant_id_key UNIQUE (tenant_id,id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='accounting_reconciliation_adjustment_requests_version_check'
      AND conrelid='accounting_reconciliation_adjustment_requests'::regclass
  ) THEN
    ALTER TABLE accounting_reconciliation_adjustment_requests
      ADD CONSTRAINT accounting_reconciliation_adjustment_requests_version_check CHECK (version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='accounting_reconciliation_adjustment_requests_direction_check'
      AND conrelid='accounting_reconciliation_adjustment_requests'::regclass
  ) THEN
    ALTER TABLE accounting_reconciliation_adjustment_requests
      ADD CONSTRAINT accounting_reconciliation_adjustment_requests_direction_check CHECK (direction IS NULL OR direction IN ('DEBIT','CREDIT'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='accounting_reconciliation_adjustment_requests_amount_check'
      AND conrelid='accounting_reconciliation_adjustment_requests'::regclass
  ) THEN
    ALTER TABLE accounting_reconciliation_adjustment_requests
      ADD CONSTRAINT accounting_reconciliation_adjustment_requests_amount_check CHECK (amount_minor > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='accounting_reconciliation_adjustment_requests_offset_account_fk'
      AND conrelid='accounting_reconciliation_adjustment_requests'::regclass
  ) THEN
    ALTER TABLE accounting_reconciliation_adjustment_requests
      ADD CONSTRAINT accounting_reconciliation_adjustment_requests_offset_account_fk
      FOREIGN KEY (offset_account_id) REFERENCES accounting_accounts(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS accounting_reconciliation_adjustment_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  adjustment_request_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  reason text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, adjustment_request_id)
    REFERENCES accounting_reconciliation_adjustment_requests(tenant_id,id)
);
DROP TRIGGER IF EXISTS accounting_reconciliation_adjustment_history_append_only ON accounting_reconciliation_adjustment_history;
CREATE TRIGGER accounting_reconciliation_adjustment_history_append_only
  BEFORE UPDATE OR DELETE ON accounting_reconciliation_adjustment_history
  FOR EACH ROW EXECUTE FUNCTION accounting_append_only_guard();

CREATE INDEX IF NOT EXISTS accounting_reconciliation_adjustment_state_idx
  ON accounting_reconciliation_adjustment_requests(tenant_id,state,created_at);

CREATE OR REPLACE FUNCTION accounting_reconciliation_adjustment_posted_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.state='POSTED' THEN
    RAISE EXCEPTION 'ACCOUNTING_RECONCILIATION_ADJUSTMENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS accounting_reconciliation_adjustment_posted_guard ON accounting_reconciliation_adjustment_requests;
CREATE TRIGGER accounting_reconciliation_adjustment_posted_guard
  BEFORE UPDATE OR DELETE ON accounting_reconciliation_adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION accounting_reconciliation_adjustment_posted_guard();

INSERT INTO schema_migrations(version)
VALUES ('0036_accounting_reconciliation_closure')
ON CONFLICT DO NOTHING;
COMMIT;
