import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookingMaintenanceProcessor } from "../../apps/worker/src/booking-maintenance.processor";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000001";

describe("Sprint 4 multi-worker-safe expiry", () => {
  const db = new pg.Client({ connectionString });
  const processor = new BookingMaintenanceProcessor();
  const holdId = randomUUID(),
    appointmentId = randomUUID(),
    reference = `NS-W${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;

  beforeAll(async () => {
    await db.connect();
    await db.query(
      "INSERT INTO slot_holds(id,tenant_id,branch_id,source,status,request_fingerprint,availability_data_version,expires_at,created_at) VALUES($1,$2,$3,'API','ACTIVE',$4,1,now()-interval '1 hour',now()-interval '2 hours')",
      [holdId, tenantId, branchId, randomUUID()],
    );
    await db.query(
      "INSERT INTO appointments(id,tenant_id,branch_id,customer_id,booking_reference,source,status,locale,timezone,start_at,end_at,contact_snapshot_json,policy_snapshot_json,pricing_summary_json,deposit_status,expires_at) VALUES($1,$2,$3,$4,$5,'RECEPTION','PENDING_CONFIRMATION','vi-VN','Asia/Ho_Chi_Minh',now()+interval '2 days',now()+interval '2 days 1 hour',$6,$7,$8,'NOT_REQUIRED',now()-interval '1 minute')",
      [
        appointmentId,
        tenantId,
        branchId,
        customerId,
        reference,
        JSON.stringify({ displayName: "Worker expiry fixture" }),
        JSON.stringify({ version: 1 }),
        JSON.stringify({ amountMinor: 0, currency: "VND" }),
      ],
    );
  });

  afterAll(async () => {
    await processor.onModuleDestroy();
    await db.end();
  });

  it("lets concurrent workers claim each expired aggregate once", async () => {
    await Promise.all([processor.run(), processor.run()]);
    const hold = await db.query(
      "SELECT status,version FROM slot_holds WHERE id=$1",
      [holdId],
    );
    const appointment = await db.query(
      "SELECT status,version FROM appointments WHERE id=$1",
      [appointmentId],
    );
    expect(hold.rows[0]).toMatchObject({ status: "EXPIRED", version: 2 });
    expect(appointment.rows[0]).toMatchObject({
      status: "EXPIRED",
      version: 2,
    });
    const events = await db.query<{ event_type: string; count: number }>(
      "SELECT event_type,count(*)::int count FROM outbox_events WHERE aggregate_id=ANY($1::uuid[]) GROUP BY event_type",
      [[holdId, appointmentId]],
    );
    expect(events.rows).toEqual(
      expect.arrayContaining([
        { event_type: "slot_hold.expired", count: 1 },
        { event_type: "appointment.expired", count: 1 },
      ]),
    );
    const history = await db.query<{ count: number }>(
      "SELECT count(*)::int count FROM appointment_status_history WHERE appointment_id=$1 AND to_status='EXPIRED'",
      [appointmentId],
    );
    expect(history.rows[0]?.count).toBe(1);
  });
});
