import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("Sprint 18 production readiness controls", () => {
  it("keeps the migration history immutable and supplies operational scripts", () => {
    expect(existsSync("infra/migrations/0035_sprint18_production_readiness.up.sql")).toBe(false);
    for (const file of ["scripts/backup.mjs", "scripts/restore.mjs", "scripts/integrity-check.mjs", "scripts/verify-backup-restore.mjs", "scripts/supply-chain-audit.mjs", "scripts/generate-release-manifest.mjs", "scripts/generate-sbom.mjs", "scripts/security-scan.mjs"]) expect(existsSync(file)).toBe(true);
  });

  it("supports a release-specific artifact namespace without changing the legacy default", () => {
    const manifest = readFileSync("scripts/generate-release-manifest.mjs", "utf8");
    const sbom = readFileSync("scripts/generate-sbom.mjs", "utf8");
    expect(manifest).toContain("RELEASE_ARTIFACT_DIR");
    expect(sbom).toContain("RELEASE_ARTIFACT_DIR");
    expect(manifest).toContain("artifacts/sprint18");
    expect(sbom).toContain("artifacts/sprint18");
  });

  it("documents the go-live stop gates and does not claim production readiness", () => {
    const audit = readFileSync("docs/operations/sprint-18-production-readiness-audit.md", "utf8");
    expect(audit).toContain("not ready for production go-live");
    expect(audit).toContain("RPO/RTO");
    expect(audit).toContain("0001`–`0034");
  });
});
