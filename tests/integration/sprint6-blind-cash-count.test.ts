import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";

const tenant = "10000000-0000-4000-8000-000000000001";
const session = "a3000000-0000-4000-8000-000000000001";
const run = `s6-blind-${Date.now()}`;

let app: Awaited<ReturnType<typeof createApp>>;
let cashierToken = "";
let managerToken = "";

describe.sequential("Sprint 6 API-enforced blind cash count", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    cashierToken = await login("cashier@example.test", "cashier");
    managerToken = await login("staff2@example.test", "manager");
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function login(email: string, suffix: string) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email,
        password: "DemoPass123!",
        deviceId: `${run}-${suffix}`,
        deviceName: "Blind close test",
        platform: "web",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.accessToken as string;
  }

  const headers = (token: string, key?: string) => ({
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenant,
    ...(key ? { "idempotency-key": key } : {}),
  });

  async function detail(token: string) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/cash-sessions/${session}`,
      headers: headers(token),
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data;
  }

  it("hides expected and variance from the owning cashier in OPEN and CLOSING", async () => {
    const open = await detail(cashierToken);
    expect(open).toMatchObject({
      status: "OPEN",
      blindCount: true,
      expectedCashMinor: null,
      varianceMinor: null,
    });
    expect(open.movements.length).toBeGreaterThan(0);
    expect(
      open.movements.every(
        (movement: { amountMinor: number | null }) =>
          movement.amountMinor === null,
      ),
    ).toBe(true);
    const cashierMovements = await app.inject({
      method: "GET",
      url: `/v1/cash-sessions/${session}/movements`,
      headers: headers(cashierToken),
    });
    expect(cashierMovements.statusCode, cashierMovements.body).toBe(200);
    expect(
      cashierMovements
        .json()
        .data.every(
          (movement: { amountMinor: number | null }) =>
            movement.amountMinor === null,
        ),
    ).toBe(true);
    const closing = await app.inject({
      method: "POST",
      url: `/v1/cash-sessions/${session}/begin-closing`,
      headers: headers(cashierToken, `${run}-begin`),
      payload: { version: open.version },
    });
    expect(closing.statusCode, closing.body).toBe(201);
    expect(closing.json().data).toMatchObject({
      status: "CLOSING",
      blindCount: true,
      expectedCashMinor: null,
      varianceMinor: null,
    });

    const review = await app.inject({
      method: "GET",
      url: `/v1/cash-sessions/${session}/closing-review`,
      headers: headers(managerToken),
    });
    expect(review.statusCode, review.body).toBe(200);
    expect(review.json().data.blindCount).toBe(false);
    expect(review.json().data.expectedCashMinor).toBeTypeOf("number");

    const declared = await app.inject({
      method: "POST",
      url: `/v1/cash-sessions/${session}/declare`,
      headers: headers(cashierToken, `${run}-declare`),
      payload: {
        version: closing.json().data.version,
        declaredCashMinor: review.json().data.expectedCashMinor,
      },
    });
    expect(declared.statusCode, declared.body).toBe(201);
    expect(declared.json().data.expectedCashMinor).toBeNull();
    expect(declared.json().data.varianceMinor).toBeNull();

    const managerReview = await app.inject({
      method: "GET",
      url: `/v1/cash-sessions/${session}/closing-review`,
      headers: headers(managerToken),
    });
    expect(managerReview.statusCode, managerReview.body).toBe(200);
    expect(managerReview.json().data.declaredCashMinor).toBe(
      review.json().data.expectedCashMinor,
    );
    expect(managerReview.json().data.varianceMinor).toBe(0);

    const closed = await app.inject({
      method: "POST",
      url: `/v1/cash-sessions/${session}/close`,
      headers: headers(managerToken, `${run}-close`),
      payload: {
        version: managerReview.json().data.version,
        approveVariance: false,
      },
    });
    expect(closed.statusCode, closed.body).toBe(201);
    const cashierClosed = await detail(cashierToken);
    expect(cashierClosed).toMatchObject({
      status: "CLOSED",
      blindCount: false,
      expectedCashMinor: review.json().data.expectedCashMinor,
      declaredCashMinor: review.json().data.expectedCashMinor,
      varianceMinor: 0,
    });
  });

  it("denies closing-review to a cashier at the permission boundary", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/cash-sessions/${session}/closing-review`,
      headers: headers(cashierToken),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("PERMISSION_DENIED");
  });
});
