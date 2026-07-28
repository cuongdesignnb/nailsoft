import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";
import { closeClosureDb, dbRow } from "./helpers/sprint8-closure";
test.afterAll(closeClosureDb);
test("replacement preserves expiry, legal policy and lineage", async () => {
  const owner = await login("owner@example.test");
  try {
    const response = await owner.api.post(
      "/v1/gift-cards/da200000-0000-4000-8000-000000000001/replace",
      {
        headers: headers(owner, "s10-replacement-expiry"),
        data: { version: 1, reason: "Credential replacement" },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
    const next = (await response.json()).data.giftCardId;
    const row = await dbRow<{ same_expiry: boolean; same_legal: boolean }>(
      `SELECT n.expires_at IS NOT DISTINCT FROM o.expires_at AS same_expiry,
              n.legal_policy_id IS NOT DISTINCT FROM o.legal_policy_id AS same_legal
         FROM gift_cards n JOIN gift_cards o ON o.tenant_id=n.tenant_id AND o.id=n.replaces_gift_card_id
        WHERE n.id=$1`,
      [next],
    );
    expect(row).toEqual({ same_expiry: true, same_legal: true });
  } finally {
    await close(owner);
  }
});
