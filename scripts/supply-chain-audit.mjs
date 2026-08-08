import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const run = promisify(execFile);
const maxBuffer = 20 * 1024 * 1024;
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const exceptionFile = resolve(
  process.cwd(),
  "docs/security/supply-chain-exceptions.json",
);

const command = async (file, args) =>
  run(file, args, {
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer,
  });

const asArray = (value) => (Array.isArray(value) ? value : []);

const parseJsonOutput = (output) => {
  const text = String(output ?? "").trim();
  if (!text) throw new Error("Dependency audit returned no JSON output.");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start)
      throw new Error("Dependency audit returned malformed JSON.");
    return JSON.parse(text.slice(start, end + 1));
  }
};

export const loadExceptions = (file = exceptionFile) => {
  const document = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(document.exceptions))
    throw new Error(
      "Security exception record must contain an exceptions array.",
    );
  return document.exceptions.map((exception) => {
    const required = [
      "id",
      "package",
      "severity",
      "dependencyType",
      "approvedAt",
      "expiresAt",
    ];
    if (
      required.some(
        (field) =>
          typeof exception[field] !== "string" || exception[field].length === 0,
      )
    ) {
      throw new Error(
        `Invalid security exception record: ${exception.id ?? "unknown"}`,
      );
    }
    if (
      !Array.isArray(exception.advisoryIds) ||
      exception.advisoryIds.length === 0
    ) {
      throw new Error(
        `Security exception ${exception.id} must list advisoryIds.`,
      );
    }
    if (
      !Array.isArray(exception.dependencyContext) ||
      exception.dependencyContext.length === 0
    ) {
      throw new Error(
        `Security exception ${exception.id} must list dependencyContext.`,
      );
    }
    if (exception.noPatchAvailable !== true) {
      throw new Error(
        `Security exception ${exception.id} must explicitly declare noPatchAvailable=true.`,
      );
    }
    return exception;
  });
};

const normalizedAdvisories = (report) => {
  if (
    !report ||
    typeof report !== "object" ||
    !report.advisories ||
    typeof report.advisories !== "object"
  ) {
    throw new Error(
      "Unsupported pnpm audit JSON shape; advisories object is required.",
    );
  }
  return Object.values(report.advisories).map((advisory) => ({
    id: String(advisory.github_advisory_id ?? advisory.id ?? ""),
    package: String(advisory.module_name ?? ""),
    severity: String(advisory.severity ?? "").toLowerCase(),
    vulnerableVersions: String(advisory.vulnerable_versions ?? ""),
    patchedVersions: String(advisory.patched_versions ?? ""),
    cwe: advisory.cwe ?? null,
    title: advisory.title ?? null,
    findings: asArray(advisory.findings),
    paths: asArray(advisory.findings).flatMap((finding) =>
      asArray(finding.paths).map(String),
    ),
  }));
};

const exceptionIsActive = (exception, now) => {
  const approvedAt = Date.parse(`${exception.approvedAt}T00:00:00.000Z`);
  const expiresAt = Date.parse(`${exception.expiresAt}T00:00:00.000Z`);
  return (
    Number.isFinite(approvedAt) &&
    Number.isFinite(expiresAt) &&
    approvedAt <= now &&
    now < expiresAt
  );
};

const matchesException = (advisory, exception, now) =>
  exceptionIsActive(exception, now) &&
  exception.package === advisory.package &&
  exception.severity === advisory.severity &&
  exception.dependencyType === "transitive" &&
  exception.advisoryIds.includes(advisory.id) &&
  advisory.paths.length > 0 &&
  advisory.paths.every((path) =>
    exception.dependencyContext.every((context) => path.includes(context)),
  );

export const evaluateAuditReport = (report, exceptions, now = Date.now()) => {
  const advisories = normalizedAdvisories(report);
  const counts = advisories.reduce(
    (summary, advisory) => {
      if (advisory.severity in summary) summary[advisory.severity] += 1;
      return summary;
    },
    { critical: 0, high: 0, moderate: 0, low: 0 },
  );
  const critical = advisories.filter(
    (advisory) => advisory.severity === "critical",
  );
  const high = advisories.filter((advisory) => advisory.severity === "high");
  const accepted = high.filter((advisory) =>
    exceptions.some((exception) => matchesException(advisory, exception, now)),
  );
  const untriagedHigh = high.filter((advisory) => !accepted.includes(advisory));
  const securityExceptionIds = [
    ...new Set(
      accepted.flatMap((advisory) =>
        exceptions
          .filter((exception) => matchesException(advisory, exception, now))
          .map((exception) => exception.id),
      ),
    ),
  ];
  const dependencyAudit =
    accepted.length > 0 ? "PASS_WITH_TIME_LIMITED_EXCEPTION" : "PASS";

  return {
    pass: critical.length === 0 && untriagedHigh.length === 0,
    DEPENDENCY_AUDIT: dependencyAudit,
    CRITICAL_COUNT: counts.critical,
    HIGH_COUNT: counts.high,
    MODERATE_COUNT: counts.moderate,
    LOW_COUNT: counts.low,
    UNTRIAGED_CRITICAL_FINDINGS: critical.length,
    UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS: untriagedHigh.length,
    KNOWN_NO_PATCH_HIGH_EXCEPTIONS: accepted.length,
    SECURITY_EXCEPTION_IDS: securityExceptionIds,
    untriagedAdvisories: untriagedHigh.concat(critical),
  };
};

const runDependencyAudit = async () => {
  let auditOutput;
  try {
    auditOutput = await command(packageManager, ["audit", "--json"]);
  } catch (error) {
    auditOutput = {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? "",
      exitCode: error.code ?? 1,
    };
  }
  const report = parseJsonOutput(auditOutput.stdout || auditOutput.stderr);
  const evaluation = evaluateAuditReport(report, loadExceptions());
  if (!evaluation.pass) {
    const details = evaluation.untriagedAdvisories
      .map(
        (advisory) => `${advisory.id}:${advisory.package}:${advisory.severity}`,
      )
      .join(", ");
    const error = new Error(
      `Dependency audit gate failed for untriaged findings: ${details || "unknown"}`,
    );
    error.audit = evaluation;
    throw error;
  }
  return evaluation;
};

export const main = async () => {
  const result = {
    SECRET_SCAN: "PENDING",
    STATIC_ANALYSIS: "PENDING",
    DEPENDENCY_AUDIT: "PENDING",
    SBOM: "PENDING",
    CONTAINER_SCAN: "NOT_CONFIGURED",
    CRITICAL_COUNT: 0,
    HIGH_COUNT: 0,
    MODERATE_COUNT: 0,
    LOW_COUNT: 0,
    UNTRIAGED_CRITICAL_FINDINGS: 0,
    UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS: 0,
    KNOWN_NO_PATCH_HIGH_EXCEPTIONS: 0,
    SECURITY_EXCEPTION_IDS: [],
  };
  try {
    await command(packageManager, ["security:scan"]);
    result.SECRET_SCAN = "PASS";
    await command(packageManager, ["lint"]);
    await command(packageManager, ["typecheck"]);
    result.STATIC_ANALYSIS = "PASS";

    const audit = await runDependencyAudit();
    Object.assign(result, {
      DEPENDENCY_AUDIT: audit.DEPENDENCY_AUDIT,
      CRITICAL_COUNT: audit.CRITICAL_COUNT,
      HIGH_COUNT: audit.HIGH_COUNT,
      MODERATE_COUNT: audit.MODERATE_COUNT,
      LOW_COUNT: audit.LOW_COUNT,
      UNTRIAGED_CRITICAL_FINDINGS: audit.UNTRIAGED_CRITICAL_FINDINGS,
      UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS:
        audit.UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS,
      KNOWN_NO_PATCH_HIGH_EXCEPTIONS: audit.KNOWN_NO_PATCH_HIGH_EXCEPTIONS,
      SECURITY_EXCEPTION_IDS: audit.SECURITY_EXCEPTION_IDS,
    });

    await command(packageManager, ["release:sbom"]);
    result.SBOM = "PASS";
    const image = process.env.CONTAINER_IMAGE;
    if (image && existsSync("Dockerfile")) {
      await command("docker", ["image", "inspect", image]);
      const scanner = process.env.CONTAINER_SCANNER ?? "docker";
      if (scanner === "docker-scout")
        await command("docker", ["scout", "cves", image]);
      else
        throw new Error(
          "CONTAINER_SCANNER must be docker-scout when CONTAINER_IMAGE is configured",
        );
      result.CONTAINER_SCAN = "PASS";
    } else result.CONTAINER_SCAN = "NOT_APPLICABLE_NO_PRODUCTION_IMAGE";
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error?.audit) Object.assign(result, error.audit);
    process.stderr.write(
      `${JSON.stringify({ ...result, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  }
};

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();
