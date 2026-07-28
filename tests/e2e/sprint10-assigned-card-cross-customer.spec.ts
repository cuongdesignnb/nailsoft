import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import { draftOrder } from "./helpers/sprint10-closure";
test("assigned card cannot redeem against another customer", async () => {
  const owner = await login("owner@example.test");
  try {
    const card = await owner.api.get(
      "/v1/gift-cards/da200000-0000-4000-8000-000000000001",
      { headers: headers(owner) },
    );
    const version = (await card.json()).data.balance.version;
    const response = await owner.api.post(
      `/v1/pos-orders/${draftOrder}/stored-value/gift-card`,
      {
        headers: headers(owner, "s10-cross-customer"),
        data: {
          requestedMinor: "10000",
          number: "4111111111111111",
          version,
        },
      },
    );
    expect(response.status(), await response.text()).toBe(409);
    expect((await response.json()).error.code).toBe(
      "STORED_VALUE_CUSTOMER_MISMATCH",
    );
  } finally {
    await close(owner);
  }
});
