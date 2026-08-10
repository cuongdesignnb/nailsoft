import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 19 Wave 8 Owner Mobile auth-context contract", () => {
  it("projects owner_mobile.enabled additively without changing authorization", async () => {
    const [service, domain, validation, openapi] = await Promise.all([
      readFile("apps/api/src/modules/identity/auth-context.service.ts", "utf8"),
      readFile("packages/domain-types/src/index.ts", "utf8"),
      readFile("packages/validation/src/index.ts", "utf8"),
      readFile("docs/api/openapi.yaml", "utf8"),
    ]);
    expect(service).toContain("owner_mobile.enabled");
    expect(service).toContain("ownerMobileEnabled");
    expect(domain).toContain("ownerMobileEnabled: boolean");
    expect(validation).toContain("ownerMobileEnabled: z.boolean()");
    expect(openapi).toContain("ownerMobileEnabled");
    expect(openapi).toContain("not an authorization boundary");
  });

  it("keeps the mobile client free of production tenant and seed context", async () => {
    const files = await Promise.all([
      readFile("apps/owner-mobile/app/index.tsx", "utf8"),
      readFile("apps/owner-mobile/app/[screen].tsx", "utf8"),
      readFile("apps/owner-mobile/lib/wave8/auth-flow.ts", "utf8"),
    ]);
    const source = files.join("\n");
    expect(source).not.toContain('tenantSlug: "nailsoft-demo"');
    expect(source).not.toContain("20000000-0000-4000-8000-000000000001");
    expect(source).not.toContain("50000000-0000-4000-8000-000000000001");
    expect(source).toContain("SecureStore");
    expect(source).toContain("workspaceSelectionRequired");
  });
});
