import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/main";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";

let app: Awaited<ReturnType<typeof createApp>>;
const deviceId = "concurrent-refresh-test";

describe("strict concurrent refresh rotation", () => {
  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.get(DatabaseService).query("DELETE FROM device_sessions WHERE device_id=$1", [deviceId]);
    await app.close();
  });

  it("creates one successor and revokes the family when the old token is reused", async () => {
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: {
      tenantSlug: "nailsoft-demo", email: "owner@example.test", password: "DemoPass123!",
      deviceId, deviceName: "Concurrent Refresh", platform: "android",
    }});
    const token = login.json().data.refreshToken as string;
    const request = () => app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: token, deviceId } });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const successful = responses.find((response) => response.statusCode === 200)!;
    const successor = successful.json().data.refreshToken as string;
    const afterReuse = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: successor, deviceId } });
    expect(afterReuse.statusCode).toBe(409);
    expect(afterReuse.json().error.code).toBe("REFRESH_TOKEN_REUSE");
    const active = await app.get(DatabaseService).query("SELECT count(*)::int count FROM device_sessions WHERE device_id=$1 AND revoked_at IS NULL", [deviceId]);
    expect(active.rows[0].count).toBe(0);
  });
});
