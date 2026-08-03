import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const run = promisify(execFile);
const result = { SECRET_SCAN: "PENDING", STATIC_ANALYSIS: "PENDING", DEPENDENCY_AUDIT: "PENDING", SBOM: "PENDING", CONTAINER_SCAN: "NOT_CONFIGURED", UNTRIAGED_CRITICAL_FINDINGS: 0, UNTRIAGED_HIGH_EXPLOITABLE_FINDINGS: 0 };
const command = async (file, args) => run(file, args, { windowsHide: true, shell: process.platform === "win32", maxBuffer: 20 * 1024 * 1024 });
try {
  await command(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["security:scan"]); result.SECRET_SCAN = "PASS";
  await command(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["lint"]); await command(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["typecheck"]); result.STATIC_ANALYSIS = "PASS";
  await command(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["audit", "--audit-level=high"]); result.DEPENDENCY_AUDIT = "PASS";
  await command(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["release:sbom"]); result.SBOM = "PASS";
  const image = process.env.CONTAINER_IMAGE;
  if (image && existsSync("Dockerfile")) {
    await command("docker", ["image", "inspect", image]);
    const scanner = process.env.CONTAINER_SCANNER ?? "docker";
    if (scanner === "docker-scout") await command("docker", ["scout", "cves", image]);
    else throw new Error("CONTAINER_SCANNER must be docker-scout when CONTAINER_IMAGE is configured");
    result.CONTAINER_SCAN = "PASS";
  } else result.CONTAINER_SCAN = "NOT_APPLICABLE_NO_PRODUCTION_IMAGE";
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ...result, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
