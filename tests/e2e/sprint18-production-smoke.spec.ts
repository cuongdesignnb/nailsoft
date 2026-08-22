import { test, expect, request as apiRequest } from "@playwright/test";
import { apiBaseUrl } from "./helpers/api-client";

test("production smoke exposes version and readiness without secrets", async () => {
  const request = await apiRequest.newContext({ baseURL: apiBaseUrl });
  try {
    const [ready, version, metrics] = await Promise.all([request.get("/v1/health/ready"), request.get("/v1/version"), request.get("/v1/metrics")]);
    expect(ready.ok()).toBeTruthy();
    expect(version.ok()).toBeTruthy();
    const body = await version.json();
    expect(body.data).toHaveProperty("commitSha");
    expect(JSON.stringify(body)).not.toMatch(/secret|token|password/i);
    expect(metrics.ok()).toBeTruthy();
    expect(await metrics.text()).toContain("nailsoft_http_requests_total");
  } finally {
    await request.dispose();
  }
});
