import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Sprint 16 asset contract", () => {
  const controller = readFileSync("apps/api/src/modules/assets/assets.controller.ts", "utf8");
  const migration = readFileSync("infra/migrations/0033_fixed_assets_maintenance_depreciation.up.sql", "utf8");
  it("exposes explicit asset command routes", () => {
    for (const route of ["candidates/:id/approve-capitalization", "capitalization-requests/:id/approve", "depreciation-runs/:id/post", "maintenance-work-orders/:id/verify", "transfers/:id/receive", "count-sessions/:id/record", "impairments/:id/approve", "disposals/:id/complete", "opening-imports/:id/process"]) expect(controller).toContain(route);
    expect(controller).not.toContain("/:action");
  });
  it("uses bigint/rational-safe schema and immutable guards", () => {
    expect(migration).toContain("asset_posted_economics_guard");
    expect(migration).toContain("asset_depreciation_runs");
    expect(migration).toContain("gross_carrying_amount_minor bigint");
    expect(migration).toContain("asset_candidate_source_allocations");
    expect(migration).toContain("UNIQUE(tenant_id,source_type,source_id,generation)");
  });
});
