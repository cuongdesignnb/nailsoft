import { afterAll, describe, expect, it } from "vitest";
import { database, tenant } from "./helpers/sprint10-closure.js";
const db = database();
describe("Sprint 10 legal expiration policy", () => {
  afterAll(async () => db.end());
  it("keeps the approved snapshot and default no-expiration behavior", async () => {
    const row = (
      await db.query(
        `SELECT g.expiration_mode,g.expires_at,p.status,p.legal_review_status
           FROM gift_cards g JOIN stored_value_legal_policies p
             ON p.tenant_id=g.tenant_id AND p.id=g.legal_policy_id
          WHERE g.tenant_id=$1 AND g.id='da200000-0000-4000-8000-000000000001'`,
        [tenant],
      )
    ).rows[0];
    expect(row).toMatchObject({
      expiration_mode: "NO_EXPIRATION",
      expires_at: null,
      status: "APPROVED",
      legal_review_status: "APPROVED",
    });
  });
});
