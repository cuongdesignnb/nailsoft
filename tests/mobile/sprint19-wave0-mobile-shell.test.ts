import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sprint 19 Wave 0 mobile shells", () => {
  it("keeps Owner Mobile role context, query states and safe shell navigation", () => {
    const source = readFileSync("apps/owner-mobile/app/index.tsx", "utf8");
    const layout = readFileSync("apps/owner-mobile/app/_layout.tsx", "utf8");
    expect(source).toContain("getAuthContext");
    expect(layout).toContain("QueryClientProvider");
    expect(layout).toContain("MobileShell");
    expect(source).toContain("SafeAreaView");
  });
  it("keeps Staff Mobile own-scope context and shared shell", () => {
    const source = readFileSync("apps/staff-mobile/app/index.tsx", "utf8");
    const layout = readFileSync("apps/staff-mobile/app/_layout.tsx", "utf8");
    expect(source).toContain("getAuthContext");
    expect(source).toContain("ownStaffId");
    expect(layout).toContain("MobileShell");
    expect(source).toContain("SafeAreaView");
  });
});
