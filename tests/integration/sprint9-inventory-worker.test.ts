import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { InventoryMaintenanceProcessor } from "../../apps/worker/src/inventory-maintenance.processor.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenantId = "10000000-0000-4000-8000-000000000001";
const reservationId = "b9150000-0000-4000-8000-000000000001";
const balanceId = "b9080000-0000-4000-8000-000000000001";

describe.sequential("Sprint 9 inventory maintenance worker", () => {
  const processor = new InventoryMaintenanceProcessor();

  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("expires reservations once and restores the reserved projection", async () => {
    await pool.query(
      "UPDATE inventory_reservations SET status='ACTIVE',expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2",
      [tenantId, reservationId],
    );
    await pool.query(
      "UPDATE inventory_stock_balances SET reserved=2 WHERE tenant_id=$1 AND id=$2",
      [tenantId, balanceId],
    );

    const processed = await Promise.all([
      processor.expireReservations(),
      processor.expireReservations(),
    ]);
    expect(processed.reduce((sum, value) => sum + value, 0)).toBe(1);

    const result = (
      await pool.query(
        `SELECT r.status,b.reserved::text,
          (SELECT count(*)::int FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='inventory.reservation_expired') events
         FROM inventory_reservations r JOIN inventory_stock_balances b ON b.tenant_id=r.tenant_id AND b.id=$3
         WHERE r.tenant_id=$1 AND r.id=$2`,
        [tenantId, reservationId, balanceId],
      )
    ).rows[0];
    expect(result).toEqual({
      status: "EXPIRED",
      reserved: "0.000000",
      events: 1,
    });
  });

  it("deduplicates low-stock and expiry alerts through expression indexes", async () => {
    await Promise.all([processor.lowStockAlerts(), processor.lowStockAlerts()]);
    await Promise.all([processor.expiryAlerts(), processor.expiryAlerts()]);

    const duplicates = await pool.query(
      `SELECT alert_type,item_id,COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid) lot_key,count(*)::int
       FROM inventory_alerts WHERE tenant_id=$1 AND status='OPEN'
       GROUP BY alert_type,item_id,COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid)
       HAVING count(*)>1`,
      [tenantId],
    );
    expect(duplicates.rows).toEqual([]);
  });
});
