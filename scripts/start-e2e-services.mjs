import { spawn } from "node:child_process";

const shell = process.platform === "win32";
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [
  spawn(command, ["--filter", "@nailsoft/api", "dev"], {
    stdio: "inherit",
    shell,
    env: process.env,
  }),
  spawn(command, ["--filter", "@nailsoft/worker", "dev"], {
    stdio: "inherit",
    shell,
    env: process.env,
  }),
];

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
