import { describe, expect, it } from "vitest";
import { isWave4Path } from "../../apps/admin-web/lib/sprint19-wave4/routes";

describe("Sprint 19 Wave 4 route ownership", () => {
  it("owns workforce and payroll surfaces", () => {
    for (const path of ["/admin/staff/list", "/admin/staff/new", "/admin/staff/abc", "/admin/staff/abc/pay-profile", "/admin/scheduling/shifts", "/admin/scheduling/leave-requests", "/admin/time-clock", "/admin/timesheets", "/admin/workforce/policies", "/admin/payroll/runs", "/admin/payouts"]) expect(isWave4Path(path)).toBe(true);
  });
  it("does not steal adjacent accounting, POS, commission, analytics or mobile routes", () => {
    for (const path of ["/admin/accounting/periods", "/admin/pos/orders/abc", "/admin/commission", "/admin/financial/reports", "/admin/analytics", "/owner/home", "/staff/my-day"]) expect(isWave4Path(path)).toBe(false);
  });
});
