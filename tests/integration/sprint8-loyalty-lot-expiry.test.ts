import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { BenefitMaintenanceProcessor } from "../../apps/worker/src/benefit-maintenance.processor.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";
const account = "c8000000-0000-4000-8000-000000000201";
const lot = "c8000000-0000-4000-8000-000000000203";

describe("Sprint 8 reserved loyalty lot expiry", () => {
  const processor = new BenefitMaintenanceProcessor();
  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("expires only the unreserved part of a FIFO lot", async () => {
    await pool.query(
      "UPDATE loyalty_accounts SET available_points=500,reserved_points=100 WHERE tenant_id=$1 AND id=$2",
      [tenant, account],
    );
    await pool.query(
      `UPDATE loyalty_point_lots SET available_points=400,reserved_points=100,status='AVAILABLE',expires_at=now()-interval '1 minute'
       WHERE tenant_id=$1 AND id=$2`,
      [tenant, lot],
    );
    await processor.expireLoyaltyLots();
    const result = await pool.query(
      `SELECT l.available_points,l.reserved_points,l.status,a.available_points account_available,a.reserved_points account_reserved
       FROM loyalty_point_lots l JOIN loyalty_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id
       WHERE l.tenant_id=$1 AND l.id=$2`,
      [tenant, lot],
    );
    expect(result.rows[0]).toEqual({
      available_points: "0",
      reserved_points: "100",
      status: "RESERVED",
      account_available: "100",
      account_reserved: "100",
    });
  });
});
