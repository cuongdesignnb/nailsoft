import { afterAll, describe, expect, it } from "vitest";
import { database } from "./helpers/sprint10-closure.js";
const db = database();
describe("Sprint 10 stored-value velocity limits", () => {
  afterAll(async () => db.end());
  it("persists contention-safe daily counters and high-value approvals", async () => {
    const row = (
      await db.query(`SELECT
        to_regclass('stored_value_velocity_counters') IS NOT NULL counters,
        to_regclass('stored_value_high_value_approvals') IS NOT NULL approvals,
        EXISTS(SELECT 1 FROM pg_constraint WHERE conname='stored_value_velocity_unique') contention_guard`)
    ).rows[0];
    expect(row).toEqual({
      counters: true,
      approvals: true,
      contention_guard: true,
    });
  });
});
