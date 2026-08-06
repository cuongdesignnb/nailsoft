import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiApp,
  command,
  login,
  pool,
  tenant,
} from "./sprint12-closure-helpers";

const customerId = "60000000-0000-4000-8000-000000000001";
const crossTenant = "60000000-0000-4000-8000-000000000999";
const crossTenantTenant = "10000000-0000-4000-8000-000000000999";
const crossTenantSlug = "customer-read-cross-tenant";
const branchA = "20000000-0000-4000-8000-000000000001";
const branchB = "20000000-0000-4000-8000-000000000002";
const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 19 Customer 360 read foundation", () => {
  beforeAll(async () => {
    app = await apiApp();
    await db.query(
      `INSERT INTO tenants(id,name,slug) VALUES($1,'Cross tenant read fixture',$2)
       ON CONFLICT (id) DO NOTHING`,
      [crossTenantTenant, crossTenantSlug],
    );
    await db.query(
      `INSERT INTO customers(id,tenant_id,display_name,phone_normalized,email_normalized,preferred_locale,is_guest)
       VALUES($1,$2,'Cross tenant customer','+84909999999','cross-tenant@example.test','en-US',false)
       ON CONFLICT (id) DO NOTHING`,
      [crossTenant, crossTenantTenant],
    );
  });

  afterAll(async () => {
    await db.query("DELETE FROM customers WHERE tenant_id=$1", [crossTenantTenant]);
    await db.query("DELETE FROM tenants WHERE id=$1", [crossTenantTenant]);
    await app.close();
    await db.end();
  });

  it("keeps the booking directory array-compatible while adding cursor metadata", async () => {
    const owner = await login(app, "owner@example.test");
    const first = await app.inject({
      method: "GET",
      url: "/v1/customers?limit=2",
      headers: owner,
    });
    expect(first.statusCode, first.body).toBe(200);
    const firstBody = first.json();
    expect(Array.isArray(firstBody.data)).toBe(true);
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.meta.pagination.limit).toBe(2);
    expect(firstBody.meta.pagination.hasMore).toBe(true);
    const cursor = firstBody.meta.pagination.nextCursor as string;
    expect(cursor).toBeTruthy();
    expect(cursor).not.toContain("@");
    expect(cursor).not.toContain("+84");

    const second = await app.inject({
      method: "GET",
      url: `/v1/customers?limit=2&cursor=${encodeURIComponent(cursor)}`,
      headers: owner,
    });
    expect(second.statusCode, second.body).toBe(200);
    const ids = [...firstBody.data, ...second.json().data].map(
      (row: { id: string }) => row.id,
    );
    expect(new Set(ids).size).toBe(ids.length);

    const byPhone = await app.inject({
      method: "GET",
      url: "/v1/customers?search=%2B84900000001",
      headers: owner,
    });
    expect(byPhone.statusCode, byPhone.body).toBe(200);
    expect(byPhone.json().data[0].id).toBe(customerId);

    const byEmail = await app.inject({
      method: "GET",
      url: "/v1/customers?search=customer1%40example.test",
      headers: owner,
    });
    expect(byEmail.statusCode, byEmail.body).toBe(200);
    expect(byEmail.json().data[0].id).toBe(customerId);

    const invalidCursor = await app.inject({
      method: "GET",
      url: "/v1/customers?cursor=not-a-valid-cursor",
      headers: owner,
    });
    expect(invalidCursor.statusCode, invalidCursor.body).toBe(400);
    expect(invalidCursor.json().error.code).toBe("INVALID_CUSTOMER_CURSOR");

    const tooLarge = await app.inject({
      method: "GET",
      url: "/v1/customers?limit=101",
      headers: owner,
    });
    expect(tooLarge.statusCode, tooLarge.body).toBe(400);
  });

  it("returns tenant profile data and filters child activity by branch", async () => {
    const owner = await login(app, "owner@example.test");
    const ownerDetail = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}`,
      headers: owner,
    });
    expect(ownerDetail.statusCode, ownerDetail.body).toBe(200);
    const ownerBody = ownerDetail.json().data;
    expect(ownerBody.profile).toMatchObject({
      id: customerId,
      displayName: "Khách 1",
      preferredLocale: "vi-VN",
      status: "ACTIVE",
      isGuest: false,
    });
    expect(ownerBody.contact).toEqual({
      access: "FULL",
      phone: "+84900000001",
      email: "customer1@example.test",
    });
    expect(ownerBody.activitySummary.appointmentCount).toBeGreaterThan(0);
    expect(ownerBody.recentAppointments.length).toBeGreaterThan(0);
    expect(ownerBody.recentAppointments.length).toBeLessThanOrEqual(10);
    expect(ownerBody.recentPurchases.access).toBe("GRANTED");
    expect(ownerBody.recentRefunds.access).toBe("GRANTED");
    const serialized = JSON.stringify(ownerBody);
    for (const forbidden of [
      "phone_normalized",
      "email_normalized",
      "phone_hash",
      "email_hash",
      "otp",
      "token",
      "internal_note",
      "staff_private_note",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }

    const managerB = await login(app, "manager-b@example.test");
    const branchScoped = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}`,
      headers: managerB,
    });
    expect(branchScoped.statusCode, branchScoped.body).toBe(200);
    expect(branchScoped.json().data.profile.id).toBe(customerId);
    expect(branchScoped.json().data.recentAppointments).toEqual([]);
    expect(branchScoped.json().data.activitySummary.appointmentCount).toBe(0);
    expect(branchScoped.json().data.recentPurchases.items).toEqual([]);
    expect(branchScoped.json().data.recentRefunds.items).toEqual([]);

    expect(branchA).not.toBe(branchB);
  });

  it("enforces permission, invalid-id and cross-tenant denial", async () => {
    const technician = await login(app, "staff5@example.test");
    const technicianResponse = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}`,
      headers: technician,
    });
    expect(technicianResponse.statusCode, technicianResponse.body).toBe(403);

    const platform = await login(app, "platform-e2e@example.test");
    const platformResponse = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}`,
      headers: platform,
    });
    expect(platformResponse.statusCode, platformResponse.body).toBe(403);

    const owner = await login(app, "owner@example.test");
    const unknown = await app.inject({
      method: "GET",
      url: "/v1/customers/60000000-0000-4000-8000-000000000998",
      headers: owner,
    });
    expect(unknown.statusCode, unknown.body).toBe(404);
    expect(unknown.json().error.code).toBe("CUSTOMER_NOT_FOUND");

    const invalid = await app.inject({
      method: "GET",
      url: "/v1/customers/not-a-uuid",
      headers: owner,
    });
    expect(invalid.statusCode, invalid.body).toBe(400);

    const crossTenantResponse = await app.inject({
      method: "GET",
      url: `/v1/customers/${crossTenant}`,
      headers: owner,
    });
    expect(crossTenantResponse.statusCode, crossTenantResponse.body).toBe(404);
    expect(crossTenantResponse.json().error.code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("denies customer PII even when support access carries the lookup permission", async () => {
    const platform = await login(app, "platform-e2e@example.test");
    const owner = await login(app, "owner@example.test");
    const request = await app.inject({
      method: "POST",
      url: "/v1/platform/support-access-grants",
      headers: command(platform, "s19-customer-read-support-request"),
      payload: {
        tenantId: tenant,
        supportUserId: "30000000-0000-4000-8000-000000000015",
        ticketReference: "SUP-1903-CUSTOMER-READ",
        reason: "Customer read foundation security verification",
        permissionScope: ["customer.booking_lookup"],
        branchScope: [branchA],
        dataClassificationScope: ["CUSTOMER_PII"],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        sessionTtlSeconds: 600,
      },
    });
    expect(request.statusCode, request.body).toBe(201);
    const grantId = request.json().data.id as string;
    const approved = await app.inject({
      method: "POST",
      url: `/v1/tenant/support-access-grants/${grantId}/approve`,
      headers: command(owner, "s19-customer-read-support-approve"),
      payload: { reason: "BA-approved support denial verification" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const session = await app.inject({
      method: "POST",
      url: `/v1/platform/support-access-grants/${grantId}/start-session`,
      headers: command(platform, "s19-customer-read-support-start"),
      payload: {},
    });
    expect(session.statusCode, session.body).toBe(201);

    const supportResponse = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}`,
      headers: {
        ...platform,
        "x-support-session-token": session.json().data.sessionToken,
      },
    });
    expect(supportResponse.statusCode, supportResponse.body).toBe(403);
    expect(supportResponse.json().error.code).toBe("SUPPORT_CUSTOMER_PII_DENIED");

    await app.inject({
      method: "POST",
      url: `/v1/tenant/support-access-grants/${grantId}/revoke`,
      headers: command(owner, "s19-customer-read-support-revoke"),
      payload: { reason: "Customer read security verification complete" },
    });
  });
});
