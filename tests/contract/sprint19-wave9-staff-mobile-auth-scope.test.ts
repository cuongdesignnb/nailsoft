import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { authContextSchema } from "../../packages/validation/src/index.js";

describe("Sprint 19 Wave 9 Staff Mobile auth and scope contract", () => {
  it("projects staff_mobile.enabled additively without changing permission semantics", async () => {
    const [service, domain, validation, openapi] = await Promise.all([
      readFile("apps/api/src/modules/identity/auth-context.service.ts", "utf8"),
      readFile("packages/domain-types/src/index.ts", "utf8"),
      readFile("packages/validation/src/index.ts", "utf8"),
      readFile("docs/api/openapi.yaml", "utf8"),
    ]);
    expect(service).toContain("staff_mobile.enabled");
    expect(service).toContain("staffMobileEnabled");
    expect(domain).toContain("staffMobileEnabled");
    expect(validation).toContain("staffMobileEnabled");
    expect(openapi).toContain("staffMobileEnabled");
    expect(openapi).toContain("not an authorization boundary");
  });

  it("keeps Staff Mobile tenant-neutral and free of seed context", async () => {
    const files = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
      readFile("apps/staff-mobile/lib/wave9/auth-flow.ts", "utf8"),
      readFile("apps/staff-mobile/lib/wave9/screen-model.ts", "utf8"),
    ]);
    const source = files.join("\n");
    expect(source).not.toContain('tenantSlug: "nailsoft-demo"');
    expect(source).not.toContain("20000000-0000-4000-8000-000000000001");
    expect(source).not.toContain("50000000-0000-4000-8000-000000000001");
    expect(source).not.toMatch(/2026-(07|08|09)/);
    expect(source).toContain("workspaceSelectionRequired");
    expect(source).toContain("MFA_REQUIRED");
    expect(source).toContain("/v1/auth/logout");
  });

  it("fails closed without capability or own staff scope and uses descriptors", async () => {
    const permissions = await readFile("apps/staff-mobile/lib/wave9/permissions.ts", "utf8");
    expect(permissions).toContain("staffMobileEnabled");
    expect(permissions).toContain("ownStaffId");
    expect(permissions).toContain("accessModeAllowsStaff");
    expect(permissions).toContain("staffRouteRegistry");
    expect(permissions).toContain("ASSIGNED_SESSION");
    expect(permissions).toContain("ASSIGNED_TASK");
  });

  it("accepts the additive capability while keeping old contexts compatible", () => {
    const parsed = authContextSchema.parse({
      user: { id: "10000000-0000-0000-0000-000000000001", displayName: "Technician", locale: "en-US" },
      workspace: { tenantId: "20000000-0000-0000-0000-000000000001", tenantName: "Salon", tenantSlug: "salon", membershipId: "30000000-0000-0000-0000-000000000001", accessMode: "FULL" },
      authorization: { roles: ["NAIL_TECHNICIAN"], permissions: ["service_session.read_own"], branchIds: ["40000000-0000-0000-0000-000000000001"], ownStaffId: "50000000-0000-0000-0000-000000000001" },
      branches: [{ id: "40000000-0000-0000-0000-000000000001", name: "Main", status: "ACTIVE" }],
      capabilities: { ownerMobileEnabled: false, staffMobileEnabled: true },
    });
    expect(parsed.capabilities?.staffMobileEnabled).toBe(true);
  });
});
