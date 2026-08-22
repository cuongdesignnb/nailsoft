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
import {
  RequireAnyPermission,
  RequirePermission,
} from "../identity/permission.decorator.js";
import { BenefitsCatalogService } from "./benefits-catalog.service.js";
import { BenefitsReportingService } from "./benefits-reporting.service.js";
import { MembershipHubReportingService } from "./membership-hub-reporting.service.js";
import { PackageHubReportingService } from "./package-hub-reporting.service.js";
import { BenefitsTransactionService } from "./benefits-transaction.service.js";
import { LoyaltyLedgerReportingService } from "./loyalty-ledger-reporting.service.js";
import { VoucherHubReportingService } from "./voucher-hub-reporting.service.js";

const requestId = (r: any) => r.raw?.requestId ?? "unknown",
  key = (v: string | undefined) => v ?? "";
const ok = (data: unknown, r: any) => ({
  success: true,
  data,
  meta: { requestId: requestId(r), timestamp: new Date().toISOString() },
});

@ApiTags("voucher-campaigns")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("voucher-campaigns")
export class VoucherCampaignController {
  constructor(
    @Inject(BenefitsCatalogService) private readonly s: BenefitsCatalogService,
  ) {}
  @Get() @RequirePermission("voucher.campaign.read") async list(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.campaigns(r.auth), r);
  }
  @Post() @RequirePermission("voucher.campaign.manage") async create(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createCampaign(r.auth, b, key(k), requestId(r)), r);
  }
  @Get(":campaignId") @RequirePermission("voucher.campaign.read") async detail(
    @Param("campaignId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.campaign(r.auth, id), r);
  }
  @Post(":campaignId/activate")
  @RequirePermission("voucher.campaign.manage")
  async activate(
    @Param("campaignId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.campaignStatus(
        r.auth,
        id,
        "ACTIVE",
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
  @Post(":campaignId/pause")
  @RequirePermission("voucher.campaign.manage")
  async pause(
    @Param("campaignId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.campaignStatus(
        r.auth,
        id,
        "PAUSED",
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
  @Post(":campaignId/end")
  @RequirePermission("voucher.campaign.manage")
  async end(
    @Param("campaignId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.campaignStatus(r.auth, id, "ENDED", b, key(k), requestId(r)),
      r,
    );
  }
  @Post(":campaignId/codes")
  @RequirePermission("voucher.code.issue")
  async issue(
    @Param("campaignId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.issueCode(r.auth, id, b, key(k), requestId(r)), r);
  }
  @Post(":campaignId/codes/batch")
  @RequirePermission("voucher.code.issue")
  async batch(
    @Param("campaignId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.batchCodes(r.auth, id, b, key(k), requestId(r)), r);
  }
}
@ApiTags("voucher-codes")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("voucher-codes")
export class VoucherCodeController {
  constructor(
    @Inject(BenefitsCatalogService) private readonly s: BenefitsCatalogService,
    @Inject(VoucherHubReportingService)
    private readonly hub: VoucherHubReportingService,
  ) {}
  @Get("directory") @RequirePermission("voucher.code.read") async directory(
    @Query() query: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.hub.directory(r.auth, query), r);
  }
  @Get("overview") @RequirePermission("voucher.code.read") async overview(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.hub.overview(r.auth), r);
  }
  @Get(":voucherCodeId/overview")
  @RequirePermission("voucher.code.read")
  async overviewDetail(
    @Param("voucherCodeId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.hub.overviewDetail(r.auth, id), r);
  }
  @Post(":voucherCodeId/eligibility-preview")
  @RequirePermission("benefit.eligibility.read")
  async eligibilityPreview(
    @Param("voucherCodeId") id: string,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.hub.eligibilityPreview(r.auth, id, b), r);
  }
  @Get() @RequirePermission("voucher.code.read") async list(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.codes(r.auth), r);
  }
  @Get(":voucherCodeId") @RequirePermission("voucher.code.read") async detail(
    @Param("voucherCodeId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.code(r.auth, id), r);
  }
  @Post(":voucherCodeId/assign-customer")
  @RequirePermission("voucher.code.assign")
  async assign(
    @Param("voucherCodeId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.assignCode(r.auth, id, b, key(k), requestId(r)), r);
  }
  @Post(":voucherCodeId/cancel")
  @RequirePermission("voucher.code.cancel")
  async cancel(
    @Param("voucherCodeId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.cancelCode(r.auth, id, b, key(k), requestId(r)), r);
  }
}
@ApiTags("vouchers")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class VoucherWalletController {
  constructor(
    @Inject(BenefitsCatalogService) private readonly s: BenefitsCatalogService,
    @Inject(BenefitsTransactionService)
    private readonly t: BenefitsTransactionService,
    @Inject(PackageHubReportingService)
    private readonly reporting: PackageHubReportingService,
  ) {}
  @Get("customers/:customerId/vouchers")
  @RequirePermission("voucher.code.read")
  async customer(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.customerVouchers(r.auth, id), r);
  }
  @Post("vouchers/validate")
  @RequirePermission("benefit.eligibility.read")
  async validate(@Body() b: unknown, @Req() r: AuthenticatedRequest) {
    return ok(await this.t.validateVoucher(r.auth, b), r);
  }
}

@ApiTags("loyalty")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class LoyaltyController {
  constructor(
    @Inject(BenefitsCatalogService) private readonly s: BenefitsCatalogService,
    @Inject(LoyaltyLedgerReportingService)
    private readonly ledgerReporting: LoyaltyLedgerReportingService,
  ) {}
  @Get("loyalty-programs")
  @RequirePermission("loyalty.program.read")
  async programs(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.programs(r.auth), r);
  }
  @Post("loyalty-programs")
  @RequirePermission("loyalty.program.manage")
  async create(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createProgram(r.auth, b, key(k), requestId(r)), r);
  }
  @Get("loyalty-programs/:programId")
  @RequirePermission("loyalty.program.read")
  async program(
    @Param("programId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.program(r.auth, id), r);
  }
  @Post("loyalty-programs/:programId/supersede")
  @RequirePermission("loyalty.program.manage")
  async supersede(
    @Param("programId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.supersedeProgram(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("loyalty-programs/:programId/deactivate")
  @RequirePermission("loyalty.program.manage")
  async deactivate(
    @Param("programId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.deactivateProgram(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Get("customers/:customerId/loyalty")
  @RequirePermission("loyalty.account.read")
  async account(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.loyalty(r.auth, id), r);
  }
  @Get("customers/:customerId/loyalty/ledger")
  @RequirePermission("loyalty.ledger.read")
  async ledger(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.loyaltyLedger(r.auth, id), r);
  }
  @Get("customers/:customerId/loyalty/overview")
  @RequirePermission("loyalty.account.read")
  async loyaltyOverview(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.ledgerReporting.overview(r.auth, id), r);
  }
  @Get("customers/:customerId/loyalty/ledger/directory")
  @RequirePermission("loyalty.ledger.read")
  async loyaltyLedgerDirectory(
    @Param("customerId") id: string,
    @Query() query: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.ledgerReporting.directory(r.auth, id, query), r);
  }
  @Get("customers/:customerId/loyalty/ledger/:entryId")
  @RequirePermission("loyalty.ledger.read")
  async loyaltyLedgerDetail(
    @Param("customerId") customerId: string,
    @Param("entryId") entryId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.ledgerReporting.detail(r.auth, customerId, entryId), r);
  }
  @Post("loyalty-adjustments")
  @RequirePermission("loyalty.adjustment.request")
  async adjustment(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.createAdjustment(r.auth, b, key(k), requestId(r)),
      r,
    );
  }
  @Get("loyalty-adjustments")
  @RequireAnyPermission(
    "loyalty.adjustment.request",
    "loyalty.adjustment.approve",
  )
  async adjustments(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.adjustments(r.auth), r);
  }
  @Post("loyalty-adjustments/:id/approve")
  @RequirePermission("loyalty.adjustment.approve")
  async approve(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustmentDecision(
        r.auth,
        id,
        "APPROVED",
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
  @Post("loyalty-adjustments/:id/reject")
  @RequirePermission("loyalty.adjustment.approve")
  async reject(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustmentDecision(
        r.auth,
        id,
        "REJECTED",
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
  @Post("loyalty-adjustments/:id/cancel")
  @RequirePermission("loyalty.adjustment.request")
  async cancel(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustmentDecision(
        r.auth,
        id,
        "CANCELLED",
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
}

@ApiTags("membership")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class MembershipController {
  constructor(
    @Inject(BenefitsCatalogService) private readonly s: BenefitsCatalogService,
    @Inject(MembershipHubReportingService)
    private readonly hub: MembershipHubReportingService,
  ) {}
  @Get("memberships/overview")
  @RequirePermission("membership.assignment.read")
  async overview(@Req() r: AuthenticatedRequest) {
    return ok(await this.hub.overview(r.auth), r);
  }
  @Get("memberships/directory")
  @RequirePermission("membership.assignment.read")
  async directory(
    @Query() query: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.hub.directory(r.auth, query), r);
  }
  @Get("customers/:customerId/membership/summary")
  @RequirePermission("membership.assignment.read")
  async summary(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.hub.summary(r.auth, id), r);
  }
  @Get("membership-tiers")
  @RequirePermission("membership.tier.read")
  async tiers(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.tiers(r.auth), r);
  }
  @Post("membership-tiers")
  @RequirePermission("membership.tier.manage")
  async create(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createTier(r.auth, b, key(k), requestId(r)), r);
  }
  @Get("membership-tiers/:tierId")
  @RequirePermission("membership.tier.read")
  async tier(@Param("tierId") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.tier(r.auth, id), r);
  }
  @Post("membership-tiers/:tierId/supersede")
  @RequirePermission("membership.tier.manage")
  async supersede(
    @Param("tierId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.supersedeTier(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("membership-tiers/:tierId/deactivate")
  @RequirePermission("membership.tier.manage")
  async deactivate(
    @Param("tierId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.deactivateTier(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Get("customers/:customerId/membership")
  @RequirePermission("membership.assignment.read")
  async current(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.membership(r.auth, id), r);
  }
  @Post("customers/:customerId/membership/assign")
  @RequirePermission("membership.assignment.manage")
  async assign(
    @Param("customerId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.assignMembership(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("customers/:customerId/membership/revoke")
  @RequirePermission("membership.assignment.manage")
  async revoke(
    @Param("customerId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.revokeMembership(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("customers/:customerId/membership/evaluate")
  @RequirePermission("membership.evaluate")
  async evaluate(
    @Param("customerId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.evaluateMembership(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
}

@ApiTags("service-packages")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class PackageController {
  constructor(
    @Inject(BenefitsCatalogService) private readonly s: BenefitsCatalogService,
    @Inject(BenefitsTransactionService)
    private readonly t: BenefitsTransactionService,
    @Inject(PackageHubReportingService)
    private readonly reporting: PackageHubReportingService,
  ) {}
  @Get("service-packages")
  @RequirePermission("package.catalog.read")
  async list(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.packages(r.auth), r);
  }
  @Post("service-packages")
  @RequirePermission("package.catalog.manage")
  async create(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createPackage(r.auth, b, key(k), requestId(r)), r);
  }
  @Get("service-packages/:packageId")
  @RequirePermission("package.catalog.read")
  async detail(@Param("packageId") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.package(r.auth, id), r);
  }
  @Post("service-packages/:packageId/activate")
  @RequirePermission("package.catalog.manage")
  async activate(
    @Param("packageId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.packageStatus(r.auth, id, "ACTIVE", b, key(k), requestId(r)),
      r,
    );
  }
  @Post("service-packages/:packageId/supersede")
  @RequirePermission("package.catalog.manage")
  async supersede(
    @Param("packageId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.supersedePackage(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("service-packages/:packageId/deactivate")
  @RequirePermission("package.catalog.manage")
  async deactivate(
    @Param("packageId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.packageStatus(
        r.auth,
        id,
        "INACTIVE",
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
  @Get("customers/:customerId/packages")
  @RequirePermission("package.entitlement.read")
  async customer(
    @Param("customerId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.customerPackages(r.auth, id), r);
  }
  @Post("customers/:customerId/packages/issue")
  @RequirePermission("package.entitlement.issue")
  async issue(
    @Param("customerId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.issuePackage(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Get("customer-packages/overview")
  @RequirePermission("package.entitlement.read")
  async overview(@Req() r: AuthenticatedRequest) {
    return ok(await this.reporting.overview(r.auth), r);
  }
  @Get("customer-packages/directory")
  @RequirePermission("package.entitlement.read")
  async directory(@Query() q: unknown, @Req() r: AuthenticatedRequest) {
    return ok(await this.reporting.directory(r.auth, q), r);
  }
  @Get("customer-packages/:entitlementId/overview")
  @RequirePermission("package.entitlement.read")
  async entitlementOverview(
    @Param("entitlementId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.reporting.entitlementOverview(r.auth, id), r);
  }
  @Get("customer-packages/:entitlementId")
  @RequirePermission("package.entitlement.read")
  async entitlement(
    @Param("entitlementId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.entitlement(r.auth, id), r);
  }
  @Get("customer-packages/:entitlementId/ledger")
  @RequirePermission("package.entitlement.read")
  async ledger(
    @Param("entitlementId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.entitlementLedger(r.auth, id), r);
  }
  @Post("customer-packages/:entitlementId/adjustments")
  @RequirePermission("package.entitlement.adjust")
  async adjust(
    @Param("entitlementId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustPackage(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("customer-packages/:entitlementId/reservations")
  @RequirePermission("package.reserve")
  async reserve(
    @Param("entitlementId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.createEntitlementReservation(
        r.auth,
        id,
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
  @Post("package-reservations/:reservationId/release")
  @RequirePermission("benefit.release")
  async release(
    @Param("reservationId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.releasePackage(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Get("package-reservations/:reservationId")
  @RequirePermission("package.entitlement.read")
  async reservation(
    @Param("reservationId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.t.packageReservation(r.auth, id), r);
  }
}

@ApiTags("pos-benefits")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("pos-orders/:orderId/benefits")
export class PosBenefitsController {
  constructor(
    @Inject(BenefitsTransactionService)
    private readonly t: BenefitsTransactionService,
  ) {}
  @Get("eligibility")
  @RequirePermission("benefit.eligibility.read")
  async eligibility(
    @Param("orderId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.t.orderEligibility(r.auth, id), r);
  }
  @Get() @RequirePermission("benefit.eligibility.read") async benefits(
    @Param("orderId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.t.orderBenefits(r.auth, id), r);
  }
  @Post("voucher") @RequirePermission("benefit.apply") async voucher(
    @Param("orderId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.applyVoucher(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("loyalty") @RequirePermission("benefit.apply") async loyalty(
    @Param("orderId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.applyLoyalty(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("membership") @RequirePermission("benefit.apply") async membership(
    @Param("orderId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.applyMembership(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post("package") @RequirePermission("benefit.apply") async package(
    @Param("orderId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.applyPackage(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post(":applicationId/release")
  @RequirePermission("benefit.release")
  async release(
    @Param("orderId") id: string,
    @Param("applicationId") app: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.releaseApplication(r.auth, id, app, b, key(k), requestId(r)),
      r,
    );
  }
}

@ApiTags("appointment-benefits")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("appointments/:appointmentId")
export class AppointmentBenefitsController {
  constructor(
    @Inject(BenefitsTransactionService)
    private readonly t: BenefitsTransactionService,
  ) {}
  @Get("benefits")
  @RequirePermission("package.entitlement.read")
  async benefits(
    @Param("appointmentId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.t.appointmentBenefits(r.auth, id), r);
  }
  @Post("package-reservations")
  @RequirePermission("package.reserve")
  async reserve(
    @Param("appointmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.createAppointmentReservation(
        r.auth,
        id,
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
  @Post("package-reservations/:reservationId/release")
  @RequirePermission("benefit.release")
  async release(
    @Param("reservationId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.t.releasePackage(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
}

@ApiTags("customer-wallet")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("customer/me")
export class CustomerWalletController {
  constructor(
    @Inject(BenefitsCatalogService) private readonly s: BenefitsCatalogService,
  ) {}
  @Get("benefits")
  @RequireAnyPermission("loyalty.account.read", "package.entitlement.read")
  async wallet(@Req() r: AuthenticatedRequest) {
    const id = await this.s.ownCustomer(r.auth);
    return ok(await this.s.wallet(r.auth, id), r);
  }
  @Get("loyalty") @RequirePermission("loyalty.account.read") async loyalty(
    @Req() r: AuthenticatedRequest,
  ) {
    const id = await this.s.ownCustomer(r.auth);
    return ok(await this.s.loyalty(r.auth, id), r);
  }
  @Get("membership")
  @RequirePermission("membership.assignment.read")
  async membership(@Req() r: AuthenticatedRequest) {
    const id = await this.s.ownCustomer(r.auth);
    return ok(await this.s.membership(r.auth, id), r);
  }
  @Get("packages")
  @RequirePermission("package.entitlement.read")
  async packages(@Req() r: AuthenticatedRequest) {
    const id = await this.s.ownCustomer(r.auth);
    return ok(await this.s.customerPackages(r.auth, id), r);
  }
}

@ApiTags("benefit-reports")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("benefits")
export class BenefitsReportController {
  constructor(
    @Inject(BenefitsReportingService)
    private readonly s: BenefitsReportingService,
  ) {}
  @Get("reports/vouchers")
  @RequirePermission("benefit.report.read")
  async vouchers(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.vouchers(r.auth), r);
  }
  @Get("reports/loyalty")
  @RequirePermission("benefit.report.read")
  async loyalty(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.loyalty(r.auth), r);
  }
  @Get("reports/membership")
  @RequirePermission("benefit.report.read")
  async membership(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.membership(r.auth), r);
  }
  @Get("reports/packages")
  @RequirePermission("benefit.report.read")
  async packages(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.packages(r.auth), r);
  }
  @Get("reports/liability")
  @RequirePermission("benefit.liability.read")
  async liability(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.liability(r.auth), r);
  }
  @Get("reports/expiring")
  @RequirePermission("benefit.report.read")
  async expiring(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.expiring(r.auth), r);
  }
  @Get("customer-directory")
  @RequirePermission("benefit.report.read")
  async customerDirectory(
    @Query() query: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.customerDirectory(r.auth, query), r);
  }
  @Post("exports") @RequirePermission("benefit.report.read") async create(
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createExport(r.auth, b), r);
  }
  @Get("exports/:exportId")
  @RequirePermission("benefit.report.read")
  async export(@Param("exportId") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.export(r.auth, id), r);
  }
}

@ApiTags("customer-benefits")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("customers")
export class CustomerBenefitsController {
  constructor(
    @Inject(BenefitsReportingService)
    private readonly s: BenefitsReportingService,
  ) {}

  @Get(":customerId/benefits/summary")
  @RequirePermission("benefit.report.read")
  async summary(
    @Param("customerId") customerId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.customerBenefitSummary(r.auth, customerId), r);
  }
}

@ApiTags("public-customer-packages")
@Controller("public/salons/:salonSlug")
export class PublicPackageController {
  constructor(
    @Inject(BenefitsTransactionService)
    private readonly t: BenefitsTransactionService,
  ) {}
  @Get("customer-packages") async packages(
    @Param("salonSlug") slug: string,
    @Headers("authorization") a: string,
    @Req() r: any,
  ) {
    return ok(
      await this.t.publicPackages(
        slug,
        String(a ?? "").replace(/^Bearer\s+/i, ""),
      ),
      r,
    );
  }
  @Post("package-reservations") async reserve(
    @Param("salonSlug") slug: string,
    @Headers("authorization") a: string,
    @Headers("idempotency-key") k: string,
    @Body() b: unknown,
    @Req() r: any,
  ) {
    return ok(
      await this.t.publicReserve(
        slug,
        String(a ?? "").replace(/^Bearer\s+/i, ""),
        b,
        key(k),
        requestId(r),
      ),
      r,
    );
  }
}
