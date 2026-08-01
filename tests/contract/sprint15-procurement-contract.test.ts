import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Sprint 15 procurement OpenAPI contract", () => {
  const document = readFileSync("docs/api/openapi.yaml", "utf8");

  it("documents tenant-scoped procurement write surfaces", () => {
    for (const path of [
      "/procurement/vendors",
      "/procurement/purchase-requests",
      "/procurement/purchase-orders",
      "/procurement/receipts",
      "/procurement/vendor-bills",
      "/procurement/ap/open-items",
      "/procurement/payment-proposals",
      "/procurement/vendor-payments",
      "/procurement/vendor-credit-notes",
      "/procurement/vendor-returns",
    ]) expect(document).toContain(`${path}:`);
  });

  it("requires idempotency on procurement commands", () => {
    expect(document).toContain("/procurement/vendor-payments:");
    expect(document).toContain("#/components/parameters/IdempotencyKey");
    expect(document).toContain("version: 0.16.0");
  });

  it("documents approval, posting and worker-owned payment actions", () => {
    for (const path of [
      "/procurement/purchase-requests/{id}/approve",
      "/procurement/purchase-orders/{id}/amend",
      "/procurement/vendor-bills/{id}/match",
      "/procurement/vendor-bills/{id}/post",
      "/procurement/vendor-payments/{id}/process",
      "/procurement/vendor-payments/{id}/reconcile",
      "/procurement/vendor-credit-notes/{id}/apply",
    ]) expect(document).toContain(`${path}:`);
  });
});
