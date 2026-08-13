import { beforeEach, describe, expect, it } from "vitest";
import { DistributedRateLimiter } from "../src/common/distributed-rate-limit.js";
import { resetRateLimitsForTests } from "../src/common/rate-limit.js";

describe("shared rate-limit policy", () => {
  beforeEach(() => resetRateLimitsForTests());

  it("keeps local/test fallback behavior when the shared store is disabled", async () => {
    const limiter = new DistributedRateLimiter("redis://unused", false, false);
    await expect(limiter.decision("test", 1, 60_000, 100)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.decision("test", 1, 60_000, 100)).resolves.toMatchObject({ allowed: false });
  });

  it("fails closed when a required shared store is unavailable", async () => {
    const limiter = new DistributedRateLimiter("redis://unused", true, true);
    await expect(limiter.decision("test", 1, 60_000, 100)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });
});
