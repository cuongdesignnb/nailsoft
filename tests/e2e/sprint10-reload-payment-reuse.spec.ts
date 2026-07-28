import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import { closeClosureDb, dbRow } from "./helpers/sprint8-closure";
import {
  createAppointmentOrder,
  data,
  finalize,
  getOrder,
  pay,
} from "./helpers/sprint10-closure";
test.afterAll(closeClosureDb);
test("a dedicated captured reload payment cannot create liability twice", async () => {
  const owner = await login("owner@example.test");
  try {
    const activated = await owner.api.post(
      "/v1/gift-cards/da200000-0000-4000-8000-000000000002/reactivate",
      {
        headers: headers(owner, "s10-reload-reactivate"),
        data: { version: 1, reason: "Approved reload test" },
      },
    );
    const card = await data(activated);
    const order = await createAppointmentOrder(owner, "s10-reload");
    // The product API does not yet expose a standalone empty-order command.
    // Adapt the deterministic appointment order into the dedicated reload
    // fixture while retaining its tenant, branch, customer, and register scope.
    await dbRow(
      "UPDATE pos_order_lines SET status='VOIDED',void_reason='DEDICATED_RELOAD_E2E_FIXTURE' WHERE pos_order_id=$1 AND status='ACTIVE' RETURNING id",
      [order.id],
    );
    await dbRow(
      `UPDATE pos_orders SET subtotal_minor=0,discount_minor=0,taxable_minor=0,
         tax_minor=0,total_minor=0,tip_minor=0,amount_paid_minor=0,amount_due_minor=0
       WHERE id=$1 RETURNING id`,
      [order.id],
    );
    await data(
      await owner.api.post(
        `/v1/pos-orders/${order.id}/gift-card-reload-lines`,
        {
          headers: headers(owner, "sprint10-reload-line"),
          data: {
            giftCardId: card.id,
            amountMinor: "100000",
            version: card.version,
          },
        },
      ),
    );
    await finalize(owner, order.id, "s10-reload");
    await pay(owner, order.id, 100_000, "s10-reload");
    const paid = await getOrder(owner, order.id);
    const paymentId = paid.payments[0].id;
    const first = await owner.api.post(`/v1/gift-cards/${card.id}/reload`, {
      headers: headers(owner, "s10-reload-first"),
      data: { amountMinor: "100000", paymentId, version: card.version },
    });
    expect(first.status(), await first.text()).toBe(201);
    const version = (await first.json()).data.version;
    const second = await owner.api.post(`/v1/gift-cards/${card.id}/reload`, {
      headers: headers(owner, "s10-reload-second"),
      data: { amountMinor: "100000", paymentId, version },
    });
    expect(second.status(), await second.text()).toBe(409);
    expect((await second.json()).error.code).toBe(
      "GIFT_CARD_FUNDING_ALREADY_ALLOCATED",
    );
  } finally {
    await close(owner);
  }
});
