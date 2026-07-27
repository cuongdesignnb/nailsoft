import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRANCH, REFUND, TENANT, harness } from "./sprint7-closure-test-utils";

describe.sequential("Sprint 7 cash refund register attribution", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let manager: string;
  const otherRegister = "f7100000-0000-4000-8000-000000000001";
  const otherDrawer = "f7200000-0000-4000-8000-000000000001";
  const otherSession = "f7300000-0000-4000-8000-000000000001";
  beforeAll(async () => {
    h = await harness("cash-register");
    manager = await h.login("staff2@example.test");
    await h.db.query(
      `INSERT INTO pos_registers(id,tenant_id,branch_id,code,name,status,device_binding_required)
       VALUES($1,$2,$3,'CLOSURE-POS','Closure POS','ACTIVE',false)`,
      [otherRegister, TENANT, BRANCH],
    );
    await h.db.query(
      `INSERT INTO cash_drawers(id,tenant_id,branch_id,register_id,code,name,currency,status)
       VALUES($1,$2,$3,$4,'CLOSURE-DRAWER','Closure Drawer','VND','ACTIVE')`,
      [otherDrawer, TENANT, BRANCH, otherRegister],
    );
    await h.db.query(
      `INSERT INTO cash_sessions(id,tenant_id,branch_id,register_id,cash_drawer_id,cashier_user_id,business_date,timezone,status,opening_float_minor,expected_cash_minor,variance_threshold_minor)
       VALUES($1,$2,$3,$4,$5,'30000000-0000-4000-8000-000000000002',CURRENT_DATE,'Asia/Ho_Chi_Minh','OPEN',1000000,1000000,5000)`,
      [otherSession, TENANT, BRANCH, otherRegister, otherDrawer],
    );
  });
  afterAll(async () => h?.app.close());

  it("rejects another register without creating movement or credit note", async () => {
    const approved = await h.app.inject({
      method: "POST",
      url: `/v1/refunds/${REFUND}/approve`,
      headers: h.headers(manager),
      payload: { version: 1, reason: "Closure approval evidence" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const response = await h.app.inject({
      method: "POST",
      url: `/v1/refunds/${REFUND}/execute-cash`,
      headers: h.headers(manager),
      payload: {
        version: approved.json().data.version,
        cashSessionId: otherSession,
      },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("CASH_REFUND_REGISTER_MISMATCH");
    const sideEffects = (
      await h.db.query<{ movements: number; notes: number }>(
        `SELECT
          (SELECT count(*)::int FROM cash_movements WHERE tenant_id=$1 AND related_refund_id=$2) movements,
          (SELECT count(*)::int FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2) notes`,
        [TENANT, REFUND],
      )
    ).rows[0]!;
    expect(sideEffects).toEqual({ movements: 0, notes: 0 });
  });
});
