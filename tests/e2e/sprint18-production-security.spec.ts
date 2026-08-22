import { test, expect, request as apiRequest } from "@playwright/test";
import { apiBaseUrl } from "./helpers/api-client";

test("canonical health probes and security headers are available", async () => {
  const request = await apiRequest.newContext({ baseURL: apiBaseUrl });
  try {
  const response = await request.get("/v1/health/live");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-request-id"]).toBeTruthy();
  expect((await response.json()).data.status).toBe("ok");
  const startup = await request.get("/v1/health/startup");
  expect(startup.ok()).toBeTruthy();
  } finally {
    await request.dispose();
  }
});

test("denies unknown CORS origins without credential wildcarding", async () => {
  const request = await apiRequest.newContext({ baseURL: apiBaseUrl });
  try {
  const allowed = await request.get("/v1/health/live", { headers: { Origin: "http://localhost:3000" } });
  expect(allowed.headers()["access-control-allow-origin"]).toBe("http://localhost:3000");
  const denied = await request.get("/v1/health/live", { headers: { Origin: "https://unknown.example.test" } });
  expect(denied.headers()["access-control-allow-origin"]).toBeUndefined();
  expect(denied.headers()["access-control-allow-credentials"]).not.toBe("true");
  } finally {
    await request.dispose();
  }
});

test("enforces branch scope and support-access gate on authenticated analytics", async () => {
  const request = await apiRequest.newContext({ baseURL: apiBaseUrl });
  try {
  const login = await request.post("/v1/auth/login", { data: { tenantSlug: "nailsoft-demo", email: "manager-b@example.test", password: "DemoPass123!", deviceId: "s18-e2e-manager-b", deviceName: "Sprint 18", platform: "web" } });
  expect(login.ok()).toBeTruthy();
  const manager = (await login.json()).data.accessToken as string;
  const idor = await request.get("/v1/analytics/branches/compare?branchId=20000000-0000-4000-8000-000000000001", { headers: { authorization: `Bearer ${manager}`, "x-tenant-id": "10000000-0000-4000-8000-000000000001" } });
  expect(idor.status()).toBe(403);
  expect(JSON.stringify(await idor.json())).not.toMatch(/password|token|secret/i);

  const platformLogin = await request.post("/v1/auth/login", { data: { tenantSlug: "nailsoft-demo", email: "platform-e2e@example.test", password: "DemoPass123!", deviceId: "s18-e2e-platform", deviceName: "Sprint 18", platform: "web" } });
  expect(platformLogin.ok()).toBeTruthy();
  const platform = (await platformLogin.json()).data.accessToken as string;
  const denied = await request.get("/v1/analytics/command-center", { headers: { authorization: `Bearer ${platform}`, "x-tenant-id": "10000000-0000-4000-8000-000000000001", "x-support-session-token": "invalid" } });
  expect(denied.status()).toBe(403);
  expect(JSON.stringify(await denied.json())).not.toMatch(/password|token|secret/i);
  } finally {
    await request.dispose();
  }
});

test("redacts invalid authentication errors and preserves request correlation", async () => {
  const request = await apiRequest.newContext({ baseURL: apiBaseUrl });
  try {
  const response = await request.post("/v1/auth/login", { headers: { "x-request-id": "s18-redaction", "x-correlation-id": "s18-correlation" }, data: { tenantSlug: "nailsoft-demo", email: "missing-sprint18@example.test", password: "do-not-echo", deviceId: "s18-redaction", deviceName: "Sprint 18", platform: "web" } });
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.headers()["x-request-id"]).toBe("s18-redaction");
  expect(response.headers()["x-correlation-id"]).toBe("s18-correlation");
  expect(await response.text()).not.toMatch(/do-not-echo|DemoPass123|Bearer\s+[A-Za-z0-9]/i);
  } finally {
    await request.dispose();
  }
});
