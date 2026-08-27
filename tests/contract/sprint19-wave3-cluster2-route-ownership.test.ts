import { describe, expect, it } from "vitest";
import { isWave3Cluster2Path, isWave3Path } from "../../apps/admin-web/lib/sprint19-wave3/routes";

describe("Sprint 19 Wave 3 Cluster 2 route ownership", () => {
  it("owns benefits, loyalty, membership and package surfaces", () => {
    for (const path of [
      "/admin/benefits",
      "/admin/benefits/customers",
      "/admin/benefits/customers/60000000-0000-4000-8000-000000000001",
      "/admin/loyalty/programs",
      "/admin/loyalty/adjustments",
      "/admin/loyalty/customers/60000000-0000-4000-8000-000000000001",
      "/admin/membership/tiers",
      "/admin/membership/customers",
      "/admin/membership/customers/60000000-0000-4000-8000-000000000001",
      "/admin/packages/catalog",
      "/admin/packages/catalog/70000000-0000-4000-8000-000000000001",
      "/admin/packages/entitlements",
      "/admin/packages/entitlements/80000000-0000-4000-8000-000000000001",
    ]) expect(isWave3Cluster2Path(path)).toBe(true);
  });

  it("does not steal routes owned by other waves", () => {
    for (const path of [
      "/admin/pos/orders/90000000-0000-4000-8000-000000000001/benefits",
      "/admin/benefits/liability",
      "/admin/benefits/reports/summary",
      "/admin/stored-value/liability",
      "/admin/accounting/periods",
      "/booking/services",
      "/owner/home",
    ]) expect(isWave3Path(path)).toBe(false);

    expect(isWave3Path("/admin/customers/60000000-0000-4000-8000-000000000001/engagement")).toBe(true);
  });
});
