import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Sprint 13 OpenAPI platform billing contract", () => {
  it("publishes tenant, platform, usage, payment, and support boundaries", async () => {
    const yaml = await readFile("docs/api/openapi.yaml", "utf8");

    for (const path of [
      "/tenant/billing/account:",
      "/tenant/billing/subscription/change-plan:",
      "/tenant/billing/entitlements:",
      "/tenant/billing/invoices:",
      "/tenant/support-access-grants/{id}/approve:",
      "/platform/plans/{id}/versions/{versionId}/publish:",
      "/platform/tenants:",
      "/platform/invoices/{id}/finalize:",
      "/platform/payment-intents/{id}/confirm:",
      "/platform/payment-intents/{id}/reconcile:",
      "/internal/platform-usage/events:",
    ]) {
      expect(yaml).toContain(path);
    }

    expect(yaml).toContain("version: 0.15.0");
    expect(yaml).toContain("#/components/parameters/IdempotencyKey");
    expect(yaml).toContain("PlanChangeCommand:");
    expect(yaml).toContain("UsageEventCommand:");
  });
});
