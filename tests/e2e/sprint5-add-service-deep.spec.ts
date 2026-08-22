import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const branchId = "20000000-0000-4000-8000-000000000001";
const serviceId = "50000000-0000-4000-8000-000000000001";
const fixtureStartAt = new Date();
fixtureStartAt.setUTCDate(fixtureStartAt.getUTCDate() + 1);
while ([0, 1].includes(fixtureStartAt.getUTCDay())) fixtureStartAt.setUTCDate(fixtureStartAt.getUTCDate() + 1);
fixtureStartAt.setUTCHours(3, 0, 0, 0);
const fixtureDate = fixtureStartAt.toISOString().slice(0, 10);

test("add-service revalidates a Booking Engine hold and preserves existing price snapshots", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  let fixtureShiftId = "";
  try {
    const shifts = await owner.api.get(`/v1/shifts?branchId=${branchId}`, {
      headers: headers(owner),
    });
    const publishedShift = (await shifts.json()).data.find(
      (shift: any) =>
        shift.status === "PUBLISHED" &&
        String(shift.startAt).startsWith("2026-08-10"),
    );
    expect(publishedShift).toBeTruthy();
    const staffId = publishedShift.staffId;
    const cancelledShift = await owner.api.post(
      `/v1/shifts/${publishedShift.id}/cancel`,
      { headers: headers(owner, "e2e-s5-add-cancel-seed-shift") },
    );
    expect(cancelledShift.status(), await cancelledShift.text()).toBe(201);
    const fixtureShift = await owner.api.post("/v1/shifts", {
      headers: headers(owner, "e2e-s5-add-create-future-shift"),
      data: {
        branchId,
        staffId,
        startAt: fixtureStartAt.toISOString(),
        endAt: new Date(
          fixtureStartAt.getTime() + 6 * 60 * 60 * 1000,
        ).toISOString(),
        breakMinutes: 0,
        source: "MANUAL",
      },
    });
    expect(fixtureShift.status(), await fixtureShift.text()).toBe(201);
    fixtureShiftId = (await fixtureShift.json()).data.id;
    const publishedFixtureShift = await owner.api.post(
      `/v1/shifts/${fixtureShiftId}/publish`,
      { headers: headers(owner, "e2e-s5-add-publish-future-shift") },
    );
    expect(
      publishedFixtureShift.status(),
      await publishedFixtureShift.text(),
    ).toBe(201);
    const availability = await owner.api.get(
      `/v1/availability?branchId=${branchId}&serviceId=${serviceId}&dateFrom=${fixtureDate}&dateTo=${fixtureDate}&slotIntervalMin=5`,
      { headers: headers(owner) },
    );
    const slot = (await availability.json()).data.days.flatMap(
      (day: any) => day.slots,
    )[0];
    expect(slot).toBeTruthy();
    const walkInResponse = await owner.api.post("/v1/walk-ins", {
      headers: headers(owner, "e2e-s5-add-create"),
      data: {
        branchId,
        displayName: "Deep E2E add-service",
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
    const walkIn = (await walkInResponse.json()).data;
    const ready = await owner.api.post(`/v1/walk-ins/${walkIn.id}/ready`, {
      headers: headers(owner, "e2e-s5-add-ready"),
      data: { version: walkIn.version },
    });
    const conversionHold = await owner.api.post(
      `/v1/walk-ins/${walkIn.id}/conversion-holds`,
      {
        headers: headers(owner, "e2e-s5-add-conversion-hold"),
        data: { desiredStartAt: slot.startAt },
      },
    );
    const converted = await owner.api.post(
      `/v1/walk-ins/${walkIn.id}/convert`,
      {
        headers: headers(owner, "e2e-s5-add-convert"),
        data: {
          version: (await ready.json()).data.version,
          holdId: (await conversionHold.json()).data.holdId,
        },
      },
    );
    expect(converted.status(), await converted.text()).toBe(201);
    const appointmentId = (await converted.json()).data.appointmentId;
    const checked = await owner.api.post(
      `/v1/appointments/${appointmentId}/check-in`,
      {
        headers: headers(manager, "e2e-s5-add-checkin"),
        data: {
          version: 1,
          overrideReason: "Deterministic late-fixture approval",
        },
      },
    );
    expect(checked.status(), await checked.text()).toBe(201);
    const beforeResponse = await owner.api.get(
      `/v1/appointments/${appointmentId}`,
      { headers: headers(owner) },
    );
    const before = (await beforeResponse.json()).data;

    const plan = await owner.api.post(
      `/v1/appointments/${appointmentId}/add-service-plans`,
      {
        headers: headers(owner),
        data: { serviceId, staffPreference: { type: "ANY" } },
      },
    );
    expect(plan.status(), await plan.text()).toBe(201);
    expect(
      Date.parse((await plan.json()).data.scheduleImpact.earliestStartAt),
    ).toBeGreaterThan(Date.now());
    const hold = await owner.api.post(
      `/v1/appointments/${appointmentId}/add-service-holds`,
      {
        headers: headers(owner, "e2e-s5-add-service-hold"),
        data: { serviceId, staffPreference: { type: "ANY" } },
      },
    );
    expect(hold.status(), await hold.text()).toBe(201);
    const committed = await owner.api.post(
      `/v1/appointments/${appointmentId}/add-service`,
      {
        headers: headers(owner, "e2e-s5-add-commit"),
        data: {
          holdId: (await hold.json()).data.holdId,
          version: (await checked.json()).data.version,
          customerApprovalMethod: "VERBAL",
          approvalNote: "Customer approved during deep E2E",
        },
      },
    );
    expect(committed.status(), await committed.text()).toBe(201);
    const afterResponse = await owner.api.get(
      `/v1/appointments/${appointmentId}`,
      { headers: headers(owner) },
    );
    const after = (await afterResponse.json()).data;
    expect(after.items).toHaveLength(2);
    expect(after.items[0].price).toEqual(before.items[0].price);
  } finally {
    if (fixtureShiftId) {
      await owner.api
        .post(`/v1/shifts/${fixtureShiftId}/cancel`, {
          headers: headers(owner, "e2e-s5-add-cleanup-shift"),
        })
        .catch(() => undefined);
    }
    await close(manager);
    await close(owner);
  }
});
