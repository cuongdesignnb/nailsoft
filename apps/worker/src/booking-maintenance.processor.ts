/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";

@Injectable()
export class BookingMaintenanceProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 2,
  });
  async run() {
    return (
      await Promise.all([
        this.expireHolds(),
        this.expireAppointments(),
        this.deliverNotifications(),
      ])
    ).reduce((a, b) => a + b, 0);
  }
  async expireHolds() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = (
        await client.query<any>(
          "SELECT * FROM slot_holds WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50",
        )
      ).rows;
      for (const hold of rows) {
        await client.query(
          "UPDATE staff_schedule_reservations SET status='EXPIRED',released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND slot_hold_item_id IN(SELECT id FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2)",
          [hold.tenant_id, hold.id],
        );
        await client.query(
          "UPDATE resource_schedule_reservations SET status='EXPIRED',released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND slot_hold_item_id IN(SELECT id FROM slot_hold_items WHERE tenant_id=$1 AND slot_hold_id=$2)",
          [hold.tenant_id, hold.id],
        );
        const updated = (
          await client.query<any>(
            "UPDATE slot_holds SET status='EXPIRED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING version",
            [hold.tenant_id, hold.id],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO audit_logs(tenant_id,branch_id,action,entity_type,entity_id,after_json,reason,request_id) VALUES($1,$2,'slot_hold.expired','slot_hold',$3,$4,'TTL_EXPIRED','worker:slot-hold-expiry')",
          [
            hold.tenant_id,
            hold.branch_id,
            hold.id,
            JSON.stringify({ status: "EXPIRED" }),
          ],
        );
        await client.query(
          "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,source) VALUES($1,$2,'slot_hold.expired','slot_hold',$3,$4,$5,'worker')",
          [
            hold.tenant_id,
            hold.branch_id,
            hold.id,
            updated.version,
            JSON.stringify({
              holdId: hold.id,
              branchId: hold.branch_id,
              status: "EXPIRED",
              refetch: true,
            }),
          ],
        );
      }
      await client.query("COMMIT");
      return rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async expireAppointments() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = (
        await client.query<any>(
          "SELECT * FROM appointments WHERE status IN('PENDING_CONFIRMATION','PENDING_DEPOSIT') AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50",
        )
      ).rows;
      for (const root of rows) {
        await client.query(
          "UPDATE staff_schedule_reservations SET status='EXPIRED',released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND appointment_item_id IN(SELECT id FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2)",
          [root.tenant_id, root.id],
        );
        await client.query(
          "UPDATE resource_schedule_reservations SET status='EXPIRED',released_at=now() WHERE tenant_id=$1 AND status='ACTIVE' AND appointment_item_id IN(SELECT id FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2)",
          [root.tenant_id, root.id],
        );
        await client.query(
          "UPDATE appointment_items SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2",
          [root.tenant_id, root.id],
        );
        const updated = (
          await client.query<any>(
            "UPDATE appointments SET status='EXPIRED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING version",
            [root.tenant_id, root.id],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO appointment_status_history(tenant_id,appointment_id,from_status,to_status,actor_type,reason_code,request_id) VALUES($1,$2,$3,'EXPIRED','SYSTEM','TTL_EXPIRED','worker:appointment-expiry')",
          [root.tenant_id, root.id, root.status],
        );
        await client.query(
          "INSERT INTO audit_logs(tenant_id,branch_id,action,entity_type,entity_id,after_json,reason,request_id) VALUES($1,$2,'appointment.expired','appointment',$3,$4,'TTL_EXPIRED','worker:appointment-expiry')",
          [
            root.tenant_id,
            root.branch_id,
            root.id,
            JSON.stringify({ status: "EXPIRED" }),
          ],
        );
        await client.query(
          "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,source) VALUES($1,$2,'appointment.expired','appointment',$3,$4,$5,'worker')",
          [
            root.tenant_id,
            root.branch_id,
            root.id,
            updated.version,
            JSON.stringify({
              appointmentId: root.id,
              branchId: root.branch_id,
              status: "EXPIRED",
              refetch: true,
            }),
          ],
        );
      }
      await client.query("COMMIT");
      return rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async deliverNotifications() {
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.NOTIFICATION_PROVIDER
    )
      return 0;
    const result = await this.pool.query(
      "WITH claimed AS(SELECT id FROM booking_notification_jobs WHERE status='PENDING' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50) UPDATE booking_notification_jobs j SET status='DELIVERED',attempt_count=attempt_count+1,delivered_at=now() FROM claimed WHERE j.id=claimed.id RETURNING j.id",
    );
    return result.rowCount ?? 0;
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
