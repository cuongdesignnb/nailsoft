import { describe, expect, it } from "vitest";
import { isWave3CustomerEngagementPath, isWave3CustomerPath } from "../../apps/admin-web/lib/sprint19-wave3/routes";

describe("Sprint 19 Wave 3 customer route ownership", () => {
  it("owns only the audited Customer 360 routes", () => {
    expect(isWave3CustomerPath("/admin/customers")).toBe(true);
    expect(isWave3CustomerPath("/admin/customers/")).toBe(true);
    expect(isWave3CustomerPath("/admin/customers/new")).toBe(true);
    expect(isWave3CustomerPath("/admin/customers/60000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isWave3CustomerPath("/admin/customers/60000000-0000-4000-8000-000000000001/engagement")).toBe(false);
    expect(isWave3CustomerPath("/admin/benefits")).toBe(false);
    expect(isWave3CustomerPath("/admin/pos/orders/1")).toBe(false);
    expect(isWave3CustomerPath("/admin/accounting")).toBe(false);
  });

  it("keeps engagement ownership explicit for the legacy Sprint 11 renderer", () => {
    expect(isWave3CustomerEngagementPath("/admin/customers/60000000-0000-4000-8000-000000000001/engagement")).toBe(true);
    expect(isWave3CustomerEngagementPath("/admin/customers/60000000-0000-4000-8000-000000000001")).toBe(false);
  });
});
