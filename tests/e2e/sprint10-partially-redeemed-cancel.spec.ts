import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
test("generic lifecycle cancel cannot destroy an available monetary balance", async () => {
  const owner = await login("owner@example.test");
  try {
    const response = await owner.api.post(
      "/v1/gift-cards/da200000-0000-4000-8000-000000000001/cancel",
      {
        headers: headers(owner, "s10-cancel-safety"),
        data: { version: 1, reason: "Unsafe generic cancellation" },
      },
    );
    expect(response.status(), await response.text()).toBe(409);
    expect((await response.json()).error.code).toBe(
      "GIFT_CARD_CANCELLATION_EVIDENCE_REQUIRED",
    );
  } finally {
    await close(owner);
  }
});
