import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const input = resolve(process.argv[2] ?? "");
const url = process.env.RESTORE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!input) throw new Error("Usage: node scripts/restore.mjs <backup.dump>");
if (!url) throw new Error("RESTORE_DATABASE_URL or DATABASE_URL is required");
if (process.env.NODE_ENV === "production" && process.env.BACKUP_ALLOW_PRODUCTION !== "true") throw new Error("Production restore requires BACKUP_ALLOW_PRODUCTION=true");
const metadata = JSON.parse(await readFile(`${input}.json`, "utf8"));
const actual = createHash("sha256").update(await readFile(input)).digest("hex");
if (actual !== metadata.sha256) throw new Error("Backup checksum mismatch; restore refused");
await run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", url, input], { windowsHide: true });
process.stdout.write(`${JSON.stringify({ restored: true, artifact: input, sha256: actual, restoredAt: new Date().toISOString() })}\n`);
