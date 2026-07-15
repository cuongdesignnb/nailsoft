import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/modules/identity/auth.guard.js";
import { allowedOrigins } from "../src/common/cors-origins.js";

describe("shared authorization wiring", () => {
  it("makes the HTTP guard delegate active-session authorization", async () => {
    const authorize = vi.fn().mockResolvedValue({
      userId: "user",
      tenantId: "tenant",
      membershipId: "membership",
      sessionId: "session",
      authorizationVersion: 1,
      roles: [],
      branchIds: [],
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const guard = new AuthGuard({ authorize } as never);
    const request = {
      headers: { authorization: "Bearer signed", "x-tenant-id": "tenant" },
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as never),
    ).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledWith({
      accessToken: "signed",
      requiredTenantId: "tenant",
    });
    expect(request).toHaveProperty("auth.sessionId", "session");
  });

  it("fails closed for missing or wildcard production CORS origins", () => {
    const oldNode = process.env.NODE_ENV;
    const oldOrigins = process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;
    expect(() => allowedOrigins()).toThrow(/required/);
    process.env.CORS_ORIGINS = "*";
    expect(() => allowedOrigins()).toThrow(/wildcard/);
    process.env.NODE_ENV = oldNode;
    if (oldOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = oldOrigins;
  });
});
