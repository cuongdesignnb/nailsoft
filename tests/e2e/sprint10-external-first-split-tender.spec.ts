import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import {
  draftOrder,
  finalize,
  getOrder,
  pay,
} from "./helpers/sprint10-closure";
test("external payment caps server-authoritative stored-value eligibility", async () => {
  const owner = await login("owner@example.test");
  try {
    await finalize(owner, draftOrder, "s10-external-first");
    await pay(owner, draftOrder, 80_000, "s10-external-first");
    const order = await getOrder(owner, draftOrder);
    expect(order.amountDueMinor).toBe(30_000);
    const response = await owner.api.get(
      `/v1/pos-orders/${draftOrder}/stored-value/eligibility`,
      { headers: headers(owner) },
    );
    expect(response.status(), await response.text()).toBe(200);
    const plan = (await response.json()).data;
    expect(plan.currentOrderDueMinor).toBe("30000");
    expect(plan.maxStoredValueMinor).toBe("30000");
    expect(plan.allocationOrder).toBe("EXTERNAL_PAYMENT_FIRST");
  } finally {
    await close(owner);
  }
});
