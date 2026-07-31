import { describe, expect, it } from "vitest";
import { canTransition, isBalanced } from "../src/modules/accounting/accounting-domain.js";

describe("Sprint 14 accounting domain", () => {
  it("requires balanced double-entry lines", () => {
    expect(isBalanced([{ debitMinor: 100n }, { creditMinor: 100n }])).toBe(true);
    expect(isBalanced([{ debitMinor: 100n }, { creditMinor: 99n }])).toBe(false);
    expect(isBalanced([{ debitMinor: 100n }])).toBe(false);
  });
  it("requires independent journal approval before posting", () => {
    expect(canTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "POSTED")).toBe(true);
    expect(canTransition("DRAFT", "POSTED")).toBe(false);
    expect(canTransition("POSTED", "APPROVED")).toBe(false);
  });
});
