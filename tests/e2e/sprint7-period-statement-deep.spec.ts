import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("locked statement returns only exact period and staff entries", async () => {
  const owner = await login("owner@example.test");
  const accountant = await login("accountant@example.test");
  try {
    const created = await accountant.api.post("/v1/commission-adjustments", {
      headers: headers(accountant),
      data: {
        staffId: "47000000-0000-4000-8000-000000000008",
        targetPeriodId: "b2000000-0000-4000-8000-000000000001",
        amountMinor: 4321,
        currency: "VND",
        reasonCode: "STATEMENT_E2E",
        note: "Statement reconciliation evidence",
      },
    });
    expect(created.status()).toBe(201);
    const adjustment = (await created.json()).data;
    const approved = await owner.api.post(
      `/v1/commission-adjustments/${adjustment.id}/approve`,
      {
        headers: headers(owner),
        data: { version: adjustment.version, reason: "Statement approval" },
      },
    );
    expect(approved.status()).toBe(201);
    const review = await owner.api.post(
      "/v1/commission-periods/b2000000-0000-4000-8000-000000000001/start-review",
      {
        headers: headers(owner),
        data: { version: 1 },
      },
    );
    expect(review.status()).toBe(201);
    const locked = await owner.api.post(
      "/v1/commission-periods/b2000000-0000-4000-8000-000000000001/lock",
      {
        headers: headers(owner),
        data: { version: (await review.json()).data.version },
      },
    );
    expect(locked.status()).toBe(201);
    const response = await owner.api.get(
      "/v1/commission-periods/b2000000-0000-4000-8000-000000000001/staff/47000000-0000-4000-8000-000000000008/statement",
      { headers: headers(owner) },
    );
    expect(response.status()).toBe(200);
    const statement = (await response.json()).data;
    expect(statement.entries.length).toBeGreaterThan(0);
    for (const entry of statement.entries) {
      expect(entry.periodId).toBe("b2000000-0000-4000-8000-000000000001");
      expect(entry.staffId).toBe("47000000-0000-4000-8000-000000000008");
    }
    expect(
      statement.entries.reduce(
        (sum: number, entry: { commissionMinor: number }) =>
          sum + entry.commissionMinor,
        0,
      ),
    ).toBe(statement.payableMinor);
  } finally {
    await close(owner);
    await close(accountant);
  }
});
