import { expect, test } from "@playwright/test";
import { close, login } from "./helpers/api-client";
import { closeClosureDb, dbRows } from "./helpers/sprint8-closure";
import {
  createAppointmentOrder,
  finalize,
  issueCard,
  pay,
} from "./helpers/sprint10-closure";
test.afterAll(closeClosureDb);
test("multiple captured payments exactly fund one gift-card liability", async () => {
  const owner = await login("owner@example.test");
  try {
    const order = await createAppointmentOrder(owner, "s10-multi-funding");
    const card = await issueCard(owner, order.id, "s10-multi-funding");
    await finalize(owner, order.id, "s10-multi-funding");
    await pay(owner, order.id, 90_000, "s10-multi-funding-90");
    await pay(owner, order.id, 10_000, "s10-multi-funding-10");
    await pay(owner, order.id, 110_000, "s10-multi-funding-service");
    const allocations = await dbRows<{ allocated_minor: string }>(
      `SELECT allocated_minor::text FROM stored_value_funding_allocations
        WHERE gift_card_id=$1 ORDER BY created_at,id`,
      [card.giftCardId],
    );
    expect(allocations.map((item) => item.allocated_minor)).toEqual([
      "90000",
      "10000",
    ]);
  } finally {
    await close(owner);
  }
});
