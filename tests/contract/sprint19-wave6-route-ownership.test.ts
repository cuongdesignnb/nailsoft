import { describe, expect, it } from "vitest";
import { isWave6AnalyticsPath, isWave6Path, routeForWave6, wave6Routes } from "../../apps/admin-web/lib/sprint19-wave6/routes";

describe("Sprint 19 Wave 6 route ownership", () => {
  it("maps all 34 screen IDs without renumbering", () => {
    expect(wave6Routes).toHaveLength(34);
    expect(wave6Routes.map((route) => route.screenId)).toEqual(Array.from({ length: 34 }, (_, index) => `19.6.${index + 1}`));
  });

  it("owns accounting, platform and analytics paths", () => {
    for (const path of ["/admin/accounting", "/admin/billing", "/platform/plans", "/platform/tenants", "/admin/analytics", "/admin/analytics/data-quality"]) expect(isWave6Path(path)).toBe(true);
    expect(isWave6AnalyticsPath("/admin/analytics/sales")).toBe(true);
  });

  it("does not steal out-of-scope routes", () => {
    for (const path of ["/admin/pos", "/admin/procurement", "/admin/inventory", "/booking", "/owner/home", "/staff/today"]) expect(isWave6Path(path)).toBe(false);
  });

  it("keeps aliases on their intended module", () => {
    expect(routeForWave6("/platform/discounts").area).toBe("platform-catalog");
    expect(routeForWave6("/platform/reconciliation").area).toBe("platform-payments");
    expect(routeForWave6("/platform/break-glass").area).toBe("support-access");
  });
});
