import {
  Controller,
  Get,
  Header,
  Inject,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { loadRuntimeConfig } from "@nailsoft/config";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { ObservabilityService } from "./observability.service.js";

@ApiTags("system")
@Controller()
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Optional() @Inject(ObservabilityService) private readonly observability?: ObservabilityService,
  ) {}

  private envelope(data: Record<string, unknown>) {
    return { success: true, data, meta: { requestId: "system", timestamp: new Date().toISOString() } };
  }

  @Get("health")
  @ApiOperation({ summary: "Liveness (legacy alias)" })
  health() {
    return this.live();
  }

  @Get("health/live")
  @ApiOperation({ summary: "Liveness probe" })
  live() {
    return this.envelope({ status: "ok", service: "api" });
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness (legacy alias)" })
  ready() {
    return this.readiness();
  }

  @Get("health/ready")
  @ApiOperation({ summary: "Readiness probe" })
  async readiness() {
    try {
      await this.db.ping();
      return this.envelope({ status: "ready", database: "ok" });
    } catch {
      throw new ServiceUnavailableException({ code: "NOT_READY", message: "Database unavailable" });
    }
  }

  @Get("health/startup")
  @ApiOperation({ summary: "Startup configuration probe" })
  startup() {
    try {
      const config = loadRuntimeConfig();
      return this.envelope({ status: "started", environment: config.NODE_ENV, version: config.APP_VERSION });
    } catch {
      throw new ServiceUnavailableException({ code: "NOT_STARTED", message: "Runtime configuration unavailable" });
    }
  }

  @Get("version")
  @ApiOperation({ summary: "Build and migration version" })
  async version() {
    const config = loadRuntimeConfig();
    let migrationVersion = "unknown";
    try {
      const result = await this.db.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1");
      migrationVersion = result.rows[0]?.version ?? "none";
    } catch {
      // Version remains safe to expose even when the database is not ready.
    }
    return this.envelope({ appVersion: config.APP_VERSION, commitSha: config.COMMIT_SHA, buildTimestamp: config.BUILD_TIMESTAMP, apiVersion: config.API_VERSION, migrationVersion });
  }

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  @ApiOperation({ summary: "Prometheus metrics" })
  metrics() {
    return this.observability?.renderPrometheus() ?? "# metrics unavailable\n";
  }
}
