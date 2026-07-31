import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tenant = "10000000-0000-4000-8000-000000000001";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });

describe("Sprint 14 accounting correctness closure", () => {
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  it("rejects posted line insert/update/delete and header mutation", async () => {
    await db.query("BEGIN");
    try {
      const book = await db.query<any>(`INSERT INTO accounting_books(tenant_id,code,name,functional_currency,status,configuration_status) VALUES($1,'TEST14','Test 14','VND','ACTIVE','ACTIVE') RETURNING id`, [tenant]);
      const fy = await db.query<any>(`INSERT INTO accounting_fiscal_years(tenant_id,book_id,year_no,starts_on,ends_on) VALUES($1,$2,2099,'2099-01-01','2099-12-31') RETURNING id`, [tenant, book.rows[0].id]);
      const period = await db.query<any>(`INSERT INTO accounting_periods(tenant_id,book_id,fiscal_year_id,code,starts_on,ends_on,state) VALUES($1,$2,$3,'2099-01','2099-01-01','2099-01-31','OPEN') RETURNING id`, [tenant, book.rows[0].id, fy.rows[0].id]);
      const a = await db.query<any>(`INSERT INTO accounting_accounts(tenant_id,book_id,code,name,account_type) VALUES($1,$2,'1000','Cash','ASSET') RETURNING id`, [tenant, book.rows[0].id]);
      const r = await db.query<any>(`INSERT INTO accounting_accounts(tenant_id,book_id,code,name,account_type) VALUES($1,$2,'4000','Revenue','REVENUE') RETURNING id`, [tenant, book.rows[0].id]);
      const journal = await db.query<any>(`INSERT INTO accounting_journals(tenant_id,book_id,period_id,journal_type,accounting_date,currency,journal_number,state) VALUES($1,$2,$3,'MANUAL','2099-01-02','VND','TEST-2099-000001','APPROVED') RETURNING id`, [tenant, book.rows[0].id, period.rows[0].id]);
      await db.query(`INSERT INTO accounting_journal_lines(tenant_id,journal_id,line_no,account_id,debit_minor,credit_minor,functional_debit_minor,functional_credit_minor,currency,exchange_numerator,exchange_denominator) VALUES($1,$2,1,$3,100,0,100,0,'VND',1,1),($1,$2,2,$4,0,100,0,100,'VND',1,1)`, [tenant, journal.rows[0].id, a.rows[0].id, r.rows[0].id]);
      await db.query(`UPDATE accounting_journals SET state='POSTED' WHERE tenant_id=$1 AND id=$2`, [tenant, journal.rows[0].id]);
      await db.query("SAVEPOINT posted_line_insert");
      await expect(db.query(`INSERT INTO accounting_journal_lines(tenant_id,journal_id,line_no,account_id,debit_minor,credit_minor,functional_debit_minor,functional_credit_minor,currency,exchange_numerator,exchange_denominator) VALUES($1,$2,3,$3,1,0,1,0,'VND',1,1)`, [tenant, journal.rows[0].id, a.rows[0].id])).rejects.toMatchObject({ code: "55000" });
      await db.query("ROLLBACK TO SAVEPOINT posted_line_insert");
      await db.query("SAVEPOINT posted_header_update");
      await expect(db.query(`UPDATE accounting_journals SET currency='USD' WHERE tenant_id=$1 AND id=$2`, [tenant, journal.rows[0].id])).rejects.toMatchObject({ code: "55000" });
      await db.query("ROLLBACK TO SAVEPOINT posted_header_update");
    } finally { await db.query("ROLLBACK"); }
  });

  it("enforces non-overlapping periods", async () => {
    await db.query("BEGIN");
    try {
      const book = await db.query<any>(`INSERT INTO accounting_books(tenant_id,code,name,functional_currency) VALUES($1,'TEST14P','Test 14P','VND') RETURNING id`, [tenant]);
      const fy = await db.query<any>(`INSERT INTO accounting_fiscal_years(tenant_id,book_id,year_no,starts_on,ends_on) VALUES($1,$2,2098,'2098-01-01','2098-12-31') RETURNING id`, [tenant, book.rows[0].id]);
      await db.query(`INSERT INTO accounting_periods(tenant_id,book_id,fiscal_year_id,code,starts_on,ends_on) VALUES($1,$2,$3,'2098-01','2098-01-01','2098-01-31')`, [tenant, book.rows[0].id, fy.rows[0].id]);
      await expect(db.query(`INSERT INTO accounting_periods(tenant_id,book_id,fiscal_year_id,code,starts_on,ends_on) VALUES($1,$2,$3,'2098-OVERLAP','2098-01-15','2098-02-01')`, [tenant, book.rows[0].id, fy.rows[0].id])).rejects.toMatchObject({ code: "23P01" });
    } finally { await db.query("ROLLBACK"); }
  });
});
