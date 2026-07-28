import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storedValueRedemptionCap } from "../../apps/api/src/modules/stored-value/stored-value-domain.js";
import { database } from "./helpers/sprint10-closure.js";

const db = database();
describe("Sprint 10 external-payment-first redemption", () => {
  beforeAll(async () => void (await db.query("SELECT 1")));
  afterAll(async () => db.end());
  it("caps requested stored value by current due and deploys plan snapshots", async () => {
    expect(
      storedValueRedemptionCap({
        requested: 100n,
        available: 100n,
        remainingEligible: 100n,
        currentOrderDue: 20n,
      }),
    ).toBe(20n);
    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='pos_order_stored_value_applications'
          AND column_name IN('redemption_plan_json','eligibility_snapshot_json')`,
    );
    expect(columns.rowCount).toBe(2);
  });
});
