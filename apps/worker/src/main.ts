import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadRuntimeConfig } from "@nailsoft/config";
import { WorkerModule } from "./worker.module.js";

async function bootstrap() {
  const config = loadRuntimeConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ["error", "warn", "log"] });
  const shutdown = async (signal: string) => {
    process.stdout.write(JSON.stringify({ event: "worker.shutdown", signal, commitSha: config.COMMIT_SHA }) + "\n");
    await app.close();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  await app.init();
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(JSON.stringify({ event: "worker.startup_failed", message: error instanceof Error ? error.message : "unknown" }) + "\n");
  process.exitCode = 1;
});
