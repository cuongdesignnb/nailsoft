import { describe, expect, it } from "vitest";
import { AlertDeduper } from "../../apps/api/src/modules/health/alert-deduper.js";
import { ObservabilityService } from "../../apps/api/src/modules/health/observability.service.js";
import { HealthController } from "../../apps/api/src/modules/health/health.controller.js";

describe("Sprint 18 observability and alert evidence", () => {
  it("propagates metrics and deduplicates alert transitions", async () => {
    const metrics = new ObservabilityService(); metrics.requestStarted(); metrics.recordRequest(200); metrics.requestStarted(); metrics.recordRequest(503);
    expect(metrics.renderPrometheus()).toContain("nailsoft_http_requests_total 2");
    expect(metrics.renderPrometheus()).toContain("nailsoft_http_errors_total 1");
    const alerts = new AlertDeduper();
    expect(alerts.observe("outbox.lag", true)).toMatchObject({ emit: true, state: "OPEN" });
    expect(alerts.observe("outbox.lag", true)).toMatchObject({ emit: false, state: "OPEN" });
    expect(alerts.observe("outbox.lag", false)).toMatchObject({ resolved: true, state: "RESOLVED" });
    expect(alerts.observe("outbox.lag", false)).toMatchObject({ resolved: false, state: "RESOLVED" });
  });

  it("fails readiness when the authoritative database is unavailable", async () => {
    const health = new HealthController({ ping: async () => { throw new Error("db down"); } } as never);
    await expect(health.readiness()).rejects.toMatchObject({ response: { code: "NOT_READY" } });
  });
});
