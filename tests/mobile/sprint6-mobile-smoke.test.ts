import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 6 mobile financial boundary", () => {
  it("gives Owner Mobile a realtime, read-only financial summary", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("financialSummary");
    expect(screen).toContain("/v1/financial/summary");
    expect(screen).toContain("pos.order.updated");
    expect(screen).toContain(
      "Read-only. Payment capture is unavailable on Owner Mobile.",
    );
    expect(screen).not.toContain("/v1/pos-orders/${");
    expect(screen).not.toContain("/v1/payments");
  });
});
