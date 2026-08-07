import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test.describe.serial("Sprint 19 Wave 4 workforce and payroll", () => {
  test("owner can read staff, scheduling and payroll workspaces", async () => {
    const owner = await login("owner@example.test");
    try {
      for (const path of ["/v1/staff", "/v1/time-clock/sessions", "/v1/timesheets", "/v1/payroll/runs", "/v1/payout-batches"]) {
        const response = await owner.api.get(path, { headers: headers(owner) });
        expect(response.status(), path).toBe(200);
      }
    } finally { await close(owner); }
  });

  test("technician remains scoped to own workforce data", async () => {
    const technician = await login("staff5@example.test");
    try {
      const own = await technician.api.get("/v1/staff/me/timesheets", { headers: headers(technician) });
      expect(own.status()).toBe(200);
      const payroll = await technician.api.get("/v1/payroll/runs", { headers: headers(technician) });
      expect([403, 404]).toContain(payroll.status());
    } finally { await close(technician); }
  });

  test("platform support cannot read salon workforce without grant", async () => {
    const platform = await login("platform-e2e@example.test");
    try { const response = await platform.api.get("/v1/staff", { headers: headers(platform) }); expect(response.status()).toBe(403); }
    finally { await close(platform); }
  });
});
