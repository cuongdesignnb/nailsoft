import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
let projects;
try {
  const { stdout } = await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["list", "--json", "--depth", "0"], { windowsHide: true, shell: process.platform === "win32" });
  projects = JSON.parse(stdout);
} catch {
  const manifests = ["package.json"];
  for (const workspace of ["apps", "packages"]) {
    for (const entry of await readdir(workspace, { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(`${workspace}/${entry.name}/package.json`);
    }
  }
  projects = [];
  for (const file of manifests) {
    try { projects.push(JSON.parse(await readFile(file, "utf8"))); } catch { /* ignore incomplete workspace entries */ }
  }
}
const roots = Array.isArray(projects) ? projects : [projects];
const components = [];
for (const root of roots) for (const [name, info] of Object.entries(root.dependencies ?? {})) components.push({ type: "library", name, version: info.version ?? "unknown", scope: "required" });
const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: "Nailsoft", name: "generate-sbom" }] }, components };
const artifactDir = process.env.RELEASE_ARTIFACT_DIR ?? "artifacts/sprint18";
await mkdir(artifactDir, { recursive: true });
const path = `${artifactDir}/sbom.cyclonedx.json`;
await writeFile(path, `${JSON.stringify(sbom, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ components: components.length, path })}\n`);
