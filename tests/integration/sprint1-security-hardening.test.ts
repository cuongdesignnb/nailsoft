import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
let app: Awaited<ReturnType<typeof createApp>>, db: DatabaseService;
const tenantId = "10000000-0000-4000-8000-000000000001",
  ownerId = "30000000-0000-4000-8000-000000000001";
const loginPayload = {
  tenantSlug: "nailsoft-demo",
  email: "owner@example.test",
  password: "DemoPass123!",
  deviceId: "security-test",
  deviceName: "Security Test",
  platform: "android",
};
describe("Sprint 1 security hardening", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    db = app.get(DatabaseService);
  });
  afterAll(async () => {
    await db.query(
      "DELETE FROM device_sessions WHERE device_id LIKE 'security-%' OR device_id='workspace-test' OR device_id='platform-test'",
    );
    await db.query("DELETE FROM auth_rate_limits");
    await db.query(
      "UPDATE users SET status='ACTIVE',failed_login_attempts=0,locked_until=NULL WHERE id=$1",
      [ownerId],
    );
    await db.query(
      "DELETE FROM membership_roles WHERE membership_id IN ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')",
    );
    await db.query(
      "DELETE FROM tenant_memberships WHERE id IN ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')",
    );
    await db.query(
      "DELETE FROM users WHERE id='31000000-0000-4000-8000-000000000001'",
    );
    await db.query(
      "DELETE FROM audit_logs WHERE tenant_id='11000000-0000-4000-8000-000000000001'",
    );
    await db.query(
      "DELETE FROM outbox_events WHERE tenant_id='11000000-0000-4000-8000-000000000001'",
    );
    await db.query(
      "DELETE FROM tenants WHERE id='11000000-0000-4000-8000-000000000001'",
    );
    await app.close();
  });
  it("requires workspace selection for a global user with multiple active memberships", async () => {
    await db.query(
      "INSERT INTO tenants(id,name,slug,status) VALUES('11000000-0000-4000-8000-000000000001','Second Salon','second-salon','ACTIVE')",
    );
    await db.query(
      "INSERT INTO tenant_memberships(id,tenant_id,user_id,status,joined_at) VALUES('91000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',$1,'ACTIVE',now())",
      [ownerId],
    );
    await db.query(
      "INSERT INTO membership_roles(membership_id,role) VALUES('91000000-0000-4000-8000-000000000001','SALON_OWNER')",
    );
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        ...loginPayload,
        tenantSlug: undefined,
        deviceId: "workspace-test",
      },
    });
    expect(login.statusCode).toBe(200);
    const data = login.json().data;
    expect(data.workspaceSelectionRequired).toBe(true);
    expect(data.workspaces).toHaveLength(2);
    const selected = await app.inject({
      method: "POST",
      url: "/v1/auth/select-workspace",
      payload: {
        workspaceToken: data.workspaceToken,
        membershipId: "91000000-0000-4000-8000-000000000001",
        deviceId: "workspace-test",
        deviceName: "Workspace Test",
        platform: "web",
      },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().data.tenantId).toBe(
      "11000000-0000-4000-8000-000000000001",
    );
  });
  it("rejects refresh after expiry", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { ...loginPayload, deviceId: "security-expired" },
    });
    const token = login.json().data.refreshToken;
    await db.query(
      "UPDATE device_sessions SET expires_at=now()-interval '1 second' WHERE device_id='security-expired'",
    );
    const refresh = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: token, deviceId: "security-expired" },
    });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json().error.code).toBe("REFRESH_SESSION_INVALID");
  });
  it("rejects refresh for a suspended global account", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { ...loginPayload, deviceId: "security-suspended" },
    });
    const token = login.json().data.refreshToken;
    await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [
      ownerId,
    ]);
    const refresh = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: token, deviceId: "security-suspended" },
    });
    expect(refresh.statusCode).toBe(401);
    await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [ownerId]);
  });
  it("does not grant tenant data access to Platform Super Admin", async () => {
    await db.query(
      `INSERT INTO users(id,origin_tenant_id,email,display_name,password_hash) VALUES('31000000-0000-4000-8000-000000000001',$1,'platform@example.test','Platform Admin','scrypt$nailsoft-demo-owner$0fc74e8eecbefabd51c25bde52305b97aeacbf373d234e7d627beeb8f59382f6d18293e20bf7837189eba0ef54445494eac854f09522f4ac3c54c6116bbcd42a')`,
      [tenantId],
    );
    await db.query(
      "INSERT INTO tenant_memberships(id,tenant_id,user_id,status,joined_at) VALUES('91000000-0000-4000-8000-000000000002',$1,'31000000-0000-4000-8000-000000000001','ACTIVE',now())",
      [tenantId],
    );
    await db.query(
      "INSERT INTO membership_roles(membership_id,role) VALUES('91000000-0000-4000-8000-000000000002','PLATFORM_SUPER_ADMIN')",
    );
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        ...loginPayload,
        email: "platform@example.test",
        deviceId: "platform-test",
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/organization",
      headers: {
        authorization: `Bearer ${login.json().data.accessToken}`,
        "x-tenant-id": tenantId,
      },
    });
    expect(response.statusCode).toBe(403);
  });
  it("rate limits repeated unknown-account failures without revealing existence", async () => {
    for (let index = 0; index < 10; index++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          ...loginPayload,
          email: "unknown@example.test",
          deviceId: `security-rate-${index}`,
        },
      });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        ...loginPayload,
        email: "unknown@example.test",
        deviceId: "security-rate-blocked",
      },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("AUTH_RATE_LIMITED");
  });
  it("keeps web refresh tokens in HttpOnly cookies and enforces CSRF", async () => {
    await db.query("DELETE FROM auth_rate_limits");
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        ...loginPayload,
        platform: "web",
        deviceId: "security-cookie",
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.refreshToken).toBeUndefined();
    const refresh = login.cookies.find(
        (cookie) => cookie.name === "refreshToken",
      ),
      csrf = login.cookies.find((cookie) => cookie.name === "csrfToken");
    expect(refresh?.httpOnly).toBe(true);
    const cookie = `refreshToken=${refresh?.value}; csrfToken=${csrf?.value}`;
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: { cookie },
      payload: { deviceId: "security-cookie" },
    });
    expect(rejected.statusCode).toBe(403);
    const rotated = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: { cookie, "x-csrf-token": csrf?.value ?? "" },
      payload: { deviceId: "security-cookie" },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().data.refreshToken).toBeUndefined();
  });
});
