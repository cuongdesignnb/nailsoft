import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool, tenant } from "./sprint12-closure-helpers";

const bookId = "a0000000-0000-4000-8000-000000000001";
const fiscalYearId = "a1000000-0000-4000-8000-000000000001";
const periodId = "a2000000-0000-4000-8000-000000000001";
const bankAccountId = "a3000000-0000-4000-8000-000000000001";
const bankGlId = "a4000000-0000-4000-8000-000000000001";
const offsetAccountId = "a4000000-0000-4000-8000-000000000002";
const importId = "a5000000-0000-4000-8000-000000000001";
const statementLineId = "a6000000-0000-4000-8000-000000000001";
const concurrentStatementLineId = "a6000000-0000-4000-8000-000000000002";
const reconciliationId = "a7000000-0000-4000-8000-000000000001";
const managerUser = "30000000-0000-4000-8000-000000000002";
const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 20 Wave 2 accounting reconciliation closure", () => {
  beforeAll(async () => {
    app = await apiApp();
    await db.query(
      `INSERT INTO accounting_books(id,tenant_id,code,name,functional_currency,timezone,status,configuration_status,posting_mode)
       VALUES($1,$2,'W2','Wave 2 test book','VND','Asia/Ho_Chi_Minh','ACTIVE','ACTIVE','REVIEW_REQUIRED')`,
      [bookId, tenant],
    );
    await db.query(
      `INSERT INTO accounting_fiscal_years(id,tenant_id,book_id,year_no,starts_on,ends_on)
       VALUES($1,$2,$3,2026,'2026-01-01','2026-12-31')`,
      [fiscalYearId, tenant, bookId],
    );
    await db.query(
      `INSERT INTO accounting_periods(id,tenant_id,book_id,fiscal_year_id,code,starts_on,ends_on,state)
       VALUES($1,$2,$3,$4,'W2-2026','2026-01-01','2026-12-31','OPEN')`,
      [periodId, tenant, bookId, fiscalYearId],
    );
    await db.query(
      `INSERT INTO accounting_accounts(id,tenant_id,book_id,code,name,account_type,control_class,active)
       VALUES($1,$2,$3,'1100','Wave 2 bank','ASSET','BANK',true),
             ($4,$2,$3,'6100','Wave 2 offset','EXPENSE','OTHER_EXPENSE',true)`,
      [bankGlId, tenant, bookId, offsetAccountId],
    );
    await db.query(
      `INSERT INTO accounting_bank_accounts(id,tenant_id,book_id,account_id,bank_name,account_reference_redacted,currency)
       VALUES($1,$2,$3,$4,'Wave 2 Bank','****0001','VND')`,
      [bankAccountId, tenant, bookId, bankGlId],
    );
    await db.query(
      `INSERT INTO accounting_bank_statement_imports(id,tenant_id,bank_account_id,format,file_checksum,state,imported_by_user_id)
       VALUES($1,$2,$3,'MANUAL','wave2-fixture','READY',$4)`,
      [importId, tenant, bankAccountId, "30000000-0000-4000-8000-000000000001"],
    );
    await db.query(
      `INSERT INTO accounting_bank_statement_lines(id,tenant_id,import_id,bank_account_id,line_no,transaction_date,amount_minor,currency,direction,reference,description,fingerprint)
       VALUES($1,$2,$3,$4,1,'2026-06-15',10000,'VND','DEBIT','W2-1','Wave 2 fixture','wave2-fixture-line')`,
      [statementLineId, tenant, importId, bankAccountId],
    );
    await db.query(
      `INSERT INTO accounting_bank_statement_lines(id,tenant_id,import_id,bank_account_id,line_no,transaction_date,amount_minor,currency,direction,reference,description,fingerprint)
       VALUES($1,$2,$3,$4,2,'2026-06-15',12000,'VND','DEBIT','W2-2','Wave 2 concurrency fixture','wave2-concurrency-line')`,
      [concurrentStatementLineId, tenant, importId, bankAccountId],
    );
    await db.query(
      `INSERT INTO accounting_bank_reconciliations(id,tenant_id,bank_account_id,period_id,state,statement_balance_minor,ledger_balance_minor,difference_minor,created_by_user_id)
       VALUES($1,$2,$3,$4,'MATCHING',15000,10000,5000,$5)`,
      [reconciliationId, tenant, bankAccountId, periodId, "30000000-0000-4000-8000-000000000001"],
    );
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("excludes/restores a statement line with version and idempotency guards", async () => {
    const owner = await login(app, "owner@example.test");
    const excludePayload = { version: 1, expectedMatchState: "UNMATCHED", reason: "Wave 2 exclusion test" };
    const first = await app.inject({ method: "POST", url: `/v1/accounting/bank-accounts/${bankAccountId}/statement-lines/${statementLineId}/exclude`, headers: command(owner, "w2-exclude-0001"), payload: excludePayload });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().data).toMatchObject({ matchState: "EXCLUDED", version: 2 });
    const replay = await app.inject({ method: "POST", url: `/v1/accounting/bank-accounts/${bankAccountId}/statement-lines/${statementLineId}/exclude`, headers: command(owner, "w2-exclude-0001"), payload: excludePayload });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data.version).toBe(2);
    const reused = await app.inject({ method: "POST", url: `/v1/accounting/bank-accounts/${bankAccountId}/statement-lines/${statementLineId}/exclude`, headers: command(owner, "w2-exclude-0001"), payload: { ...excludePayload, reason: "different body" } });
    expect(reused.statusCode, reused.body).toBe(409);
    expect(reused.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const stale = await app.inject({ method: "POST", url: `/v1/accounting/bank-accounts/${bankAccountId}/statement-lines/${statementLineId}/restore`, headers: command(owner, "w2-restore-stale"), payload: { version: 1, reason: "stale" } });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe("VERSION_CONFLICT");
    const restored = await app.inject({ method: "POST", url: `/v1/accounting/bank-accounts/${bankAccountId}/statement-lines/${statementLineId}/restore`, headers: command(owner, "w2-restore-0001"), payload: { version: 2, reason: "Wave 2 restore test" } });
    expect(restored.statusCode, restored.body).toBe(201);
    expect(restored.json().data).toMatchObject({ matchState: "UNMATCHED", version: 3 });
  });

  it("runs the adjustment lifecycle and posts one balanced bank-adjustment journal", async () => {
    const owner = await login(app, "owner@example.test");
    const created = await app.inject({ method: "POST", url: `/v1/accounting/bank-reconciliations/${reconciliationId}/adjustments`, headers: command(owner, "w2-adjust-create"), payload: { amountMinor: "5000", direction: "DEBIT", offsetAccountId, accountingDate: "2026-06-15", reason: "Wave 2 adjustment test" } });
    expect(created.statusCode, created.body).toBe(201);
    const adjustmentId = created.json().data.id as string;
    expect(created.json().data).toMatchObject({ state: "DRAFT", version: 1, direction: "DEBIT" });
    const submitted = await app.inject({ method: "POST", url: `/v1/accounting/reconciliation-adjustments/${adjustmentId}/submit`, headers: command(owner, "w2-adjust-submit"), payload: { version: 1 } });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const submitCommand = await db.query<any>("SELECT operation FROM accounting_command_idempotency WHERE tenant_id=$1 AND idempotency_key=$2", [tenant, "w2-adjust-submit"]);
    expect(submitCommand.rows[0]?.operation).toBe("accounting.reconciliation_adjustment.submit");
    const selfApprove = await app.inject({ method: "POST", url: `/v1/accounting/reconciliation-adjustments/${adjustmentId}/approve`, headers: command(owner, "w2-adjust-self-approve"), payload: { version: 2 } });
    expect(selfApprove.statusCode, selfApprove.body).toBe(403);
    expect(selfApprove.json().error.code).toBe("ACCOUNTING_RECONCILIATION_SELF_APPROVAL_DENIED");
    await db.query("UPDATE accounting_reconciliation_adjustment_requests SET requested_by_user_id=$2 WHERE tenant_id=$1 AND id=$3", [tenant, managerUser, adjustmentId]);
    const approved = await app.inject({ method: "POST", url: `/v1/accounting/reconciliation-adjustments/${adjustmentId}/approve`, headers: command(owner, "w2-adjust-approve"), payload: { version: 2 } });
    expect(approved.statusCode, approved.body).toBe(201);
    const posted = await app.inject({ method: "POST", url: `/v1/accounting/reconciliation-adjustments/${adjustmentId}/post`, headers: command(owner, "w2-adjust-post"), payload: { version: 3 } });
    expect(posted.statusCode, posted.body).toBe(201);
    const postedReplay = await app.inject({ method: "POST", url: `/v1/accounting/reconciliation-adjustments/${adjustmentId}/post`, headers: command(owner, "w2-adjust-post"), payload: { version: 3 } });
    expect(postedReplay.statusCode, postedReplay.body).toBe(201);
    expect(postedReplay.json().data.adjustment.version).toBe(4);
    expect(posted.json().data.adjustment).toMatchObject({ state: "POSTED", version: 4 });
    const journal = await db.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND source_id=$2", [tenant, adjustmentId]);
    expect(journal.rowCount).toBe(1);
    expect(journal.rows[0].state).toBe("POSTED");
    expect(journal.rows[0].source_type).toBe("ACCOUNTING_RECONCILIATION_ADJUSTMENT");
    const totals = await db.query<any>("SELECT sum(debit_minor)::text debit,sum(credit_minor)::text credit FROM accounting_journal_lines WHERE tenant_id=$1 AND journal_id=$2", [tenant, journal.rows[0].id]);
    expect(totals.rows[0]).toEqual({ debit: "5000", credit: "5000" });
    const reconciliation = await db.query<any>("SELECT ledger_balance_minor::text ledger,difference_minor::text difference FROM accounting_bank_reconciliations WHERE id=$1", [reconciliationId]);
    expect(reconciliation.rows[0]).toEqual({ ledger: "15000", difference: "0" });
  });

  it("serializes concurrent statement-line commands with one winning version", async () => {
    const owner = await login(app, "owner@example.test");
    const payload = { version: 1, expectedMatchState: "UNMATCHED", reason: "Concurrent exclusion test" };
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/accounting/bank-accounts/${bankAccountId}/statement-lines/${concurrentStatementLineId}/exclude`, headers: command(owner, "w2-concurrent-exclude-1"), payload }),
      app.inject({ method: "POST", url: `/v1/accounting/bank-accounts/${bankAccountId}/statement-lines/${concurrentStatementLineId}/exclude`, headers: command(owner, "w2-concurrent-exclude-2"), payload }),
    ]);
    const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    const conflict = first.statusCode === 409 ? first : second;
    expect(conflict.json().error.code).toBe("VERSION_CONFLICT");
    const line = await db.query<any>("SELECT match_state,version FROM accounting_bank_statement_lines WHERE tenant_id=$1 AND id=$2", [tenant, concurrentStatementLineId]);
    expect(line.rows[0]).toEqual({ match_state: "EXCLUDED", version: 2 });
  });
});
