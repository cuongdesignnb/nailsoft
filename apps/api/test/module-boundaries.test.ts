import { describe, expect, it } from "vitest";
import { backendModuleBoundaries } from "../src/modules/module-boundaries";
describe("module boundaries", () => {
  it("matches the SRS", () => expect(backendModuleBoundaries).toHaveLength(22));
  it("does not start AI early", () =>
    expect(backendModuleBoundaries).not.toContain("ai"));
});
