import { describe, expect, it } from "vitest";
import { AnalyticsService } from "../../apps/api/src/modules/analytics/analytics.service.js";
import type { AccessClaims } from "../../apps/api/src/modules/identity/auth.types.js";

const tenant = "10000000-0000-4000-8000-000000000001";
const branchA = "20000000-0000-4000-8000-000000000001";
const branchB = "20000000-0000-4000-8000-000000000002";
const auth = (overrides: Partial<AccessClaims> = {}): AccessClaims => ({ userId: "u", tenantId: tenant, membershipId: "m", authorizationVersion: 1, sessionId: "s", roles: ["BRANCH_MANAGER"] as never, branchIds: [branchA], ...overrides });

describe("Sprint 18 tenant and branch IDOR boundaries", () => {
  it("rejects branch filters outside the authenticated manager scope", async () => {
    const service = new AnalyticsService({} as never);
    await expect(service.branches(auth(), { branchIds: [branchB] })).rejects.toMatchObject({ response: { code: "BRANCH_ACCESS_DENIED" } });
  });

  it("rejects staff access to another technician's personal analytics", async () => {
    const service = new AnalyticsService({} as never);
    await expect(service.staff(auth({ roles: ["NAIL_TECHNICIAN"] as never, ownStaffId: "staff-a" }), {}, "staff-b")).rejects.toMatchObject({ response: { code: "STAFF_SCOPE_DENIED" } });
  });

  it("scopes exports by tenant and requester rather than accepting an ID alone", async () => {
    let sql = ""; let values: unknown[] = [];
    const service = new AnalyticsService({ query: async (statement: string, params: unknown[]) => { sql = statement; values = params; return { rows: [] }; } } as never);
    await expect(service.exportById(auth({ roles: ["SALON_OWNER"] as never }), "export-id")).rejects.toMatchObject({ response: { code: "ANALYTICS_EXPORT_NOT_FOUND" } });
    expect(sql).toContain("tenant_id=$1"); expect(sql).toContain("requested_by_user_id=$3"); expect(values).toEqual([tenant, "export-id", "u"]);
  });

  it("denies platform identities without an explicit support grant", async () => {
    const service = new AnalyticsService({} as never);
    await expect(service.branches(auth({ tenantId: tenant, roles: ["PLATFORM_SUPER_ADMIN"] as never, supportAccess: undefined }), {})).rejects.toMatchObject({ response: { code: "PERMISSION_DENIED" } });
  });
});
