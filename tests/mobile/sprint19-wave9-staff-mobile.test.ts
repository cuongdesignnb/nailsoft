import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 19 Wave 9 Staff Mobile foundation", () => {
  it("has explicit auth, capability and safe session mechanics", async () => {
    const [index, session, auth, workspace, mfa] = await Promise.all([
      readFile("apps/staff-mobile/app/index.tsx", "utf8"),
      readFile("apps/staff-mobile/lib/session.ts", "utf8"),
      readFile("apps/staff-mobile/lib/wave9/auth-flow.ts", "utf8"),
      readFile("apps/staff-mobile/app/workspace.tsx", "utf8"),
      readFile("apps/staff-mobile/app/mfa.tsx", "utf8"),
    ]);
    expect(index).toContain("ownStaffId");
    expect(index).toContain("staffMobileEnabled");
    expect(auth).toContain("SecureStore");
    expect(auth).toContain("createRefreshSingleFlight");
    expect(auth).toContain("/v1/auth/select-workspace");
    expect(auth).toContain("/v1/auth/mfa/challenge/verify");
    expect(auth).toContain("/v1/auth/logout");
    expect(session).toContain("registerSessionRefresh");
    expect(workspace).toContain("workspaceToken");
    expect(mfa).toContain("recovery");
  });

  it("has no false offline success or production context constants", async () => {
    const [screen, model] = await Promise.all([
      readFile("apps/staff-mobile/app/[screen].tsx", "utf8"),
      readFile("apps/staff-mobile/lib/wave9/screen-model.ts", "utf8"),
    ]);
    const source = `${screen}\n${model}`;
    expect(source).toContain("VERSION_CONFLICT");
    expect(source).toContain("idempotency-key");
    expect(source).not.toContain("navigator.onLine");
    expect(source).not.toContain("crypto.randomUUID");
    expect(source).not.toContain("20000000-0000-4000-8000-000000000001");
    expect(source).not.toContain("50000000-0000-4000-8000-000000000001");
  });
});
