import { test, expect } from "@playwright/test";

test("production smoke exposes version and readiness without secrets", async ({ request }) => {
  const [ready, version, metrics] = await Promise.all([request.get("/v1/health/ready"), request.get("/v1/version"), request.get("/v1/metrics")]);
  expect(ready.ok()).toBeTruthy();
  expect(version.ok()).toBeTruthy();
  const body = await version.json();
  expect(body.data).toHaveProperty("commitSha");
  expect(JSON.stringify(body)).not.toMatch(/secret|token|password/i);
  expect(metrics.ok()).toBeTruthy();
  expect(await metrics.text()).toContain("nailsoft_http_requests_total");
});
