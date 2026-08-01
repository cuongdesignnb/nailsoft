import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const tenant = "10000000-0000-4000-8000-000000000001";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });
describe("Sprint 15 receipt inventory source events", () => {
  beforeAll(() => db.connect()); afterAll(() => db.end());
  it("deduplicates the same receipt operation", async () => {
    await db.query("BEGIN");
    try {
      const branch = "20000000-0000-4000-8000-000000000001";
      const item = (await db.query<any>("SELECT id FROM inventory_items WHERE tenant_id=$1 LIMIT 1", [tenant])).rows[0];
      const location = (await db.query<any>("SELECT id FROM inventory_locations WHERE tenant_id=$1 AND branch_id=$2 LIMIT 1", [tenant, branch])).rows[0];
      if (!item || !location) return;
      const source = "00000000-0000-4000-8000-000000000015";
      const first = await db.query("INSERT INTO procurement_inventory_source_events(tenant_id,source_type,source_id,operation,branch_id,item_id,location_id,quantity,fingerprint,request_id) VALUES($1,'PROCUREMENT_RECEIPT',$2,'RECEIPT',$3,$4,$5,1,'a','r') ON CONFLICT DO NOTHING RETURNING id", [tenant, source, branch, item.id, location.id]);
      const second = await db.query("INSERT INTO procurement_inventory_source_events(tenant_id,source_type,source_id,operation,branch_id,item_id,location_id,quantity,fingerprint,request_id) VALUES($1,'PROCUREMENT_RECEIPT',$2,'RECEIPT',$3,$4,$5,1,'b','r2') ON CONFLICT DO NOTHING RETURNING id", [tenant, source, branch, item.id, location.id]);
      expect(first.rowCount).toBe(1); expect(second.rowCount).toBe(0);
    } finally { await db.query("ROLLBACK"); }
  });
});
