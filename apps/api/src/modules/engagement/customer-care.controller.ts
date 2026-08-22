/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequirePermission } from "../identity/permission.decorator.js";
import { CustomerCareService } from "./customer-care.service.js";

const requestId = (request: any) => request.raw?.requestId ?? "unknown";
const idempotencyKey = (value?: string) => value ?? "";
const ok = (data: unknown, request: AuthenticatedRequest) => ({
  success: true,
  data,
  meta: {
    requestId: requestId(request),
    timestamp: new Date().toISOString(),
  },
});

@ApiTags("customer-care")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class CustomerCareController {
  constructor(
    @Inject(CustomerCareService) private readonly service: CustomerCareService,
  ) {}

  @Get("customer-care/overview")
  @RequirePermission("customer.care.read")
  async overview(
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(await this.service.overview(request.auth, query), request);
  }

  @Get("customer-care/directory")
  @RequirePermission("customer.care.read")
  async directory(
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(await this.service.directory(request.auth, query), request);
  }

  @Get("customer-care/followups")
  @RequirePermission("customer.care.read")
  async followups(
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(await this.service.followups(request.auth, query), request);
  }

  @Get("customer-care/activity/:sourceType/:sourceId")
  @RequirePermission("customer.care.read")
  async activityDetail(
    @Param("sourceType") sourceType: string,
    @Param("sourceId") sourceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(
      await this.service.activityDetail(request.auth, sourceType, sourceId),
      request,
    );
  }

  @Post("customer-care/activities")
  @RequirePermission("customer.care.manage")
  async createActivity(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(
      await this.service.createActivity(
        request.auth,
        body,
        idempotencyKey(key),
        requestId(request),
      ),
      request,
    );
  }

  @Post("customer-care/followups")
  @RequirePermission("customer.care.followup.manage")
  async createFollowup(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(
      await this.service.createFollowup(
        request.auth,
        body,
        idempotencyKey(key),
        requestId(request),
      ),
      request,
    );
  }

  @Post("customer-care/followups/:id/complete")
  @RequirePermission("customer.care.followup.manage")
  async completeFollowup(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(
      await this.service.completeFollowup(
        request.auth,
        id,
        body,
        idempotencyKey(key),
        requestId(request),
      ),
      request,
    );
  }

  @Post("customer-care/followups/:id/cancel")
  @RequirePermission("customer.care.followup.manage")
  async cancelFollowup(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(
      await this.service.cancelFollowup(
        request.auth,
        id,
        body,
        idempotencyKey(key),
        requestId(request),
      ),
      request,
    );
  }
}
