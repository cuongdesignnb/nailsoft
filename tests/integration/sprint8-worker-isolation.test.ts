import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { BenefitMaintenanceProcessor } from "../../apps/worker/src/benefit-maintenance.processor.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";

describe("Sprint 8 Worker transaction isolation", () => {
  const processor = new BenefitMaintenanceProcessor();
  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("dead-letters one failed job without rolling back a valid job", async () => {
    await pool.query(
      `INSERT INTO benefit_jobs(tenant_id,job_type,aggregate_id,generation_key,status,run_at,max_attempts,payload_json)
       VALUES
       ($1,'RESERVATION_EXPIRY','cf500000-0000-4000-8000-000000000001','test:worker:bad','PENDING',now(),1,'{}'),
       ($1,'MEMBERSHIP_EVALUATION','60000000-0000-4000-8000-000000000005','test:worker:good','PENDING',now(),5,
         '{"customerId":"60000000-0000-4000-8000-000000000005"}')`,
      [tenant],
    );
    await processor.jobs();
    const rows = await pool.query(
      `SELECT generation_key,status,last_error_code FROM benefit_jobs
       WHERE tenant_id=$1 AND generation_key IN('test:worker:bad','test:worker:good') ORDER BY generation_key`,
      [tenant],
    );
    expect(rows.rows).toEqual([
      {
        generation_key: "test:worker:bad",
        status: "DEAD_LETTER",
        last_error_code: "UNSUPPORTED_BENEFIT_JOB",
      },
      {
        generation_key: "test:worker:good",
        status: "COMPLETED",
        last_error_code: null,
      },
    ]);
  });
});
