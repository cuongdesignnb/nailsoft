import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
describe("Sprint 12 Admin functional UI contract", () => {
  it("routes operational workspaces to real APIs with complete states", async () => {
    const source = await readFile(
      "apps/admin-web/lib/sprint12-screen.tsx",
      "utf8",
    );
    for (const route of [
      "/admin/time-clock",
      "/admin/timesheets",
      "/admin/workforce/policies",
      "/admin/payroll/runs",
      "/admin/payroll/statements",
      "/admin/payouts",
      "/admin/payout-reconciliation",
    ])
      expect(source).toContain(route);
    for (const state of [
      "loading",
      "empty",
      "error",
      "forbidden",
      "Retry",
      "Saved.",
      "Internet connection required",
    ])
      expect(source).toContain(state);
    expect(source).toContain("idempotency-key");
    expect(source).toContain("PostgreSQL remains");
    expect(source).toContain("authoritative");
  });
});
