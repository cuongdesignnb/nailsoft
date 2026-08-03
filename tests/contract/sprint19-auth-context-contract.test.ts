import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { authContextSchema } from "../../packages/validation/src/index.js";

describe("Sprint 19 authenticated UI context contract", () => {
  it("declares the additive endpoint and its permission-aware response", async () => {
    const openapi = await readFile("docs/api/openapi.yaml", "utf8");
    expect(openapi).toContain("/auth/context:");
    expect(openapi).toContain("AuthContextResponse:");
    expect(openapi).toContain("effective permissions");
  });
  it("validates the shared UI context shape", () => {
    expect(authContextSchema.parse({
      user: { id: "10000000-0000-4000-8000-000000000001", displayName: "Owner", locale: "vi-VN" },
      workspace: { tenantId: "20000000-0000-4000-8000-000000000001", tenantName: "Demo", tenantSlug: "demo", membershipId: "30000000-0000-4000-8000-000000000001", accessMode: "FULL" },
      authorization: { roles: ["SALON_OWNER"], permissions: ["operations.board.read"], branchIds: ["40000000-0000-4000-8000-000000000001"] },
      branches: [{ id: "40000000-0000-4000-8000-000000000001", name: "Main", status: "ACTIVE" }],
    }).authorization.permissions).toContain("operations.board.read");
  });
});
