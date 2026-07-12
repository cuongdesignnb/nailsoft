import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

let app: Awaited<ReturnType<typeof createApp>>;
let token = "";
let categoryId = "";
let serviceId = "";
let leaveId = "";
const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";

describe("Sprint 2 service catalog and staff foundation", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { tenantSlug: "nailsoft-demo", email: "owner@example.test", password: "DemoPass123!", deviceId: "sprint2-integration", deviceName: "Sprint 2", platform: "android" } });
    token = login.json().data.accessToken;
  });
  afterAll(async () => {
    const db = app.get(DatabaseService);
    if (serviceId) {
      await db.query("DELETE FROM service_prices WHERE tenant_id=$1 AND service_id=$2", [tenantId, serviceId]);
      await db.query("DELETE FROM service_skill_requirements WHERE tenant_id=$1 AND service_id=$2", [tenantId, serviceId]);
      await db.query("DELETE FROM service_resource_requirements WHERE tenant_id=$1 AND service_id=$2", [tenantId, serviceId]);
      await db.query("DELETE FROM services WHERE tenant_id=$1 AND id=$2", [tenantId, serviceId]);
    }
    if (categoryId) await db.query("DELETE FROM service_categories WHERE tenant_id=$1 AND id=$2", [tenantId, categoryId]);
    if (leaveId) await db.query("DELETE FROM leave_requests WHERE tenant_id=$1 AND id=$2", [tenantId, leaveId]);
    await app.close();
  });

  it("creates and activates a bilingual service only after an active price exists", async () => {
    const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId };
    const category = await app.inject({ method: "POST", url: "/v1/service-categories", headers, payload: { code: "S2-TEST-CATEGORY", name: { "vi-VN": "Kiểm thử", "en-US": "Test" } } });
    expect(category.statusCode).toBe(201);
    categoryId = category.json().data.id;
    const service = await app.inject({ method: "POST", url: "/v1/services", headers, payload: { categoryId, code: "S2-TEST-SERVICE", name: { "vi-VN": "Dịch vụ kiểm thử", "en-US": "Test service" }, defaultDurationMin: 45 } });
    expect(service.statusCode).toBe(201);
    serviceId = service.json().data.id;
    expect(service.json().data.status).toBe("DRAFT");
    const price = await app.inject({ method: "POST", url: `/v1/services/${serviceId}/prices`, headers, payload: { branchId: null, amount: 350000, currency: "VND", effectiveFrom: "2026-01-01T00:00:00.000Z", status: "ACTIVE" } });
    expect(price.statusCode).toBe(201);
    const active = await app.inject({ method: "POST", url: `/v1/services/${serviceId}/activate`, headers });
    expect(active.statusCode).toBe(201);
    expect(active.json().data.status).toBe("ACTIVE");
  });

  it("rejects active price overlap and supports branch-priority resolution", async () => {
    const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId };
    const overlap = await app.inject({ method: "POST", url: `/v1/services/${serviceId}/prices`, headers, payload: { branchId: null, amount: 360000, currency: "VND", effectiveFrom: "2026-02-01T00:00:00.000Z", status: "ACTIVE" } });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error.code).toBe("PRICE_OVERLAP");
    const resolver = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: `/v1/services?branchId=${branchId}&status=ACTIVE&pageSize=1`, headers });
    expect(resolver.statusCode).toBe(200);
    expect(resolver.json().meta.total).toBeGreaterThan(0);
  });

  it("exposes tenant-scoped staff, shifts and leave foundation", async () => {
    const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId };
    const staff = await app.inject({ method: "GET", url: "/v1/staff?status=ACTIVE", headers });
    const shifts = await app.inject({ method: "GET", url: "/v1/shifts?branchId=" + branchId, headers });
    const leave = await app.inject({ method: "GET", url: "/v1/leave-requests?branchId=" + branchId, headers });
    expect(staff.statusCode).toBe(200);
    expect(staff.json().data.length).toBeGreaterThanOrEqual(1);
    expect(shifts.statusCode).toBe(200);
    expect(leave.statusCode).toBe(200);
    const created = await app.inject({ method: "POST", url: "/v1/leave-requests", headers, payload: { staffId: "47000000-0000-4000-8000-000000000001", branchId, leaveType: "PERSONAL", startAt: "2026-09-01T09:00:00.000Z", endAt: "2026-09-01T17:00:00.000Z", reason: "integration" } });
    expect(created.statusCode).toBe(201);
    leaveId = created.json().data.id;
    expect(created.json().data.status).toBe("DRAFT");
    const submitted = await app.inject({ method: "POST", url: `/v1/leave-requests/${leaveId}/submit`, headers });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().data.status).toBe("PENDING");
  });
});
