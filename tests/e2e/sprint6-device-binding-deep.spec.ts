import { expect, test } from "@playwright/test";
import pg from "pg";
import { close, headers, login, tenantId } from "./helpers/api-client";

const register = "a1000000-0000-4000-8000-000000000001";
const drawer = "a2000000-0000-4000-8000-000000000001";

test("authenticated current device cannot spoof another bound device", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  });
  await db.connect();
  const cashier = await login("cashier@example.test");
  try {
    await db.query(
      "UPDATE pos_registers SET device_binding_required=true WHERE tenant_id=$1 AND id=$2",
      [tenantId, register],
    );
    await db.query(
      `INSERT INTO pos_register_device_bindings(tenant_id,register_id,device_id,status,bound_by_user_id)
       VALUES($1,$2,'e2e-bound-other','ACTIVE','30000000-0000-4000-8000-000000000002')
       ON CONFLICT(tenant_id,register_id,device_id) DO UPDATE SET status='ACTIVE',revoked_at=NULL`,
      [tenantId, register],
    );
    const denied = await cashier.api.post("/v1/cash-sessions/open", {
      headers: headers(cashier),
      data: {
        registerId: register,
        cashDrawerId: drawer,
        openingFloatMinor: 0,
        deviceId: "e2e-bound-other",
      },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe(
      "POS_REGISTER_DEVICE_NOT_BOUND",
    );
  } finally {
    await db.query(
      "UPDATE pos_registers SET device_binding_required=false WHERE tenant_id=$1 AND id=$2",
      [tenantId, register],
    );
    await db.query(
      "DELETE FROM pos_register_device_bindings WHERE tenant_id=$1 AND register_id=$2 AND device_id='e2e-bound-other'",
      [tenantId, register],
    );
    await close(cashier);
    await db.end();
  }
});
