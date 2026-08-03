import { describe, expect, it } from "vitest";
import { canSeeNavigation, navigationRegistry } from "../../apps/admin-web/lib/navigation-registry.js";
import type { AuthContext } from "../../packages/domain-types/src/index.js";

const base: AuthContext = {
  user: { id: "user", displayName: "Owner", locale: "en-US" },
  workspace: { tenantId: "tenant", tenantName: "Tenant", tenantSlug: "tenant", membershipId: "member", accessMode: "FULL" },
  authorization: { roles: ["SALON_OWNER"], permissions: ["inventory.read"], branchIds: ["branch"] },
  branches: [{ id: "branch", name: "Main", status: "ACTIVE" }],
};

describe("Sprint 19 navigation registry", () => {
  it("uses semantic icons and filters granular permissions", () => {
    const inventory = navigationRegistry.flatMap((group) => group.items).find((item) => item.href === "/admin/inventory");
    const procurement = navigationRegistry.flatMap((group) => group.items).find((item) => item.href === "/admin/procurement");
    expect(inventory?.icon).toBe("inventory");
    expect(inventory && canSeeNavigation(inventory, base)).toBe(true);
    expect(procurement && canSeeNavigation(procurement, base)).toBe(false);
  });
  it("does not expose regular salon navigation to a platform actor without support access", () => {
    const platform: AuthContext = { ...base, authorization: { roles: ["PLATFORM_SUPER_ADMIN"], permissions: [], branchIds: [] }, branches: [] };
    const dashboard = navigationRegistry.flatMap((group) => group.items).find((item) => item.href === "/admin/dashboard")!;
    const platformItem = navigationRegistry.flatMap((group) => group.items).find((item) => item.href === "/platform/tenants")!;
    expect(canSeeNavigation(dashboard, platform)).toBe(false);
    expect(canSeeNavigation(platformItem, platform)).toBe(true);
  });
});
