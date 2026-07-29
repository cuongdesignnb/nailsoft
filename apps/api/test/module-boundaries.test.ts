import { describe, expect, it } from "vitest";
import { backendModuleBoundaries } from "../src/modules/module-boundaries";
describe("module boundaries", () => {
  it("matches the SRS through Sprint 11", () => {
    expect(backendModuleBoundaries).toHaveLength(31);
    expect(backendModuleBoundaries).toEqual(
      expect.arrayContaining([
        "voucher",
        "loyalty",
        "membership",
        "service-package",
        "benefits",
        "gift-card",
        "customer-credit",
        "stored-value",
        "customer-engagement",
        "review",
        "service-recovery",
      ]),
    );
  });
  it("does not start AI early", () =>
    expect(backendModuleBoundaries).not.toContain("ai"));
});
