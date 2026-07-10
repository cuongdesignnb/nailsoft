import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequirePermission } from "../identity/permission.decorator.js";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { OrganizationService } from "./organization.service.js";
@ApiTags("organization")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class OrganizationController {
  constructor(
    @Inject(OrganizationService) private readonly service: OrganizationService,
  ) {}
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
  @Get("organization") @RequirePermission("organization.read") async tenant(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(await this.service.tenant(req.auth), req);
  }
  @Patch("organization")
  @RequirePermission("organization.update")
  async updateTenant(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.ok(
      await this.service.updateTenant(
        req.auth,
        body,
        req.raw.requestId ?? "unknown",
      ),
      req,
    );
  }
  @Get("branches") @RequirePermission("branch.read") async branches(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(await this.service.branches(req.auth), req);
  }
  @Post("branches") @RequirePermission("branch.create") async create(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(
      await this.service.createBranch(
        req.auth,
        body,
        req.raw.requestId ?? "unknown",
      ),
      req,
    );
  }
  @Get("branches/:id") @RequirePermission("branch.read") async branch(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(await this.service.branch(req.auth, id), req);
  }
  @Patch("branches/:id") @RequirePermission("branch.update") async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(
      await this.service.updateBranch(
        req.auth,
        id,
        body,
        req.raw.requestId ?? "unknown",
      ),
      req,
    );
  }
  @Get("branches/:id/business-hours")
  @RequirePermission("branch.read")
  async hours(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.ok(await this.service.hours(req.auth, id), req);
  }
  @Put("branches/:id/business-hours")
  @RequirePermission("branch.manage_hours")
  async updateHours(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ok(
      await this.service.updateHours(
        req.auth,
        id,
        body,
        req.raw.requestId ?? "unknown",
      ),
      req,
    );
  }
}
