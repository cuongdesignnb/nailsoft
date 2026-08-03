import { describe, expect, it, beforeEach } from "vitest";
import { redactSensitive } from "../src/common/redact-sensitive.js";
import { rateLimitDecision, resetRateLimitsForTests } from "../src/common/rate-limit.js";
import { HealthController } from "../src/modules/health/health.controller.js";
import { ObservabilityService } from "../src/modules/health/observability.service.js";
import type { DatabaseService } from "../src/infrastructure/database.service.js";

describe("Sprint 18 runtime security controls", () => {
  beforeEach(() => resetRateLimitsForTests());

  it("redacts secrets recursively without changing safe fields", () => {
    expect(redactSensitive({ apiKey: "hidden", nested: { password: "hidden" }, status: "ok" })).toEqual({ apiKey: "[REDACTED]", nested: { password: "[REDACTED]" }, status: "ok" });
  });

  it("enforces a deterministic fixed-window decision", () => {
    expect(rateLimitDecision("test", 2, 60_000, 100).allowed).toBe(true);
    expect(rateLimitDecision("test", 2, 60_000, 100).allowed).toBe(true);
    expect(rateLimitDecision("test", 2, 60_000, 100).allowed).toBe(false);
    expect(rateLimitDecision("test", 2, 60_000, 61_000).allowed).toBe(true);
  });

  it("exposes canonical liveness and safe metrics endpoints", async () => {
    const controller = new HealthController({ ping: async () => undefined, query: async () => ({ rows: [] }) } as unknown as DatabaseService, new ObservabilityService());
    expect(controller.live().data.status).toBe("ok");
    expect(await controller.readiness()).toMatchObject({ data: { status: "ready" } });
    expect(controller.metrics()).toContain("nailsoft_http_requests_total");
  });
});
