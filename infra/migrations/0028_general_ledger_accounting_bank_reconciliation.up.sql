BEGIN;

CREATE TABLE accounting_books(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  functional_currency char(3) NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','CONFIGURING','ACTIVE','SUSPENDED','CLOSED')),
  configuration_status text NOT NULL DEFAULT 'INCOMPLETE' CHECK(configuration_status IN('INCOMPLETE','READY','ACTIVE')),
  posting_mode text NOT NULL DEFAULT 'DISABLED' CHECK(posting_mode IN('DISABLED','REVIEW_REQUIRED','AUTO_POST')),
  historical_auto_posting boolean NOT NULL DEFAULT false,
  opening_balance_status text NOT NULL DEFAULT 'NONE' CHECK(opening_balance_status IN('NONE','DRAFT','POSTED')),
  cutover_date date,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
);
CREATE INDEX accounting_books_tenant_status_idx ON accounting_books(tenant_id,status);

CREATE TABLE accounting_fiscal_years(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  book_id uuid NOT NULL,
  year_no integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_on>=starts_on), UNIQUE(tenant_id,id), UNIQUE(book_id,year_no),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);

CREATE TABLE accounting_periods(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  book_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  code text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  state text NOT NULL DEFAULT 'FUTURE' CHECK(state IN('FUTURE','OPEN','SOFT_CLOSED','PENDING_CLOSE','CLOSED','REOPEN_PENDING','REOPENED')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_on>=starts_on), UNIQUE(tenant_id,id), UNIQUE(book_id,code),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id),
  FOREIGN KEY(fiscal_year_id) REFERENCES accounting_fiscal_years(id)
);
CREATE INDEX accounting_periods_lookup_idx ON accounting_periods(tenant_id,book_id,starts_on,ends_on,state);

CREATE TABLE accounting_account_groups(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, normal_side text NOT NULL CHECK(normal_side IN('DEBIT','CREDIT')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(book_id,code),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);
CREATE TABLE accounting_accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL,
  group_id uuid, parent_account_id uuid, code text NOT NULL, name text NOT NULL,
  account_type text NOT NULL CHECK(account_type IN('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','CONTRA_ASSET','CONTRA_LIABILITY','CONTRA_REVENUE','CONTRA_EXPENSE')),
  control_class text CHECK(control_class IS NULL OR control_class IN('CASH','BANK','CARD_RECEIVABLE','CUSTOMER_RECEIVABLE','INVENTORY','ACCOUNTS_PAYABLE','GIFT_CARD_LIABILITY','CUSTOMER_CREDIT_LIABILITY','TIP_PAYABLE','PAYROLL_PAYABLE','TAX_PAYABLE','OWNER_EQUITY','RETAINED_EARNINGS','SERVICE_REVENUE','RETAIL_REVENUE','COGS','PAYROLL_EXPENSE','COMMISSION_EXPENSE','SOFTWARE_EXPENSE','BANK_FEE','OTHER_EXPENSE')),
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(book_id,code), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id),
  FOREIGN KEY(group_id) REFERENCES accounting_account_groups(id), FOREIGN KEY(parent_account_id) REFERENCES accounting_accounts(id)
);
CREATE INDEX accounting_accounts_hierarchy_idx ON accounting_accounts(book_id,parent_account_id,active);
CREATE TABLE accounting_dimensions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  book_id uuid NOT NULL, code text NOT NULL, name text NOT NULL, dimension_type text NOT NULL DEFAULT 'BRANCH',
  active boolean NOT NULL DEFAULT true, UNIQUE(book_id,code), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);
CREATE TABLE accounting_cost_centers(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL,
  dimension_id uuid, branch_id uuid, code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE(book_id,code), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id),
  FOREIGN KEY(dimension_id) REFERENCES accounting_dimensions(id), FOREIGN KEY(branch_id) REFERENCES branches(id)
);

CREATE TABLE accounting_tax_codes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL,
  code text NOT NULL, jurisdiction_reference text NOT NULL, tax_type text NOT NULL CHECK(tax_type IN('SALES_TAX','VAT','GST','SERVICE_TAX','WITHHOLDING_INPUT','OTHER')),
  rate_numerator bigint NOT NULL CHECK(rate_numerator>=0), rate_denominator bigint NOT NULL CHECK(rate_denominator>0),
  inclusive boolean NOT NULL DEFAULT false, direction text NOT NULL CHECK(direction IN('INPUT','OUTPUT')),
  recoverable_numerator bigint NOT NULL DEFAULT 0 CHECK(recoverable_numerator>=0), recoverable_denominator bigint NOT NULL DEFAULT 1 CHECK(recoverable_denominator>0),
  effective_from date NOT NULL, effective_to date, input_account_id uuid, output_account_id uuid,
  legal_review_status text NOT NULL DEFAULT 'PENDING' CHECK(legal_review_status IN('PENDING','REVIEWED','RETIRED')),
  version integer NOT NULL DEFAULT 1, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_to IS NULL OR effective_to>=effective_from), UNIQUE(book_id,code,effective_from),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), FOREIGN KEY(input_account_id) REFERENCES accounting_accounts(id), FOREIGN KEY(output_account_id) REFERENCES accounting_accounts(id)
);

CREATE TABLE accounting_posting_rules(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','ACTIVE','SUPERSEDED','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(book_id,code),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);
CREATE TABLE accounting_posting_rule_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, rule_id uuid NOT NULL, version_no integer NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','ACTIVE','SUPERSEDED','RETIRED')),
  effective_from timestamptz NOT NULL, effective_to timestamptz, mapping_json jsonb NOT NULL DEFAULT '{}', fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(rule_id,version_no), FOREIGN KEY(tenant_id,rule_id) REFERENCES accounting_posting_rules(tenant_id,id)
);
CREATE TABLE accounting_configuration_checklists(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, item_code text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','READY','BLOCKED')), evidence_json jsonb NOT NULL DEFAULT '{}',
  updated_by_user_id uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(book_id,item_code),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);

CREATE TABLE accounting_posting_candidates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, period_id uuid,
  source_type text NOT NULL, source_id uuid NOT NULL, source_fingerprint text NOT NULL, generation_key text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','MAPPING','READY','REVIEW_REQUIRED','POSTING','POSTED','IGNORED','FAILED','REVERSED')),
  mapping_rule_version_id uuid, journal_id uuid, failure_code text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,book_id,source_type,source_id,generation_key), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), FOREIGN KEY(period_id) REFERENCES accounting_periods(id), FOREIGN KEY(mapping_rule_version_id) REFERENCES accounting_posting_rule_versions(id)
);
CREATE INDEX accounting_posting_candidates_pending_idx ON accounting_posting_candidates(tenant_id,book_id,state,created_at) WHERE state IN('PENDING','MAPPING','READY','REVIEW_REQUIRED','FAILED');

CREATE TABLE accounting_journal_batches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, batch_number text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','PENDING_APPROVAL','APPROVED','POSTING','POSTED','REJECTED','CANCELLED')),
  created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(book_id,batch_number), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);
CREATE TABLE accounting_journals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, period_id uuid NOT NULL,
  batch_id uuid, journal_number text, journal_type text NOT NULL CHECK(journal_type IN('SOURCE','MANUAL','OPENING_BALANCE','ADJUSTMENT','REVERSAL','REPLACEMENT','BANK_ADJUSTMENT','PERIOD_CLOSE')),
  state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','PENDING_APPROVAL','APPROVED','POSTING','POSTED','REJECTED','CANCELLED','REVERSAL_PENDING','REVERSED','FAILED')),
  accounting_date date NOT NULL, currency char(3) NOT NULL, exchange_numerator bigint NOT NULL DEFAULT 1 CHECK(exchange_numerator>0), exchange_denominator bigint NOT NULL DEFAULT 1 CHECK(exchange_denominator>0),
  source_type text, source_id uuid, source_fingerprint text, generation_key text, branch_id uuid, cost_center_id uuid,
  requested_by_user_id uuid REFERENCES users(id), approved_by_user_id uuid REFERENCES users(id), posted_by_user_id uuid REFERENCES users(id),
  reversal_of_journal_id uuid, replacement_for_journal_id uuid, version integer NOT NULL DEFAULT 1, request_id text, evidence_json jsonb NOT NULL DEFAULT '{}',
  posted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(book_id,journal_number),
  FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), FOREIGN KEY(period_id) REFERENCES accounting_periods(id), FOREIGN KEY(batch_id) REFERENCES accounting_journal_batches(id),
  FOREIGN KEY(branch_id) REFERENCES branches(id), FOREIGN KEY(cost_center_id) REFERENCES accounting_cost_centers(id), FOREIGN KEY(reversal_of_journal_id) REFERENCES accounting_journals(id), FOREIGN KEY(replacement_for_journal_id) REFERENCES accounting_journals(id),
  CHECK(approved_by_user_id IS NULL OR requested_by_user_id IS NULL OR approved_by_user_id<>requested_by_user_id),
  UNIQUE(tenant_id,book_id,source_type,source_id,generation_key)
);
CREATE INDEX accounting_journals_period_state_idx ON accounting_journals(tenant_id,book_id,period_id,state,accounting_date);
CREATE TABLE accounting_journal_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, journal_id uuid NOT NULL, line_no integer NOT NULL,
  account_id uuid NOT NULL, debit_minor bigint NOT NULL DEFAULT 0 CHECK(debit_minor>=0), credit_minor bigint NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
  functional_debit_minor bigint NOT NULL DEFAULT 0 CHECK(functional_debit_minor>=0), functional_credit_minor bigint NOT NULL DEFAULT 0 CHECK(functional_credit_minor>=0),
  currency char(3) NOT NULL, exchange_numerator bigint NOT NULL CHECK(exchange_numerator>0), exchange_denominator bigint NOT NULL CHECK(exchange_denominator>0),
  branch_id uuid, cost_center_id uuid, staff_id uuid, vendor_id uuid, customer_id uuid, tax_code_id uuid, open_item_id uuid, source_line_reference text, fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(journal_id,line_no), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,journal_id) REFERENCES accounting_journals(tenant_id,id), FOREIGN KEY(account_id) REFERENCES accounting_accounts(id), FOREIGN KEY(branch_id) REFERENCES branches(id), FOREIGN KEY(cost_center_id) REFERENCES accounting_cost_centers(id), FOREIGN KEY(tax_code_id) REFERENCES accounting_tax_codes(id),
  CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)), CHECK((functional_debit_minor>0 AND functional_credit_minor=0) OR (functional_credit_minor>0 AND functional_debit_minor=0))
);
CREATE TABLE accounting_journal_approval_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, journal_id uuid NOT NULL, from_state text, to_state text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL, fingerprint text NOT NULL, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,journal_id) REFERENCES accounting_journals(tenant_id,id)
);
CREATE TABLE accounting_journal_reversal_links(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, original_journal_id uuid NOT NULL, reversal_journal_id uuid NOT NULL, replacement_journal_id uuid,
  reason text NOT NULL, created_by_user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(original_journal_id,reversal_journal_id),
  FOREIGN KEY(tenant_id,original_journal_id) REFERENCES accounting_journals(tenant_id,id), FOREIGN KEY(tenant_id,reversal_journal_id) REFERENCES accounting_journals(tenant_id,id)
);
CREATE TABLE accounting_ledger_projection_checkpoints(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, projection_name text NOT NULL, last_journal_id uuid, last_posted_at timestamptz, version bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(book_id,projection_name), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);

CREATE TABLE accounting_opening_balance_imports(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, cutover_date date NOT NULL, currency char(3) NOT NULL,
  file_checksum text NOT NULL, state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','VALIDATED','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','CANCELLED')),
  total_debit_minor bigint NOT NULL DEFAULT 0, total_credit_minor bigint NOT NULL DEFAULT 0, approved_by_user_id uuid REFERENCES users(id), posted_journal_id uuid, version integer NOT NULL DEFAULT 1, created_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(book_id,file_checksum), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), CHECK(total_debit_minor=total_credit_minor OR state NOT IN('VALIDATED','PENDING_APPROVAL','APPROVED','POSTED'))
);
CREATE TABLE accounting_opening_balance_rows(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, import_id uuid NOT NULL, row_no integer NOT NULL, account_id uuid NOT NULL, debit_minor bigint NOT NULL DEFAULT 0, credit_minor bigint NOT NULL DEFAULT 0, currency char(3) NOT NULL, error_code text, UNIQUE(import_id,row_no), FOREIGN KEY(tenant_id,import_id) REFERENCES accounting_opening_balance_imports(tenant_id,id), FOREIGN KEY(account_id) REFERENCES accounting_accounts(id), CHECK((debit_minor>=0 AND credit_minor>=0) AND ((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)))
);
CREATE TABLE accounting_import_errors(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, import_id uuid NOT NULL, row_no integer, code text NOT NULL, detail_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,import_id) REFERENCES accounting_opening_balance_imports(tenant_id,id)
);

CREATE TABLE accounting_counterparty_accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, counterparty_type text NOT NULL CHECK(counterparty_type IN('CUSTOMER','VENDOR','STAFF','PLATFORM')), counterparty_id uuid NOT NULL, account_id uuid NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(book_id,counterparty_type,counterparty_id), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), FOREIGN KEY(account_id) REFERENCES accounting_accounts(id)
);
CREATE TABLE accounting_vendor_profiles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), vendor_reference text NOT NULL, display_name text NOT NULL, tax_reference text, active boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,vendor_reference)
);
CREATE TABLE accounting_customer_accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), customer_id uuid NOT NULL, account_id uuid NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(tenant_id,customer_id), FOREIGN KEY(account_id) REFERENCES accounting_accounts(id)
);
CREATE TABLE accounting_open_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, journal_id uuid NOT NULL, line_id uuid NOT NULL,
  item_type text NOT NULL CHECK(item_type IN('CUSTOMER_RECEIVABLE','VENDOR_PAYABLE','PAYROLL_PAYABLE','TIP_PAYABLE','TAX_PAYABLE','OTHER')),
  original_minor bigint NOT NULL CHECK(original_minor>0), settled_minor bigint NOT NULL DEFAULT 0 CHECK(settled_minor>=0), currency char(3) NOT NULL, due_on date NOT NULL, counterparty_id uuid, state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','PARTIALLY_SETTLED','SETTLED','DISPUTED','WRITTEN_OFF','REVERSED')), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), FOREIGN KEY(tenant_id,journal_id) REFERENCES accounting_journals(tenant_id,id), FOREIGN KEY(tenant_id,line_id) REFERENCES accounting_journal_lines(tenant_id,id), CHECK(settled_minor<=original_minor)
);
CREATE INDEX accounting_open_items_aging_idx ON accounting_open_items(tenant_id,book_id,item_type,state,due_on);
CREATE TABLE accounting_open_item_allocations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, open_item_id uuid NOT NULL, settlement_journal_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), reversed_allocation_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,open_item_id) REFERENCES accounting_open_items(tenant_id,id), FOREIGN KEY(tenant_id,settlement_journal_id) REFERENCES accounting_journals(tenant_id,id), FOREIGN KEY(reversed_allocation_id) REFERENCES accounting_open_item_allocations(id)
);

CREATE TABLE accounting_bank_accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, account_id uuid NOT NULL, bank_name text NOT NULL, account_reference_redacted text NOT NULL, currency char(3) NOT NULL, active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, UNIQUE(tenant_id,id), UNIQUE(book_id,account_reference_redacted), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), FOREIGN KEY(account_id) REFERENCES accounting_accounts(id)
);
CREATE TABLE accounting_bank_statement_imports(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, bank_account_id uuid NOT NULL, format text NOT NULL CHECK(format IN('CSV','OFX','CAMT','MANUAL')), file_checksum text NOT NULL, state text NOT NULL DEFAULT 'IMPORTED' CHECK(state IN('IMPORTED','PROCESSING','READY','FAILED')), imported_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(bank_account_id,file_checksum), FOREIGN KEY(tenant_id,bank_account_id) REFERENCES accounting_bank_accounts(tenant_id,id)
);
CREATE TABLE accounting_bank_statement_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, import_id uuid NOT NULL, bank_account_id uuid NOT NULL, line_no integer NOT NULL, transaction_date date NOT NULL, value_date date, amount_minor bigint NOT NULL, currency char(3) NOT NULL, direction text NOT NULL CHECK(direction IN('DEBIT','CREDIT')), reference text, description text, fingerprint text NOT NULL, match_state text NOT NULL DEFAULT 'UNMATCHED' CHECK(match_state IN('UNMATCHED','SUGGESTED','MATCHED','PARTIALLY_MATCHED','EXCLUDED','DISPUTED')), matched_minor bigint NOT NULL DEFAULT 0 CHECK(matched_minor>=0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(import_id,line_no), UNIQUE(bank_account_id,fingerprint), FOREIGN KEY(tenant_id,import_id) REFERENCES accounting_bank_statement_imports(tenant_id,id), FOREIGN KEY(tenant_id,bank_account_id) REFERENCES accounting_bank_accounts(tenant_id,id), CHECK(matched_minor<=abs(amount_minor))
);
CREATE INDEX accounting_bank_statement_unmatched_idx ON accounting_bank_statement_lines(tenant_id,bank_account_id,match_state,transaction_date) WHERE match_state IN('UNMATCHED','SUGGESTED','PARTIALLY_MATCHED');
CREATE TABLE accounting_bank_reconciliations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, bank_account_id uuid NOT NULL, period_id uuid, state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','MATCHING','REVIEW','RECONCILED','CLOSED','VOID_PENDING','VOIDED')), statement_balance_minor bigint NOT NULL DEFAULT 0, ledger_balance_minor bigint NOT NULL DEFAULT 0, difference_minor bigint NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1, created_by_user_id uuid REFERENCES users(id), closed_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,bank_account_id) REFERENCES accounting_bank_accounts(tenant_id,id), FOREIGN KEY(period_id) REFERENCES accounting_periods(id)
);
CREATE TABLE accounting_bank_matches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, reconciliation_id uuid NOT NULL, match_type text NOT NULL CHECK(match_type IN('ONE_TO_ONE','ONE_TO_MANY','MANY_TO_ONE','SPLIT','MANUAL_ADJUSTMENT')), state text NOT NULL DEFAULT 'SUGGESTED' CHECK(state IN('SUGGESTED','MATCHED','REJECTED','VOIDED')), total_minor bigint NOT NULL CHECK(total_minor>0), journal_id uuid, created_by_user_id uuid REFERENCES users(id), confirmed_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,reconciliation_id) REFERENCES accounting_bank_reconciliations(tenant_id,id), FOREIGN KEY(journal_id) REFERENCES accounting_journals(id)
);
CREATE TABLE accounting_bank_match_allocations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, match_id uuid NOT NULL, statement_line_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(match_id,statement_line_id), FOREIGN KEY(tenant_id,match_id) REFERENCES accounting_bank_matches(tenant_id,id), FOREIGN KEY(tenant_id,statement_line_id) REFERENCES accounting_bank_statement_lines(tenant_id,id)
);
CREATE TABLE accounting_reconciliation_adjustment_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, reconciliation_id uuid NOT NULL, amount_minor bigint NOT NULL, reason text NOT NULL, state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','CANCELLED')), journal_id uuid, requested_by_user_id uuid REFERENCES users(id), approved_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,reconciliation_id) REFERENCES accounting_bank_reconciliations(tenant_id,id), FOREIGN KEY(journal_id) REFERENCES accounting_journals(id), CHECK(approved_by_user_id IS NULL OR requested_by_user_id IS NULL OR approved_by_user_id<>requested_by_user_id)
);

CREATE TABLE accounting_period_close_checklists(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, period_id uuid NOT NULL, item_code text NOT NULL, state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','PASSED','WAIVED','BLOCKED')), evidence_json jsonb NOT NULL DEFAULT '{}', approved_by_user_id uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(period_id,item_code), FOREIGN KEY(tenant_id,period_id) REFERENCES accounting_periods(tenant_id,id)
);
CREATE TABLE accounting_period_close_history(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, period_id uuid NOT NULL, from_state text, to_state text NOT NULL, actor_user_id uuid REFERENCES users(id), reason text NOT NULL, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,period_id) REFERENCES accounting_periods(tenant_id,id)
);
CREATE TABLE accounting_statement_definitions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, code text NOT NULL, name text NOT NULL, statement_type text NOT NULL CHECK(statement_type IN('TRIAL_BALANCE','PROFIT_AND_LOSS','BALANCE_SHEET','CASH_FLOW','GENERAL_LEDGER','AP_AGING','AR_AGING','TAX_SUMMARY','LIABILITY_RECONCILIATION','INVENTORY_RECONCILIATION','BANK_RECONCILIATION')), definition_json jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true, UNIQUE(book_id,code), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);
CREATE TABLE accounting_statement_snapshots(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, period_id uuid, definition_id uuid NOT NULL, state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','GENERATED','APPROVED','FINAL','SUPERSEDED')), cutoff_at timestamptz NOT NULL, mapping_fingerprint text NOT NULL, source_fingerprint text NOT NULL, totals_json jsonb NOT NULL DEFAULT '{}', checksum text NOT NULL, generated_by_user_id uuid REFERENCES users(id), approved_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(book_id,definition_id,period_id,checksum), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id), FOREIGN KEY(period_id) REFERENCES accounting_periods(id), FOREIGN KEY(definition_id) REFERENCES accounting_statement_definitions(id), CHECK(approved_by_user_id IS NULL OR generated_by_user_id IS NULL OR approved_by_user_id<>generated_by_user_id)
);
CREATE TABLE accounting_statement_snapshot_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, snapshot_id uuid NOT NULL, account_id uuid, label text NOT NULL, debit_minor bigint NOT NULL DEFAULT 0, credit_minor bigint NOT NULL DEFAULT 0, balance_minor bigint NOT NULL DEFAULT 0, line_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,snapshot_id) REFERENCES accounting_statement_snapshots(tenant_id,id), FOREIGN KEY(account_id) REFERENCES accounting_accounts(id)
);
CREATE TABLE accounting_export_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, book_id uuid NOT NULL, export_type text NOT NULL, filters_json jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','PROCESSING','READY','FAILED')), storage_key text, checksum text, requested_by_user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,book_id) REFERENCES accounting_books(tenant_id,id)
);

CREATE OR REPLACE FUNCTION accounting_period_overlap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM accounting_periods p WHERE p.book_id=NEW.book_id AND p.id<>COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid) AND daterange(p.starts_on,p.ends_on,'[]') && daterange(NEW.starts_on,NEW.ends_on,'[]')) THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_OVERLAP' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_period_overlap_guard BEFORE INSERT OR UPDATE ON accounting_periods FOR EACH ROW EXECUTE FUNCTION accounting_period_overlap_guard();

CREATE OR REPLACE FUNCTION accounting_journal_post_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint;
BEGIN
  IF NEW.state='POSTED' AND OLD.state IS DISTINCT FROM 'POSTED' THEN
    IF NOT EXISTS(SELECT 1 FROM accounting_journal_lines l WHERE l.journal_id=NEW.id) THEN RAISE EXCEPTION 'JOURNAL_LINE_INVALID' USING ERRCODE='23514'; END IF;
    SELECT COALESCE(sum(functional_debit_minor),0),COALESCE(sum(functional_credit_minor),0) INTO d,c FROM accounting_journal_lines WHERE journal_id=NEW.id;
    IF d<>c THEN RAISE EXCEPTION 'JOURNAL_NOT_BALANCED' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM accounting_periods p WHERE p.id=NEW.period_id AND p.state IN('CLOSED','REOPEN_PENDING')) THEN RAISE EXCEPTION 'ACCOUNTING_PERIOD_CLOSED' USING ERRCODE='55000'; END IF;
    NEW.posted_at=COALESCE(NEW.posted_at,now());
  END IF;
  IF OLD.state='POSTED' AND (to_jsonb(NEW)-ARRAY['state','updated_at','version','posted_at','posted_by_user_id'])<>(to_jsonb(OLD)-ARRAY['state','updated_at','version','posted_at','posted_by_user_id']) THEN RAISE EXCEPTION 'JOURNAL_POSTED_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_journal_post_guard BEFORE UPDATE ON accounting_journals FOR EACH ROW EXECUTE FUNCTION accounting_journal_post_guard();
CREATE OR REPLACE FUNCTION accounting_posted_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM accounting_journals j WHERE j.id=COALESCE(OLD.journal_id,NEW.journal_id) AND j.state='POSTED') THEN RAISE EXCEPTION 'JOURNAL_POSTED_IMMUTABLE' USING ERRCODE='55000'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER accounting_posted_line_guard BEFORE UPDATE OR DELETE ON accounting_journal_lines FOR EACH ROW EXECUTE FUNCTION accounting_posted_line_guard();

CREATE OR REPLACE FUNCTION accounting_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACCOUNTING_APPEND_ONLY' USING ERRCODE='55000'; END $$;
CREATE TRIGGER accounting_journal_approval_append_only BEFORE UPDATE OR DELETE ON accounting_journal_approval_history FOR EACH ROW EXECUTE FUNCTION accounting_append_only_guard();
CREATE TRIGGER accounting_period_close_history_append_only BEFORE UPDATE OR DELETE ON accounting_period_close_history FOR EACH ROW EXECUTE FUNCTION accounting_append_only_guard();
CREATE TRIGGER accounting_statement_lines_append_only BEFORE UPDATE OR DELETE ON accounting_statement_snapshot_lines FOR EACH ROW EXECUTE FUNCTION accounting_append_only_guard();

INSERT INTO permissions(code,description) SELECT code,'Sprint 14 accounting and reconciliation permission' FROM unnest(ARRAY[
  'accounting.book.read','accounting.book.manage','accounting.account.read','accounting.account.manage','accounting.period.read','accounting.period.manage','accounting.period.close','accounting.period.reopen',
  'accounting.mapping.read','accounting.mapping.manage','accounting.tax.read','accounting.tax.manage','accounting.journal.read','accounting.journal.create','accounting.journal.submit','accounting.journal.approve','accounting.journal.post','accounting.journal.reverse','accounting.control_account.manual_post',
  'accounting.opening_balance.import','accounting.opening_balance.approve','accounting.backfill.preview','accounting.backfill.run','accounting.open_item.read','accounting.open_item.settle','accounting.open_item.write_off',
  'accounting.bank_account.read','accounting.bank_account.manage','accounting.bank_statement.import','accounting.bank_reconciliation.read','accounting.bank_reconciliation.manage','accounting.bank_reconciliation.close','accounting.bank_reconciliation.void',
  'accounting.report.read','accounting.statement.approve','accounting.export'
]) code ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'SALON_OWNER',code FROM permissions WHERE code LIKE 'accounting.%' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'ACCOUNTANT',code FROM permissions WHERE code LIKE 'accounting.%' AND code NOT IN('accounting.period.close','accounting.period.reopen','accounting.statement.approve','accounting.opening_balance.approve') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'BRANCH_MANAGER',code FROM permissions WHERE code IN('accounting.book.read','accounting.account.read','accounting.period.read','accounting.journal.read','accounting.open_item.read','accounting.bank_account.read','accounting.bank_reconciliation.read','accounting.report.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role,permission_code) SELECT 'CASHIER',code FROM permissions WHERE code IN('accounting.bank_reconciliation.read') ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('0028_general_ledger_accounting_bank_reconciliation');
COMMIT;
