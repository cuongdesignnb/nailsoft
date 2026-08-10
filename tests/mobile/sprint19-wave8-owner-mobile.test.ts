import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../packages/domain-types/src/index.js";
import { accessModeAllowsRoute, canReadRoute, routeDescriptor } from "../../apps/owner-mobile/lib/wave8/permissions.js";
import { authorizedBranches, syncBranchContext } from "../../apps/owner-mobile/lib/wave8/branch-context.js";
import { createIntentKey } from "../../apps/owner-mobile/lib/wave8/intent-key.js";
import { ownerWave8Screens } from "../../apps/owner-mobile/lib/wave8/screen-model.js";

const context = (permissions: string[] = ["operations.board.read"], accessMode = "FULL"): AuthContext => ({
  user: { id: "10000000-0000-4000-8000-000000000001", displayName: "Owner", locale: "en-US" },
  workspace: { tenantId: "10000000-0000-4000-8000-000000000001", tenantName: "Demo", tenantSlug: "demo", membershipId: "30000000-0000-4000-8000-000000000001", accessMode },
  authorization: { roles: ["SALON_OWNER"], permissions, branchIds: ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"] },
  branches: [{ id: "20000000-0000-4000-8000-000000000001", name: "Main", status: "ACTIVE" }, { id: "20000000-0000-4000-8000-000000000002", name: "Second", status: "ACTIVE" }],
  capabilities: { ownerMobileEnabled: true },
});

describe("Sprint 19 Wave 8 Owner Mobile foundation", () => {
  it("keeps the authorized twelve-screen logical map explicit", () => {
    expect(ownerWave8Screens).toHaveLength(12);
    expect(ownerWave8Screens.map((screen) => screen.id)).toEqual([
      "19.8.1", "19.8.2", "19.8.3", "19.8.4", "19.8.5", "19.8.6",
      "19.8.7", "19.8.8", "19.8.9", "19.8.10", "19.8.11", "19.8.12",
    ]);
  });

  it("removes production context hardcodes and wires the additive auth foundation", async () => {
    const [index, screen, session, routes] = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
      readFile("apps/owner-mobile/lib/wave8/auth-flow.ts", "utf8"),
      readFile("apps/owner-mobile/lib/wave8/permissions.ts", "utf8"),
    ]);
    expect(index).not.toContain('tenantSlug: "nailsoft-demo"');
    expect(screen).not.toContain("20000000-0000-4000-8000-000000000001");
    expect(screen).not.toContain("50000000-0000-4000-8000-000000000001");
    expect(index).toContain("ownerMobileEnabled");
    expect(session).toContain("/v1/auth/select-workspace");
    expect(session).toContain("/v1/auth/logout");
    expect(session).toContain("SecureStore.deleteItemAsync");
    expect(routes).toContain("authorization.permissions");
  });

  it("keeps branch context server-scoped and requires explicit selection for multiple branches", () => {
    const value = context();
    expect(authorizedBranches(value)).toHaveLength(2);
    expect(syncBranchContext(value).activeBranchId).toBeUndefined();
    expect(canReadRoute(context(["operations.board.read"]), "operationalSummary")).toBe(true);
    expect(canReadRoute(context([], "FULL"), "operationalSummary")).toBe(false);
    const billing = routeDescriptor("billingPlan")!;
    expect(accessModeAllowsRoute("BILLING_ONLY", billing)).toBe(true);
    expect(accessModeAllowsRoute("BILLING_ONLY", routeDescriptor("operationalSummary")!)).toBe(false);
  });

  it("creates a stable key for one intent and distinct keys for distinct intents", () => {
    const first = createIntentKey("refund", "refund-1", "approve");
    const second = createIntentKey("refund", "refund-1", "approve");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^refund:refund-1:approve:/);
  });

  it("keeps shared native UI on the app React instance", async () => {
    const uiNative = JSON.parse(await readFile("packages/ui-native/package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(uiNative.dependencies?.react).toBeUndefined();
    expect(uiNative.dependencies?.["react-native"]).toBeUndefined();
    expect(uiNative.peerDependencies?.react).toBe("19.0.0");
    expect(uiNative.peerDependencies?.["react-native"]).toBe("0.79.4");
  });
});
