import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 10 stored-value API contract", () => {
  it("publishes command-specific routes with granular permissions", async () => {
    const source = await readFile(
      "apps/api/src/modules/stored-value/stored-value.controller.ts",
      "utf8",
    );
    for (const route of [
      "gift-card-products",
      "gift-cards/:giftCardId/replace",
      "gift-cards/:giftCardId/reload",
      "pos-orders/:orderId/stored-value/gift-card",
      "pos-orders/:orderId/stored-value/customer-credit",
      "stored-value-adjustments/:id/approve",
      "customer/me/stored-value-history",
      "stored-value/reports/:kind",
    ])
      expect(source).toContain(route);
    expect(source).toContain('@RequirePermission("stored_value.reserve")');
    expect(source).toContain(
      '@RequirePermission("customer_credit.adjustment.approve")',
    );
  });

  it("keeps full card values out of response projections", async () => {
    const source = await readFile(
      "apps/api/src/modules/stored-value/stored-value.service.ts",
      "utf8",
    );
    expect(source).toContain("maskedNumber: maskCard");
    expect(source).not.toContain('number_hash "numberHash"');
    expect(source).not.toContain('pin_hash "pinHash"');
    expect(source).toContain("displayOnce: true");
  });
});
