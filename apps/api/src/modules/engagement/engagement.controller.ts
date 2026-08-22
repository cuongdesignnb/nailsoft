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
import { createHash } from "node:crypto";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import {
  RequireAnyPermission,
  RequirePermission,
} from "../identity/permission.decorator.js";
import { CommunicationService } from "./communication.service.js";
import { MarketingService } from "./marketing.service.js";
import { ReviewRecoveryService } from "./review-recovery.service.js";
import { verifyPublicToken } from "./engagement-domain.js";

const rid = (r: any) => r.raw?.requestId ?? "unknown",
  key = (v?: string) => v ?? "",
  ok = (data: unknown, r?: any) => ({
    success: true,
    data,
    meta: {
      requestId: r ? rid(r) : "public",
      timestamp: new Date().toISOString(),
    },
  });

@ApiTags("customer-communication")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class CommunicationController {
  constructor(
    @Inject(CommunicationService) private readonly s: CommunicationService,
  ) {}
  @Get("customers/:customerId/communication-preferences")
  @RequirePermission("communication.preference.read")
  async preferences(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.preferences(r.auth, id), r);
  }
  @Post("customers/:customerId/communication-preferences/update")
  @RequirePermission("communication.preference.manage")
  async updatePreferences(
    @Param("customerId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.updatePreferences(r.auth, id, b, key(k), rid(r)), r);
  }
  @Get("customers/:customerId/consents")
  @RequirePermission("communication.consent.read")
  async consents(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.consents(r.auth, id), r);
  }
  @Post("customers/:customerId/consents/grant")
  @RequirePermission("communication.consent.capture")
  async grant(
    @Param("customerId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.consent(r.auth, id, "GRANT", b, key(k), rid(r)), r);
  }
  @Post("customers/:customerId/consents/withdraw")
  @RequirePermission("communication.consent.withdraw")
  async withdraw(
    @Param("customerId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.consent(r.auth, id, "WITHDRAW", b, key(k), rid(r)),
      r,
    );
  }

  @Get("communications/templates")
  @RequirePermission("communication.template.read")
  async templates(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.templates(r.auth), r);
  }
  @Get("communications/templates/marketing-versions")
  @RequirePermission("communication.template.read")
  async marketingTemplateVersions(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.marketingTemplateVersions(r.auth), r);
  }
  @Post("communications/templates")
  @RequirePermission("communication.template.manage")
  async createTemplate(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createTemplate(r.auth, b, key(k), rid(r)), r);
  }
  @Get("communications/templates/:templateId")
  @RequirePermission("communication.template.read")
  async template(
    @Param("templateId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.template(r.auth, id), r);
  }
  @Post("communications/templates/:templateId/versions")
  @RequirePermission("communication.template.manage")
  async version(
    @Param("templateId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.addTemplateVersion(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("communications/templates/:templateId/versions/:versionId/activate")
  @RequirePermission("communication.template.manage")
  async activateVersion(
    @Param("templateId") id: string,
    @Param("versionId") version: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.activateTemplateVersion(r.auth, id, version, key(k), rid(r)),
      r,
    );
  }
  @Post("communications/templates/:templateId/deactivate")
  @RequirePermission("communication.template.manage")
  async deactivateTemplate(
    @Param("templateId") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.deactivateTemplate(r.auth, id, key(k), rid(r)), r);
  }

  @Get("communications/rules")
  @RequirePermission("communication.rule.read")
  async rules(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.rules(r.auth), r);
  }
  @Post("communications/rules")
  @RequirePermission("communication.rule.manage")
  async createRule(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createRule(r.auth, b, key(k), rid(r)), r);
  }
  @Post("communications/rules/:id/activate")
  @RequirePermission("communication.rule.manage")
  async activateRule(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.ruleStatus(r.auth, id, "ACTIVE", key(k), rid(r)), r);
  }
  @Post("communications/rules/:id/pause")
  @RequirePermission("communication.rule.manage")
  async pauseRule(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.ruleStatus(r.auth, id, "PAUSED", key(k), rid(r)), r);
  }
  @Post("communications/rules/:id/deactivate")
  @RequirePermission("communication.rule.manage")
  async deactivateRule(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.ruleStatus(r.auth, id, "INACTIVE", key(k), rid(r)),
      r,
    );
  }

  @Get("communications/messages")
  @RequirePermission("communication.message.read")
  async messages(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.messages(r.auth), r);
  }
  @Get("communications/messages/:id")
  @RequirePermission("communication.message.read")
  async message(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.message(r.auth, id), r);
  }
  @Get("communications/messages/:id/attempts")
  @RequirePermission("communication.message.read")
  async attempts(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.attempts(r.auth, id), r);
  }
  @Post("communications/messages/:id/retry")
  @RequirePermission("communication.message.retry")
  async retry(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.retryMessage(r.auth, id, key(k), rid(r)), r);
  }
  @Get("internal-notifications")
  @RequirePermission("communication.internal.read")
  async internal(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.internal(r.auth), r);
  }
  @Post("internal-notifications/:id/read")
  @RequirePermission("communication.internal.read")
  async read(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.internalStatus(r.auth, id, "READ", key(k), rid(r)),
      r,
    );
  }
  @Post("internal-notifications/:id/dismiss")
  @RequirePermission("communication.internal.read")
  async dismiss(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.internalStatus(r.auth, id, "DISMISSED", key(k), rid(r)),
      r,
    );
  }
}

@ApiTags("customer-self-engagement")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("customer/me")
export class CustomerSelfEngagementController {
  constructor(
    @Inject(CommunicationService) private readonly s: CommunicationService,
  ) {}
  private async customer(r: AuthenticatedRequest) {
    return this.s.ownCustomerId(r.auth);
  }
  @Get("communication-preferences") async preferences(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.preferences(r.auth, await this.customer(r)), r);
  }
  @Post("communication-preferences/update") async update(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.updatePreferences(
        r.auth,
        await this.customer(r),
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("consents") async consents(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.consents(r.auth, await this.customer(r)), r);
  }
  @Post("consents/grant") async grant(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.consent(
        r.auth,
        await this.customer(r),
        "GRANT",
        { ...(b as any), source: "CUSTOMER_PORTAL" },
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("consents/withdraw") async withdraw(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.consent(
        r.auth,
        await this.customer(r),
        "WITHDRAW",
        { ...(b as any), source: "CUSTOMER_PORTAL" },
        key(k),
        rid(r),
      ),
      r,
    );
  }
}

@ApiTags("marketing")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class MarketingController {
  constructor(@Inject(MarketingService) private readonly s: MarketingService) {}
  @Get("customer-segments")
  @RequirePermission("marketing.segment.read")
  async segments(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.segments(r.auth), r);
  }
  @Post("customer-segments")
  @RequirePermission("marketing.segment.manage")
  async createSegment(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createSegment(r.auth, b, key(k), rid(r)), r);
  }
  @Get("customer-segments/:id")
  @RequirePermission("marketing.segment.read")
  async segment(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.segment(r.auth, id), r);
  }
  @Post("customer-segments/:id/update")
  @RequirePermission("marketing.segment.manage")
  async updateSegment(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.updateSegment(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("customer-segments/:id/preview")
  @RequirePermission("marketing.segment.read")
  async previewSegment(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.previewSegment(r.auth, id), r);
  }
  @Post("customer-segments/:id/activate")
  @RequirePermission("marketing.segment.manage")
  async activateSegment(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.segmentStatus(r.auth, id, "ACTIVE", key(k), rid(r)),
      r,
    );
  }
  @Post("customer-segments/:id/deactivate")
  @RequirePermission("marketing.segment.manage")
  async deactivateSegment(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.segmentStatus(r.auth, id, "INACTIVE", key(k), rid(r)),
      r,
    );
  }
  @Get("marketing/overview")
  @RequirePermission("marketing.campaign.read")
  async marketingOverview(
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.marketingOverview(r.auth, q), r);
  }
  @Get("marketing-campaigns/create-context")
  @RequirePermission("marketing.campaign.create")
  async campaignCreateContext(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.campaignCreateContext(r.auth), r);
  }
  @Get("marketing-campaigns")
  @RequirePermission("marketing.campaign.read")
  async campaigns(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.campaigns(r.auth), r);
  }
  @Get("marketing-campaigns/directory")
  @RequirePermission("marketing.campaign.read")
  async campaignDirectory(
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.campaignDirectory(r.auth, q), r);
  }
  @Post("marketing-campaigns")
  @RequirePermission("marketing.campaign.create")
  async createCampaign(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createCampaign(r.auth, b, key(k), rid(r)), r);
  }
  @Get("marketing-campaigns/:id")
  @RequirePermission("marketing.campaign.read")
  async campaign(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.campaign(r.auth, id), r);
  }
  @Get("marketing-campaigns/:id/overview")
  @RequirePermission("marketing.campaign.read")
  async campaignOverview(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.campaignOverview(r.auth, id), r);
  }
  @Post("marketing-campaigns/:id/update")
  @RequirePermission("marketing.campaign.create")
  async updateCampaign(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.updateCampaign(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("marketing-campaigns/:id/preview")
  @RequirePermission("marketing.campaign.read")
  async previewCampaign(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.previewCampaign(r.auth, id), r);
  }
  @Post("marketing-campaigns/:id/submit")
  @RequirePermission("marketing.campaign.create")
  async submit(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transition(
        r.auth,
        id,
        "PENDING_APPROVAL",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("marketing-campaigns/:id/approve")
  @RequirePermission("marketing.campaign.approve")
  async approve(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transition(r.auth, id, "APPROVED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("marketing-campaigns/:id/schedule")
  @RequirePermission("marketing.campaign.schedule")
  async schedule(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transition(r.auth, id, "SCHEDULED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("marketing-campaigns/:id/pause")
  @RequirePermission("marketing.campaign.schedule")
  async pause(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transition(r.auth, id, "PAUSED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("marketing-campaigns/:id/resume")
  @RequirePermission("marketing.campaign.schedule")
  async resume(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transition(r.auth, id, "RUNNING", b, key(k), rid(r)),
      r,
    );
  }
  @Post("marketing-campaigns/:id/cancel")
  @RequirePermission("marketing.campaign.cancel")
  async cancel(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transition(r.auth, id, "CANCELLED", b, key(k), rid(r)),
      r,
    );
  }
  @Get("marketing-campaigns/:id/audience")
  @RequirePermission("marketing.campaign.read")
  async audience(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.audience(r.auth, id), r);
  }
  @Get("marketing-campaigns/:id/report")
  @RequirePermission("marketing.report.read")
  async report(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.report(r.auth, id), r);
  }
}

@ApiTags("reviews-recovery")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class ReviewRecoveryController {
  constructor(
    @Inject(ReviewRecoveryService) private readonly s: ReviewRecoveryService,
  ) {}
  @Get("reviews") @RequirePermission("review.read") async reviews(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.reviews(r.auth), r);
  }
  @Get("reviews/:id") @RequirePermission("review.read") async review(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.review(r.auth, id), r);
  }
  @Post("reviews/:id/publish")
  @RequirePermission("review.moderate")
  async publish(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.moderate(r.auth, id, "PUBLISHED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("reviews/:id/hide") @RequirePermission("review.moderate") async hide(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.moderate(r.auth, id, "HIDDEN", b, key(k), rid(r)),
      r,
    );
  }
  @Post("reviews/:id/flag") @RequirePermission("review.moderate") async flag(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.moderate(r.auth, id, "FLAGGED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("reviews/:id/respond")
  @RequirePermission("review.respond")
  async respond(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.respond(r.auth, id, b, key(k), rid(r)), r);
  }
  @Get("review-requests")
  @RequirePermission("review.request.manage")
  async requests(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.reviewRequests(r.auth), r);
  }
  @Post("review-requests/:id/resend")
  @RequirePermission("review.request.manage")
  async resend(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.requestStatus(r.auth, id, "PENDING", key(k), rid(r)),
      r,
    );
  }
  @Post("review-requests/:id/cancel")
  @RequirePermission("review.request.manage")
  async cancelRequest(
    @Param("id") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.requestStatus(r.auth, id, "CANCELLED", key(k), rid(r)),
      r,
    );
  }
  @Get("service-recovery/cases")
  @RequirePermission("service_recovery.read")
  async cases(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.cases(r.auth), r);
  }
  @Post("service-recovery/cases")
  @RequirePermission("service_recovery.create")
  async createCase(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createCase(r.auth, b, key(k), rid(r)), r);
  }
  @Get("service-recovery/cases/:id")
  @RequirePermission("service_recovery.read")
  async case(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.recoveryCase(r.auth, id), r);
  }
  @Post("service-recovery/cases/:id/triage")
  @RequirePermission("service_recovery.manage")
  async triage(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transitionCase(r.auth, id, "TRIAGED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("service-recovery/cases/:id/assign")
  @RequirePermission("service_recovery.assign")
  async assign(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.assign(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("service-recovery/cases/:id/start")
  @RequirePermission("service_recovery.manage")
  async start(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transitionCase(r.auth, id, "IN_PROGRESS", b, key(k), rid(r)),
      r,
    );
  }
  @Post("service-recovery/cases/:id/wait-customer")
  @RequirePermission("service_recovery.manage")
  async wait(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transitionCase(
        r.auth,
        id,
        "WAITING_CUSTOMER",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("service-recovery/cases/:id/resolve")
  @RequirePermission("service_recovery.manage")
  async resolve(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transitionCase(r.auth, id, "RESOLVED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("service-recovery/cases/:id/close")
  @RequirePermission("service_recovery.manage")
  async close(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transitionCase(r.auth, id, "CLOSED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("service-recovery/cases/:id/cancel")
  @RequirePermission("service_recovery.manage")
  async cancelCase(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transitionCase(r.auth, id, "CANCELLED", b, key(k), rid(r)),
      r,
    );
  }
  @Get("service-recovery/cases/:id/tasks")
  @RequirePermission("service_recovery.read")
  async tasks(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.tasks(r.auth, id), r);
  }
  @Get("service-recovery/tasks/me")
  @RequirePermission("service_recovery.read")
  async assignedTasks(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.assignedTasks(r.auth), r);
  }
  @Post("service-recovery/cases/:id/tasks")
  @RequireAnyPermission("service_recovery.manage", "service_recovery.assign")
  async createTask(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createTask(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("service-recovery/tasks/:id/complete")
  @RequirePermission("service_recovery.contact")
  async completeTask(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.completeTask(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("service-recovery/cases/:id/contact")
  @RequirePermission("service_recovery.contact")
  async contact(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.contact(r.auth, id, b, key(k), rid(r)), r);
  }
  @Get("service-recovery/cases/:id/compensations")
  @RequirePermission("service_recovery.read")
  async compensations(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.compensations(r.auth, id), r);
  }
  @Get("service-recovery/compensations")
  @RequirePermission("service_recovery.compensation.approve")
  async pendingCompensations(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.pendingCompensations(r.auth), r);
  }
  @Post("service-recovery/cases/:id/compensations")
  @RequirePermission("service_recovery.compensation.request")
  async requestComp(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.requestCompensation(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("service-recovery/compensations/:id/approve")
  @RequirePermission("service_recovery.compensation.approve")
  async approveComp(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.decideCompensation(
        r.auth,
        id,
        "APPROVED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("service-recovery/compensations/:id/reject")
  @RequirePermission("service_recovery.compensation.approve")
  async rejectComp(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.decideCompensation(
        r.auth,
        id,
        "REJECTED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("service-recovery/compensations/:id/cancel")
  @RequirePermission("service_recovery.compensation.request")
  async cancelComp(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.decideCompensation(
        r.auth,
        id,
        "CANCELLED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("customers/:customerId/engagement-timeline")
  @RequirePermission("customer.engagement_timeline.read")
  async timeline(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.engagementTimeline(r.auth, id), r);
  }
}

@ApiTags("public-engagement")
@Controller("public")
export class PublicEngagementController {
  constructor(
    @Inject(CommunicationService)
    private readonly communications: CommunicationService,
    @Inject(ReviewRecoveryService)
    private readonly reviews: ReviewRecoveryService,
  ) {}
  @Post("communications/unsubscribe") async unsubscribe(@Body() b: any) {
    let payload: ReturnType<typeof verifyTokenBody>;
    try {
      payload = verifyTokenBody(b.token);
    } catch {
      return ok({ accepted: true });
    }
    const tokenHash = createHash("sha256")
      .update(String(b.token))
      .digest("hex");
    const auth = {
      tenantId: payload.tenantId,
      userId: payload.customerId,
      membershipId: "public",
      authorizationVersion: 1,
      sessionId: "public",
      roles: [] as any[],
      branchIds: [],
    };
    // Persistence errors deliberately escape: a valid token must never receive
    // a false success without durable consent evidence.
    await this.communications.consent(
      auth,
      payload.customerId,
      "WITHDRAW",
      {
        purpose: payload.purpose,
        source: "UNSUBSCRIBE_LINK",
        evidence: { token: "verified" },
      },
      `unsubscribe:${tokenHash}`,
      "public-unsubscribe",
    );
    return ok({ accepted: true });
  }
  @Get("reviews/request") async request(@Query("token") token: string) {
    return ok(await this.reviews.publicReviewRequest(token));
  }
  @Post("reviews/submit") async submit(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
  ) {
    return ok(
      await this.reviews.submitPublicReview(b, key(k), "public-review"),
    );
  }
  @Post("reviews/update") async update() {
    return ok({
      accepted: false,
      code: "REVIEW_REVISION_REQUIRES_NEW_SIGNED_FLOW",
    });
  }
}

function verifyTokenBody(token: string): {
  tenantId: string;
  customerId: string;
  purpose: string;
} {
  const configuredSecret =
    process.env.COMMUNICATION_TOKEN_SECRET ?? process.env.JWT_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === "production")
    throw new Error("COMMUNICATION_TOKEN_SECRET_REQUIRED");
  const secret = configuredSecret ?? "development-only-communication-secret";
  const body = verifyPublicToken(String(token ?? ""), secret);
  if (body.purpose !== "MARKETING_EMAIL") throw new Error("invalid");
  return {
    tenantId: String(body.tenantId),
    customerId: String(body.customerId),
    purpose: String(body.purpose),
  };
}
