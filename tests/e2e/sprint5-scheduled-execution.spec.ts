import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const sessionId = "77000000-0000-4000-8000-000000000007";
const staffId = "47000000-0000-4000-8000-000000000007";

test("scheduled appointment executes through the assigned technician to checkout-ready", async () => {
  const technician = await login("staff7@example.test");
  const owner = await login("owner@example.test");
  try {
    let response = await technician.api.post(
      `/v1/service-sessions/${sessionId}/start`,
      {
        headers: headers(technician, "e2e-s5-scheduled-start"),
        data: { version: 1, staffId },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
    let session = (await response.json()).data;

    response = await technician.api.post(
      `/v1/service-sessions/${sessionId}/pause`,
      {
        headers: headers(technician, "e2e-s5-scheduled-pause"),
        data: { version: session.version, reasonCode: "CUSTOMER_BREAK" },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
    session = (await response.json()).data;

    response = await technician.api.post(
      `/v1/service-sessions/${sessionId}/resume`,
      {
        headers: headers(technician, "e2e-s5-scheduled-resume"),
        data: { version: session.version, staffId },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
    session = (await response.json()).data;

    response = await technician.api.post(
      `/v1/service-sessions/${sessionId}/complete`,
      {
        headers: headers(technician, "e2e-s5-scheduled-complete"),
        data: { version: session.version, completionNote: "Deep E2E complete" },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
    expect((await response.json()).data.status).toBe("COMPLETED");

    const summary = await owner.api.get(
      "/v1/appointments/70000000-0000-4000-8000-000000000007/checkout-summary",
      { headers: headers(owner) },
    );
    expect(summary.status(), await summary.text()).toBe(200);
    expect((await summary.json()).data).toEqual(
      expect.objectContaining({ status: "COMPLETED", checkoutReady: true }),
    );
  } finally {
    await close(technician);
    await close(owner);
  }
});
