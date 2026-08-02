import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Sprint 17 analytics API contract", () => {
  const controller = readFileSync("apps/api/src/modules/analytics/analytics.controller.ts", "utf8");
  const migration = readFileSync("infra/migrations/0034_business_intelligence_owner_command_center.up.sql", "utf8");
  it("keeps explicit routes ahead of dynamic identifiers", () => {
    for (const route of ["command-center", "kpis", "trends", "branches/compare", "staff/me", "data-quality", "projection-health", "exports", "rebuilds"]) expect(controller).toContain(route);
    expect(controller).not.toContain("/:action");
  });
  it("declares metadata, projection identity and granular permissions", () => {
    for (const table of ["analytics_metric_definitions", "analytics_projection_events", "analytics_projection_checkpoints", "analytics_daily_branch_facts", "analytics_targets", "analytics_alert_occurrences", "analytics_export_jobs", "analytics_rebuild_runs"]) expect(migration).toContain(`CREATE TABLE ${table}`);
    expect(migration).toContain("UNIQUE (tenant_id, projector_name, source_type, source_id, source_version)");
    expect(migration).toContain("analytics.dashboard.read");
    expect(migration).toContain("analytics_projection_events_append_only");
  });
});
