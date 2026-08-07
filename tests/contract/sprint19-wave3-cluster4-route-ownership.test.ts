import { describe, expect, it } from "vitest";
import { isWave3Cluster4Path, isWave3Path } from "../../apps/admin-web/lib/sprint19-wave3/routes";

describe("Sprint 19 Wave 3 Cluster 4 route ownership", () => {
  it("owns communications, marketing, reviews and recovery surfaces", () => {
    for (const path of [
      "/admin/communications/templates",
      "/admin/communications/rules",
      "/admin/communications/messages",
      "/admin/communications/suppressions",
      "/admin/marketing/segments",
      "/admin/marketing/campaigns",
      "/admin/marketing/campaigns/70000000-0000-4000-8000-000000000001",
      "/admin/reviews",
      "/admin/reviews/70000000-0000-4000-8000-000000000001",
      "/admin/review-requests",
      "/admin/service-recovery",
      "/admin/service-recovery/70000000-0000-4000-8000-000000000001",
    ]) expect(isWave3Cluster4Path(path)).toBe(true);
  });

  it("does not steal customer engagement, POS, accounting, booking or workforce routes", () => {
    for (const path of [
      "/admin/customers/70000000-0000-4000-8000-000000000001/engagement",
      "/admin/pos/orders/70000000-0000-4000-8000-000000000001",
      "/admin/accounting/periods",
      "/admin/booking/appointments",
      "/admin/workforce/shifts",
      "/admin/stored-value/liability",
    ]) expect(isWave3Path(path)).toBe(false);
  });
});
