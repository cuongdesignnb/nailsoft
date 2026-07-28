import { expect, test } from "@playwright/test";
import { close, headers, login, type Session } from "./helpers/api-client";
import { closeClosureDb, dbRow } from "./helpers/sprint8-closure";

const appointmentForPurchase = "70000000-0000-4000-8000-000000000035";
const register = "a1000000-0000-4000-8000-000000000001";
const giftCardProduct = "da100000-0000-4000-8000-000000000001";
const redemptionOrder = "a4000000-0000-4000-8000-000000000001";
const customerCreditOrder = "a4000000-0000-4000-8000-000000000002";
const redemptionOrderLine = "a5000000-0000-4000-8000-000000000001";
const customerCreditOrderLine = "a5000000-0000-4000-8000-000000000002";
const customer = "60000000-0000-4000-8000-000000000008";
const adjustmentCustomer = "60000000-0000-4000-8000-000000000001";

test.describe.configure({ mode: "serial" });
test.afterAll(closeClosureDb);

async function order(session: Session, orderId: string) {
  const response = await session.api.get(`/v1/pos-orders/${orderId}`, {
    headers: headers(session),
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
}

async function finalizeAndPay(session: Session, orderId: string) {
  let current = await order(session, orderId);
  if (!current.finalizedAt) {
    const finalized = await session.api.post(
      `/v1/pos-orders/${orderId}/finalize`,
      {
        headers: headers(session, `s10-finalize-${orderId}`),
        data: { version: current.version },
      },
    );
    expect(finalized.status(), await finalized.text()).toBe(201);
    current = (await finalized.json()).data;
  }
  if (current.amountDueMinor > 0) {
    const paid = await session.api.post(`/v1/pos-orders/${orderId}/payments`, {
      headers: headers(session, `s10-pay-${orderId}`),
      data: {
        version: current.version,
        amountToApplyMinor: current.amountDueMinor,
        tenderType: "CARD_EXTERNAL",
        provider: "SPRINT10_E2E",
        providerTransactionId: `s10-${orderId}-${Date.now()}`,
        cardLast4: "4242",
      },
    });
    expect(paid.status(), await paid.text()).toBe(201);
    current = (await paid.json()).data;
  }
  expect(current.status).toBe("PAID");
  return current;
}

async function invoiceLine(invoiceId: string, sourceOrderLineId: string) {
  return dbRow<{ id: string; net_minor: string }>(
    `SELECT id,net_minor::text FROM invoice_lines
      WHERE invoice_id=$1 AND source_order_line_id=$2`,
    [invoiceId, sourceOrderLineId],
  );
}

async function refundLine(params: {
  owner: Session;
  manager: Session;
  invoiceId: string;
  invoiceLineId: string;
  amountMinor: number;
  destination?: "ORIGINAL_TENDER" | "CUSTOMER_CREDIT";
  key: string;
}) {
  const created = await params.owner.api.post(
    `/v1/invoices/${params.invoiceId}/refunds`,
    {
      headers: headers(params.owner, `${params.key}-create`),
      data: {
        items: [
          {
            invoiceLineId: params.invoiceLineId,
            amountMinor: params.amountMinor,
          },
        ],
        tipAmountMinor: 0,
        refundDestination: params.destination ?? "ORIGINAL_TENDER",
        reasonCode: "SPRINT10_E2E",
        reasonText: "Authenticated Sprint 10 stored-value lifecycle",
      },
    },
  );
  expect(created.status(), await created.text()).toBe(201);
  let refund = (await created.json()).data;
  const submitted = await params.owner.api.post(
    `/v1/refunds/${refund.id}/submit`,
    {
      headers: headers(params.owner, `${params.key}-submit`),
      data: { version: refund.version },
    },
  );
  expect(submitted.status(), await submitted.text()).toBe(201);
  refund = (await submitted.json()).data;
  const approved = await params.manager.api.post(
    `/v1/refunds/${refund.id}/approve`,
    {
      headers: headers(params.manager, `${params.key}-approve`),
      data: { version: refund.version, reason: "Independent manager approval" },
    },
  );
  expect(approved.status(), await approved.text()).toBe(201);
  refund = (await approved.json()).data;
  if (refund.status !== "COMPLETED") {
    const executed = await params.owner.api.post(
      `/v1/refunds/${refund.id}/execute-external`,
      {
        headers: headers(params.owner, `${params.key}-execute`),
        data: {
          version: refund.version,
          provider: "SPRINT10_E2E",
          providerRefundId: `${params.key}-${Date.now()}`,
          processedAt: new Date().toISOString(),
          evidenceNote: "Provider-confirmed Sprint 10 refund",
        },
      },
    );
    expect(executed.status(), await executed.text()).toBe(201);
    refund = (await executed.json()).data;
  }
  expect(refund.status).toBe("COMPLETED");
  return refund;
}

test("gift-card purchase activates only after capture, redeems with split tender, and restores exactly", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const created = await owner.api.post(
      `/v1/appointments/${appointmentForPurchase}/pos-orders`,
      {
        headers: headers(owner, "s10-purchase-order"),
        data: { registerId: register },
      },
    );
    expect(created.status(), await created.text()).toBe(201);
    const purchaseOrderId = (await created.json()).data.id;

    const issuedCards: Array<{
      giftCardId: string;
      lineId: string;
      fulfillment: { number: string };
    }> = [];
    for (const suffix of ["redeem", "refund"]) {
      const issued = await owner.api.post(
        `/v1/pos-orders/${purchaseOrderId}/gift-card-lines`,
        {
          headers: headers(owner, `s10-gift-line-${suffix}`),
          data: {
            productId: giftCardProduct,
            amountMinor: "100000",
            customerId: customer,
            form: "DIGITAL",
            deliveryChannel: "NONE",
          },
        },
      );
      expect(issued.status(), await issued.text()).toBe(201);
      issuedCards.push((await issued.json()).data);
    }
    const purchase = await finalizeAndPay(owner, purchaseOrderId);
    for (const issued of issuedCards) {
      const card = await owner.api.get(`/v1/gift-cards/${issued.giftCardId}`, {
        headers: headers(owner),
      });
      expect(card.status()).toBe(200);
      expect((await card.json()).data.status).toBe("ACTIVE");
    }

    const card = await owner.api.get(
      `/v1/gift-cards/${issuedCards[0].giftCardId}`,
      {
        headers: headers(owner),
      },
    );
    const cardData = (await card.json()).data;
    const reserve = await owner.api.post(
      `/v1/pos-orders/${redemptionOrder}/stored-value/gift-card`,
      {
        headers: headers(owner, "s10-reserve-redeem"),
        data: {
          requestedMinor: "100000",
          number: issuedCards[0].fulfillment.number,
          version: cardData.balance.version,
        },
      },
    );
    expect(reserve.status(), await reserve.text()).toBe(201);
    expect((await reserve.json()).data.acceptedMinor).toBe("100000");
    const redeemedOrder = await finalizeAndPay(owner, redemptionOrder);
    expect(redeemedOrder.payments).toHaveLength(1);
    expect(redeemedOrder.payments[0].capturedMinor).toBe(10000);

    const redeemedInvoice = await dbRow<{ id: string }>(
      "SELECT id FROM invoices WHERE pos_order_id=$1 AND status='ISSUED'",
      [redemptionOrder],
    );
    const redeemedLine = await invoiceLine(
      redeemedInvoice.id,
      redemptionOrderLine,
    );
    await refundLine({
      owner,
      manager,
      invoiceId: redeemedInvoice.id,
      invoiceLineId: redeemedLine.id,
      amountMinor: Number(redeemedLine.net_minor),
      key: "s10-redemption-refund",
    });
    const restored = await owner.api.get(
      `/v1/gift-cards/${issuedCards[0].giftCardId}/balance`,
      { headers: headers(owner) },
    );
    expect((await restored.json()).data.availableMinor).toBe("100000");

    const purchaseInvoice = await dbRow<{ id: string }>(
      "SELECT id FROM invoices WHERE pos_order_id=$1 AND status='ISSUED'",
      [purchase.id],
    );
    const fundingLine = await invoiceLine(
      purchaseInvoice.id,
      issuedCards[1].lineId,
    );
    await refundLine({
      owner,
      manager,
      invoiceId: purchaseInvoice.id,
      invoiceLineId: fundingLine.id,
      amountMinor: Number(fundingLine.net_minor),
      key: "s10-unused-card-refund",
    });
    const cancelled = await owner.api.get(
      `/v1/gift-cards/${issuedCards[1].giftCardId}`,
      { headers: headers(owner) },
    );
    expect((await cancelled.json()).data.status).toBe("CANCELLED");
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("customer-credit refund destination completes without original-tender duplication", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const paid = await finalizeAndPay(owner, customerCreditOrder);
    const invoice = await dbRow<{ id: string }>(
      "SELECT id FROM invoices WHERE pos_order_id=$1 AND status='ISSUED'",
      [customerCreditOrder],
    );
    const line = await invoiceLine(invoice.id, customerCreditOrderLine);
    const refund = await refundLine({
      owner,
      manager,
      invoiceId: invoice.id,
      invoiceLineId: line.id,
      amountMinor: Number(line.net_minor),
      destination: "CUSTOMER_CREDIT",
      key: "s10-customer-credit-refund",
    });
    const allocationCounts = await dbRow<{
      external_count: number;
      credit_count: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM refund_payment_allocations WHERE refund_id=$1) external_count,
         (SELECT count(*)::int FROM stored_value_refund_allocations WHERE refund_id=$1 AND destination='CUSTOMER_CREDIT') credit_count`,
      [refund.id],
    );
    expect(allocationCounts.external_count).toBe(0);
    expect(allocationCounts.credit_count).toBe(1);
    const wallet = await owner.api.get(
      `/v1/customers/${paid.customerId}/customer-credit`,
      { headers: headers(owner) },
    );
    expect(wallet.status()).toBe(200);
    expect(
      BigInt((await wallet.json()).data[0].availableMinor),
    ).toBeGreaterThan(0n);
    const replay = await owner.api.post(
      `/v1/refunds/${refund.id}/issue-customer-credit`,
      {
        headers: headers(owner, "s10-credit-issue-replay"),
        data: { amountMinor: String(line.net_minor) },
      },
    );
    expect(replay.status(), await replay.text()).toBe(201);
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("customer-credit adjustment uses independent approval and salon data remains denied to technician/platform", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  const technician = await login("staff7@example.test");
  const platform = await login("platform-e2e@example.test");
  try {
    const created = await owner.api.post("/v1/stored-value-adjustments", {
      headers: headers(owner, "s10-adjustment-create"),
      data: {
        branchId: "20000000-0000-4000-8000-000000000001",
        customerId: adjustmentCustomer,
        currency: "VND",
        adjustmentType: "SERVICE_RECOVERY_CREDIT",
        amountMinor: "50000",
        reasonCode: "SERVICE_RECOVERY",
        note: "Authenticated Sprint 10 independent approval",
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const adjustment = (await created.json()).data;
    const selfApproval = await owner.api.post(
      `/v1/stored-value-adjustments/${adjustment.id}/approve`,
      {
        headers: headers(owner, "s10-adjustment-self"),
        data: { version: adjustment.version, reason: "Self approval denied" },
      },
    );
    expect(selfApproval.status()).toBe(409);
    expect((await selfApproval.json()).error.code).toBe(
      "CUSTOMER_CREDIT_SELF_APPROVAL_DENIED",
    );
    const approved = await manager.api.post(
      `/v1/stored-value-adjustments/${adjustment.id}/approve`,
      {
        headers: headers(manager, "s10-adjustment-approve"),
        data: { version: adjustment.version, reason: "Independent review" },
      },
    );
    expect(approved.status(), await approved.text()).toBe(201);
    expect((await approved.json()).data.status).toBe("APPROVED");

    for (const session of [technician, platform]) {
      const denied = await session.api.get(
        "/v1/stored-value/reports/liability",
        {
          headers: headers(session),
        },
      );
      expect([403, 404]).toContain(denied.status());
    }
  } finally {
    await close(owner);
    await close(manager);
    await close(technician);
    await close(platform);
  }
});
