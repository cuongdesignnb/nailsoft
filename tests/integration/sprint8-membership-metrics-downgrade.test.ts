import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { BenefitMaintenanceProcessor } from "../../apps/worker/src/benefit-maintenance.processor.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";
const customer = "60000000-0000-4000-8000-000000000004";
const actor = "30000000-0000-4000-8000-000000000002";

describe("Sprint 8 membership rolling metrics and downgrade", () => {
  const processor = new BenefitMaintenanceProcessor();
  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("rolls expired spend out and replaces an unqualified automatic tier", async () => {
    const old = await pool.query(
      "SELECT * FROM sprint8_membership_metrics($1,$2,now()+interval '2 years',30)",
      [tenant, customer],
    );
    expect(Number(old.rows[0].spend_minor)).toBe(0);

    await pool.query(
      `INSERT INTO membership_tiers(id,tenant_id,code,name_json,qualification_type,qualification_threshold,rolling_window_days,benefits_json,priority,effective_from,created_by_user_id)
       VALUES
       ('cf200000-0000-4000-8000-000000000001',$1,'CLOSE-LOW','{"en-US":"Low"}','ROLLING_SPEND',0,30,'[]',10,now()-interval '1 day',$2),
       ('cf200000-0000-4000-8000-000000000002',$1,'CLOSE-HIGH','{"en-US":"High"}','ROLLING_SPEND',999999999,30,'[]',20,now()-interval '1 day',$2)`,
      [tenant, actor],
    );
    await pool.query(
      `INSERT INTO customer_membership_assignments(
         tenant_id,customer_id,tier_id,status,effective_from,benefit_snapshot_json,
         qualification_snapshot_json,reason_code,assignment_source)
       VALUES($1,$2,'cf200000-0000-4000-8000-000000000002','ACTIVE',now()-interval '1 day','[]','{}','TEST_HIGH','AUTOMATIC')`,
      [tenant, customer],
    );
    await pool.query(
      `INSERT INTO benefit_jobs(tenant_id,job_type,aggregate_id,generation_key,run_at,payload_json)
       VALUES($1,'MEMBERSHIP_EVALUATION',$2,'test:membership:downgrade',now(),$3)`,
      [tenant, customer, JSON.stringify({ customerId: customer })],
    );
    await processor.jobs();
    const active = await pool.query(
      `SELECT a.tier_id,a.reason_code FROM customer_membership_assignments a
       WHERE a.tenant_id=$1 AND a.customer_id=$2 AND a.status='ACTIVE'`,
      [tenant, customer],
    );
    expect(active.rows).toEqual([
      {
        tier_id: "cf200000-0000-4000-8000-000000000001",
        reason_code: "AUTOMATIC_DOWNGRADE",
      },
    ]);
  });
});
