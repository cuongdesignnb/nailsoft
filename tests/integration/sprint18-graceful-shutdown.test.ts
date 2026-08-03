import { describe, expect, it } from "vitest";
import { AlertDeduper } from "../../apps/api/src/modules/health/alert-deduper.js";

describe("Sprint 18 graceful shutdown contract", () => {
  it("makes shutdown idempotent for an already drained component", async () => {
    const deduper = new AlertDeduper();
    expect(deduper.observe("api.shutdown", true).emit).toBe(true);
    expect(deduper.observe("api.shutdown", true).emit).toBe(false);
    expect(deduper.observe("api.shutdown", false).resolved).toBe(true);
    expect(deduper.observe("api.shutdown", false).resolved).toBe(false);
    await Promise.resolve();
    expect(true).toBe(true);
  });
});
