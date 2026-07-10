import {
  Body,
  Controller,
  Get,
  Inject,
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
