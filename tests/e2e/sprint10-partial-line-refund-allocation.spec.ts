import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import { closeClosureDb, dbRow } from "./helpers/sprint8-closure";
import {
  createAppointmentOrder,
  draftOrder,
  finalize,
  getOrder,
  issueCard,
  pay,
} from "./helpers/sprint10-closure";
test.afterAll(closeClosureDb);
test("partial line refund restores only its proportional stored-value allocation", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const fundingOrder = await createAppointmentOrder(owner, "s10-line-refund");
    const card = await issueCard(owner, fundingOrder.id, "s10-line-refund");
    await finalize(owner, fundingOrder.id, "s10-line-refund");
    await pay(owner, fundingOrder.id, 100_000, "s10-line-refund");
    await pay(owner, fundingOrder.id, 110_000, "s10-line-refund-service");
    const detail = await owner.api.get(`/v1/gift-cards/${card.giftCardId}`, {
      headers: headers(owner),
    });
    const reserve = await owner.api.post(
      `/v1/pos-orders/${draftOrder}/stored-value/gift-card`,
      {
        headers: headers(owner, "s10-line-refund-reserve"),
        data: {
          requestedMinor: "40000",
          number: card.fulfillment.number,
          version: (await detail.json()).data.balance.version,
        },
      },
    );
    expect(reserve.status(), await reserve.text()).toBe(201);
    await finalize(owner, draftOrder, "s10-line-refund-sale");
    await pay(owner, draftOrder, 70_000, "s10-line-refund-sale");
    const sale = await getOrder(owner, draftOrder);
    const invoiceLine = await dbRow<{ id: string }>(
      "SELECT id FROM invoice_lines WHERE invoice_id=$1 AND source_order_line_id='a5000000-0000-4000-8000-000000000001'",
      [sale.invoice.id],
    );
    let refund = await owner.api.post(
      `/v1/invoices/${sale.invoice.id}/refunds`,
      {
        headers: headers(owner, "s10-line-refund-create"),
        data: {
          items: [{ invoiceLineId: invoiceLine.id, amountMinor: 20000 }],
          tipAmountMinor: 0,
          refundDestination: "ORIGINAL_TENDER",
          reasonCode: "LINE_TEST",
          reasonText: "Exact partial line restoration",
        },
      },
    );
    let value = (await refund.json()).data;
    refund = await owner.api.post(`/v1/refunds/${value.id}/submit`, {
      headers: headers(owner, "s10-line-refund-submit"),
      data: { version: value.version },
    });
    value = (await refund.json()).data;
    refund = await manager.api.post(`/v1/refunds/${value.id}/approve`, {
      headers: headers(manager, "s10-line-refund-approve"),
      data: { version: value.version, reason: "Independent approval" },
    });
    value = (await refund.json()).data;
    if (value.status !== "COMPLETED")
      await owner.api.post(`/v1/refunds/${value.id}/execute-external`, {
        headers: headers(owner, "s10-line-refund-execute"),
        data: {
          version: value.version,
          provider: "SPRINT10_CLOSURE",
          providerRefundId: `line-${Date.now()}`,
          processedAt: new Date().toISOString(),
          evidenceNote: "Exact line refund evidence",
        },
      });
    const restored = await dbRow<{ amount_minor: string }>(
      "SELECT amount_minor::text FROM stored_value_refund_allocations WHERE refund_id=$1 AND settlement_line_allocation_id IS NOT NULL",
      [value.id],
    );
    expect(restored.amount_minor).toBe("7272");
  } finally {
    await close(owner);
    await close(manager);
  }
});
