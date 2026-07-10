import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { DatabaseService } from "../../infrastructure/database.service.js";
@ApiTags("system")
@Controller()
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  @Get("health") @ApiOperation({ summary: "Liveness" }) health() {
    return {
      success: true,
      data: { status: "ok", service: "api" },
      meta: { requestId: "health", timestamp: new Date().toISOString() },
    };
  }
  @Get("ready") @ApiOperation({ summary: "Readiness" }) async ready() {
    try {
      await this.db.ping();
      return {
        success: true,
        data: { status: "ready", database: "ok" },
        meta: { requestId: "ready", timestamp: new Date().toISOString() },
      };
    } catch {
      throw new ServiceUnavailableException({
        code: "NOT_READY",
        message: "Database unavailable",
      });
    }
  }
}
