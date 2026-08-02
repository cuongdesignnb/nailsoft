import { describe, expect, it } from "vitest";
import { businessDate, comparison, freshness, parseFilters, safePercentage } from "../src/modules/analytics/analytics-domain.js";

describe("Sprint 17 analytics metric contracts", () => {
  it("rejects unbounded ranges and calculates a deterministic default", () => {
    const filters = parseFilters({ to: "2026-08-31" });
    expect(filters.from).toBe("2026-08-02");
    expect(() => parseFilters({ from: "2025-01-01", to: "2026-08-31" })).toThrow();
  });
  it("does not produce Infinity for a zero comparison baseline", () => {
    expect(safePercentage(100n, 0n)).toEqual({ value: null, state: "ZERO_BASELINE" });
    expect(comparison(100n, 0n, "PREVIOUS_PERIOD").percentageChange).toBeNull();
  });
  it("uses branch timezone for business date and reports freshness", () => {
    expect(businessDate("2026-08-01T23:30:00Z", "Asia/Ho_Chi_Minh")).toBe("2026-08-02");
    expect(freshness(new Date(), new Date()).status).toBe("FRESH");
    expect(freshness(null).status).toBe("STALE");
  });
});
