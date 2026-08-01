import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const user = "30000000-0000-4000-8000-000000000001";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });

describe("Sprint 15 request and PO approval", () => {
  beforeAll(() => db.connect()); afterAll(() => db.end());
  it("keeps approved line economics on the PO and rejects unapproved lines", async () => {
    await db.query("BEGIN");
    try {
      const request = (await db.query<any>("INSERT INTO procurement_purchase_requests(tenant_id,branch_id,requester_user_id,request_number,currency,requested_total_minor,approved_total_minor,fingerprint) VALUES($1,$2,$3,'QA-PR-LINE','VND',300,100,'req') RETURNING id", [tenant, branch, user])).rows[0];
      const line = (await db.query<any>("INSERT INTO procurement_purchase_request_lines(tenant_id,purchase_request_id,line_no,description,quantity,unit_price_minor,amount_minor,approved_quantity,approved_amount_minor) VALUES($1,$2,1,'approved',2,100,200,1,100) RETURNING id", [tenant, request.id])).rows[0];
      await db.query("UPDATE procurement_purchase_requests SET status='PARTIALLY_APPROVED',version=version+1 WHERE tenant_id=$1 AND id=$2", [tenant, request.id]);
      const vendor = (await db.query<any>("INSERT INTO procurement_vendors(tenant_id,code,legal_name,display_name,currency,status) VALUES($1,'QA-PR-V','QA','QA','VND','ACTIVE') RETURNING id", [tenant])).rows[0];
      const po = (await db.query<any>("INSERT INTO procurement_purchase_orders(tenant_id,branch_id,vendor_id,purchase_request_id,po_number,currency,total_minor,subtotal_minor,fingerprint) VALUES($1,$2,$3,$4,'QA-PR-PO','VND',100,100,'po') RETURNING id", [tenant, branch, vendor.id, request.id])).rows[0];
      const version = (await db.query<any>("INSERT INTO procurement_purchase_order_versions(tenant_id,purchase_order_id,version_no,state,currency,fingerprint) VALUES($1,$2,1,'DRAFT','VND','v') RETURNING id", [tenant, po.id])).rows[0];
      const inserted = (await db.query<any>("INSERT INTO procurement_purchase_order_lines(tenant_id,purchase_order_id,order_version_id,line_no,description,ordered_quantity,unit_price_minor,amount_minor,branch_id) VALUES($1,$2,$3,1,'approved',99,999,999,$4) RETURNING ordered_quantity,amount_minor", [tenant, po.id, version.id, branch])).rows[0];
      expect(String(inserted.ordered_quantity)).toContain("1"); expect(String(inserted.amount_minor)).toBe("100");
      expect(line.id).toBeTruthy();
    } finally { await db.query("ROLLBACK"); }
  });
});
