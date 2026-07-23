import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const shell = process.platform === "win32";
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const root = resolve(import.meta.dirname, "..");

for (const packageName of [
  "@nailsoft/domain-types",
  "@nailsoft/validation",
  "@nailsoft/api",
  "@nailsoft/worker",
]) {
  const result = spawnSync(command, ["--filter", packageName, "build"], {
    cwd: root,
    stdio: "inherit",
    shell,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const children = [];
children.push(
  spawn(process.execPath, [resolve(root, "apps/worker/dist/main.js")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
);

// Let the worker drain deterministic seed outbox events before API health makes
// Playwright release the test suite. This keeps cache and realtime assertions
// independent from startup ordering.
await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));

children.push(
  spawn(process.execPath, [resolve(root, "apps/api/dist/main.js")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
);

function stop(signal) {
  for (const child of children) child.kill(signal);
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
await Promise.race(
  children.map(
    (child) =>
      new Promise((resolve) => child.once("exit", (code) => resolve(code))),
  ),
);
stop("SIGTERM");
