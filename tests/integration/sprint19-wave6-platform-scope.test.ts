import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool, tenant } from "./sprint12-closure-helpers";

const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 19 Wave 6 platform support scope", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("proves support tokens are bound to the granted target tenant", async () => {
    const owner = await login(app, "owner@example.test");
    const platform = await login(app, "platform-e2e@example.test");
    const suffix = Date.now().toString();
    const request = await app.inject({
      method: "POST",
      url: "/v1/platform/support-access-grants",
      headers: command(platform, `s19-wave6-support-request-${suffix}`),
      payload: {
        tenantId: tenant,
        supportUserId: "30000000-0000-4000-8000-000000000015",
        ticketReference: `SUP-W6-${suffix}`,
        reason: "Wave 6 scope verification",
        permissionScope: [
          "platform.tenant.read",
          "platform.subscription.read",
          "platform.usage.read",
          "platform.invoice.read",
          "platform.payment.read",
        ],
        branchScope: [],
        dataClassificationScope: [],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        sessionTtlSeconds: 600,
      },
    });
    expect(request.statusCode, request.body).toBe(201);
    const grant = request.json().data;
    const approve = await app.inject({
      method: "POST",
      url: `/v1/tenant/support-access-grants/${grant.id}/approve`,
      headers: command(owner, `s19-wave6-support-approve-${suffix}`),
      payload: { reason: "Approved for scoped verification" },
    });
    expect(approve.statusCode, approve.body).toBe(201);
    const session = await app.inject({
      method: "POST",
      url: `/v1/platform/support-access-grants/${grant.id}/start-session`,
      headers: command(platform, `s19-wave6-support-start-${suffix}`),
      payload: {},
    });
    expect(session.statusCode, session.body).toBe(201);
    const support = {
      ...platform,
      "x-support-session-token": session.json().data.sessionToken,
    };

    const tenantList = await app.inject({
      method: "GET",
      url: "/v1/platform/tenants",
      headers: support,
    });
    expect(tenantList.statusCode, tenantList.body).toBe(200);
    expect(tenantList.json().data.every((row: any) => row.id === tenant)).toBe(true);

    const target = await app.inject({
      method: "GET",
      url: `/v1/platform/tenants/${tenant}`,
      headers: support,
    });
    expect(target.statusCode, target.body).toBe(200);

    const other = await app.inject({
      method: "GET",
      url: "/v1/platform/tenants/13000000-0000-0000-0000-000000000901",
      headers: support,
    });
    expect(other.statusCode, other.body).toBe(403);

    const globalPlans = await app.inject({
      method: "GET",
      url: "/v1/platform/plans",
      headers: support,
    });
    expect(globalPlans.statusCode, globalPlans.body).toBe(403);

    const targetInvoices = await app.inject({
      method: "GET",
      url: `/v1/platform/tenants/${tenant}/invoices`,
      headers: support,
    });
    expect(targetInvoices.statusCode, targetInvoices.body).toBe(200);
    expect(targetInvoices.json().data.every((row: any) => row.tenantId === tenant)).toBe(true);

    const targetPayments = await app.inject({
      method: "GET",
      url: `/v1/platform/tenants/${tenant}/payments`,
      headers: support,
    });
    expect(targetPayments.statusCode, targetPayments.body).toBe(200);
    expect(targetPayments.json().data.every((row: any) => row.tenantId === tenant)).toBe(true);
  });
});
