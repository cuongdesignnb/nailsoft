import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import {
  closeClosureDb,
  customerId,
  dbRow,
  finalizeAndPay,
  firstLineId,
  getOrder,
  orderId,
  refundLine,
} from "./helpers/sprint8-closure";

test.afterAll(closeClosureDb);

test("voucher survives paid lifecycle and restores usage proportionally", async () => {
  const owner = await login("owner@example.test");
  try {
    const now = Date.now();
    const created = await owner.api.post("/v1/voucher-campaigns", {
      headers: headers(owner, "s8-close-voucher-campaign"),
      data: {
        name: "Closure proportional voucher",
        discountType: "PERCENT",
        discountValue: 1000,
        minimumSpendMinor: 0,
        perCustomerUseLimit: 1,
        codeUseLimit: 1,
        branchIds: [],
        serviceIds: [],
        customerIds: [customerId],
        membershipTierIds: [],
        eligibilityPolicy: {},
        refundPolicy: "PROPORTIONAL_RESTORE",
        validFrom: new Date(now - 60_000).toISOString(),
        validUntil: new Date(now + 86_400_000).toISOString(),
      },
    });
    expect(created.status()).toBe(201);
    const campaign = (await created.json()).data;
    const activated = await owner.api.post(
      `/v1/voucher-campaigns/${campaign.id}/activate`,
      {
        headers: headers(owner, "s8-close-voucher-activate"),
        data: { version: campaign.version },
      },
    );
    expect(activated.status()).toBe(201);
    const code = "CLOSE-PROP-10";
    const issued = await owner.api.post(
      `/v1/voucher-campaigns/${campaign.id}/codes`,
      {
        headers: headers(owner, "s8-close-voucher-issue"),
        data: { code, customerId, useLimit: 1 },
      },
    );
    expect(issued.status()).toBe(201);
    const order = await getOrder(owner);
    const applied = await owner.api.post(
      `/v1/pos-orders/${orderId}/benefits/voucher`,
      {
        headers: headers(owner, "s8-close-voucher-apply"),
        data: { version: order.version, code },
      },
    );
    expect(applied.status()).toBe(201);
    const paid = await finalizeAndPay(owner);
    await refundLine(owner, paid, firstLineId, 50_000);
    const usage = await dbRow<{ net_committed_uses: string }>(
      "SELECT net_committed_uses FROM voucher_customer_usage WHERE campaign_id=$1 AND customer_id=$2",
      [campaign.id, customerId],
    );
    expect(Number(usage.net_committed_uses)).toBeGreaterThan(0);
    expect(Number(usage.net_committed_uses)).toBeLessThan(1);
  } finally {
    await close(owner);
  }
});
