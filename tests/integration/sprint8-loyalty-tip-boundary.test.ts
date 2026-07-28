import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { loyaltyRedemptionPlan } from "../../apps/api/src/modules/benefits/benefit-domain.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});

describe("Sprint 8 loyalty tip boundary", () => {
  afterAll(() => pool.end());

  it("caps accepted points to pre-tip service due", async () => {
    const plan = loyaltyRedemptionPlan({
      requestedPoints: 500n,
      eligibleDueMinor: 25_000n,
      redemptionPoints: 100n,
      redemptionMinor: 10_000n,
    });
    expect(plan).toEqual({
      requestedPoints: 500n,
      acceptedPoints: 200n,
      appliedMinor: 20_000n,
      unusedPoints: 300n,
    });
    const columns = await pool.query(
      `SELECT count(*)::int n FROM information_schema.columns
       WHERE table_name='loyalty_reservations'
         AND column_name IN('requested_points','accepted_points','unused_points')`,
    );
    expect(columns.rows[0].n).toBe(3);
  });

  it("cannot spend points on a tip-only remainder", () => {
    expect(
      loyaltyRedemptionPlan({
        requestedPoints: 500n,
        eligibleDueMinor: 0n,
        redemptionPoints: 100n,
        redemptionMinor: 10_000n,
      }),
    ).toMatchObject({ acceptedPoints: 0n, appliedMinor: 0n });
  });
});
