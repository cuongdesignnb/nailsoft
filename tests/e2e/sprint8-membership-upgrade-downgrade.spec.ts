import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import {
  closeClosureDb,
  customerId,
  finalizeAndPay,
  firstLineId,
  refundLine,
} from "./helpers/sprint8-closure";

test.afterAll(closeClosureDb);

test("membership upgrades from paid rolling spend and downgrades after refund", async () => {
  const owner = await login("owner@example.test");
  try {
    const created = await owner.api.post("/v1/membership-tiers", {
      headers: headers(owner, "s8-close-tier-create"),
      data: {
        code: "CLOSE-SPEND",
        name: { "en-US": "Closure Spend" },
        qualificationType: "ROLLING_SPEND",
        qualificationThreshold: 100_000,
        rollingWindowDays: 30,
        benefits: [],
        priority: 1000,
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(created.status()).toBe(201);
    const paid = await finalizeAndPay(owner);
    const upgraded = await owner.api.post(
      `/v1/customers/${customerId}/membership/evaluate`,
      {
        headers: headers(owner, "s8-close-membership-upgrade"),
        data: {},
      },
    );
    expect(upgraded.status()).toBe(201);
    expect((await upgraded.json()).data.changed).toBe(true);
    await refundLine(owner, paid, firstLineId, 110_000);
    const downgraded = await owner.api.post(
      `/v1/customers/${customerId}/membership/evaluate`,
      {
        headers: headers(owner, "s8-close-membership-downgrade"),
        data: {},
      },
    );
    expect(downgraded.status()).toBe(201);
    const result = (await downgraded.json()).data;
    expect(result.changed).toBe(true);
    expect(result.assignmentId).toBeNull();
  } finally {
    await close(owner);
  }
});
