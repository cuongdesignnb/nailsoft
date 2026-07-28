import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 10 mobile stored-value boundaries", () => {
  it("gives Owner Mobile liability, issuance, redemption, credit, approvals, and exceptions", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    for (const item of [
      "storedValueLiability",
      "storedValueIssuance",
      "storedValueRedemption",
      "customerCreditOutstanding",
      "storedValueApprovals",
      "storedValueExceptions",
    ])
      expect(index).toContain(item);
    expect(screen).toContain("/v1/stored-value/reports/liability");
    expect(screen).toContain("/v1/stored-value-adjustments");
    expect(screen).toContain("stored_value.reconciliation_invalidated");
  });

  it("exposes only a permission-gated read surface in Staff Mobile", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("storedValueAccess");
    expect(screen).toContain("/v1/gift-cards");
    expect(screen).not.toContain("/v1/stored-value-adjustments");
    expect(screen).not.toContain("/v1/stored-value/reports/liability");
  });
});
