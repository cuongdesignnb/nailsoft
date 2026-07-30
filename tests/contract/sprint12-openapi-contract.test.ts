import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
describe("Sprint 12 OpenAPI and command contract", () => {
  it("publishes protected workforce/payroll/payout paths", async () => {
    const yaml = await readFile("docs/api/openapi.yaml", "utf8");
    for (const path of [
      "/staff/me/time-clock/clock-in:",
      "/time-clock/sessions:",
      "/timesheets/{timesheetId}/approve:",
      "/timesheets/{timesheetId}/adjustments:",
      "/payroll/runs/{runId}/calculate:",
      "/payroll/runs/{runId}/workers:",
      "/payroll/exceptions:",
      "/payroll/runs/{runId}/finalize:",
      "/payout-items/{itemId}/record-manual-payment:",
    ])
      expect(yaml).toContain(path);
    expect(yaml).toContain("#/components/parameters/IdempotencyKey");
    expect(yaml).toContain("version: 0.15.0");
  });
});
