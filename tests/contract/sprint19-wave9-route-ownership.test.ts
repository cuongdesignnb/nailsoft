import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 19 Wave 9 Staff Mobile route ownership", () => {
  it("keeps Staff Mobile routing inside its Expo app and does not broaden customer access", async () => {
    const [layout, index, permissions] = await Promise.all([
      readFile("apps/staff-mobile/app/_layout.tsx", "utf8"),
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/lib/wave9/permissions.ts", "utf8"),
    ]);
    expect(layout).toContain("MobileShell");
    expect(index).toContain("staffOwnRouteRegistry");
    expect(permissions).toContain('"upcomingAppointments"');
    expect(permissions).not.toContain('"customerDirectory"');
    expect(permissions).toContain("ASSIGNED_APPOINTMENT");
    expect(permissions).toContain("visibleStaffTabs");
  });
});
