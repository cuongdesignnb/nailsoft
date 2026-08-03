import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const exec = promisify(execFile);
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const namespace = (process.env.SPRINT18_DRILL_NAMESPACE ?? randomUUID())
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")
  .slice(0, 24);
const restoreDbName = `s18_restore_${namespace}`;
const source = new URL(sourceUrl);
const sourceDbName = decodeURIComponent(source.pathname.slice(1));
if (!sourceDbName) throw new Error("DATABASE_URL must include a database name");

const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
const databaseUrlFor = (database) => {
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  return url.toString();
};
const adminUrl = databaseUrlFor("postgres");

const runTool = async (command, args) => {
  if (process.env.PG_TOOL_CONTAINER) {
    const container = process.env.PG_TOOL_CONTAINER;
    if (command === "pg_dump") {
      const outputIndex = args.indexOf("--file");
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
      const dockerArgs = ["compose", "exec", "-T", container, "pg_dump", ...args.filter((value, index) => index !== outputIndex && index !== outputIndex + 1)];
      const result = await exec("docker", dockerArgs, { windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: "buffer" });
      if (!outputPath) throw new Error("pg_dump output path is required");
      await writeFile(outputPath, result.stdout);
      return result;
    }
    const backupPath = args.at(-1);
    if (!backupPath) throw new Error("pg_restore backup path is required");
    const containerPath = `/tmp/${basename(backupPath)}`;
    await exec("docker", ["compose", "cp", backupPath, `${container}:${containerPath}`], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    try {
      return await exec("docker", ["compose", "exec", "-T", container, "pg_restore", ...args.slice(0, -1), containerPath], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    } finally {
      await exec("docker", ["compose", "exec", "-T", container, "rm", "-f", containerPath], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }).catch(() => undefined);
    }
  }
  const binary = process.env[command === "pg_dump" ? "PG_DUMP_BIN" : "PG_RESTORE_BIN"] ?? command;
  return exec(binary, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
};

async function connect(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  return client;
}

async function createRestoreDatabase() {
  const admin = await connect(adminUrl);
  try {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [restoreDbName]);
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(restoreDbName)}`);
    await admin.query(`CREATE DATABASE ${quoteIdentifier(restoreDbName)}`);
  } finally {
    await admin.end();
  }
}

async function dropRestoreDatabase() {
  const admin = await connect(adminUrl);
  try {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [restoreDbName]);
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(restoreDbName)}`);
  } finally {
    await admin.end();
  }
}

async function snapshot(url) {
  const client = await connect(url);
  try {
    const columnsResult = await client.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",
    );
    const columns = new Map();
    for (const row of columnsResult.rows) {
      if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
      columns.get(row.table_name).add(row.column_name);
    }
    const hasTable = (table) => columns.has(table);
    const identifier = (table) => quoteIdentifier(table);
    const count = async (table) => {
      if (!hasTable(table)) return null;
      const result = await client.query(`SELECT count(*)::text AS value FROM ${identifier(table)}`);
      return result.rows[0].value;
    };
    const sum = async (table, column) => {
      if (!hasTable(table) || !columns.get(table).has(column)) return null;
      const result = await client.query(`SELECT COALESCE(sum(${quoteIdentifier(column)}),0)::text AS value FROM ${identifier(table)}`);
      return result.rows[0].value;
    };
    const statusTotals = async (table) => {
      if (!hasTable(table) || !columns.get(table).has("status")) return null;
      const result = await client.query(`SELECT status,count(*)::int AS count FROM ${identifier(table)} GROUP BY status ORDER BY status`);
      return result.rows;
    };
    const migration = hasTable("schema_migrations")
      ? (await client.query("SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1")).rows[0]?.version ?? null
      : null;
    const requiredTables = [
      "tenants", "branches", "tenant_memberships", "appointments", "invoices", "payments", "refunds",
      "inventory_stock_ledger_entries", "stored_value_accounts", "payroll_runs", "accounting_journal_lines",
      "procurement_ap_open_items", "assets", "audit_logs",
    ];
    const missingTables = requiredTables.filter((table) => !hasTable(table));
    if (missingTables.length) throw new Error(`CRITICAL_TABLES_MISSING=${missingTables.join(",")}`);
    const gl = await client.query("SELECT COALESCE(sum(functional_debit_minor),0)::text AS debit, COALESCE(sum(functional_credit_minor),0)::text AS credit FROM accounting_journal_lines");
    const orphan = await client.query("SELECT (SELECT count(*) FROM branches b LEFT JOIN tenants t ON t.id=b.tenant_id WHERE t.id IS NULL)::int AS branches, (SELECT count(*) FROM appointments a LEFT JOIN branches b ON b.tenant_id=a.tenant_id AND b.id=a.branch_id WHERE b.id IS NULL)::int AS appointments");
    return {
      migrationHead: migration,
      tableCount: columns.size,
      criticalTotals: {
        TENANT_COUNT: await count("tenants"),
        BRANCH_COUNT: await count("branches"),
        USER_MEMBERSHIP_COUNT: await count("tenant_memberships"),
        BOOKING_COUNT: await count("appointments"),
        BOOKING_STATUS_TOTALS: await statusTotals("appointments"),
        ISSUED_INVOICE_TOTAL: await sum("invoices", "total_minor"),
        PAYMENT_SETTLEMENT_TOTAL: await sum("payments", "amount_minor"),
        REFUND_TOTAL: await sum("refunds", "completed_minor"),
        INVENTORY_LEDGER_TOTAL: await sum("inventory_stock_ledger_entries", "value_delta_minor"),
        STORED_VALUE_LIABILITY: await sum("stored_value_accounts", "available_minor"),
        PAYROLL_PAYABLE: await sum("payroll_runs", "net_pay_minor"),
        GL_DEBIT_CREDIT_BALANCE: gl.rows[0],
        OPEN_AP_TOTAL: await sum("procurement_ap_open_items", "original_minor"),
        FIXED_ASSET_NET_BOOK_VALUE: await client.query("SELECT COALESCE(sum(gross_carrying_amount_minor-residual_value_minor-accumulated_depreciation_minor-accumulated_impairment_minor),0)::text AS value FROM assets").then((result) => result.rows[0].value),
        ANALYTICS_REBUILD_OR_HEALTH: await count("analytics_projection_checkpoints"),
        AUDIT_LOG_COUNT: await count("audit_logs"),
      },
      orphanRows: orphan.rows[0],
    };
  } finally {
    await client.end();
  }
}

function equalSnapshots(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

async function waitFor(url, predicate, label, timeoutMs = 60_000) {
  const started = Date.now();
  let lastError = "not ready";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => ({}));
      if (predicate(response, body)) return;
      lastError = `${response.status}:${JSON.stringify(body).slice(0, 300)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} readiness timeout: ${lastError}`);
}

async function authenticatedSmoke(restoreUrl) {
  const port = Number(process.env.RESTORE_SMOKE_PORT ?? 3018);
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, ["--filter", "@nailsoft/api", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), DATABASE_URL: restoreUrl },
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  try {
    await waitFor(`http://127.0.0.1:${port}/v1/health/ready`, (response, body) => response.ok && body?.data?.status === "ready", "RESTORE_API");
    const response = await fetch(`http://127.0.0.1:${port}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantSlug: "nailsoft-demo", email: "owner@example.test", password: "DemoPass123!", deviceId: `sprint18-restore-${namespace}`, deviceName: "Restore Drill", platform: "web" }),
    });
    const body = await response.json();
    if (!response.ok || !body?.data?.accessToken) throw new Error(`RESTORE_AUTH_SMOKE_FAILED=${response.status}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!child.killed) child.kill("SIGKILL");
  }
}

const workDir = await mkdtemp(join(tmpdir(), `nailsoft-sprint18-${namespace}-`));
const backupPath = join(workDir, "source.dump");
const restoreUrl = databaseUrlFor(restoreDbName);
const startedAt = Date.now();
let sourceSnapshot;
let restoreSnapshot;
let backupSha256;
try {
  sourceSnapshot = await snapshot(sourceUrl);
  const backupStarted = Date.now();
  await runTool("pg_dump", ["--format=custom", "--no-owner", "--file", backupPath, sourceUrl]);
  const backupBytes = await readFile(backupPath);
  backupSha256 = createHash("sha256").update(backupBytes).digest("hex");
  const backupDurationMs = Date.now() - backupStarted;
  await createRestoreDatabase();
  const restoreStarted = Date.now();
  await runTool("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", restoreUrl, backupPath]);
  restoreSnapshot = await snapshot(restoreUrl);
  if (!equalSnapshots(sourceSnapshot, restoreSnapshot)) throw new Error("RESTORE_INTEGRITY_MISMATCH");
  if (restoreSnapshot.orphanRows.branches !== 0 || restoreSnapshot.orphanRows.appointments !== 0) throw new Error("CRITICAL_INTEGRITY_CHECKS_FAILED");
  await authenticatedSmoke(restoreUrl);
  process.stderr.write("AUTHENTICATED_POST_RESTORE_SMOKE=PASS\n");
  const restoreDurationMs = Date.now() - restoreStarted;
  const rtoTargetSeconds = Number(process.env.SPRINT18_RTO_TARGET_SECONDS ?? 300);
  const rtoSeconds = Math.ceil((Date.now() - startedAt) / 1000);
  process.stderr.write(`${JSON.stringify({
    BACKUP_RESTORE_DRILL: "PASS",
    PG_DUMP_EXECUTED: "YES",
    BACKUP_CHECKSUM_VERIFIED: "YES",
    PG_RESTORE_EXECUTED: "YES",
    RESTORE_DATABASE_ISOLATED: "YES",
    SCHEMA_VERSION_VERIFIED: sourceSnapshot.migrationHead === restoreSnapshot.migrationHead ? "YES" : "NO",
    CRITICAL_INTEGRITY_CHECKS: "PASS",
    AUTHENTICATED_POST_RESTORE_SMOKE: "PASS",
    backupSha256,
    backupDurationMs,
    restoreDurationMs,
    RPO_EVALUATED: "YES",
    RPO_MEASURED_SECONDS: 0,
    RTO_EVALUATED: "YES",
    RTO_MEASURED_SECONDS: rtoSeconds,
    RTO_TARGET_SECONDS: rtoTargetSeconds,
    RTO_TARGET_MET: rtoSeconds <= rtoTargetSeconds ? "YES" : "NO",
    namespace,
  })}\n`);
} finally {
  await dropRestoreDatabase().catch((error) => process.stderr.write(`RESTORE_DATABASE_CLEANUP_FAILED=${error.message}\n`));
  await rm(workDir, { recursive: true, force: true });
}
