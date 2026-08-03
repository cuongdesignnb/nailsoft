import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { allowedOrigins } from "../../apps/api/src/common/cors-origins.js";
import { createApp } from "../../apps/api/src/main.js";

let app: Awaited<ReturnType<typeof createApp>>;

describe("Sprint 18 CORS and security header policy", () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldOrigins = process.env.CORS_ORIGINS;
  beforeAll(async () => { process.env.NODE_ENV = "test"; process.env.CORS_ORIGINS = "http://localhost:3000"; app = await createApp(); await app.init(); await app.getHttpAdapter().getInstance().ready(); });
  afterAll(async () => { await app.close(); });
  afterEach(() => { process.env.NODE_ENV = oldNodeEnv; if (oldOrigins === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = oldOrigins; });

  it("allows only configured origins and never wildcard credentials", () => {
    process.env.NODE_ENV = "test"; process.env.CORS_ORIGINS = "https://admin.example.test,https://booking.example.test";
    expect(allowedOrigins()).toEqual(["https://admin.example.test", "https://booking.example.test"]);
    process.env.NODE_ENV = "production"; process.env.CORS_ORIGINS = "*";
    expect(() => allowedOrigins()).toThrow("wildcard");
  });

  it("requires an explicit origin allowlist in production", () => {
    process.env.NODE_ENV = "production"; delete process.env.CORS_ORIGINS;
    expect(() => allowedOrigins()).toThrow("CORS_ORIGINS is required");
  });

  it("does not emit credential permission for an unknown origin", async () => {
    const allowed = await app.inject({ method: "GET", url: "/v1/health/live", headers: { origin: "http://localhost:3000" } });
    const denied = await app.inject({ method: "GET", url: "/v1/health/live", headers: { origin: "https://unknown.example.test" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    expect(denied.headers["access-control-allow-credentials"]).not.toBe("true");
  });
});
