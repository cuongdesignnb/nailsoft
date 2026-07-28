import { afterAll, describe, expect, it } from "vitest";
import { database } from "./helpers/sprint10-closure.js";
const db = database();
describe("Sprint 10 immutable funding allocation", () => {
  afterAll(async () => db.end());
  it("has exact payment and line guards plus append-only history", async () => {
    const row = (
      await db.query(`SELECT
        to_regclass('stored_value_funding_allocations') IS NOT NULL table_ok,
        EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='stored_value_funding_allocation_guard') funding_guard,
        EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='stored_value_funding_append_only') immutable`)
    ).rows[0];
    expect(row).toEqual({
      table_ok: true,
      funding_guard: true,
      immutable: true,
    });
  });
});
