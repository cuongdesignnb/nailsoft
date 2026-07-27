import { expect, test } from "@playwright/test";
import pg from "pg";
import { close, headers, login, tenantId } from "./helpers/api-client";

const branch = "20000000-0000-4000-8000-000000000001";
const order = "a4000000-0000-4000-8000-000000000002";
const register = "d1000000-0000-4000-8000-000000000006";
const drawer = "d2000000-0000-4000-8000-000000000006";
const cashSession = "d3000000-0000-4000-8000-000000000006";

test("cross-register cash leaves order, payment and movement unchanged", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  });
  await db.connect();
  const manager = await login("staff2@example.test");
  try {
    await db.query(
      `INSERT INTO pos_registers(id,tenant_id,branch_id,code,name,status,device_binding_required)
       VALUES($1,$2,$3,'E2E-CROSS','E2E Cross Register','ACTIVE',false)`,
      [register, tenantId, branch],
    );
    await db.query(
      `INSERT INTO cash_drawers(id,tenant_id,branch_id,register_id,code,name,currency,status)
       VALUES($1,$2,$3,$4,'E2E-CROSS','E2E Cross Drawer','VND','ACTIVE')`,
      [drawer, tenantId, branch, register],
    );
    await db.query(
      `INSERT INTO cash_sessions(id,tenant_id,branch_id,register_id,cash_drawer_id,cashier_user_id,business_date,timezone,status,opening_float_minor,expected_cash_minor,variance_threshold_minor)
       VALUES($1,$2,$3,$4,$5,'30000000-0000-4000-8000-000000000002',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'Asia/Ho_Chi_Minh','OPEN',0,0,5000)`,
      [cashSession, tenantId, branch, register, drawer],
    );
    const before = (
      await db.query(
        "SELECT version,amount_due_minor FROM pos_orders WHERE tenant_id=$1 AND id=$2",
        [tenantId, order],
      )
    ).rows[0];
    const denied = await manager.api.post(`/v1/pos-orders/${order}/payments`, {
      headers: headers(manager),
      data: {
        version: Number(before.version),
        tenderType: "CASH",
        amountToApplyMinor: 1,
        cashReceivedMinor: 1,
        cashSessionId: cashSession,
      },
    });
    expect(denied.status()).toBe(409);
    expect((await denied.json()).error.code).toBe("PAYMENT_REGISTER_MISMATCH");
    const after = (
      await db.query(
        `SELECT o.version,o.amount_due_minor,
          (SELECT count(*)::int FROM payments p WHERE p.tenant_id=o.tenant_id AND p.pos_order_id=o.id) payments,
          (SELECT count(*)::int FROM cash_movements m WHERE m.tenant_id=o.tenant_id AND m.cash_session_id=$3) movements
         FROM pos_orders o WHERE o.tenant_id=$1 AND o.id=$2`,
        [tenantId, order, cashSession],
      )
    ).rows[0];
    expect(after.version).toBe(before.version);
    expect(after.amount_due_minor).toBe(before.amount_due_minor);
    expect(after.movements).toBe(0);
  } finally {
    await db.query("DELETE FROM cash_sessions WHERE tenant_id=$1 AND id=$2", [
      tenantId,
      cashSession,
    ]);
    await db.query("DELETE FROM cash_drawers WHERE tenant_id=$1 AND id=$2", [
      tenantId,
      drawer,
    ]);
    await db.query("DELETE FROM pos_registers WHERE tenant_id=$1 AND id=$2", [
      tenantId,
      register,
    ]);
    await close(manager);
    await db.end();
  }
});
