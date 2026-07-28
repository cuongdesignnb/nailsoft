import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  max: 12,
});
const tenant = "10000000-0000-4000-8000-000000000001";
const campaign = "c8000000-0000-4000-8000-000000000001";
const customer = "60000000-0000-4000-8000-000000000002";

describe("Sprint 8 voucher per-customer capacity", () => {
  afterAll(() => pool.end());

  it("serializes concurrent reservations across campaign codes", async () => {
    await pool.query(
      `INSERT INTO voucher_customer_usage(tenant_id,campaign_id,customer_id)
       VALUES($1,$2,$3) ON CONFLICT(tenant_id,campaign_id,customer_id)
       DO UPDATE SET active_reservations=0,net_committed_uses=0`,
      [tenant, campaign, customer],
    );
    const attempts = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`voucher-customer:${tenant}:${campaign}:${customer}`],
          );
          const result = await c.query(
            `UPDATE voucher_customer_usage SET active_reservations=active_reservations+1
             WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3
               AND active_reservations+net_committed_uses<1 RETURNING customer_id`,
            [tenant, campaign, customer],
          );
          await c.query("COMMIT");
          return result.rowCount;
        } catch (error) {
          await c.query("ROLLBACK");
          throw error;
        } finally {
          c.release();
        }
      }),
    );
    expect(attempts.filter((count) => count === 1)).toHaveLength(1);
  });
});
