import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiSession, database, tenant } from "./helpers/sprint10-closure.js";
const db = database();
let owner: Awaited<ReturnType<typeof apiSession>>;
describe("Sprint 10 replacement expiry and lineage", () => {
  beforeAll(async () => void (owner = await apiSession()));
  afterAll(async () => {
    await owner.app.close();
    await db.end();
  });
  it("preserves legal/expiry fields and records the replacement chain", async () => {
    const response = await owner.app.inject({
      method: "POST",
      url: "/v1/gift-cards/da200000-0000-4000-8000-000000000001/replace",
      headers: owner.headers("s10-replace-lineage"),
      payload: { version: 1, reason: "Damaged physical credential" },
    });
    expect(response.statusCode, response.body).toBe(201);
    const next = response.json().data.giftCardId;
    const row = (
      await db.query(
        `SELECT n.replaces_gift_card_id,
                n.expires_at IS NOT DISTINCT FROM o.expires_at AS same_expiry,
                n.legal_policy_id IS NOT DISTINCT FROM o.legal_policy_id AS same_legal
           FROM gift_cards n JOIN gift_cards o ON o.tenant_id=n.tenant_id AND o.id=n.replaces_gift_card_id
          WHERE n.tenant_id=$1 AND n.id=$2`,
        [tenant, next],
      )
    ).rows[0];
    expect(row).toEqual({
      replaces_gift_card_id: "da200000-0000-4000-8000-000000000001",
      same_expiry: true,
      same_legal: true,
    });
  });
});
