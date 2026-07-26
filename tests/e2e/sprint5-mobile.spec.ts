import { expect, test } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers } from "./helpers/api-client";

const branch = "20000000-0000-4000-8000-000000000001";

test("Owner Mobile operational summary uses live scoped data", async () => {
  const owner = await authenticated("owner");
  try {
    const response = await owner.api.get(
      `/v1/operations/summary?branchId=${branch}`,
      { headers: headers(owner) },
    );
    expect(response.status()).toBe(200);
    const data = (await response.json()).data;
    expect(data).toEqual(
      expect.objectContaining({
        waitingCount: expect.any(Number),
        inServiceCount: expect.any(Number),
        readyCheckoutCount: expect.any(Number),
      }),
    );
  } finally {
    await close(owner);
  }
});

test("Staff Today is real API data and hides other staff scope", async () => {
  const technician = await authenticated("technicianA");
  try {
    const today = await technician.api.get("/v1/staff/me/today", {
      headers: headers(technician),
    });
    expect(today.status()).toBe(200);
    const data = (await today.json()).data;
    expect(data).toHaveProperty("staffId");
    expect(data).toHaveProperty("upcomingServices");
    expect(data).toHaveProperty("completedToday");
    const other = await technician.api.get(
      "/v1/service-sessions/77000000-0000-4000-8000-000000000008",
      { headers: headers(technician) },
    );
    expect([403, 404]).toContain(other.status());
  } finally {
    await close(technician);
  }
});
