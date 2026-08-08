import { describe, expect, it } from "vitest";
import { isWave5InventoryPath } from "../../apps/admin-web/lib/sprint19-wave5-inventory";
import { isWave5ProcurementPath } from "../../apps/admin-web/lib/sprint19-wave5-procurement";
import { isWave5AssetsPath } from "../../apps/admin-web/lib/sprint19-wave5-assets";

describe("Sprint 19 Wave 5 route ownership", () => {
  it("owns inventory, procurement and fixed-asset surfaces", () => {
    for (const path of [
      "/admin/inventory/stock",
      "/admin/inventory/transfers",
      "/admin/procurement/vendors",
      "/admin/procurement/payment-proposals",
      "/admin/procurement/returns",
      "/admin/assets",
      "/admin/assets/depreciation",
      "/admin/assets/disposals",
    ]) {
      expect(isWave5InventoryPath(path) || isWave5ProcurementPath(path) || isWave5AssetsPath(path)).toBe(true);
    }
  });

  it("does not steal adjacent accounting, financial, POS, workforce or analytics routes", () => {
    for (const path of [
      "/admin/accounting/periods",
      "/admin/financial/reports",
      "/admin/pos/orders/70000000-0000-4000-8000-000000000001",
      "/admin/payroll/runs",
      "/admin/billing/invoices",
      "/admin/analytics",
    ]) {
      expect(isWave5InventoryPath(path)).toBe(false);
      expect(isWave5ProcurementPath(path)).toBe(false);
      expect(isWave5AssetsPath(path)).toBe(false);
    }
  });
});
