import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const { stdout: sha } = await run("git", ["rev-parse", "HEAD"]);
const migrationFiles = await readdir("infra/migrations");
const discoveredMigrationHead = migrationFiles
  .filter((file) => file.endsWith(".up.sql"))
  .sort()
  .at(-1)
  ?.replace(/\.up\.sql$/, "");
const manifest = { schemaVersion: "1.0", name: packageJson.name, version: packageJson.version, commitSha: process.env.COMMIT_SHA ?? sha.trim(), buildTimestamp: process.env.BUILD_TIMESTAMP ?? new Date().toISOString(), node: process.version, migrationHead: process.env.MIGRATION_HEAD ?? discoveredMigrationHead ?? "unknown", artifactPolicy: "No secrets or customer data" };
const artifactDir = process.env.RELEASE_ARTIFACT_DIR ?? "artifacts/sprint18";
await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/release-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...manifest, path: `${artifactDir}/release-manifest.json` })}\n`);
