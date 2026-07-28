import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import {
  closeClosureDb,
  dbRow,
  finalizeAndPay,
  getOrder,
  orderId,
  refundLine,
} from "./helpers/sprint8-closure";

const branchQ1 = "20000000-0000-4000-8000-000000000001";
const branchQ2 = "20000000-0000-4000-8000-000000000002";
const sourceLocation = "b9050000-0000-4000-8000-000000000001";
const destinationLocation = "b9050000-0000-4000-8000-000000000003";
const retailLocation = "b9050000-0000-4000-8000-000000000002";
const polish = "b9030000-0000-4000-8000-000000000001";
const careKit = "b9030000-0000-4000-8000-000000000003";
const polishLot = "b9070000-0000-4000-8000-000000000001";
const supplier = "b90a0000-0000-4000-8000-000000000001";
const millilitre = "b9000000-0000-4000-8000-000000000002";
const serviceSession = "77000000-0000-4000-8000-000000000007";
const technician = "47000000-0000-4000-8000-000000000007";

test.describe.configure({ mode: "serial" });
test.afterAll(closeClosureDb);

test("purchase order uses independent approval and reconciles partial/final receipts", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const created = await owner.api.post("/v1/inventory/purchase-orders", {
      headers: headers(owner, "s9-e2e-po-create"),
      data: {
        branchId: branchQ1,
        supplierId: supplier,
        currency: "VND",
        lines: [
          {
            itemId: polish,
            uomId: millilitre,
            quantity: "100",
            unitPriceMinor: "5000",
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    let po = (await created.json()).data;
    expect(po.poNumber).toMatch(/^PO-Q1-\d{4}-\d{6}$/);

    const submitted = await owner.api.post(
      `/v1/inventory/purchase-orders/${po.id}/submit`,
      {
        headers: headers(owner, "s9-e2e-po-submit"),
        data: { version: po.version },
      },
    );
    expect(submitted.status()).toBe(201);
    po = (await submitted.json()).data;
    const selfApproval = await owner.api.post(
      `/v1/inventory/purchase-orders/${po.id}/approve`,
      {
        headers: headers(owner, "s9-e2e-po-self-approve"),
        data: { version: po.version },
      },
    );
    expect(selfApproval.status()).toBe(409);
    const approved = await manager.api.post(
      `/v1/inventory/purchase-orders/${po.id}/approve`,
      {
        headers: headers(manager, "s9-e2e-po-approve"),
        data: { version: po.version, reason: "Independent approval" },
      },
    );
    expect(approved.status()).toBe(201);
    po = (await approved.json()).data;
    const detail = await owner.api.get(
      `/v1/inventory/purchase-orders/${po.id}`,
      { headers: headers(owner) },
    );
    const poLineId = (await detail.json()).data.lines[0].id;

    for (const [index, quantity] of ["40", "60"].entries()) {
      const receipt = await owner.api.post("/v1/inventory/goods-receipts", {
        headers: headers(owner, `s9-e2e-receipt-${index}-create`),
        data: {
          branchId: branchQ1,
          purchaseOrderId: po.id,
          locationId: sourceLocation,
          receivedAt: new Date().toISOString(),
          lines: [
            {
              purchaseOrderLineId: poLineId,
              itemId: polish,
              lotId: polishLot,
              quantity,
              unitCostMinor: "5000",
              qualityDisposition: "ACCEPTED",
            },
          ],
        },
      });
      const receiptBody = await receipt.json();
      expect(receipt.status(), JSON.stringify(receiptBody)).toBe(201);
      const receiptData = receiptBody.data;
      const posted = await owner.api.post(
        `/v1/inventory/goods-receipts/${receiptData.id}/post`,
        {
          headers: headers(owner, `s9-e2e-receipt-${index}-post`),
          data: { version: receiptData.version },
        },
      );
      const postedBody = await posted.json();
      expect(posted.status(), JSON.stringify(postedBody)).toBe(201);
      const current = await owner.api.get(
        `/v1/inventory/purchase-orders/${po.id}`,
        { headers: headers(owner) },
      );
      const body = (await current.json()).data;
      expect(body.status).toBe(index === 0 ? "PARTIALLY_RECEIVED" : "RECEIVED");
    }
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("transfer reserves, ships through in-transit and preserves lot at destination", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const created = await owner.api.post("/v1/inventory/transfers", {
      headers: headers(owner, "s9-e2e-transfer-create"),
      data: {
        sourceBranchId: branchQ1,
        destinationBranchId: branchQ2,
        sourceLocationId: sourceLocation,
        destinationLocationId: destinationLocation,
        lines: [{ itemId: polish, lotId: polishLot, quantity: "5" }],
      },
    });
    expect(created.status()).toBe(201);
    let transfer = (await created.json()).data;
    for (const [actor, command, key] of [
      [owner, "request", "s9-e2e-transfer-request"],
      [manager, "approve", "s9-e2e-transfer-approve"],
      [owner, "ship", "s9-e2e-transfer-ship"],
      [owner, "receive", "s9-e2e-transfer-receive"],
    ] as const) {
      const response = await actor.api.post(
        `/v1/inventory/transfers/${transfer.id}/${command}`,
        {
          headers: headers(actor, key),
          data: { version: transfer.version, reason: "Authenticated transfer" },
        },
      );
      expect(response.status()).toBe(201);
      transfer = (await response.json()).data;
    }
    expect(transfer.status).toBe("RECEIVED");
    const destination = await owner.api.get(
      `/v1/inventory/stock?branchId=${branchQ2}&itemId=${polish}`,
      { headers: headers(owner) },
    );
    expect(destination.status()).toBe(200);
    expect(Number((await destination.json()).data[0].onHand)).toBe(5);
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("blind count hides expected values until review and posts its variance", async () => {
  const owner = await login("owner@example.test");
  const manager = await login("staff2@example.test");
  try {
    const created = await owner.api.post("/v1/inventory/counts", {
      headers: headers(owner, "s9-e2e-count-create"),
      data: {
        branchId: branchQ1,
        locationId: retailLocation,
        blind: true,
        items: [{ itemId: careKit }],
      },
    });
    let count = (await created.json()).data;
    const started = await owner.api.post(
      `/v1/inventory/counts/${count.id}/start`,
      {
        headers: headers(owner, "s9-e2e-count-start"),
        data: { version: count.version },
      },
    );
    count = (await started.json()).data;
    const blind = await owner.api.get(`/v1/inventory/counts/${count.id}`, {
      headers: headers(owner),
    });
    const blindBody = (await blind.json()).data;
    expect(blindBody.lines[0].expectedQuantity).toBeUndefined();
    const declared = await owner.api.post(
      `/v1/inventory/counts/${count.id}/lines/${blindBody.lines[0].id}/declare`,
      {
        headers: headers(owner, "s9-e2e-count-declare"),
        data: { version: blindBody.lines[0].version, countedQuantity: "4" },
      },
    );
    expect(declared.status()).toBe(201);
    const reviewed = await manager.api.post(
      `/v1/inventory/counts/${count.id}/start-review`,
      {
        headers: headers(manager, "s9-e2e-count-review"),
        data: { version: count.version },
      },
    );
    count = (await reviewed.json()).data;
    const review = await manager.api.get(
      `/v1/inventory/counts/${count.id}/review`,
      { headers: headers(manager) },
    );
    expect((await review.json()).data.lines[0].varianceQuantity).toBe(
      "1.000000",
    );
    const posted = await manager.api.post(
      `/v1/inventory/counts/${count.id}/post`,
      {
        headers: headers(manager, "s9-e2e-count-post"),
        data: { version: count.version },
      },
    );
    expect((await posted.json()).data.status).toBe("POSTED");
  } finally {
    await close(owner);
    await close(manager);
  }
});

test("service start reserves materials and completion consumes exactly once", async () => {
  const tech = await login("staff7@example.test");
  try {
    const started = await tech.api.post(
      `/v1/service-sessions/${serviceSession}/start`,
      {
        headers: headers(tech, "s9-e2e-service-start"),
        data: { version: 1, staffId: technician, overrideReason: null },
      },
    );
    expect(started.status()).toBe(201);
    const session = (await started.json()).data;
    const materialsResponse = await tech.api.get(
      `/v1/service-sessions/${serviceSession}/materials`,
      { headers: headers(tech) },
    );
    expect(materialsResponse.status()).toBe(200);
    const materials = (await materialsResponse.json()).data;
    expect(materials.lines).toHaveLength(1);
    const actualUsage = await tech.api.post(
      `/v1/service-sessions/${serviceSession}/materials/actual-usage`,
      {
        headers: headers(tech, "s9-e2e-service-actual"),
        data: {
          version: materials.version,
          actualLines: [
            {
              reservationLineId: materials.lines[0].reservationLineId,
              quantity: "1.5",
            },
          ],
        },
      },
    );
    expect(actualUsage.status(), await actualUsage.text()).toBe(201);
    const completed = await tech.api.post(
      `/v1/service-sessions/${serviceSession}/complete`,
      {
        headers: headers(tech, "s9-e2e-service-complete"),
        data: { version: session.version, completionNote: "Inventory E2E" },
      },
    );
    expect(completed.status()).toBe(201);
    const reservation = await dbRow<{ status: string }>(
      "SELECT status FROM service_material_reservations WHERE service_session_id=$1",
      [serviceSession],
    );
    expect(reservation.status).toBe("COMMITTED");
    const movement = await dbRow<{ quantity_delta: string }>(
      "SELECT quantity_delta::text FROM inventory_stock_ledger_entries WHERE reference_type='service_material_reservation_line' AND reference_id=$1",
      [materials.lines[0].reservationLineId],
    );
    expect(movement.quantity_delta).toBe("-1.500000");
  } finally {
    await close(tech);
  }
});

test("retail sale commits stock and refund only restocks after explicit inspection post", async () => {
  const owner = await login("owner@example.test");
  try {
    let order = await getOrder(owner);
    const added = await owner.api.post(
      `/v1/pos-orders/${orderId}/product-lines`,
      {
        headers: headers(owner, "s9-e2e-product-add"),
        data: {
          version: order.version,
          itemId: careKit,
          locationId: retailLocation,
          quantity: "1",
        },
      },
    );
    expect(added.status()).toBe(201);
    const productLine = (await added.json()).data;
    order = await finalizeAndPay(owner);
    const afterSale = await dbRow<{ on_hand: string }>(
      "SELECT on_hand::text FROM inventory_stock_balances WHERE branch_id=$1 AND location_id=$2 AND item_id=$3 AND lot_id IS NULL",
      [branchQ1, retailLocation, careKit],
    );
    expect(afterSale.on_hand).toBe("3.000000");
    const refund = await refundLine(owner, order, productLine.lineId, 250000);
    const refundItem = await dbRow<{ id: string }>(
      "SELECT id FROM refund_items WHERE refund_id=$1",
      [refund.id],
    );
    const afterRefund = await dbRow<{ on_hand: string }>(
      "SELECT on_hand::text FROM inventory_stock_balances WHERE branch_id=$1 AND location_id=$2 AND item_id=$3 AND lot_id IS NULL",
      [branchQ1, retailLocation, careKit],
    );
    expect(afterRefund.on_hand).toBe("3.000000");
    const inspected = await owner.api.post(
      `/v1/refunds/${refund.id}/inventory-return-decisions`,
      {
        headers: headers(owner, "s9-e2e-return-inspect"),
        data: {
          refundItemId: refundItem.id,
          inventoryItemId: careKit,
          disposition: "RESTOCK",
          quantity: "1",
          locationId: retailLocation,
          reasonCode: "CUSTOMER_RETURN",
        },
      },
    );
    expect(inspected.status()).toBe(201);
    const decision = (await inspected.json()).data;
    const posted = await owner.api.post(
      `/v1/inventory/return-decisions/${decision.id}/post`,
      { headers: headers(owner, "s9-e2e-return-post") },
    );
    expect(posted.status(), await posted.text()).toBe(201);
    const afterReturn = await dbRow<{ on_hand: string }>(
      "SELECT on_hand::text FROM inventory_stock_balances WHERE branch_id=$1 AND location_id=$2 AND item_id=$3 AND lot_id IS NULL",
      [branchQ1, retailLocation, careKit],
    );
    expect(afterReturn.on_hand).toBe("4.000000");
  } finally {
    await close(owner);
  }
});
