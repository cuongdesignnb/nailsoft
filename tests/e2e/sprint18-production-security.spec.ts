import { test, expect } from "@playwright/test";

test("canonical health probes and security headers are available", async ({ request }) => {
  const response = await request.get("/v1/health/live");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-request-id"]).toBeTruthy();
  expect((await response.json()).data.status).toBe("ok");
  const startup = await request.get("/v1/health/startup");
  expect(startup.ok()).toBeTruthy();
});
