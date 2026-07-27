import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("technician own tip summary is derived from active tip versions", async () => {
  const technician = await login("staff5@example.test");
  try {
    const response = await technician.api.get("/v1/staff/me/tips", {
      headers: headers(technician),
    });
    expect(response.status()).toBe(200);
    const summary = (await response.json()).data;
    expect(summary.staffId).toBe("47000000-0000-4000-8000-000000000005");
    expect(summary.grossTipMinor).toBe(6250);
    expect(summary.netTipMinor).toBeLessThanOrEqual(summary.grossTipMinor);
  } finally {
    await close(technician);
  }
});
