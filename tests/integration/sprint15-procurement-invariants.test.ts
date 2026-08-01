import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const owner = "30000000-0000-4000-8000-000000000001";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });

describe("Sprint 15 procurement PostgreSQL invariants", () => {
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  it("keeps vendor invoices unique and AP balances capped", async () => {
    await db.query("BEGIN");
    try {
      const vendor = (await db.query<any>("INSERT INTO procurement_vendors(tenant_id,code,legal_name,display_name,currency,status) VALUES($1,'QA15-V','QA Vendor','QA Vendor','VND','ACTIVE') RETURNING id", [tenant])).rows[0];
      const bill = (await db.query<any>("INSERT INTO procurement_vendor_bills(tenant_id,branch_id,vendor_id,bill_number,normalized_invoice_number,invoice_date,due_date,currency,total_minor,fingerprint) VALUES($1,$2,$3,'QA-15-001','QA15001','2097-01-01','2097-01-31','VND',1000,'qa15') RETURNING id", [tenant, branch, vendor.id])).rows[0];
      await db.query("SAVEPOINT duplicate_invoice");
      await expect(db.query("INSERT INTO procurement_vendor_bills(tenant_id,branch_id,vendor_id,bill_number,normalized_invoice_number,invoice_date,due_date,currency,total_minor,fingerprint) VALUES($1,$2,$3,'QA-15-DUP','QA15001','2097-01-01','2097-01-31','VND',1000,'qa15dup')", [tenant, branch, vendor.id])).rejects.toMatchObject({ code: "23505" });
      await db.query("ROLLBACK TO SAVEPOINT duplicate_invoice");
      const open = (await db.query<any>("INSERT INTO procurement_ap_open_items(tenant_id,vendor_id,vendor_bill_id,branch_id,due_date,original_minor) VALUES($1,$2,$3,$4,'2097-01-31',1000) RETURNING id", [tenant, vendor.id, bill.id, branch])).rows[0];
      await db.query("SAVEPOINT ap_cap");
      await expect(db.query("UPDATE procurement_ap_open_items SET paid_minor=900,credited_minor=200 WHERE tenant_id=$1 AND id=$2", [tenant, open.id])).rejects.toMatchObject({ code: "23514" });
      await db.query("ROLLBACK TO SAVEPOINT ap_cap");
      await db.query("INSERT INTO procurement_vendor_bill_history(tenant_id,vendor_bill_id,from_status,to_status,actor_user_id,request_id) VALUES($1,$2,NULL,'DRAFT',$3,'qa15')", [tenant, bill.id, owner]);
      await db.query("SAVEPOINT append_only");
      await expect(db.query("DELETE FROM procurement_vendor_bill_history WHERE tenant_id=$1 AND vendor_bill_id=$2", [tenant, bill.id])).rejects.toMatchObject({ code: "55000" });
      await db.query("ROLLBACK TO SAVEPOINT append_only");
    } finally {
      await db.query("ROLLBACK");
    }
  });
});
