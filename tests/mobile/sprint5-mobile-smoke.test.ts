import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
describe("Sprint 5 mobile operational surfaces", () => {
  it("Staff Today uses real APIs, execution commands and explicit offline draft policy", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("staffToday");
    expect(screen).toContain("/v1/staff/me/today");
    for (const action of ["start", "pause", "resume", "complete"])
      expect(screen).toContain(action);
    expect(screen).toContain("Internet connection required");
    expect(screen).toContain("Draft saved locally; it is not synced");
  });
  it("Owner Mobile reads operational summary and walk-in queue without financial actions", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("operationalSummary");
    expect(index).toContain("walkInQueue");
    expect(screen).toContain("/v1/operations/summary");
    expect(screen).toContain("/v1/walk-ins");
    expect(screen).not.toContain("/v1/payments");
    expect(screen).not.toContain("/v1/invoices");
  });
});
