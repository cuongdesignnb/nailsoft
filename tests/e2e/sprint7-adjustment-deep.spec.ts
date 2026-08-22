import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("approved manual adjustment creates one attributable commission entry", async () => {
  const accountant = await login("accountant@example.test");
  const owner = await login("owner@example.test");
  try {
    const created = await accountant.api.post("/v1/commission-adjustments", {
      headers: headers(accountant),
      data: {
        staffId: "47000000-0000-4000-8000-000000000003",
        targetPeriodId: "b2000000-0000-4000-8000-000000000001",
        amountMinor: 3210,
        currency: "VND",
        reasonCode: "E2E_CORRECTION",
        note: "Authenticated adjustment closure evidence",
      },
    });
    expect(created.status()).toBe(201);
    const adjustment = (await created.json()).data;
    const approved = await owner.api.post(
      `/v1/commission-adjustments/${adjustment.id}/approve`,
      {
        headers: headers(owner),
        data: { version: adjustment.version, reason: "Owner deep review" },
      },
    );
    expect(approved.status()).toBe(201);
    expect((await approved.json()).data.status).toBe("APPROVED");
  } finally {
    await close(accountant);
    await close(owner);
  }
});
