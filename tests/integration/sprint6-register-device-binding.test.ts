import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { RegisterDeviceAuthorizationService } from "../../apps/api/src/modules/pos/register-device-authorization.service";

const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const register = "a1000000-0000-4000-8000-000000000001";
const order = "a4000000-0000-4000-8000-000000000001";
const run = `s6-device-${Date.now()}`;

let app: Awaited<ReturnType<typeof createApp>>;
let db: DatabaseService;
let token = "";
let sessionId = "";
let deviceId = "";

describe.sequential("Sprint 6 authenticated register device boundary", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get(DatabaseService);
    deviceId = `${run}-current`;
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "cashier@example.test",
        password: "DemoPass123!",
        deviceId,
        deviceName: "Closure device",
        platform: "web",
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    token = login.json().data.accessToken;
    sessionId = (
      await db.query<{ id: string }>(
        "SELECT id FROM device_sessions WHERE tenant_id=$1 AND device_id=$2 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [tenant, deviceId],
      )
    ).rows[0]!.id;
    await db.query(
      "UPDATE pos_registers SET device_binding_required=true WHERE tenant_id=$1 AND id=$2",
      [tenant, register],
    );
    await db.query(
      `INSERT INTO pos_register_device_bindings(tenant_id,register_id,device_id,status,bound_by_user_id)
       VALUES($1,$2,$3,'ACTIVE','30000000-0000-4000-8000-000000000002')`,
      [tenant, register, `${run}-other-bound-device`],
    );
  });

  afterAll(async () => {
    if (db) {
      await db.query(
        "UPDATE pos_registers SET device_binding_required=false WHERE tenant_id=$1 AND id=$2",
        [tenant, register],
      );
      await db.query(
        "DELETE FROM pos_register_device_bindings WHERE tenant_id=$1 AND device_id LIKE $2",
        [tenant, `${run}%`],
      );
    }
    if (app) await app.close();
  });

  const headers = () => ({
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenant,
    "idempotency-key": crypto.randomUUID(),
  });

  it("rejects an unbound current device even when the client spoofs a bound device id", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${order}/assign-register`,
      headers: headers(),
      payload: {
        version: 1,
        registerId: register,
        deviceId: `${run}-other-bound-device`,
      },
    });
    // Strict assign-register input also proves client device identity is not an
    // accepted authorization field.
    expect(response.statusCode).toBe(400);

    const open = await app.inject({
      method: "POST",
      url: "/v1/cash-sessions/open",
      headers: headers(),
      payload: {
        registerId: register,
        cashDrawerId: "a2000000-0000-4000-8000-000000000001",
        openingFloatMinor: 0,
        deviceId: `${run}-other-bound-device`,
      },
    });
    expect(open.statusCode, open.body).toBe(403);
    expect(open.json().error.code).toBe("POS_REGISTER_DEVICE_NOT_BOUND");
  });

  it("accepts the authoritative current device and rejects a revoked binding", async () => {
    await db.query(
      `INSERT INTO pos_register_device_bindings(tenant_id,register_id,device_id,status,bound_by_user_id)
       VALUES($1,$2,$3,'ACTIVE','30000000-0000-4000-8000-000000000002')`,
      [tenant, register, deviceId],
    );
    const assigned = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${order}/assign-register`,
      headers: headers(),
      payload: { version: 1, registerId: register },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);

    await db.query(
      "UPDATE pos_register_device_bindings SET status='REVOKED',revoked_at=now() WHERE tenant_id=$1 AND register_id=$2 AND device_id=$3",
      [tenant, register, deviceId],
    );
    const denied = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${order}/assign-register`,
      headers: headers(),
      payload: { version: assigned.json().data.version, registerId: register },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("POS_REGISTER_DEVICE_NOT_BOUND");
  });

  it("maps a transaction-time revoked authenticated session to the POS domain error", async () => {
    await db.query(
      "UPDATE device_sessions SET revoked_at=now(),revoke_reason='closure-test' WHERE id=$1",
      [sessionId],
    );
    const membership = (
      await db.query<{ user_id: string; membership_id: string }>(
        "SELECT user_id,membership_id FROM device_sessions WHERE id=$1",
        [sessionId],
      )
    ).rows[0]!;
    await expect(
      app.get(RegisterDeviceAuthorizationService).assertRegisterAccess({
        auth: {
          userId: membership.user_id,
          tenantId: tenant,
          membershipId: membership.membership_id,
          authorizationVersion: 1,
          sessionId,
          roles: ["CASHIER"],
          branchIds: [branch],
        },
        registerId: register,
        branchId: branch,
      }),
    ).rejects.toMatchObject({
      response: { code: "POS_REGISTER_DEVICE_SESSION_INVALID" },
    });
  });
});
