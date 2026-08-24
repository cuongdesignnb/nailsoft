import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "../apps/api/node_modules/redis/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;
const env = { ...process.env, NODE_ENV: "development" };

const allSpecs = readdirSync(resolve(root, "tests/e2e"))
  .filter((entry) => entry.endsWith(".spec.ts"))
  .sort()
  .map((entry) => resolve(root, "tests/e2e", entry));
const specs = process.env.E2E_SPEC
  ? allSpecs.filter((spec) => spec.endsWith(process.env.E2E_SPEC))
  : allSpecs;
const debug = (...args) => {
  if (process.env.E2E_DEBUG === "1") console.error("[isolated-e2e]", ...args);
};

if (!specs.length) {
  throw new Error(`No E2E spec matched E2E_SPEC=${process.env.E2E_SPEC ?? ""}`);
}

const children = new Set();

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32" && command === pnpm,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12000);
  });
  child.__label = label;
  child.__output = () => output;
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null || child.killed)
    return Promise.resolve();
  return new Promise((resolveStop) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      children.delete(child);
      resolveStop();
    };
    child.once("close", done);
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
    setTimeout(done, 10_000);
  });
}

async function stopAll() {
  await Promise.all([...children].map((child) => stop(child)));
}

async function waitFor(url, label, child) {
  const deadline = Date.now() + 120_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready:\n${child.__output?.() ?? ""}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`${label} did not become ready: ${lastError}`);
}

function command(args, label) {
  debug("command:start", label, args.join(" "));
  try {
    execFileSync(pnpm, args, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      maxBuffer: 16 * 1024 * 1024,
    });
    debug("command:pass", label);
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    const stderr = error?.stderr?.toString?.() ?? "";
    throw new Error(
      `${label} failed (${error instanceof Error ? error.message : String(error)}):\n${stdout}\n${stderr}`,
    );
  }
}

function resetDatabase() {
  command(["db:reset"], "database reset");
  command(["db:seed"], "database seed");
}

async function clearQaCaches() {
  const client = createClient({
    url: env.REDIS_URL ?? "redis://localhost:6379",
    socket: { connectTimeout: 2_000, reconnectStrategy: false },
  });
  client.on("error", (error) => {
    debug("redis:error", error instanceof Error ? error.message : String(error));
  });
  try {
    await client.connect();
    const keys = [];
    for await (const batch of client.scanIterator({
      MATCH: "availability:*",
      COUNT: 100,
    })) {
      keys.push(...batch);
    }
    for (const key of keys) await client.del(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" ? error.code : undefined;
    const nestedCodes =
      error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)
        ? error.errors.map((item) => item?.code).filter(Boolean)
        : [];
    if (
      /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(message) ||
      [code, ...nestedCodes].some((value) =>
        /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(String(value)),
      )
    ) {
      console.warn(`QA cache clear skipped: Redis unavailable (${message})`);
      return;
    }
    throw error;
  } finally {
    if (client.isOpen) await client.quit();
  }
}

function runPlaywright(spec, config) {
  return new Promise((resolveRun, rejectRun) => {
    const relativeSpec = spec
      .slice(root.length + 1)
      .replaceAll("\\", "/");
    const child = start(
      pnpm,
      ["exec", "playwright", "test", relativeSpec, "--config", config, "--workers=1"],
      `Playwright ${spec}`,
    );
    child.once("close", (code, signal) => {
      const output = child.__output();
      if (code === 0) {
        console.log(`PASS ${spec.replace(`${root}\\`, "")}`);
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `Playwright failed for ${spec} (code=${code}, signal=${signal})\n${output}`,
        ),
      );
    });
    child.once("error", rejectRun);
  });
}

async function main() {
  debug("main:start", specs.map((spec) => spec.replace(`${root}\\`, "")));
  if (!existsSync(resolve(root, "apps/owner-mobile/dist"))) {
    throw new Error("Owner mobile build is missing; run pnpm build first");
  }
  if (!existsSync(resolve(root, "apps/staff-mobile/dist"))) {
    throw new Error("Staff mobile build is missing; run pnpm build first");
  }

  for (const packageName of [
    "@nailsoft/domain-types",
    "@nailsoft/validation",
    "@nailsoft/api",
    "@nailsoft/worker",
  ]) {
    command(["--filter", packageName, "build"], `${packageName} build`);
  }
  debug("builds:pass");

  const admin = start(
    node,
    [resolve(root, "apps/admin-web/node_modules/next/dist/bin/next"), "dev", "apps/admin-web", "-p", "3000"],
    "admin web",
  );
  const booking = start(
    node,
    [resolve(root, "apps/booking-web/node_modules/next/dist/bin/next"), "dev", "apps/booking-web", "-p", "3002"],
    "booking web",
  );
  await waitFor("http://127.0.0.1:3000", "Admin Web", admin);
  debug("admin:ready");
  await waitFor("http://127.0.0.1:3002", "Booking Web", booking);
  debug("booking:ready");

  const python = process.platform === "win32" ? "python" : "python3";
  const ownerMobile = start(
    python,
    ["-m", "http.server", "3003", "--directory", resolve(root, "apps/owner-mobile/dist")],
    "owner mobile",
  );
  const staffMobile = start(
    python,
    ["-m", "http.server", "3004", "--directory", resolve(root, "apps/staff-mobile/dist")],
    "staff mobile",
  );
  await waitFor("http://127.0.0.1:3003", "Owner Mobile", ownerMobile);
  debug("owner-mobile:ready");
  await waitFor("http://127.0.0.1:3004", "Staff Mobile", staffMobile);
  debug("staff-mobile:ready");

  const membershipSpec = resolve(
    root,
    "tests/e2e/sprint8-membership-upgrade-downgrade.spec.ts",
  );
  let worker;
  let api;
  for (const spec of specs) {
    const isMembership = spec === membershipSpec;
    debug("spec:start", spec);
    await stop(api);
    await stop(worker);
    debug("spec:services-stopped", spec);
    resetDatabase();
    debug("spec:database-reset", spec);
    await clearQaCaches();
    debug("spec:caches-cleared", spec);
    if (!isMembership) {
      worker = start(node, [resolve(root, "apps/worker/dist/main.js")], "worker");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
    }
    api = start(node, [resolve(root, "apps/api/dist/main.js")], "api");
    await waitFor("http://127.0.0.1:3001/v1/health", "API", api);
    debug("spec:api-ready", spec);
    await runPlaywright(
      spec,
      isMembership ? "playwright.api.config.ts" : "playwright.config.ts",
    );
    debug("spec:pass", spec);
  }
  console.log(`E2E_ISOLATED_PASS=${specs.length}/${specs.length}`);
}

process.on("SIGINT", () => {
  void stopAll();
  process.exit(130);
});
process.on("SIGTERM", () => {
  void stopAll();
  process.exit(143);
});

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stopAll();
}
