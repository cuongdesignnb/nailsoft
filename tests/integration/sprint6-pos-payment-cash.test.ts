import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

const tenant = "10000000-0000-4000-8000-000000000001";
const readyOrder = "a4000000-0000-4000-8000-000000000002";
const partialOrder = "a4000000-0000-4000-8000-000000000003";
const cashSession = "a3000000-0000-4000-8000-000000000001";
const run = `s6-${Date.now()}`;

let app: Awaited<ReturnType<typeof createApp>>;
let cashierToken = "";
let managerToken = "";
let accountantToken = "";
let platformToken = "";

const headers = (token: string, key = crypto.randomUUID()) => ({
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
  "idempotency-key": key,
});

async function login(email: string, device: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      tenantSlug: "nailsoft-demo",
      email,
      password: "DemoPass123!",
      deviceId: `${run}-${device}`,
      deviceName: "Sprint 6 integration",
      platform: "web",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data.accessToken as string;
}

describe.sequential("Sprint 6 POS, payments, invoice and cash session", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    cashierToken = await login("cashier@example.test", "cashier");
    managerToken = await login("staff2@example.test", "manager");
    accountantToken = await login("accountant@example.test", "accountant");
    platformToken = await login("platform-e2e@example.test", "platform");
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("enforces role scope and denies platform-wide tenant access", async () => {
    const accountant = await app.inject({
      method: "GET",
      url: "/v1/financial/reconciliation/daily?branchId=20000000-0000-4000-8000-000000000001",
      headers: headers(accountantToken),
    });
    expect(accountant.statusCode, accountant.body).toBe(200);

    const platform = await app.inject({
      method: "GET",
      url: "/v1/pos-orders",
      headers: headers(platformToken),
    });
    expect(platform.statusCode).toBe(403);
    expect(platform.json().error.code).toBe("PERMISSION_DENIED");

    const receptionist = await login("staff3@example.test", "receptionist");
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${readyOrder}/payments`,
      headers: headers(receptionist),
      payload: {
        tenderType: "CARD_EXTERNAL",
        amountToApplyMinor: 1,
        provider: "test-terminal",
        providerTransactionId: `${run}-forbidden`,
        version: 2,
      },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("rejects card secrets before any payment evidence is persisted", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${readyOrder}/payments`,
      headers: headers(cashierToken),
      payload: {
        tenderType: "CARD_EXTERNAL",
        amountToApplyMinor: 1,
        provider: "test-terminal",
        providerTransactionId: `${run}-secret-rejected`,
        cardNumber: "4111111111111111",
        cvv: "123",
        version: 2,
      },
    });
    expect(response.statusCode).toBe(400);
    const db = app.get(DatabaseService);
    const stored = await db.query(
      "SELECT 1 FROM payments WHERE tenant_id=$1 AND provider_transaction_id=$2",
      [tenant, `${run}-secret-rejected`],
    );
    expect(stored.rowCount).toBe(0);
  });

  it("replays the same payment command without creating duplicate evidence", async () => {
    const key = `${run}-partial-replay`;
    const payload = {
      tenderType: "CARD_EXTERNAL",
      amountToApplyMinor: 10_000,
      provider: "test-terminal",
      providerTransactionId: `${run}-partial-provider`,
      terminalId: "terminal-test-1",
      cardBrand: "TEST",
      cardLast4: "1111",
      version: 3,
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${partialOrder}/payments`,
      headers: headers(cashierToken, key),
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${partialOrder}/payments`,
      headers: headers(cashierToken, key),
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().data).toEqual(first.json().data);

    const db = app.get(DatabaseService);
    const count = await db.query<{ count: number }>(
      "SELECT count(*)::int count FROM payments WHERE tenant_id=$1 AND provider_transaction_id=$2",
      [tenant, payload.providerTransactionId],
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it("captures cash, records change only as metadata and issues one immutable invoice", async () => {
    const current = await app.inject({
      method: "GET",
      url: `/v1/pos-orders/${partialOrder}`,
      headers: headers(cashierToken),
    });
    const order = current.json().data;
    expect(order.status).toBe("PARTIALLY_PAID");
    const paid = await app.inject({
      method: "POST",
      url: `/v1/pos-orders/${partialOrder}/payments`,
      headers: headers(cashierToken, `${run}-cash-final`),
      payload: {
        tenderType: "CASH",
        amountToApplyMinor: order.amountDueMinor,
        cashReceivedMinor: order.amountDueMinor + 20_000,
        cashSessionId: cashSession,
        version: order.version,
      },
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json().data.status).toBe("PAID");
    expect(paid.json().data.amountDueMinor).toBe(0);

    const db = app.get(DatabaseService);
    const evidence = await db.query<{
      invoice_count: number;
      captured: string;
      movement: string;
      change_due: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM invoices WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ISSUED') invoice_count,
         (SELECT captured_minor::text FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 AND tender_type='CASH') captured,
         (SELECT amount_minor::text FROM cash_movements WHERE tenant_id=$1 AND related_payment_id=(SELECT id FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 AND tender_type='CASH')) movement,
         (SELECT change_due_minor::text FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 AND tender_type='CASH') change_due`,
      [tenant, partialOrder],
    );
    expect(evidence.rows[0]).toMatchObject({
      invoice_count: 1,
      captured: String(order.amountDueMinor),
      movement: String(order.amountDueMinor),
      change_due: "20000",
    });

    await expect(
      db.query(
        "UPDATE invoices SET total_minor=total_minor+1 WHERE tenant_id=$1 AND pos_order_id=$2",
        [tenant, partialOrder],
      ),
    ).rejects.toThrow();
  });

  it("serializes concurrent full capture so the amount due cannot be exceeded", async () => {
    const payload = (suffix: string) => ({
      tenderType: "CARD_EXTERNAL",
      amountToApplyMinor: 115_000,
      provider: "test-terminal",
      providerTransactionId: `${run}-race-${suffix}`,
      version: 2,
    });
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/pos-orders/${readyOrder}/payments`,
        headers: headers(cashierToken, `${run}-race-a`),
        payload: payload("a"),
      }),
      app.inject({
        method: "POST",
        url: `/v1/pos-orders/${readyOrder}/payments`,
        headers: headers(cashierToken, `${run}-race-b`),
        payload: payload("b"),
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json().error
        .code,
    ).toBe("POS_ORDER_VERSION_CONFLICT");

    const db = app.get(DatabaseService);
    const totals = await db.query<{
      status: string;
      amount_paid_minor: string;
      payment_count: number;
      invoice_count: number;
    }>(
      `SELECT o.status,o.amount_paid_minor::text,
              (SELECT count(*)::int FROM payments p WHERE p.tenant_id=o.tenant_id AND p.pos_order_id=o.id) payment_count,
              (SELECT count(*)::int FROM invoices i WHERE i.tenant_id=o.tenant_id AND i.pos_order_id=o.id AND i.status='ISSUED') invoice_count
         FROM pos_orders o WHERE o.tenant_id=$1 AND o.id=$2`,
      [tenant, readyOrder],
    );
    expect(totals.rows[0]).toMatchObject({
      status: "PAID",
      amount_paid_minor: "115000",
      payment_count: 1,
      invoice_count: 1,
    });
  });

  it("requires dual control for a high-variance cash close", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/v1/cash-sessions/${cashSession}`,
      headers: headers(cashierToken),
    });
    const begun = await app.inject({
      method: "POST",
      url: `/v1/cash-sessions/${cashSession}/begin-closing`,
      headers: headers(cashierToken, `${run}-begin-close`),
      payload: { version: detail.json().data.version },
    });
    expect(begun.statusCode, begun.body).toBe(201);
    const declared = await app.inject({
      method: "POST",
      url: `/v1/cash-sessions/${cashSession}/declare`,
      headers: headers(cashierToken, `${run}-declare`),
      payload: { version: begun.json().data.version, declaredCashMinor: 0 },
    });
    expect(declared.statusCode, declared.body).toBe(201);
    const selfClose = await app.inject({
      method: "POST",
      url: `/v1/cash-sessions/${cashSession}/close`,
      headers: headers(cashierToken, `${run}-self-close`),
      payload: {
        version: declared.json().data.version,
        approveVariance: true,
        varianceReason: "Test high variance",
      },
    });
    expect(selfClose.statusCode).toBe(409);
    expect(selfClose.json().error.code).toBe(
      "CASH_SESSION_VARIANCE_APPROVAL_REQUIRED",
    );

    const approved = await app.inject({
      method: "POST",
      url: `/v1/cash-sessions/${cashSession}/close`,
      headers: headers(managerToken, `${run}-manager-close`),
      payload: {
        version: declared.json().data.version,
        approveVariance: true,
        varianceReason: "Manager verified test variance",
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json().data.status).toBe("CLOSED");
    expect(approved.json().data.varianceApprovedByUserId).toBeTruthy();
  });

  it("keeps financial histories append-only", async () => {
    const db = app.get(DatabaseService);
    await expect(
      db.query(
        "UPDATE pos_order_status_history SET note='tampered' WHERE tenant_id=$1 AND pos_order_id=$2",
        [tenant, readyOrder],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "DELETE FROM financial_events WHERE tenant_id=$1 AND aggregate_id=$2",
        [tenant, readyOrder],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "UPDATE pos_order_pricing_revisions SET reason_code='TAMPERED' WHERE tenant_id=$1 AND pos_order_id=$2",
        [tenant, readyOrder],
      ),
    ).rejects.toThrow();
  });
});
