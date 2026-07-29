import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 11 functional mobile engagement surfaces", () => {
  it("provides Owner campaign, recovery, SLA, and compensation views with actions", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    for (const route of [
      "campaignApprovals",
      "lowRatingAlerts",
      "recoverySla",
      "compensationApprovals",
    ])
      expect(index).toContain(route);
    expect(screen).toContain("/v1/marketing-campaigns");
    expect(screen).toContain("Approve campaign");
    expect(screen).toContain("Triage recovery case");
    expect(screen).toContain("Approve compensation");
    expect(screen).toContain("Reject compensation");
    expect(screen).toContain("Internet connection required");
  });

  it("limits Staff Mobile to assigned recovery work and server-confirmed contact logging", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("recoveryTasks");
    expect(index).toContain("recoveryContact");
    expect(screen).toContain("/v1/service-recovery/tasks/me");
    expect(screen).toContain("/v1/service-recovery/cases");
    expect(screen).toContain("Log customer contact");
    expect(screen).not.toContain("/v1/marketing-campaigns");
  });
});
