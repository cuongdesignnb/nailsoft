import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluateAuditReport } from "../../scripts/supply-chain-audit.mjs";

const exceptions = JSON.parse(
  readFileSync("docs/security/supply-chain-exceptions.json", "utf8"),
).exceptions;
const now = Date.parse("2026-08-08T12:00:00.000Z");
const imageSizePath =
  "apps__owner-mobile>expo>react-native>@react-native/community-cli-plugin>metro>image-size";

const advisory = (
  id: string,
  packageName: string,
  severity = "high",
  path = imageSizePath,
) => ({
  github_advisory_id: id,
  module_name: packageName,
  severity,
  vulnerable_versions: "<1.0.0",
  patched_versions: ">=2.0.3",
  findings: [{ paths: [path] }],
});

const report = (...advisories: Record<string, unknown>[]) => ({
  advisories: Object.fromEntries(
    advisories.map((item, index) => [String(index), item]),
  ),
  metadata: {
    vulnerabilities: {
      critical: 0,
      high: advisories.length,
      moderate: 0,
      low: 0,
    },
  },
});

describe("supply-chain exception policy", () => {
  it("accepts only the exact active image-size advisories", () => {
    const result = evaluateAuditReport(
      report(
        advisory("GHSA-w3rx-r6r6-pgpr", "image-size"),
        advisory("GHSA-5p2g-fcmc-qvqq", "image-size"),
      ),
      exceptions,
      now,
    );

    expect(result.pass).toBe(true);
    expect(result.DEPENDENCY_AUDIT).toBe("PASS_WITH_TIME_LIMITED_EXCEPTION");
    expect(result.KNOWN_NO_PATCH_HIGH_EXCEPTIONS).toBe(2);
    expect(result.UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS).toBe(0);
  });

  it("fails an unknown image-size advisory", () => {
    const result = evaluateAuditReport(
      report(advisory("GHSA-unknown", "image-size")),
      exceptions,
      now,
    );
    expect(result.pass).toBe(false);
    expect(result.UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS).toBe(1);
  });

  it("fails a high advisory for another package", () => {
    const result = evaluateAuditReport(
      report(advisory("GHSA-other", "lodash", "high", "root>lodash")),
      exceptions,
      now,
    );
    expect(result.pass).toBe(false);
    expect(result.UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS).toBe(1);
  });

  it("fails critical findings without exception support", () => {
    const result = evaluateAuditReport(
      report(advisory("GHSA-w3rx-r6r6-pgpr", "image-size", "critical")),
      exceptions,
      now,
    );
    expect(result.pass).toBe(false);
    expect(result.UNTRIAGED_CRITICAL_FINDINGS).toBe(1);
  });

  it("fails the exception at its expiry boundary", () => {
    const result = evaluateAuditReport(
      report(advisory("GHSA-w3rx-r6r6-pgpr", "image-size")),
      exceptions,
      Date.parse("2026-09-07T00:00:00.000Z"),
    );
    expect(result.pass).toBe(false);
    expect(result.UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS).toBe(1);
  });

  it("fails when dependency context does not match", () => {
    const result = evaluateAuditReport(
      report(
        advisory(
          "GHSA-w3rx-r6r6-pgpr",
          "image-size",
          "high",
          "root>image-size",
        ),
      ),
      exceptions,
      now,
    );
    expect(result.pass).toBe(false);
  });

  it("does not accept patchable nanoid findings", () => {
    const result = evaluateAuditReport(
      report(
        advisory(
          "GHSA-28wg-ghj8-5hjv",
          "nanoid",
          "high",
          "root>postcss>nanoid",
        ),
      ),
      exceptions,
      now,
    );
    expect(result.pass).toBe(false);
    expect(result.UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS).toBe(1);
  });
});
