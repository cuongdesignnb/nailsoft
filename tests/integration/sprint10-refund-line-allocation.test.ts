import { afterAll, describe, expect, it } from "vitest";
import { cumulativeProportionalRestore } from "../../apps/api/src/modules/stored-value/stored-value-domain.js";
import { database } from "./helpers/sprint10-closure.js";
const db = database();
describe("Sprint 10 refund line allocation", () => {
  afterAll(async () => db.end());
  it("uses cumulative desired-minus-prior and enforces a database restore cap", async () => {
    expect(
      cumulativeProportionalRestore({
        originalAllocation: 40n,
        lineNet: 100n,
        cumulativeRefund: 75n,
        previouslyRestored: 10n,
      }),
    ).toBe(20n);
    expect(
      (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='stored_value_refund_line_restore_guard') ok",
        )
      ).rows[0].ok,
    ).toBe(true);
  });
});
