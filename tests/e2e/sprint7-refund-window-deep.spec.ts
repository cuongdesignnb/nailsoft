import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("refund plan exposes branch-local refund-window evidence", async () => {
  const owner = await login("owner@example.test");
  try {
    const response = await owner.api.post(
      "/v1/invoices/a9000000-0000-4000-8000-000000000002/refund-plans",
      {
        headers: headers(owner),
        data: {
          items: [
            {
              invoiceLineId: "aa000000-0000-4000-8000-000000000001",
              amountMinor: 1000,
            },
          ],
          tipAmountMinor: 0,
        },
      },
    );
    expect(response.status()).toBe(201);
    const evidence = (await response.json()).data.policy.refundWindowEvidence;
    expect(evidence.branchTimezone).toBe("Asia/Ho_Chi_Minh");
    expect(evidence.refundWindowDays).toBe(30);
    expect(evidence.outOfWindow).toBe(false);
  } finally {
    await close(owner);
  }
});
