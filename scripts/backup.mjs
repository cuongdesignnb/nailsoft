import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const url = process.env.DATABASE_URL;
const output = resolve(process.argv[2] ?? `artifacts/sprint18/backup-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.dump`);
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production" && process.env.BACKUP_ALLOW_PRODUCTION !== "true") throw new Error("Production backup requires BACKUP_ALLOW_PRODUCTION=true");
await mkdir(dirname(output), { recursive: true });
await run("pg_dump", ["--format=custom", "--no-owner", "--file", output, url], { windowsHide: true });
const bytes = await (await import("node:fs/promises")).readFile(output);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const metadata = { artifact: basename(output), sha256, sizeBytes: bytes.byteLength, createdAt: new Date().toISOString(), commitSha: process.env.COMMIT_SHA ?? "unknown", migrationHead: process.env.MIGRATION_HEAD ?? "unknown" };
await writeFile(`${output}.json`, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(metadata)}\n`);
