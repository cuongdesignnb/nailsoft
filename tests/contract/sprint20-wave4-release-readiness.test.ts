import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { environmentSchema } from "../../packages/config/src/index.js";

describe("Sprint 20 Wave 4 release readiness contract", () => {
  it("keeps the fifteen workstreams and explicit non-go-live state", () => {
    const report = readFileSync("docs/operations/sprint-20-wave-4-release-readiness-report.md", "utf8");
    expect(report).toContain("RELEASE_WORKSTREAM_COUNT=15");
    for (const id of Array.from({ length: 15 }, (_, index) => `R${index + 1}`)) expect(report).toContain(`| ${id} |`);
    expect(report).toContain("PRODUCTION_GO_LIVE=NO");
    expect(report).toContain("REPO_LOCAL_DOCKER_IS_STAGING=NO");
  });

  it("keeps release artifact and migration evidence available", () => {
    expect(existsSync("scripts/generate-release-manifest.mjs")).toBe(true);
    expect(existsSync("scripts/generate-sbom.mjs")).toBe(true);
    expect(existsSync("infra/migrations/0036_accounting_reconciliation_closure.up.sql")).toBe(true);
  });

  it("requires shared Redis controls in production", () => {
    const config = environmentSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app:secret@db.internal:5432/nailsoft",
      REDIS_URL: "rediss://:secret@redis.internal:6380",
      JWT_SECRET: "a".repeat(32),
      IDENTITY_HASH_SECRET: "b".repeat(32),
      MFA_ENCRYPTION_KEY: "c".repeat(32),
      CORS_ORIGINS: "https://admin.example",
      PUBLIC_URL: "https://api.example",
      PAYMENT_PROVIDER_MODE: "live",
      REDIS_REQUIRED: "true",
      REDIS_RATE_LIMIT_ENABLED: "true",
    });
    expect(config.success).toBe(true);
  });
});
