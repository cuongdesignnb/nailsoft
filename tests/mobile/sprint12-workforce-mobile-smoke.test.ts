import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
describe("Sprint 12 functional workforce mobile surfaces", () => {
  it("gives Staff real clock, attendance, timesheet and statement APIs", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
    ]);
    for (const route of [
      "timeClock",
      "attendanceHistory",
      "myTimesheets",
      "payStatements",
    ])
      expect(index).toContain(route);
    for (const api of [
      "/v1/staff/me/time-clock/status",
      "/v1/staff/me/attendance",
      "/v1/staff/me/timesheets",
      "/v1/staff/me/pay-statements",
    ])
      expect(screen).toContain(api);
    expect(screen).toContain("Clock in");
    expect(screen).toContain("Start break");
    expect(screen).toContain("Time-clock writes are never queued offline");
  });
  it("gives Owner scoped approvals and operational failures", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    for (const route of [
      "attendanceSummary",
      "missingPunchAlerts",
      "timesheetApprovals",
      "payrollApprovals",
      "payoutApprovals",
      "payrollFailures",
    ])
      expect(index).toContain(route);
    expect(screen).toContain("Approve timesheet");
    expect(screen).toContain("Approve payroll");
    expect(screen).toContain("Finalize payroll");
    expect(screen).toContain("Approve payout");
    expect(screen).toContain("Internet connection required");
  });
});
