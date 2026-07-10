import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "./auth.guard.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { RequirePermission } from "./permission.decorator.js";
import { PermissionGuard } from "./permission.guard.js";
import { UserService } from "./user.service.js";
@ApiTags("users")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("users")
export class UserController {
  constructor(@Inject(UserService) private readonly users: UserService) {}
  @Get() @RequirePermission("user.read") async list(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(await this.users.list(req.auth), req);
  }
  @Post() @RequirePermission("user.manage") async create(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(
      await this.users.create(req.auth, body, req.raw.requestId ?? "unknown"),
      req,
    );
  }
  @Get(":membershipId/sessions")
  @RequirePermission("session.read_tenant")
  async sessions(
    @Param("membershipId") membershipId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(await this.users.sessions(req.auth, membershipId), req);
  }
  @Patch(":membershipId/access")
  @RequirePermission("user.manage")
  async updateAccess(
    @Param("membershipId") membershipId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(
      await this.users.updateAccess(
        req.auth,
        membershipId,
        body,
        req.raw.requestId ?? "unknown",
      ),
      req,
    );
  }
  @Post(":membershipId/sessions/:sessionId/revoke")
  @HttpCode(204)
  @RequirePermission("session.revoke_tenant")
  async revokeSession(
    @Param("membershipId") membershipId: string,
    @Param("sessionId") sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.users.revokeSession(
      req.auth,
      membershipId,
      sessionId,
      req.raw.requestId ?? "unknown",
    );
  }
  @Post(":membershipId/sessions/revoke-all")
  @RequirePermission("session.revoke_tenant")
  async revokeAll(
    @Param("membershipId") membershipId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(
      await this.users.revokeAllSessions(
        req.auth,
        membershipId,
        req.raw.requestId ?? "unknown",
      ),
      req,
    );
  }
  private ok<T>(data: T, req: AuthenticatedRequest) {
    return {
      success: true,
      data,
      meta: {
        requestId: req.raw.requestId ?? "unknown",
        timestamp: new Date().toISOString(),
      },
    };
  }
}
