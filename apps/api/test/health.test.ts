import { describe, expect, it } from "vitest";
import { HealthController } from "../src/modules/health/health.controller";
import type { DatabaseService } from "../src/infrastructure/database.service";
describe("HealthController", () => {
  it("returns healthy status", () =>
    expect(
      new HealthController({
        ping: async () => undefined,
      } as DatabaseService).health().data.status,
    ).toBe("ok"));
});
