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
import {
  RequireAnyPermission,
  RequirePermission,
} from "../identity/permission.decorator.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { GiftCardReportingService } from "./gift-card-reporting.service.js";
import { CustomerCreditReportingService } from "./customer-credit-reporting.service.js";
import { StoredValueService } from "./stored-value.service.js";

const requestId = (request: AuthenticatedRequest) =>
  request.raw.requestId ?? "unknown";
const response = (data: unknown, request: AuthenticatedRequest) => ({
  success: true,
  data,
  meta: { requestId: requestId(request), timestamp: new Date().toISOString() },
});

@ApiBearerAuth()
@ApiTags("stored-value")
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class StoredValueController {
  constructor(
    @Inject(StoredValueService) private readonly service: StoredValueService,
    @Inject(GiftCardReportingService)
    private readonly reporting: GiftCardReportingService,
    @Inject(CustomerCreditReportingService)
    private readonly customerCreditReporting: CustomerCreditReportingService,
  ) {}

  @Get("customer/me/gift-cards")
  @RequirePermission("gift_card.read")
  async ownCards(@Req() request: AuthenticatedRequest) {
    return response(await this.service.ownGiftCards(request.auth), request);
  }

  @Get("customer/me/customer-credit")
  @RequirePermission("customer_credit.read")
  async ownCredit(@Req() request: AuthenticatedRequest) {
    return response(
      await this.service.ownCustomerCredit(request.auth),
      request,
    );
  }

  @Get("customer/me/stored-value-history")
  @RequireAnyPermission("gift_card.ledger.read", "customer_credit.ledger.read")
  async ownHistory(@Req() request: AuthenticatedRequest) {
    return response(
      await this.service.ownStoredValueHistory(request.auth),
      request,
    );
  }

  @Get("stored-value/legal-policies")
  @RequirePermission("stored_value.legal_policy.read")
  async legalPolicies(@Req() request: AuthenticatedRequest) {
    return response(await this.service.legalPolicies(request.auth), request);
  }

  @Post("stored-value/legal-policies")
  @RequirePermission("stored_value.legal_policy.manage")
  async createLegalPolicy(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.createLegalPolicy(
        request.auth,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("stored-value/legal-policies/:id/approve")
  @RequirePermission("stored_value.legal_policy.manage")
  async approveLegalPolicy(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.approveLegalPolicy(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Get("gift-card-products")
  @RequirePermission("gift_card.product.read")
  async products(@Req() request: AuthenticatedRequest) {
    return response(await this.service.products(request.auth), request);
  }

  @Post("gift-card-products")
  @RequirePermission("gift_card.product.manage")
  async createProduct(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.createProduct(
        request.auth,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Get("gift-card-products/:productId")
  @RequirePermission("gift_card.product.read")
  async product(
    @Param("productId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.product(request.auth, id), request);
  }

  @Post("gift-card-products/:productId/activate")
  @RequirePermission("gift_card.product.manage")
  async activateProduct(
    @Param("productId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.productStatus(
        request.auth,
        id,
        "ACTIVE",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("gift-card-products/:productId/deactivate")
  @RequirePermission("gift_card.product.manage")
  async deactivateProduct(
    @Param("productId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.productStatus(
        request.auth,
        id,
        "INACTIVE",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("gift-card-products/:productId/supersede")
  @RequirePermission("gift_card.product.manage")
  async supersedeProduct(
    @Param("productId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.supersedeProduct(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Get("gift-cards")
  @RequirePermission("gift_card.read")
  async cards(@Req() request: AuthenticatedRequest) {
    return response(await this.service.giftCards(request.auth), request);
  }

  @Get("gift-cards/directory")
  @RequirePermission("gift_card.read")
  async cardDirectory(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.reporting.directory(request.auth, query), request);
  }

  @Get("gift-cards/overview")
  @RequirePermission("gift_card.read")
  async cardOverview(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.reporting.overview(request.auth, query), request);
  }

  @Post("gift-cards/lookup")
  @RequireAnyPermission(
    "gift_card.read",
    "gift_card.balance.read",
    "stored_value.reserve",
  )
  async lookup(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return response(
      await this.service.lookup(request.auth, body, requestId(request)),
      request,
    );
  }

  @Get("gift-cards/:giftCardId/overview")
  @RequirePermission("gift_card.read")
  async cardOverviewById(
    @Param("giftCardId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.reporting.cardOverview(request.auth, id), request);
  }

  @Get("gift-cards/:giftCardId/ledger/directory")
  @RequirePermission("gift_card.read")
  async cardLedgerDirectory(
    @Param("giftCardId") id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.reporting.ledgerDirectory(request.auth, id, query), request);
  }

  @Get("gift-cards/:giftCardId")
  @RequirePermission("gift_card.read")
  async card(
    @Param("giftCardId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.giftCard(request.auth, id), request);
  }

  @Get("gift-cards/:giftCardId/balance")
  @RequirePermission("gift_card.balance.read")
  async balance(
    @Param("giftCardId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.balance(request.auth, id), request);
  }

  @Get("gift-cards/:giftCardId/ledger")
  @RequirePermission("gift_card.ledger.read")
  async ledger(
    @Param("giftCardId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.ledger(request.auth, id), request);
  }

  @Post("gift-cards/:giftCardId/suspend")
  @RequirePermission("gift_card.suspend")
  async suspend(
    @Param("giftCardId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.cardCommand(
        request.auth,
        id,
        "SUSPENDED",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("gift-cards/:giftCardId/reactivate")
  @RequirePermission("gift_card.activate")
  async reactivate(
    @Param("giftCardId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.cardCommand(
        request.auth,
        id,
        "ACTIVE",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("gift-cards/:giftCardId/cancel")
  @RequirePermission("gift_card.cancel")
  async cancel(
    @Param("giftCardId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.cardCommand(
        request.auth,
        id,
        "CANCELLED",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("gift-cards/:giftCardId/replace")
  @RequirePermission("gift_card.replace")
  async replace(
    @Param("giftCardId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.replaceCard(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("gift-cards/:giftCardId/reload")
  @RequirePermission("gift_card.reload")
  async reload(
    @Param("giftCardId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.reloadCard(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("pos-orders/:orderId/gift-card-reload-lines")
  @RequirePermission("gift_card.reload")
  async addGiftCardReloadLine(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.addGiftCardReloadLine(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("pos-orders/:orderId/gift-card-lines")
  @RequirePermission("gift_card.issue")
  async addGiftCardLine(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.addGiftCardLine(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("pos-orders/:orderId/gift-card-lines/:lineId/update")
  @RequirePermission("gift_card.issue")
  async updateGiftCardLine(
    @Param("orderId") id: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.updateGiftCardLine(
        request.auth,
        id,
        lineId,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("pos-orders/:orderId/gift-card-lines/:lineId/remove")
  @RequirePermission("gift_card.issue")
  async removeGiftCardLine(
    @Param("orderId") id: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.removeGiftCardLine(
        request.auth,
        id,
        lineId,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Get("pos-orders/:orderId/stored-value/eligibility")
  @RequirePermission("stored_value.eligibility.read")
  async eligibility(
    @Param("orderId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.eligibility(request.auth, id), request);
  }

  @Get("pos-orders/:orderId/stored-value")
  @RequireAnyPermission(
    "stored_value.eligibility.read",
    "stored_value.reserve",
    "stored_value.redeem",
  )
  async applications(
    @Param("orderId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.orderApplications(request.auth, id),
      request,
    );
  }

  @Post("pos-orders/:orderId/stored-value/gift-card")
  @RequirePermission("stored_value.reserve")
  async reserveGiftCard(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.reserveGiftCard(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("pos-orders/:orderId/stored-value/customer-credit")
  @RequirePermission("stored_value.reserve")
  async reserveCredit(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.reserveCustomerCredit(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("pos-orders/:orderId/stored-value/:applicationId/release")
  @RequirePermission("stored_value.release")
  async release(
    @Param("orderId") id: string,
    @Param("applicationId") applicationId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.releaseApplication(
        request.auth,
        id,
        applicationId,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Get("customers/:customerId/customer-credit")
  @RequirePermission("customer_credit.read")
  async credit(
    @Param("customerId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.customerCredit(request.auth, id),
      request,
    );
  }

  @Get("customer-credit")
  @RequirePermission("customer_credit.read")
  async credits(@Req() request: AuthenticatedRequest) {
    return response(await this.service.customerCredits(request.auth), request);
  }

  @Get("customer-credit/directory")
  @RequirePermission("customer_credit.read")
  async creditDirectory(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.customerCreditReporting.directory(request.auth, query),
      request,
    );
  }

  @Get("customer-credit/overview")
  @RequirePermission("customer_credit.read")
  async creditOverview(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.customerCreditReporting.overview(request.auth, query),
      request,
    );
  }

  @Get("customer-credit/accounts/:accountId/overview")
  @RequirePermission("customer_credit.read")
  async creditAccountOverview(
    @Param("accountId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.customerCreditReporting.accountOverview(request.auth, id),
      request,
    );
  }

  @Get("customer-credit/accounts/:accountId/ledger/directory")
  @RequirePermission("customer_credit.ledger.read")
  async creditAccountLedgerDirectory(
    @Param("accountId") id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.customerCreditReporting.ledgerDirectory(request.auth, id, query),
      request,
    );
  }

  @Get("customers/:customerId/customer-credit/ledger")
  @RequirePermission("customer_credit.ledger.read")
  async creditLedger(
    @Param("customerId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.customerCreditLedger(request.auth, id),
      request,
    );
  }

  @Get("stored-value-adjustments")
  @RequireAnyPermission(
    "customer_credit.adjustment.request",
    "customer_credit.adjustment.approve",
  )
  async adjustments(@Req() request: AuthenticatedRequest) {
    return response(await this.service.adjustments(request.auth), request);
  }

  @Post("stored-value-adjustments")
  @RequirePermission("customer_credit.adjustment.request")
  async createAdjustment(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.createAdjustment(
        request.auth,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("stored-value-adjustments/:id/approve")
  @RequirePermission("customer_credit.adjustment.approve")
  async approveAdjustment(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.adjustmentDecision(
        request.auth,
        id,
        "APPROVED",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("stored-value-adjustments/:id/reject")
  @RequirePermission("customer_credit.adjustment.approve")
  async rejectAdjustment(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.adjustmentDecision(
        request.auth,
        id,
        "REJECTED",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("stored-value-adjustments/:id/cancel")
  @RequirePermission("customer_credit.adjustment.request")
  async cancelAdjustment(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.adjustmentDecision(
        request.auth,
        id,
        "CANCELLED",
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Post("refunds/:refundId/stored-value-plan")
  @RequireAnyPermission("gift_card.read", "customer_credit.issue_from_refund")
  async refundPlan(
    @Param("refundId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.refundPlan(request.auth, id), request);
  }

  @Get("refunds/:refundId/stored-value")
  @RequireAnyPermission("gift_card.read", "customer_credit.issue_from_refund")
  async refundStoredValue(
    @Param("refundId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.refundPlan(request.auth, id), request);
  }

  @Post("refunds/:refundId/issue-customer-credit")
  @RequirePermission("customer_credit.issue_from_refund")
  async issueRefundCredit(
    @Param("refundId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.issueRefundCustomerCredit(
        request.auth,
        id,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Get("stored-value/reports/:kind")
  @RequireAnyPermission(
    "stored_value.report.read",
    "stored_value.liability.read",
    "stored_value.reconciliation.read",
  )
  async report(
    @Param("kind") kind: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.report(request.auth, kind), request);
  }

  @Post("stored-value/exports")
  @RequirePermission("stored_value.export")
  async createExport(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.createExport(
        request.auth,
        body,
        key,
        requestId(request),
      ),
      request,
    );
  }

  @Get("stored-value/exports/:exportId")
  @RequirePermission("stored_value.export")
  async exportJob(
    @Param("exportId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.exportJob(request.auth, id), request);
  }
}
