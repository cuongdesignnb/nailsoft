import pg from "pg";
import { randomUUID } from "node:crypto";
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
const runId = randomUUID();
const reservation = randomUUID();
const application = randomUUID();
const reserveGenerationKey = `test-worker-reserve:${reservation}:${runId}`;
const reservationGenerationKey = `test-worker:${reservation}:${runId}`;
const deliveryGenerationKey = "test-worker-delivery-jsonb";

async function cleanupFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.stored_value_posting','on',true)");
    await client.query(
      `UPDATE stored_value_reservations
          SET status='EXPIRED',released_at=COALESCE(released_at,now()),
              version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND id<>$2 AND status='ACTIVE'
          AND generation_key LIKE 'test-worker%'`,
      [tenant, reservation],
    );
    await client.query(
      `DELETE FROM gift_card_delivery_requests
        WHERE tenant_id=$1 AND generation_key=$2`,
      [tenant, deliveryGenerationKey],
    );
    await client.query(
      `UPDATE stored_value_accounts
          SET available_minor=500000,reserved_minor=0,
              version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenant, account],
    );
    await client.query(
      `UPDATE pos_orders
          SET status='DRAFT',amount_paid_minor=0,amount_due_minor=110000,
              version=version+1
        WHERE tenant_id=$1 AND id=$2`,
      [tenant, order],
    );
    await client.query(
      `UPDATE pos_order_stored_value_applications
          SET status='EXPIRED',version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND order_id=$2 AND id<>$3
          AND application_type='GIFT_CARD' AND status='RESERVED'`,
      [tenant, order, application],
    );
    await client.query(
      `INSERT INTO stored_value_reservations(
         id,tenant_id,account_id,order_id,customer_id,currency,requested_minor,
         accepted_minor,status,expires_at,generation_key,branch_id)
       SELECT $1,$2,$3,o.id,o.customer_id,o.currency,1000,1000,'ACTIVE',now()-interval '1 minute',$4,o.branch_id
         FROM pos_orders o WHERE o.tenant_id=$2 AND o.id=$5
       ON CONFLICT (tenant_id,id) DO UPDATE SET
         account_id=EXCLUDED.account_id,order_id=EXCLUDED.order_id,customer_id=EXCLUDED.customer_id,
         currency=EXCLUDED.currency,requested_minor=EXCLUDED.requested_minor,accepted_minor=EXCLUDED.accepted_minor,
         status='ACTIVE',expires_at=EXCLUDED.expires_at,committed_at=NULL,released_at=NULL,
         generation_key=EXCLUDED.generation_key,version=stored_value_reservations.version+1,updated_at=now()`,
      [reservation, tenant, account, reservationGenerationKey, order],
    );
    await client.query(
      `INSERT INTO pos_order_stored_value_applications(
         id,tenant_id,order_id,account_id,reservation_id,application_type,
         requested_minor,accepted_minor,currency,status)
       VALUES($1,$2,$3,$4,$5,'GIFT_CARD',1000,1000,'VND','RESERVED')
       ON CONFLICT (tenant_id,id) DO UPDATE SET
         order_id=EXCLUDED.order_id,account_id=EXCLUDED.account_id,reservation_id=EXCLUDED.reservation_id,
         application_type=EXCLUDED.application_type,requested_minor=EXCLUDED.requested_minor,
         accepted_minor=EXCLUDED.accepted_minor,currency=EXCLUDED.currency,status='RESERVED',
         version=pos_order_stored_value_applications.version+1,updated_at=now()`,
      [application, tenant, order, account, reservation],
    );
    await client.query("SELECT set_config('app.stored_value_posting','off',true)");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.sequential("Sprint 10 stored-value Worker", () => {
  const processor = new StoredValueMaintenanceProcessor();

  beforeAll(async () => {
    await cleanupFixtures();
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
          reserveGenerationKey,
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
    await cleanupFixtures();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE stored_value_reservations
            SET status='EXPIRED',released_at=COALESCE(released_at,now()),
                version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [tenant, reservation],
      );
      await client.query(
        `UPDATE pos_order_stored_value_applications
            SET status='EXPIRED',version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [tenant, application],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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

  it("writes delivery provider errors as jsonb", async () => {
    const generationKey = deliveryGenerationKey;
    await pool.query(
      `INSERT INTO gift_card_delivery_requests(
         tenant_id,gift_card_id,channel,status,generation_key
       ) VALUES($1,'da200000-0000-4000-8000-000000000001','EMAIL','PENDING',$2)
       ON CONFLICT(tenant_id,generation_key) DO UPDATE
         SET status='PENDING',attempts=0,lease_until=NULL,safe_error_json='{}'::jsonb`,
      [tenant, generationKey],
    );
    try {
      expect(await processor.deliveryRequests()).toBeGreaterThanOrEqual(1);
      const row = (
        await pool.query(
          `SELECT status,safe_error_json,jsonb_typeof(safe_error_json) AS safe_error_type
             FROM gift_card_delivery_requests
            WHERE tenant_id=$1 AND generation_key=$2`,
          [tenant, generationKey],
        )
      ).rows[0];
      expect(row).toEqual({
        status: "FAILED",
        safe_error_json: { code: "DELIVERY_PROVIDER_DISABLED" },
        safe_error_type: "object",
      });
    } finally {
      await pool.query("DELETE FROM gift_card_delivery_requests WHERE tenant_id=$1 AND generation_key=$2", [tenant, generationKey]);
    }
  });
});
