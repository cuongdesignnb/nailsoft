import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const registerA = "a1000000-0000-4000-8000-000000000001";
const sessionA = "a3000000-0000-4000-8000-000000000001";
const order = "a4000000-0000-4000-8000-000000000002";
const registerB = "b1000000-0000-4000-8000-000000000006";
const drawerB = "b2000000-0000-4000-8000-000000000006";
const sessionB = "b3000000-0000-4000-8000-000000000006";
const drawerA2 = "b2000000-0000-4000-8000-000000000007";
const sessionA2 = "b3000000-0000-4000-8000-000000000007";
const run = `s6-attribution-${Date.now()}`;

let app: Awaited<ReturnType<typeof createApp>>;
let db: DatabaseService;
let managerToken = "";

describe.sequential("Sprint 6 register/cash immutable attribution", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get(DatabaseService);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "staff2@example.test",
        password: "DemoPass123!",
        deviceId: `${run}-manager`,
        deviceName: "Attribution test",
        platform: "web",
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    managerToken = login.json().data.accessToken;
    await db.query(
      `INSERT INTO pos_registers(id,tenant_id,branch_id,code,name,status,device_binding_required)
       VALUES($1,$2,$3,'CLOSURE-B','Closure Register B','ACTIVE',false)`,
      [registerB, tenant, branch],
    );
    await db.query(
      `INSERT INTO cash_drawers(id,tenant_id,branch_id,register_id,code,name,currency,status) VALUES
       ($1,$3,$4,$5,'CLOSURE-B','Drawer B','VND','ACTIVE'),
       ($2,$3,$4,$6,'CLOSURE-A2','Drawer A2','VND','ACTIVE')`,
      [drawerB, drawerA2, tenant, branch, registerB, registerA],
    );
    await db.query(
      `INSERT INTO cash_sessions(id,tenant_id,branch_id,register_id,cash_drawer_id,cashier_user_id,business_date,timezone,status,opening_float_minor,expected_cash_minor,variance_threshold_minor) VALUES
       ($1,$3,$4,$5,$6,'30000000-0000-4000-8000-000000000002',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'Asia/Ho_Chi_Minh','OPEN',0,0,5000),
       ($2,$3,$4,$7,$8,'30000000-0000-4000-8000-000000000003',(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'Asia/Ho_Chi_Minh','OPEN',0,0,5000)`,
      [
        sessionB,
        sessionA2,
        tenant,
        branch,
        registerB,
        drawerB,
        registerA,
        drawerA2,
      ],
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const headers = (key = crypto.randomUUID()) => ({
    authorization: `Bearer ${managerToken}`,
    "x-tenant-id": tenant,
    "idempotency-key": key,
  });

  it("rejects cross-register cash before creating payment or movement", async () => {
    const before = (
      await db.query<{ payments: number; movements: number }>(
        `SELECT
          (SELECT count(*)::int FROM payments WHERE tenant_id=$1 AND pos_order_id=$2) payments,
          (SELECT count(*)::int FROM cash_movements WHERE tenant_id=$1 AND cash_session_id=$3) movements`,
        [tenant, order, sessionB],
      )
    ).rows[0]!;
    const response = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${order}/payments`,
      headers: headers(),
      payload: {
        version: 2,
        tenderType: "CASH",
        amountToApplyMinor: 10_000,
        cashReceivedMinor: 10_000,
        cashSessionId: sessionB,
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("PAYMENT_REGISTER_MISMATCH");
    const after = (
      await db.query<{ payments: number; movements: number }>(
        `SELECT
          (SELECT count(*)::int FROM payments WHERE tenant_id=$1 AND pos_order_id=$2) payments,
          (SELECT count(*)::int FROM cash_movements WHERE tenant_id=$1 AND cash_session_id=$3) movements`,
        [tenant, order, sessionB],
      )
    ).rows[0]!;
    expect(after).toEqual(before);
  });

  it("serializes two sessions racing for first cash attribution and locks the winner", async () => {
    const payload = (cashSessionId: string) => ({
      version: 2,
      tenderType: "CASH",
      amountToApplyMinor: 10_000,
      cashReceivedMinor: 10_000,
      cashSessionId,
    });
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/pos-orders/${order}/payments`,
        headers: headers(`${run}-race-a`),
        payload: payload(sessionA),
      }),
      app.inject({
        method: "POST",
        url: `/v1/pos-orders/${order}/payments`,
        headers: headers(`${run}-race-b`),
        payload: payload(sessionA2),
      }),
    ]);
    expect(
      responses.filter((response) => response.statusCode === 201),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.statusCode === 409),
    ).toHaveLength(1);

    const attributed = (
      await db.query<{
        cash_session_id: string;
        register_id: string;
        version: number;
      }>(
        "SELECT cash_session_id,register_id,version FROM pos_orders WHERE tenant_id=$1 AND id=$2",
        [tenant, order],
      )
    ).rows[0]!;
    expect([sessionA, sessionA2]).toContain(attributed.cash_session_id);
    expect(attributed.register_id).toBe(registerA);
    const payment = (
      await db.query<{ register_id: string }>(
        "SELECT register_id FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 AND tender_type='CASH'",
        [tenant, order],
      )
    ).rows[0]!;
    expect(payment.register_id).toBe(registerA);

    const losingSession =
      attributed.cash_session_id === sessionA ? sessionA2 : sessionA;
    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${order}/payments`,
      headers: headers(),
      payload: {
        version: Number(attributed.version),
        tenderType: "CASH",
        amountToApplyMinor: 10_000,
        cashReceivedMinor: 10_000,
        cashSessionId: losingSession,
      },
    });
    expect(mismatch.statusCode, mismatch.body).toBe(409);
    expect(mismatch.json().error.code).toBe("PAYMENT_CASH_SESSION_MISMATCH");

    await expect(
      db.query(
        "UPDATE pos_orders SET register_id=$3 WHERE tenant_id=$1 AND id=$2",
        [tenant, order, registerB],
      ),
    ).rejects.toThrow();
  });
});
