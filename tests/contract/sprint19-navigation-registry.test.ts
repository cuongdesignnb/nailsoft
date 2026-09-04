import { describe, expect, it } from "vitest";
import {
  activeNavigationGroupIds,
  activeNavigationItemId,
  canSeeNavigation,
  navigationRegistry,
  visibleNavigation,
} from "../../apps/admin-web/lib/navigation-registry.js";
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

  it("keeps the sidebar at two levels and removes empty parent groups", () => {
    expect(navigationRegistry.every((group) => group.items.every((item) => !("items" in item)))).toBe(true);
    const visible = visibleNavigation(base);
    expect(visible.find((group) => group.id === "inventory-assets")?.items.map((item) => item.id)).toEqual(["inventory"]);
    expect(visible.some((group) => group.id === "marketing-care")).toBe(false);
  });

  it("selects the most specific child for deep links", () => {
    const finance = navigationRegistry.find((group) => group.id === "finance")!;
    expect(activeNavigationItemId(finance, "/admin/financial/invoices/123")).toBe("invoices");
    expect(activeNavigationGroupIds(navigationRegistry, "/admin/financial/invoices/123")).toContain("finance");
  });
});
