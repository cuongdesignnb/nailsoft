import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 7 mobile financial correction boundary", () => {
  it("gives Owner Mobile approval and financial readiness using real APIs", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("pendingRefunds");
    expect(index).toContain("commissionReadiness");
    expect(screen).toContain("/v1/refunds?branchId=");
    expect(screen).toContain("/v1/financial/refunds");
    expect(screen).toContain("/v1/commission-periods");
    expect(screen).toContain("Internet connection required");
    expect(screen).not.toContain("execute-cash");
    expect(screen).not.toContain("execute-external");
  });

  it("limits Staff Mobile to own commission and net-tip APIs", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("myEarnings");
    expect(index).toContain("netTips");
    expect(screen).toContain("/v1/staff/me/commissions");
    expect(screen).toContain("/v1/staff/me/tips");
    expect(screen).not.toContain("/v1/commission-entries");
    expect(screen).not.toContain("/v1/financial/net-sales");
  });
});
