import { test, expect } from "@playwright/test";
test("authenticated analytics route is exposed", async ({ request }) => {
  const response = await request.get("/v1/analytics/command-center?from=2026-08-01&to=2026-08-31");
  expect([401, 403]).toContain(response.status());
});
