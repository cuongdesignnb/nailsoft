import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

const sessionId = "77000000-0000-4000-8000-000000000007";
const sourceStaff = "47000000-0000-4000-8000-000000000007";
const targetStaff = "47000000-0000-4000-8000-000000000011";

test("manager transfer revokes former technician execution authority atomically", async () => {
  const source = await login("staff7@example.test");
  const target = await login("staff11@example.test");
  const owner = await login("owner@example.test");
  try {
    const started = await source.api.post(
      `/v1/service-sessions/${sessionId}/start`,
      {
        headers: headers(source, "e2e-s5-transfer-start"),
        data: { version: 1, staffId: sourceStaff },
      },
    );
    expect(started.status(), await started.text()).toBe(201);
    const transferred = await owner.api.post(
      `/v1/service-sessions/${sessionId}/transfer-staff`,
      {
        headers: headers(owner, "e2e-s5-transfer-command"),
        data: {
          version: (await started.json()).data.version,
          targetStaffId: targetStaff,
          reasonCode: "SHIFT_CHANGE",
        },
      },
    );
    expect(transferred.status(), await transferred.text()).toBe(201);
    const version = (await transferred.json()).data.version;

    const formerAttempt = await source.api.post(
      `/v1/service-sessions/${sessionId}/complete`,
      {
        headers: headers(source, "e2e-s5-former-tech-denied"),
        data: { version },
      },
    );
    expect([403, 404]).toContain(formerAttempt.status());

    const completed = await target.api.post(
      `/v1/service-sessions/${sessionId}/complete`,
      {
        headers: headers(target, "e2e-s5-target-complete"),
        data: { version },
      },
    );
    expect(completed.status(), await completed.text()).toBe(201);
    expect((await completed.json()).data.status).toBe("COMPLETED");
  } finally {
    await close(source);
    await close(target);
    await close(owner);
  }
});
