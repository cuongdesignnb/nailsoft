/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
@Injectable()
export class InventoryMaintenanceProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 2,
  });
  async run() {
    return (
      await Promise.all([
        this.expireReservations(),
        this.expiryAlerts(),
        this.lowStockAlerts(),
        this.jobs(),
      ])
    ).reduce((a, b) => a + b, 0);
  }
  async expireReservations() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const rows = (
        await c.query<any>(
          "SELECT * FROM inventory_reservations WHERE status='ACTIVE' AND expires_at<now() ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 100",
        )
      ).rows;
      for (const r of rows) {
        await c.query(
          "UPDATE inventory_stock_balances SET reserved=GREATEST(0,reserved-$6::numeric),version=version+1,updated_at=now() WHERE tenant_id=$1 AND branch_id=$2 AND location_id=$3 AND item_id=$4 AND lot_id IS NOT DISTINCT FROM $5",
          [
            r.tenant_id,
            r.branch_id,
            r.location_id,
            r.item_id,
            r.lot_id,
            r.quantity,
          ],
        );
        await c.query(
          "UPDATE inventory_reservations SET status='EXPIRED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [r.tenant_id, r.id],
        );
        await this.outbox(
          c,
          r.tenant_id,
          "inventory.reservation_expired",
          "inventory_reservation",
          r.id,
          r.branch_id,
        );
      }
      await c.query("COMMIT");
      return rows.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async expiryAlerts() {
    const result = await this.pool
      .query<any>(`INSERT INTO inventory_alerts(tenant_id,branch_id,item_id,lot_id,alert_type,details_json)
  SELECT l.tenant_id,l.branch_id,l.item_id,l.id,CASE WHEN l.expiry_date<CURRENT_DATE THEN 'EXPIRED' ELSE 'EXPIRING' END,jsonb_build_object('expiryDate',l.expiry_date)
  FROM inventory_lots l WHERE l.status='AVAILABLE' AND l.expiry_date<=CURRENT_DATE+30
  ON CONFLICT (tenant_id,branch_id,item_id,(COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid)),alert_type) WHERE status='OPEN' DO NOTHING RETURNING id`);
    return result.rowCount ?? 0;
  }
  async lowStockAlerts() {
    const result = await this.pool
      .query<any>(`INSERT INTO inventory_alerts(tenant_id,branch_id,item_id,alert_type,details_json)
  SELECT s.tenant_id,s.branch_id,s.item_id,'LOW_STOCK',jsonb_build_object('available',COALESCE(sum(b.on_hand-b.reserved),0)::text,'reorderPoint',s.reorder_point::text)
  FROM inventory_item_branch_settings s LEFT JOIN inventory_stock_balances b ON b.tenant_id=s.tenant_id AND b.branch_id=s.branch_id AND b.item_id=s.item_id
  GROUP BY s.tenant_id,s.branch_id,s.item_id,s.reorder_point HAVING COALESCE(sum(b.on_hand-b.reserved),0)<=s.reorder_point
  ON CONFLICT (tenant_id,branch_id,item_id,(COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid)),alert_type) WHERE status='OPEN' DO NOTHING RETURNING id`);
    return result.rowCount ?? 0;
  }
  async jobs() {
    const claim = await this.pool.connect();
    let rows: any[] = [];
    try {
      await claim.query("BEGIN");
      rows = (
        await claim.query<any>(
          "SELECT * FROM inventory_jobs WHERE status IN('PENDING','FAILED') AND run_at<=now() AND (lease_until IS NULL OR lease_until<now()) AND attempts<max_attempts ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 25",
        )
      ).rows;
      for (const j of rows)
        await claim.query(
          "UPDATE inventory_jobs SET status='PROCESSING',attempts=attempts+1,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1",
          [j.id],
        );
      await claim.query("COMMIT");
    } catch (e) {
      await claim.query("ROLLBACK");
      throw e;
    } finally {
      claim.release();
    }
    for (const j of rows) {
      try {
        if (j.job_type === "LOW_STOCK_SCAN") await this.lowStockAlerts();
        else if (j.job_type === "EXPIRY_SCAN") await this.expiryAlerts();
        else if (j.job_type === "RESERVATION_EXPIRY")
          await this.expireReservations();
        await this.pool.query(
          "UPDATE inventory_jobs SET status='COMPLETED',lease_until=NULL,updated_at=now() WHERE id=$1",
          [j.id],
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 500) : "unknown";
        await this.pool.query(
          "UPDATE inventory_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'DEAD_LETTER' ELSE 'FAILED' END,lease_until=NULL,last_error_code=$2,last_error_message=$3,run_at=now()+make_interval(secs=>LEAST(300,attempts*attempts*15)),updated_at=now() WHERE id=$1",
          [j.id, msg.split(":")[0]?.slice(0, 100), msg],
        );
      }
    }
    return rows.length;
  }
  private outbox(
    c: pg.PoolClient,
    tenantId: string,
    event: string,
    type: string,
    id: string,
    branchId: string,
  ) {
    return c.query(
      'INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,\'{"type":"SYSTEM"}\',\'{"schemaVersion":1,"pii":false}\')',
      [
        tenantId,
        event,
        type,
        id,
        JSON.stringify({ aggregateId: id, branchId, refetch: true }),
      ],
    );
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
