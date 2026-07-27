import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("cash refund draft snapshots the original register and session", async () => {
  const cashier = await login("cashier@example.test");
  try {
    const response = await cashier.api.post(
      "/v1/invoices/a9000000-0000-4000-8000-000000000002/refunds",
      {
        headers: headers(cashier),
        data: {
          items: [
            {
              invoiceLineId: "aa000000-0000-4000-8000-000000000001",
              amountMinor: 1000,
            },
          ],
          tipAmountMinor: 0,
          paymentPreferences: [
            {
              paymentId: "a6000000-0000-4000-8000-000000000003",
              amountMinor: 1000,
            },
          ],
          reasonCode: "E2E_ATTRIBUTION",
          reasonText: "Cash register attribution deep evidence",
        },
      },
    );
    expect(response.status()).toBe(201);
    const allocation = (await response.json()).data.paymentAllocations[0];
    expect(allocation.original_register_id).toBe(
      "a1000000-0000-4000-8000-000000000001",
    );
    expect(allocation.original_cash_session_id).toBe(
      "a3000000-0000-4000-8000-000000000001",
    );
    expect(allocation.execution_cash_session_id).toBeNull();
  } finally {
    await close(cashier);
  }
});
