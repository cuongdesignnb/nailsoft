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

  it("enforces Sprint 15 closure guards for transitions, source events and posted bills", async () => {
    await db.query("BEGIN");
    try {
      const vendor = (await db.query<any>("INSERT INTO procurement_vendors(tenant_id,code,legal_name,display_name,currency,status) VALUES($1,'QA15-G','Guard Vendor','Guard Vendor','VND','ACTIVE') RETURNING id", [tenant])).rows[0];
      const bill = (await db.query<any>("INSERT INTO procurement_vendor_bills(tenant_id,branch_id,vendor_id,bill_number,normalized_invoice_number,invoice_date,due_date,currency,total_minor,fingerprint,status,version) VALUES($1,$2,$3,'QA-15-G','QA15G','2097-01-01','2097-01-31','VND',1000,'guard','POSTED',1) RETURNING id", [tenant, branch, vendor.id])).rows[0];
      await db.query("SAVEPOINT posted_bill_guard");
      await expect(db.query("UPDATE procurement_vendor_bills SET total_minor=2000 WHERE tenant_id=$1 AND id=$2", [tenant, bill.id])).rejects.toMatchObject({ code: "55000" });
      await db.query("ROLLBACK TO SAVEPOINT posted_bill_guard");
      const po = (await db.query<any>("INSERT INTO procurement_purchase_orders(tenant_id,branch_id,vendor_id,po_number,currency,total_minor,subtotal_minor,fingerprint) VALUES($1,$2,$3,'QA-PO-G','VND',1000,1000,'po-guard') RETURNING id", [tenant, branch, vendor.id])).rows[0];
      const version = (await db.query<any>("INSERT INTO procurement_purchase_order_versions(tenant_id,purchase_order_id,version_no,state,currency,fingerprint) VALUES($1,$2,1,'APPROVED','VND','po-version') RETURNING id", [tenant, po.id])).rows[0];
      const receipt = (await db.query<any>("INSERT INTO procurement_receipts(tenant_id,branch_id,purchase_order_id,order_version_id,receipt_number,received_at,status,version) VALUES($1,$2,$3,$4,'QA-GRN',now(),'DRAFT',1) RETURNING id", [tenant, branch, po.id, version.id])).rows[0];
      await db.query("SAVEPOINT receipt_guard");
      await expect(db.query("UPDATE procurement_receipts SET status='ACCEPTED',version=version+1 WHERE tenant_id=$1 AND id=$2", [tenant, receipt.id])).rejects.toMatchObject({ code: "P0001" });
      await db.query("ROLLBACK TO SAVEPOINT receipt_guard");
      const item = (await db.query<any>("SELECT id FROM inventory_items WHERE tenant_id=$1 LIMIT 1", [tenant])).rows[0];
      const location = (await db.query<any>("SELECT id FROM inventory_locations WHERE tenant_id=$1 AND branch_id=$2 LIMIT 1", [tenant, branch])).rows[0];
      if (item && location) {
        await db.query("INSERT INTO procurement_inventory_source_events(tenant_id,source_type,source_id,operation,branch_id,item_id,location_id,quantity,fingerprint,request_id) VALUES($1,'QA',$2,'RECEIPT',$3,$4,$5,1,'guard','qa')", [tenant, bill.id, branch, item.id, location.id]);
        await db.query("SAVEPOINT source_guard");
        await expect(db.query("INSERT INTO procurement_inventory_source_events(tenant_id,source_type,source_id,operation,branch_id,item_id,location_id,quantity,fingerprint,request_id) VALUES($1,'QA',$2,'RECEIPT',$3,$4,$5,1,'guard2','qa2')", [tenant, bill.id, branch, item.id, location.id])).rejects.toMatchObject({ code: "23505" });
        await db.query("ROLLBACK TO SAVEPOINT source_guard");
      }
    } finally {
      await db.query("ROLLBACK");
    }
  });
});
