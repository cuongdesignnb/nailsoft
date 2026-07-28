import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { BenefitMaintenanceProcessor } from "../../apps/worker/src/benefit-maintenance.processor.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";

describe("Sprint 8 loyalty refund-safe settlement", () => {
  const processor = new BenefitMaintenanceProcessor();
  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("does not settle a fully reversed pending earn", async () => {
    const account = "cf100000-0000-4000-8000-000000000001";
    const source = "cf100000-0000-4000-8000-000000000002";
    const aggregate = "cf100000-0000-4000-8000-000000000003";
    const program = (
      await pool.query(
        "SELECT id FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' LIMIT 1",
        [tenant],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO loyalty_accounts(id,tenant_id,customer_id,pending_points,available_points,lifetime_earned_points)
       VALUES($1,$2,'60000000-0000-4000-8000-000000000002',0,0,0)`,
      [account, tenant],
    );
    await pool.query(
      `INSERT INTO loyalty_ledger_entries(id,tenant_id,account_id,customer_id,program_id,entry_type,pending_delta,lifetime_delta,policy_snapshot_json,generation_key)
       VALUES($1,$2,$3,'60000000-0000-4000-8000-000000000002',$4,'EARN_PENDING',100,100,'{}','test:earn:full')`,
      [source, tenant, account, program],
    );
    await pool.query(
      `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,program_id,entry_type,pending_delta,lifetime_delta,policy_snapshot_json,generation_key)
       VALUES($1,$2,'60000000-0000-4000-8000-000000000002',$3,'REFUND_REVERSAL',-100,-100,$4,'test:refund:full')`,
      [
        tenant,
        account,
        program,
        JSON.stringify({ sourceEarnLedgerEntryId: source }),
      ],
    );
    await pool.query(
      `INSERT INTO benefit_jobs(tenant_id,job_type,aggregate_id,generation_key,run_at,payload_json)
       VALUES($1,'LOYALTY_SETTLEMENT',$2,'test:settle:full',now(),$3)`,
      [
        tenant,
        aggregate,
        JSON.stringify({
          points: "100",
          earnGeneration: "test:earn:full",
        }),
      ],
    );
    await processor.jobs();
    const result = await pool.query(
      `SELECT status,payload_json->>'settlementResult' result,
        (SELECT count(*)::int FROM loyalty_point_lots WHERE tenant_id=$1 AND account_id=$2) lots
       FROM benefit_jobs WHERE tenant_id=$1 AND generation_key='test:settle:full'`,
      [tenant, account],
    );
    expect(result.rows[0]).toEqual({
      status: "COMPLETED",
      result: "NO_REMAINING_POINTS",
      lots: 0,
    });
  });
});
