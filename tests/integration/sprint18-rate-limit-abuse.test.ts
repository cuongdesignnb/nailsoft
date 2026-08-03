import { beforeEach, describe, expect, it } from "vitest";
import { isSensitiveRoute, rateLimitDecision, resetRateLimitsForTests } from "../../apps/api/src/common/rate-limit.js";

describe("Sprint 18 abuse controls", () => {
  beforeEach(() => resetRateLimitsForTests());
  it("blocks repeated sensitive requests with a stable retry window", () => {
    expect(isSensitiveRoute("/v1/auth/login")).toBe(true);
    const attempts = Array.from({ length: 61 }, () => rateLimitDecision("ip:sensitive", 60, 60_000, 100));
    expect(attempts.at(-1)?.allowed).toBe(false);
    expect(attempts.at(-1)?.remaining).toBe(0);
    expect(attempts.at(-1)?.resetAt).toBe(attempts[0].resetAt);
  });
  it("uses separate buckets for export flooding and normal reads", () => {
    expect(isSensitiveRoute("/v1/analytics/exports")).toBe(true);
    expect(isSensitiveRoute("/v1/health/live")).toBe(false);
    expect(rateLimitDecision("ip:sensitive", 1, 60_000, 100).allowed).toBe(true);
    expect(rateLimitDecision("ip:sensitive", 1, 60_000, 100).allowed).toBe(false);
    expect(rateLimitDecision("ip:standard", 1, 60_000, 100).allowed).toBe(true);
  });
});
