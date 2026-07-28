import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { proportionalReversalTarget } from "../../apps/api/src/modules/benefits/benefit-domain.js";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});

describe("Sprint 8 line/application refund allocation", () => {
  afterAll(() => pool.end());

  it("calculates deterministic cumulative partial reversal targets", () => {
    expect(
      proportionalReversalTarget({
        originalValue: 101n,
        cumulativeRefundMinor: 50n,
        originalEligibleMinor: 100n,
      }),
    ).toBe(50n);
    expect(
      proportionalReversalTarget({
        originalValue: 101n,
        cumulativeRefundMinor: 100n,
        originalEligibleMinor: 100n,
      }),
    ).toBe(101n);
  });

  it("has immutable allocation and reversal evidence", async () => {
    const result = await pool.query(
      `SELECT
        to_regclass('benefit_application_allocations') IS NOT NULL applications,
        to_regclass('benefit_refund_allocations') IS NOT NULL reversals,
        (SELECT count(*)::int FROM pg_trigger WHERE tgname IN(
          'benefit_application_allocations_append_only','benefit_refund_allocations_append_only'
        ) AND NOT tgisinternal) triggers`,
    );
    expect(result.rows[0]).toEqual({
      applications: true,
      reversals: true,
      triggers: 2,
    });
  });
});
