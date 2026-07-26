import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const integrationDirectory = join(root, "tests", "integration");
const pnpm = "pnpm";
const testFiles = readdirSync(integrationDirectory)
  .filter((file) => file.endsWith(".test.ts"))
  .sort();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    shell: process.platform === "win32" && command === pnpm,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const file of testFiles) {
  const relativePath = `tests/integration/${file}`;
  console.log(
    `\n[integration] Resetting deterministic fixture for ${relativePath}`,
  );
  run(process.execPath, ["scripts/reset-db.mjs"]);
  run(process.execPath, ["scripts/seed.mjs"]);
  run(pnpm, ["exec", "vitest", "run", relativePath, "--no-file-parallelism"]);
}
