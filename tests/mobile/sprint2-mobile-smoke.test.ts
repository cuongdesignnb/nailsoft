import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Sprint 2 mobile smoke contracts", () => {
  it("keeps Owner Mobile data screens and review actions", () => {
    const source = readFileSync("apps/owner-mobile/app/[screen].tsx", "utf8");
    expect(source).toContain("/v1/services");
    expect(source).toContain("/v1/leave-requests");
    expect(source).toContain("approve");
    expect(source).toContain("Retry");
  });
  it("keeps Staff Mobile own-profile and leave request flows", () => {
    const source = readFileSync("apps/staff-mobile/app/[screen].tsx", "utf8");
    expect(source).toContain("/v1/staff/me");
    expect(source).toContain("/v1/leave-requests");
    expect(source).toContain("Create leave request");
    expect(source).toContain("Permission denied");
  });
});
