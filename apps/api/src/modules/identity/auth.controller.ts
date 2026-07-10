import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Authenticate global identity" })
  async login(
    @Body() body: unknown,
    @Req() req: { raw: { requestId?: string }; ip?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("user-agent") ua?: string,
  ) {
    const data = await this.auth.login(
      body,
      req.raw.requestId ?? "unknown",
      req.ip,
      ua,
    );
    return this.ok(this.secureWebTokens(data, body, reply), req.raw.requestId);
  }
  @Post("select-workspace")
  @HttpCode(200)
  @ApiOperation({ summary: "Select an active tenant membership" })
  async selectWorkspace(
    @Body() body: unknown,
    @Req() req: { raw: { requestId?: string }; ip?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("user-agent") ua?: string,
  ) {
    const data = await this.auth.selectWorkspace(
      body,
      req.raw.requestId ?? "unknown",
      req.ip,
      ua,
    );
    return this.ok(this.secureWebTokens(data, body, reply), req.raw.requestId);
  }
  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Rotate refresh token" })
  async refresh(
    @Body() body: unknown,
    @Req() req: FastifyRequest & { raw: { requestId?: string }; ip?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("x-csrf-token") csrfHeader?: string,
  ) {
    const parsed =
      typeof body === "object" && body !== null
        ? { ...(body as Record<string, unknown>) }
        : {};
    const cookieToken = req.cookies?.refreshToken;
    if (cookieToken) {
      if (!csrfHeader || csrfHeader !== req.cookies?.csrfToken)
        throw new ForbiddenException({
          code: "CSRF_VALIDATION_FAILED",
          message: "CSRF token is invalid",
        });
      parsed.refreshToken = cookieToken;
    }
    const data = await this.auth.refresh(
      parsed,
      req.raw.requestId ?? "unknown",
      req.ip,
    );
    return this.ok(
      this.secureWebTokens(
        data,
        { platform: cookieToken ? "web" : undefined },
        reply,
      ),
      req.raw.requestId,
    );
  }
  @Get("sessions") @UseGuards(AuthGuard) @ApiBearerAuth() async sessions(
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.db.query(
      'SELECT id,device_id "deviceId",device_name "deviceName",platform,app_version "appVersion",last_seen_at "lastSeenAt",expires_at "expiresAt",created_at "createdAt" FROM device_sessions WHERE membership_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC',
      [req.auth.membershipId, req.auth.userId],
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
  @Post("logout")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.auth.revoke(
      req.auth.tenantId,
      req.auth.userId,
      req.auth.sessionId,
      req.raw.requestId ?? "unknown",
    );
    reply.clearCookie("refreshToken", { path: "/v1/auth" });
    reply.clearCookie("csrfToken", { path: "/" });
  }
  private secureWebTokens<T>(
    data: T,
    input: unknown,
    reply: FastifyReply,
  ): T | Omit<T, "refreshToken"> {
    const platform =
      typeof input === "object" && input !== null && "platform" in input
        ? (input as { platform?: unknown }).platform
        : undefined;
    if (
      platform !== "web" ||
      typeof data !== "object" ||
      data === null ||
      !("refreshToken" in data) ||
      typeof data.refreshToken !== "string"
    )
      return data;
    const csrf = randomUUID();
    reply.setCookie("refreshToken", data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/v1/auth",
      maxAge: 2592000,
    });
    reply.setCookie("csrfToken", csrf, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 2592000,
    });
    const safe = { ...data } as T & { refreshToken?: unknown };
    delete safe.refreshToken;
    return safe as Omit<T, "refreshToken">;
  }
  private ok<T>(data: T, requestId = "unknown") {
    return {
      success: true,
      data,
      meta: { requestId, timestamp: new Date().toISOString() },
    };
  }
}
