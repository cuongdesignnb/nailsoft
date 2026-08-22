import { test, expect, request as apiRequest } from "@playwright/test";
import { apiBaseUrl } from "./helpers/api-client";

test("authenticated analytics route is exposed", async () => {
  const request = await apiRequest.newContext({ baseURL: apiBaseUrl });
  try {
    const response = await request.get("/v1/analytics/command-center?from=2026-08-01&to=2026-08-31");
    expect([401, 403]).toContain(response.status());
  } finally {
    await request.dispose();
  }
});
