import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 8 mobile benefit boundaries", () => {
  it("gives Owner Mobile real benefit reports and realtime invalidation", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("benefitLiability");
    expect(index).toContain("pendingLoyaltyAdjustments");
    expect(screen).toContain("/v1/benefits/reports/liability");
    expect(screen).toContain("/v1/benefits/reports/expiring");
    expect(screen).toContain("benefits.wallet_invalidated");
  });

  it("limits Staff Mobile to assigned appointment package coverage", async () => {
    const [index, screen] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
    ]);
    expect(index).toContain("packageCoverage");
    expect(screen).toContain("/v1/appointments/${id}/benefits");
    expect(screen).not.toContain("/v1/customer/me/benefits");
    expect(screen).not.toContain("/v1/loyalty-adjustments");
  });

  it("uses the management capability for public package reservation", async () => {
    const source = await readFile(
      "apps/booking-web/lib/manage-booking.tsx",
      "utf8",
    );
    expect(source).toContain("/customer-packages");
    expect(source).toContain("/package-reservations");
    expect(source).toContain("authorization: `Bearer ${token}`");
    expect(source).toContain('"idempotency-key": keys.current.package');
  });
});
