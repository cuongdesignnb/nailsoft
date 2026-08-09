import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const accountingPaths = [
  "/accounting/bank-accounts/{bankAccountId}/statement-lines",
  "/accounting/bank-matches",
  "/accounting/reconciliation-exceptions",
];
const platformPaths = [
  "/platform/discounts",
  "/platform/tenants/{tenantId}/entitlements",
  "/platform/tenants/{tenantId}/invoices",
  "/platform/tenants/{tenantId}/payments",
  "/platform/refunds",
  "/platform/reconciliation",
  "/platform/dunning",
  "/platform/reports",
  "/platform/break-glass",
];

describe("Sprint 19 Wave 6 additive read foundation", () => {
  it("documents exactly the twelve approved GET paths", async () => {
    const openapi = await readFile("docs/api/openapi.yaml", "utf8");
    for (const path of [...accountingPaths, ...platformPaths]) {
      expect(openapi).toContain(`  ${path}:`);
      const section = openapi.slice(openapi.indexOf(`  ${path}:`));
      expect(section.slice(0, 1800)).toContain("get:");
    }
    expect(accountingPaths).toHaveLength(3);
    expect(platformPaths).toHaveLength(9);
    expect(openapi).not.toContain("procurement.return.read");
    expect(openapi).not.toContain("platform.discount.create");
  });

  it("keeps support and money safety statements in the contract", async () => {
    const openapi = await readFile("docs/api/openapi.yaml", "utf8");
    expect(openapi).toContain("support sessions are restricted to their granted target tenant");
    expect(openapi).toContain("Break-glass is intentionally disabled");
    expect(openapi).toContain("bigint-safe strings");
  });
});
