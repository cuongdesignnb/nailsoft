import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const DEADLOCK_SQLSTATE = "40P01";
export const MAX_ATTEMPTS = 4;
export const BACKOFF_MS = [250, 500, 1_000];

export function isDeadlock(error) {
  return error?.code === DEADLOCK_SQLSTATE;
}

export function retryDelay(attempt) {
  return BACKOFF_MS[attempt - 1];
}

export async function resetSchemaOnce(
  connectionString,
  { Client = pg.Client } = {},
) {
  const client = new Client({ connectionString });
  let transactionStarted = false;
  let operationError;

  try {
    await client.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    operationError = error;
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the reset error; the client is discarded after this attempt.
      }
    }
    throw error;
  } finally {
    try {
      await client.end();
    } catch (error) {
      if (!operationError) throw error;
    }
  }
}

export async function resetSchemaWithRetry(
  connectionString,
  { Client = pg.Client, sleepFn = sleep, logger = console } = {},
) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    logger.log(`DB_RESET_ATTEMPT=${attempt}`);

    try {
      await resetSchemaOnce(connectionString, { Client });
      logger.log("DB_RESET_SUCCESS=YES");
      return;
    } catch (error) {
      if (!isDeadlock(error)) throw error;

      if (attempt === MAX_ATTEMPTS) {
        logger.log("DB_RESET_DEADLOCK_RETRY_EXHAUSTED");
        logger.log(`attempts=${MAX_ATTEMPTS}`);
        logger.log(`sqlstate=${DEADLOCK_SQLSTATE}`);
        const exhausted = new Error("DB_RESET_DEADLOCK_RETRY_EXHAUSTED", {
          cause: error,
        });
        exhausted.code = DEADLOCK_SQLSTATE;
        exhausted.attempts = MAX_ATTEMPTS;
        throw exhausted;
      }

      const delayMs = retryDelay(attempt);
      logger.log("DB_RESET_DEADLOCK_RETRY=YES");
      logger.log(`DB_RESET_RETRY_DELAY_MS=${delayMs}`);
      await sleepFn(delayMs);
    }
  }
}

export function runMigrationAndSeed(
  connectionString,
  { execFile = execFileSync } = {},
) {
  for (const script of ["migrate.mjs", "seed.mjs"]) {
    execFile(process.execPath, [`scripts/${script}`], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: connectionString },
    });
  }
}

export async function resetDatabase({
  connectionString = process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  Client = pg.Client,
  sleepFn = sleep,
  logger = console,
  execFile = execFileSync,
} = {}) {
  await resetSchemaWithRetry(connectionString, { Client, sleepFn, logger });
  runMigrationAndSeed(connectionString, { execFile });
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  await resetDatabase();
}
