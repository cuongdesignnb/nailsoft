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
  setupLoyalty,
} from "./helpers/sprint8-closure";

test.afterAll(closeClosureDb);

test("loyalty pays service only and reverses redemption plus earn on refund", async () => {
  const owner = await login("owner@example.test");
  try {
    await setupLoyalty(3000);
    let order = await getOrder(owner);
    const tipped = await owner.api.post(`/v1/pos-orders/${orderId}/tip`, {
      headers: headers(owner, "s8-close-tip-command"),
      data: {
        version: order.version,
        amountMinor: 20_000,
        source: "CUSTOMER",
        allocationBasis: "EQUAL",
      },
    });
    const tippedBody = await tipped.json();
    expect(tipped.status(), JSON.stringify(tippedBody)).toBe(201);
    order = tippedBody.data;
    const applied = await owner.api.post(
      `/v1/pos-orders/${orderId}/benefits/loyalty`,
      {
        headers: headers(owner, "s8-close-loyalty-apply"),
        data: { version: order.version, points: 500 },
      },
    );
    expect(applied.status()).toBe(201);
    order = (await applied.json()).data;
    expect(order.tipMinor).toBe(20_000);
    expect(order.amountDueMinor).toBeGreaterThanOrEqual(20_000);
    const contract = await dbRow<{
      requested_points: string;
      accepted_points: string;
      unused_points: string;
    }>(
      "SELECT requested_points,accepted_points,unused_points FROM loyalty_reservations WHERE pos_order_id=$1",
      [orderId],
    );
    expect(Number(contract.requested_points)).toBe(500);
    expect(Number(contract.accepted_points)).toBe(500);
    expect(
      Number(contract.accepted_points) + Number(contract.unused_points),
    ).toBe(500);
    const paid = await finalizeAndPay(owner);
    await refundLine(owner, paid, firstLineId, 50_000);
    const reversals = await dbRow<{ redemption: string; earn: string }>(
      `SELECT count(*) FILTER(WHERE entry_type='REFUND_REVERSAL' AND available_delta>0) redemption,
              count(*) FILTER(WHERE entry_type='REFUND_REVERSAL' AND (pending_delta<0 OR lifetime_delta<0)) earn
       FROM loyalty_ledger_entries WHERE pos_order_id=$1`,
      [orderId],
    );
    expect(Number(reversals.redemption)).toBeGreaterThan(0);
    expect(Number(reversals.earn)).toBeGreaterThan(0);
    const account = await dbRow<{ customer_id: string }>(
      "SELECT customer_id FROM loyalty_accounts WHERE customer_id=$1",
      [customerId],
    );
    expect(account.customer_id).toBe(customerId);
  } finally {
    await close(owner);
  }
});
