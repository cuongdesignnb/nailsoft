import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main.js";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service.js";

let app: Awaited<ReturnType<typeof createApp>>;
const deviceId = "sprint18-auth-hardening";

describe("Sprint 18 authenticated session hardening", () => {
  beforeAll(async () => { app = await createApp(); await app.init(); await app.getHttpAdapter().getInstance().ready(); });
  afterAll(async () => { await app.get(DatabaseService).query("DELETE FROM device_sessions WHERE device_id=$1", [deviceId]); await app.close(); });

  it("rotates refresh tokens, detects reuse and revokes the family", async () => {
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { tenantSlug: "nailsoft-demo", email: "owner@example.test", password: "DemoPass123!", deviceId, deviceName: "Sprint 18 security", platform: "android" } });
    expect(login.statusCode).toBe(200);
    const refreshToken = login.json().data.refreshToken as string;
    const request = () => app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken, deviceId } });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const successor = responses.find((response) => response.statusCode === 200)!.json().data.refreshToken;
    const reuse = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: successor, deviceId } });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().error.code).toBe("REFRESH_TOKEN_REUSE");
  });

  it("keeps password recovery responses enumeration-safe", async () => {
    const unknown = await app.inject({ method: "POST", url: "/v1/auth/forgot-password", payload: { identifier: "not-present-sprint18@example.test" } });
    const known = await app.inject({ method: "POST", url: "/v1/auth/forgot-password", payload: { identifier: "owner@example.test" } });
    expect(unknown.statusCode).toBe(202); expect(known.statusCode).toBe(202);
    expect(unknown.json().data.accepted).toBe(true); expect(known.json().data.accepted).toBe(true);
    expect(unknown.json().data.message).toBe(known.json().data.message);
  });
});
