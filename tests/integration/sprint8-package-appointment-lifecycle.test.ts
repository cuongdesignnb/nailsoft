import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { BenefitMaintenanceProcessor } from "../../apps/worker/src/benefit-maintenance.processor.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";

describe("Sprint 8 package appointment lifecycle", () => {
  const processor = new BenefitMaintenanceProcessor();
  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("keeps a package reservation while service runs past scheduled end", async () => {
    const appointment = "70000000-0000-4000-8000-000000000001";
    await pool.query(
      "UPDATE appointments SET status='IN_SERVICE',updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [tenant, appointment],
    );
    await pool.query(
      `UPDATE customer_package_entitlements SET available_units=available_units-1,reserved_units=reserved_units+1
       WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000403'`,
      [tenant],
    );
    await pool.query(
      `INSERT INTO package_reservations(
         id,tenant_id,entitlement_id,customer_id,branch_id,appointment_id,appointment_item_id,
         service_id,units,policy_snapshot_json,generation_key,expires_at,created_at)
       VALUES('cf300000-0000-4000-8000-000000000001',$1,
         'c8000000-0000-4000-8000-000000000403','60000000-0000-4000-8000-000000000001',
         '20000000-0000-4000-8000-000000000001',$2,'72000000-0000-4000-8000-000000000001',
         '50000000-0000-4000-8000-000000000001',1,'{}','test:appointment:late',
         now()-interval '1 hour',now()-interval '2 hours')`,
      [tenant, appointment],
    );
    await processor.expirePackageReservations();
    const row = await pool.query(
      "SELECT status FROM package_reservations WHERE id='cf300000-0000-4000-8000-000000000001'",
    );
    expect(row.rows[0].status).toBe("ACTIVE");
  });
});
