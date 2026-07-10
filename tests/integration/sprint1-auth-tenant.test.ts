import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

let app: Awaited<ReturnType<typeof createApp>>;
let accessToken = "";
let refreshToken = "";
let createdBranchId = "";
let targetMembershipId = "";
let managerAccessToken = "";
const tenantId = "10000000-0000-4000-8000-000000000001";

describe("Sprint 1 authentication and tenant isolation", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    const db = app.get(DatabaseService);
    await db.query("DELETE FROM device_sessions WHERE tenant_id=$1", [
      tenantId,
    ]);
    await db.query(
      "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id IN (SELECT id FROM users WHERE email='e2e.manager@example.test')",
      [tenantId],
    );
    await db.query("DELETE FROM users WHERE email='e2e.manager@example.test'");
    if (createdBranchId) {
      await db.query(
        "DELETE FROM business_hours WHERE tenant_id=$1 AND branch_id=$2",
        [tenantId, createdBranchId],
      );
      await db.query(
        "DELETE FROM branch_settings WHERE tenant_id=$1 AND branch_id=$2",
        [tenantId, createdBranchId],
      );
      await db.query("DELETE FROM branches WHERE tenant_id=$1 AND id=$2", [
        tenantId,
        createdBranchId,
      ]);
    }
    await app.close();
  });

  it("logs in with the deterministic owner and creates a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "owner@example.test",
        password: "DemoPass123!",
        deviceId: "e2e-web",
        deviceName: "E2E Browser",
        platform: "android",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    accessToken = body.data.accessToken;
    refreshToken = body.data.refreshToken;
    expect(body.data.tenantId).toBe(tenantId);
    expect(response.headers["x-request-id"]).toBeTruthy();
  });
  it("rejects a mismatched tenant context", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/organization",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-tenant-id": "90000000-0000-4000-8000-000000000009",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("TENANT_CONTEXT_MISMATCH");
  });
  it("reads only the authenticated tenant", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/organization",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-tenant-id": tenantId,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.slug).toBe("nailsoft-demo");
  });
  it("lets an owner create a branch and scoped user with audit", async () => {
    const headers = {
      authorization: `Bearer ${accessToken}`,
      "x-tenant-id": tenantId,
    };
    const branch = await app.inject({
      method: "POST",
      url: "/v1/branches",
      headers,
      payload: {
        name: "E2E Branch",
        code: "E2E",
        timezone: "Asia/Ho_Chi_Minh",
        address: { city: "HCMC" },
      },
    });
    expect(branch.statusCode).toBe(201);
    createdBranchId = branch.json().data.id;
    const user = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: {
        email: "e2e.manager@example.test",
        displayName: "E2E Manager",
        password: "SecurePass123!",
        locale: "vi-VN",
        role: "BRANCH_MANAGER",
        branchId: createdBranchId,
      },
    });
    expect(user.statusCode).toBe(201);
    targetMembershipId = user.json().data.membershipId;
    expect(user.json().data.branchIds[0]).toBe(createdBranchId);
    const managerLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "nailsoft-demo",
        email: "e2e.manager@example.test",
        password: "SecurePass123!",
        deviceId: "e2e-manager",
        deviceName: "Manager Browser",
        platform: "android",
      },
    });
    expect(managerLogin.statusCode).toBe(200);
    managerAccessToken = managerLogin.json().data.accessToken;
  });
  it("lets an owner inspect and remotely revoke employee sessions", async () => {
    const headers = {
      authorization: `Bearer ${accessToken}`,
      "x-tenant-id": tenantId,
    };
    const sessions = await app.inject({
      method: "GET",
      url: `/v1/users/${targetMembershipId}/sessions`,
      headers,
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().data).toHaveLength(1);
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/users/${targetMembershipId}/sessions/revoke-all`,
      headers,
    });
    expect(revoked.statusCode).toBe(201);
    const denied = await app.inject({
      method: "GET",
      url: "/v1/branches",
      headers: {
        authorization: `Bearer ${managerAccessToken}`,
        "x-tenant-id": tenantId,
      },
    });
    expect(denied.statusCode).toBe(401);
  });
  it("rotates refresh tokens and detects reuse", async () => {
    const rotated = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken, deviceId: "e2e-web" },
    });
    expect(rotated.statusCode).toBe(200);
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken, deviceId: "e2e-web" },
    });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().error.code).toBe("REFRESH_TOKEN_REUSE");
  });
});
