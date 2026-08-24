import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequirePermission } from "../identity/permission.decorator.js";
import { MarketingAttributionService } from "./marketing-attribution.service.js";

const requestId = (request: AuthenticatedRequest) => request.raw?.requestId ?? "unknown";
const ok = (data: unknown, request: AuthenticatedRequest) => ({
  success: true,
  data,
  meta: { requestId: requestId(request), timestamp: new Date().toISOString() },
});

@ApiTags("marketing-attribution")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class MarketingAttributionController {
  constructor(
    @Inject(MarketingAttributionService)
    private readonly service: MarketingAttributionService,
  ) {}

  @Post("marketing-campaigns/:campaignId/audience/:recipientId/attribution-context")
  @RequirePermission("marketing.attribution.issue")
  async issueContext(
    @Param("campaignId") campaignId: string,
    @Param("recipientId") recipientId: string,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(
      await this.service.issueContext(
        request.auth,
        campaignId,
        recipientId,
        key ?? "",
        requestId(request),
      ),
      request,
    );
  }

  @Get("marketing-campaigns/:campaignId/attribution")
  @RequirePermission("marketing.attribution.read")
  async campaign(
    @Param("campaignId") campaignId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(await this.service.campaignSummary(request.auth, campaignId), request);
  }

  @Get("appointments/:appointmentId/marketing-attribution")
  @RequirePermission("marketing.attribution.read")
  async appointment(
    @Param("appointmentId") appointmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return ok(await this.service.appointmentSummary(request.auth, appointmentId), request);
  }
}
