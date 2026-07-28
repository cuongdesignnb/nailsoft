import { beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error The executable reset script is intentionally plain ESM.
// prettier-ignore
import { resetDatabase, resetSchemaWithRetry } from "../../../scripts/reset-db.mjs";

type AttemptBehavior = "success" | string;

function clientHarness(behaviors: AttemptBehavior[]) {
  const clients: Array<{
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }> = [];

  class Client {
    private readonly behavior: AttemptBehavior;
    connect = vi.fn().mockResolvedValue(undefined);
    end = vi.fn().mockResolvedValue(undefined);
    query = vi.fn(async (sql: string) => {
      if (sql === "DROP SCHEMA public CASCADE" && this.behavior !== "success") {
        throw Object.assign(new Error("database reset failed"), {
          code: this.behavior,
        });
      }
    });

    constructor() {
      this.behavior = behaviors[clients.length] ?? "success";
      clients.push(this);
    }
  }

  return { Client, clients };
}

const silentLogger = { log: vi.fn() };

describe("database reset deadlock retry", () => {
  beforeEach(() => {
    silentLogger.log.mockClear();
  });

  it("retries one deadlock, creates a new client, then migrates and seeds once", async () => {
    const { Client, clients } = clientHarness(["40P01", "success"]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const execFile = vi.fn();

    await resetDatabase({
      connectionString: "postgresql://redacted",
      Client: Client as never,
      sleepFn,
      logger: silentLogger,
      execFile,
    });

    expect(clients).toHaveLength(2);
    expect(clients.every((client) => client.end.mock.calls.length === 1)).toBe(
      true,
    );
    expect(sleepFn).toHaveBeenCalledOnce();
    expect(sleepFn).toHaveBeenCalledWith(250);
    expect(silentLogger.log.mock.calls.flat()).toEqual([
      "DB_RESET_ATTEMPT=1",
      "DB_RESET_DEADLOCK_RETRY=YES",
      "DB_RESET_RETRY_DELAY_MS=250",
      "DB_RESET_ATTEMPT=2",
      "DB_RESET_SUCCESS=YES",
    ]);
    expect(silentLogger.log.mock.calls.flat().join("\n")).not.toContain(
      "postgresql://redacted",
    );
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls.map((call) => call[1])).toEqual([
      ["scripts/migrate.mjs"],
      ["scripts/seed.mjs"],
    ]);
  });

  it("stops after four deadlocks without running migration or seed", async () => {
    const { Client, clients } = clientHarness([
      "40P01",
      "40P01",
      "40P01",
      "40P01",
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const execFile = vi.fn();

    await expect(
      resetDatabase({
        connectionString: "postgresql://redacted",
        Client: Client as never,
        sleepFn,
        logger: silentLogger,
        execFile,
      }),
    ).rejects.toMatchObject({
      message: "DB_RESET_DEADLOCK_RETRY_EXHAUSTED",
      code: "40P01",
      attempts: 4,
    });

    expect(clients).toHaveLength(4);
    expect(clients.every((client) => client.end.mock.calls.length === 1)).toBe(
      true,
    );
    expect(sleepFn.mock.calls.map((call) => call[0])).toEqual([
      250, 500, 1_000,
    ]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each(["28P01", "ECONNREFUSED"])(
    "fails fast for non-deadlock error %s",
    async (code) => {
      const { Client, clients } = clientHarness([code]);
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const execFile = vi.fn();

      await expect(
        resetDatabase({
          connectionString: "postgresql://redacted",
          Client: Client as never,
          sleepFn,
          logger: silentLogger,
          execFile,
        }),
      ).rejects.toMatchObject({ code });

      expect(clients).toHaveLength(1);
      expect(clients[0]?.end).toHaveBeenCalledOnce();
      expect(sleepFn).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
    },
  );

  it("ends every client when all reset attempts deadlock", async () => {
    const { Client, clients } = clientHarness([
      "40P01",
      "40P01",
      "40P01",
      "40P01",
    ]);

    await expect(
      resetSchemaWithRetry("postgresql://redacted", {
        Client: Client as never,
        sleepFn: vi.fn().mockResolvedValue(undefined),
        logger: silentLogger,
      }),
    ).rejects.toThrow("DB_RESET_DEADLOCK_RETRY_EXHAUSTED");

    expect(new Set(clients).size).toBe(4);
    expect(clients.every((client) => client.end.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("does not retry schema reset when migration fails", async () => {
    const { Client, clients } = clientHarness(["success"]);
    const migrationError = new Error("migration failed");
    const execFile = vi.fn(() => {
      throw migrationError;
    });

    await expect(
      resetDatabase({
        connectionString: "postgresql://redacted",
        Client: Client as never,
        sleepFn: vi.fn().mockResolvedValue(undefined),
        logger: silentLogger,
        execFile,
      }),
    ).rejects.toBe(migrationError);

    expect(clients).toHaveLength(1);
    expect(execFile).toHaveBeenCalledOnce();
  });

  it("does not retry schema reset or migration when seed fails", async () => {
    const { Client, clients } = clientHarness(["success"]);
    const seedError = new Error("seed failed");
    const execFile = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw seedError;
      });

    await expect(
      resetDatabase({
        connectionString: "postgresql://redacted",
        Client: Client as never,
        sleepFn: vi.fn().mockResolvedValue(undefined),
        logger: silentLogger,
        execFile,
      }),
    ).rejects.toBe(seedError);

    expect(clients).toHaveLength(1);
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});
