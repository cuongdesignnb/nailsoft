import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service.js";
import { AuthGuard } from "./auth.guard.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { DatabaseService } from "../../infrastructure/database.service.js";
@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in and create a device session" })
  async login(
    @Body() body: unknown,
    @Req() req: { raw: { requestId?: string }; ip?: string },
    @Headers("user-agent") ua?: string,
  ) {
    return this.ok(
      await this.auth.login(body, req.raw.requestId ?? "unknown", req.ip, ua),
      req.raw.requestId,
    );
  }
  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Rotate refresh token" })
  async refresh(
    @Body() body: unknown,
    @Req() req: { raw: { requestId?: string } },
  ) {
    return this.ok(
      await this.auth.refresh(body, req.raw.requestId ?? "unknown"),
      req.raw.requestId,
    );
  }
  @Get("sessions") @UseGuards(AuthGuard) @ApiBearerAuth() async sessions(
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.db.query(
      'SELECT id,device_id "deviceId",device_name "deviceName",platform,app_version "appVersion",last_seen_at "lastSeenAt",expires_at "expiresAt",created_at "createdAt" FROM sessions WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC',
      [req.auth.tenantId, req.auth.userId],
    );
    return this.ok(result.rows, req.raw.requestId);
  }
  @Post("sessions/:id/revoke")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  async revoke(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    await this.auth.revoke(
      req.auth.tenantId,
      req.auth.userId,
      id,
      req.raw.requestId ?? "unknown",
    );
  }
  private ok<T>(data: T, requestId = "unknown") {
    return {
      success: true,
      data,
      meta: { requestId, timestamp: new Date().toISOString() },
    };
  }
}
