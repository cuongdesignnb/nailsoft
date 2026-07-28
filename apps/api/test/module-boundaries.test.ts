import { describe, expect, it } from "vitest";
import { backendModuleBoundaries } from "../src/modules/module-boundaries";
describe("module boundaries", () => {
  it("matches the SRS through Sprint 10", () => {
    expect(backendModuleBoundaries).toHaveLength(28);
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
      ]),
    );
  });
  it("does not start AI early", () =>
    expect(backendModuleBoundaries).not.toContain("ai"));
});
