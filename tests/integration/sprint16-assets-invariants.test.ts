import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const runTag = randomUUID().slice(0, 8).toUpperCase();
const categoryCode = `QA16-${runTag}`;
const candidateNumber = `QA16-C-${runTag}`;
const assetCode = `QA16-A-${runTag}`;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft" });

describe("Sprint 16 PostgreSQL asset invariants", () => {
  beforeAll(() => db.connect());
  afterAll(() => db.end());
  it("keeps module opt-in and source generation unique", async () => {
    const config = (await db.query<any>("SELECT status FROM asset_module_configurations WHERE tenant_id=$1", [tenant])).rows[0];
    expect(config ?? { status: "DISABLED" }).toMatchObject({ status: "DISABLED" });
    const category = (await db.query<any>("INSERT INTO asset_categories(tenant_id,code,name) VALUES($1,$2,'QA Assets') RETURNING id", [tenant, categoryCode])).rows[0];
    const candidate = (await db.query<any>("INSERT INTO asset_candidates(tenant_id,branch_id,candidate_number,name,currency,eligible_amount_minor) VALUES($1,$2,$3,'QA Asset','VND',1000) RETURNING id", [tenant, branch, candidateNumber])).rows[0];
    await db.query("INSERT INTO asset_candidate_source_allocations(tenant_id,candidate_id,source_type,source_id,eligible_amount_minor,allocated_amount_minor,fingerprint) VALUES($1,$2,'QA',$3,1000,0,'qa16')", [tenant, candidate.id, category.id]);
    await expect(db.query("INSERT INTO asset_candidate_source_allocations(tenant_id,candidate_id,source_type,source_id,eligible_amount_minor,allocated_amount_minor,fingerprint) VALUES($1,$2,'QA',$3,1000,0,'qa16-replay')", [tenant, candidate.id, category.id])).rejects.toMatchObject({ code: "23505" });
  });
  it("rejects economics mutation after activation and protects count snapshots", async () => {
    const category=(await db.query<any>("SELECT id FROM asset_categories WHERE tenant_id=$1 AND code=$2 LIMIT 1",[tenant,categoryCode])).rows[0];
    const asset=(await db.query<any>("INSERT INTO assets(tenant_id,branch_id,category_id,asset_code,name,status,currency,gross_carrying_amount_minor,residual_value_minor) VALUES($1,$2,$3,$4,'QA Asset','ACTIVE','VND',1000,100) RETURNING id",[tenant,branch,category.id,assetCode])).rows[0];
    await expect(db.query("UPDATE assets SET gross_carrying_amount_minor=900 WHERE tenant_id=$1 AND id=$2",[tenant,asset.id])).rejects.toMatchObject({ code: "55000" });
    const count=(await db.query<any>("INSERT INTO asset_count_sessions(tenant_id,branch_id,status,expected_snapshot_json) VALUES($1,$2,'OPEN','[]') RETURNING id",[tenant,branch])).rows[0];
    await expect(db.query("UPDATE asset_count_sessions SET expected_snapshot_json='[{\"changed\":true}]' WHERE tenant_id=$1 AND id=$2",[tenant,count.id])).rejects.toMatchObject({ code: "55000" });
  });
});
