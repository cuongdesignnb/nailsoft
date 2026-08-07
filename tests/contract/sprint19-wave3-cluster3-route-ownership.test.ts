import { describe, expect, it } from "vitest";
import { isWave3Cluster3Path, isWave3Path } from "../../apps/admin-web/lib/sprint19-wave3/routes";

describe("Sprint 19 Wave 3 Cluster 3 route ownership", () => {
  it("owns voucher, gift-card and customer credit surfaces", () => {
    for (const path of [
      "/admin/vouchers/campaigns",
      "/admin/vouchers/campaigns/70000000-0000-4000-8000-000000000001",
      "/admin/vouchers/codes",
      "/admin/gift-cards",
      "/admin/gift-cards/products",
      "/admin/gift-cards/issuance",
      "/admin/gift-cards/90000000-0000-4000-8000-000000000001",
      "/admin/customer-credit",
      "/admin/stored-value/adjustments",
    ]) expect(isWave3Cluster3Path(path)).toBe(true);
  });

  it("does not steal POS, liability or policy routes", () => {
    for (const path of [
      "/admin/stored-value",
      "/admin/stored-value/liability",
      "/admin/stored-value/reconciliation",
      "/admin/stored-value/exceptions",
      "/admin/stored-value/legal-policies",
      "/admin/pos/orders/90000000-0000-4000-8000-000000000001/gift-card",
      "/admin/pos/orders/90000000-0000-4000-8000-000000000001/stored-value",
      "/admin/accounting/periods",
      "/admin/booking/appointments",
    ]) expect(isWave3Path(path)).toBe(false);
  });

  it("keeps Cluster 2 ownership intact", () => {
    expect(isWave3Path("/admin/benefits")).toBe(true);
    expect(isWave3Path("/admin/loyalty/programs")).toBe(true);
  });
});
