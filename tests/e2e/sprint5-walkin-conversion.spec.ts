import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const branchId = "20000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";

test("walk-in conversion consumes a Booking Engine hold exactly once", async () => {
  const owner = await login("owner@example.test");
  try {
    let slot: any;
    for (let offset = 1; offset <= 30 && !slot; offset += 1) {
      const candidateDate = new Date();
      candidateDate.setUTCDate(candidateDate.getUTCDate() + offset);
      const date = candidateDate.toISOString().slice(0, 10);
      const availability = await owner.api.get(
        `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&dateFrom=${date}&dateTo=${date}&slotIntervalMin=5`,
        { headers: headers(owner) },
      );
      expect(availability.status(), await availability.text()).toBe(200);
      slot = (await availability.json()).data.days.flatMap(
        (day: any) => day.slots,
      )[0];
    }
    expect(slot).toBeTruthy();

    const created = await owner.api.post("/v1/walk-ins", {
      headers: headers(owner, "e2e-s5-walkin-create"),
      data: {
        branchId,
        displayName: "Deep E2E walk-in",
        items: [
          {
            serviceId,
            staffPreference: {
              type: "SPECIFIC",
              staffId: slot.staffCandidates[0].staffId,
            },
          },
        ],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const walkIn = (await created.json()).data;
    expect(walkIn.estimateDisclaimer).toBe("ESTIMATED_NOT_GUARANTEED");

    const ready = await owner.api.post(`/v1/walk-ins/${walkIn.id}/ready`, {
      headers: headers(owner, "e2e-s5-walkin-ready"),
      data: { version: walkIn.version },
    });
    expect(ready.status(), await ready.text()).toBe(201);
    const hold = await owner.api.post(
      `/v1/walk-ins/${walkIn.id}/conversion-holds`,
      {
        headers: headers(owner, "e2e-s5-walkin-hold"),
        data: { desiredStartAt: slot.startAt },
      },
    );
    expect(hold.status(), await hold.text()).toBe(201);
    const payload = {
      version: (await ready.json()).data.version,
      holdId: (await hold.json()).data.holdId,
    };
    const key = "e2e-s5-walkin-convert";
    const first = await owner.api.post(`/v1/walk-ins/${walkIn.id}/convert`, {
      headers: headers(owner, key),
      data: payload,
    });
    const replay = await owner.api.post(`/v1/walk-ins/${walkIn.id}/convert`, {
      headers: headers(owner, key),
      data: payload,
    });
    expect(first.status(), await first.text()).toBe(201);
    expect(replay.status(), await replay.text()).toBe(201);
    expect((await replay.json()).data.appointmentId).toBe(
      (await first.json()).data.appointmentId,
    );
  } finally {
    await close(owner);
  }
});
