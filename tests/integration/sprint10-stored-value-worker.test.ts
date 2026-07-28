import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StoredValueMaintenanceProcessor } from "../../apps/worker/src/stored-value-maintenance.processor.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";
const account = "da300000-0000-4000-8000-000000000001";
const order = "a4000000-0000-4000-8000-000000000001";
const reservation = "daf00000-0000-4000-8000-000000000001";
const application = "daf10000-0000-4000-8000-000000000001";

describe.sequential("Sprint 10 stored-value Worker", () => {
  const processor = new StoredValueMaintenanceProcessor();

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO stored_value_ledger_entries(
           tenant_id,account_id,entry_type,available_delta_minor,reserved_delta_minor,
           currency,order_id,reservation_id,policy_snapshot_json,generation_key)
         VALUES($1,$2,'RESERVE',-1000,1000,'VND',$3,$4,'{"fixture":"worker"}',$5)`,
        [
          tenant,
          account,
          order,
          reservation,
          `test-worker-reserve:${reservation}`,
        ],
      );
      await client.query(
        "SELECT set_config('app.stored_value_posting','on',true)",
      );
      await client.query(
        `UPDATE stored_value_accounts
            SET available_minor=available_minor-1000,reserved_minor=reserved_minor+1000,
                version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [tenant, account],
      );
      await client.query(
        "SELECT set_config('app.stored_value_posting','off',true)",
      );
      await client.query(
        `INSERT INTO stored_value_reservations(
           id,tenant_id,account_id,order_id,customer_id,currency,requested_minor,
           accepted_minor,status,expires_at,generation_key)
         SELECT $1,$2,$3,o.id,o.customer_id,o.currency,1000,1000,'ACTIVE',now()-interval '1 minute',$4
           FROM pos_orders o WHERE o.tenant_id=$2 AND o.id=$5`,
        [reservation, tenant, account, `test-worker:${reservation}`, order],
      );
      await client.query(
        `INSERT INTO pos_order_stored_value_applications(
           id,tenant_id,order_id,account_id,reservation_id,application_type,
           requested_minor,accepted_minor,currency,status)
         VALUES($1,$2,$3,$4,$5,'GIFT_CARD',1000,1000,'VND','RESERVED')`,
        [application, tenant, order, account, reservation],
      );
      await client.query(
        `UPDATE pos_orders
            SET amount_paid_minor=amount_paid_minor+1000,amount_due_minor=amount_due_minor-1000,
                status='PARTIALLY_PAID',version=version+1
          WHERE tenant_id=$1 AND id=$2`,
        [tenant, order],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("releases an expired reservation once and restores order/account projections", async () => {
    expect(await processor.expireReservations()).toBeGreaterThanOrEqual(1);
    expect(await processor.expireReservations()).toBe(0);
    const row = (
      await pool.query(
        `SELECT r.status reservation_status,app.status application_status,
                a.available_minor::text,a.reserved_minor::text,
                o.status order_status,o.amount_paid_minor::text,o.amount_due_minor::text,
                (SELECT count(*)::int FROM stored_value_ledger_entries l
                  WHERE l.tenant_id=r.tenant_id AND l.reservation_id=r.id) ledger_entries
           FROM stored_value_reservations r
           JOIN pos_order_stored_value_applications app ON app.tenant_id=r.tenant_id AND app.reservation_id=r.id
           JOIN stored_value_accounts a ON a.tenant_id=r.tenant_id AND a.id=r.account_id
           JOIN pos_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id
          WHERE r.tenant_id=$1 AND r.id=$2`,
        [tenant, reservation],
      )
    ).rows[0];
    expect(row).toMatchObject({
      reservation_status: "EXPIRED",
      application_status: "EXPIRED",
      available_minor: "500000",
      reserved_minor: "0",
      order_status: "DRAFT",
      amount_paid_minor: "0",
      amount_due_minor: "110000",
      ledger_entries: 2,
    });
  });
});
