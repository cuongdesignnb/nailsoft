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
import { CommissionService } from "./commission.service.js";
import { FinancialReportingService } from "./financial-reporting.service.js";
import { RefundService } from "./refund.service.js";
import { PaymentReconciliationService } from "./payment-reconciliation.service.js";

const rid = (r: AuthenticatedRequest) => r.raw.requestId ?? "unknown";
const key = (value?: string) => value ?? "";
const ok = (data: unknown, r: AuthenticatedRequest) => ({
  success: true,
  data,
  meta: { requestId: rid(r), timestamp: new Date().toISOString() },
});

@ApiTags("payment-reconciliation")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("financial/reconciliation/payments")
export class PaymentReconciliationController {
  constructor(
    @Inject(PaymentReconciliationService)
    private readonly service: PaymentReconciliationService,
  ) {}

  @Get()
  @RequirePermission("financial.reconciliation.read")
  directory(@Query() query: unknown, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.directory(r.auth, query), r);
  }

  @Get(":paymentId")
  @RequirePermission("financial.reconciliation.read")
  detail(@Param("paymentId") id: string, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.detail(r.auth, id, rid(r)), r);
  }

  @Post("bulk-confirm")
  @RequirePermission("financial.reconciliation.review")
  bulkConfirm(
    @Body() body: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.bulkConfirm(r.auth, body, key(k), rid(r)),
      r,
    );
  }

  @Post(":paymentId/notes")
  @RequirePermission("financial.reconciliation.review")
  note(
    @Param("paymentId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.addNote(r.auth, id, body, key(k), rid(r)),
      r,
    );
  }

  @Post(":paymentId/decision")
  @RequirePermission("financial.reconciliation.review")
  decision(
    @Param("paymentId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.decide(r.auth, id, body, key(k), rid(r)),
      r,
    );
  }

  private async wrap(value: Promise<unknown>, r: AuthenticatedRequest) {
    return ok(await value, r);
  }
}

@ApiTags("refunds")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class RefundController {
  constructor(@Inject(RefundService) private readonly service: RefundService) {}
  @Post("invoices/:invoiceId/refund-plans")
  @RequirePermission("refund.request")
  plan(
    @Param("invoiceId") id: string,
    @Body() body: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.plan(r.auth, id, body), r);
  }
  @Post("invoices/:invoiceId/refunds")
  @RequirePermission("refund.request")
  create(
    @Param("invoiceId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.create(r.auth, id, body, key(k), rid(r)), r);
  }
  @Get("refunds") @RequirePermission("refund.read") list(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.list(r.auth, q), r);
  }
  @Get("refunds/directory") @RequirePermission("refund.read") directory(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.directory(r.auth, q), r);
  }
  @Get("refunds/:id") @RequirePermission("refund.read") detail(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.detail(r.auth, id), r);
  }
  @Get("refunds/:id/history") @RequirePermission("refund.read") history(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.historyList(r.auth, id), r);
  }
  @Get("refunds/:id/attempts")
  @RequirePermission("refund.view_provider_metadata")
  attempts(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.attempts(r.auth, id), r);
  }
  @Post("refunds/:id/submit") @RequirePermission("refund.request") submit(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.submit(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("refunds/:id/approve") @RequirePermission("refund.approve") approve(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.approve(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("refunds/:id/reject") @RequirePermission("refund.reject") reject(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.reject(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("refunds/:id/cancel") @RequirePermission("refund.cancel") cancel(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.cancel(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("refunds/:id/execute-cash")
  @RequirePermission("refund.execute_cash")
  cash(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.executeCash(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("refunds/:id/execute-external")
  @RequirePermission("refund.execute_external")
  external(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.executeExternal(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("refunds/:id/retry")
  @RequirePermission("refund.execute_external")
  retry(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.retry(r.auth, id, b, key(k), rid(r)), r);
  }
  private async wrap(value: Promise<unknown>, r: AuthenticatedRequest) {
    return ok(await value, r);
  }
}

@ApiTags("credit-notes")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("credit-notes")
export class CreditNoteController {
  constructor(
    @Inject(FinancialReportingService)
    private readonly service: FinancialReportingService,
  ) {}
  @Get() @RequirePermission("credit_note.read") list(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.creditNotes(r.auth, q), r);
  }
  @Get("directory") @RequirePermission("credit_note.read") directory(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.creditNoteDirectory(r.auth, q), r);
  }
  @Get(":id") @RequirePermission("credit_note.read") detail(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.creditNote(r.auth, id), r);
  }
  @Get(":id/print") @RequirePermission("credit_note.print") print(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.print(r.auth, id), r);
  }
  @Post(":id/deliver") @RequirePermission("credit_note.deliver") deliver(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.deliver(r.auth, id, b, key(k), rid(r)), r);
  }
  private async wrap(value: Promise<unknown>, r: AuthenticatedRequest) {
    return ok(await value, r);
  }
}

@ApiTags("commission")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class CommissionController {
  constructor(
    @Inject(CommissionService) private readonly service: CommissionService,
  ) {}
  @Get("commission-rules") @RequirePermission("commission.rule.read") rules(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.rules(r.auth, q), r);
  }
  @Post("commission-rules")
  @RequirePermission("commission.rule.manage")
  createRule(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.createRule(r.auth, b, key(k), rid(r)), r);
  }
  @Get("commission-rules/:id") @RequirePermission("commission.rule.read") rule(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.rule(r.auth, id), r);
  }
  @Post("commission-rules/:id/supersede")
  @RequirePermission("commission.rule.manage")
  supersede(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.supersedeRule(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("commission-rules/:id/deactivate")
  @RequirePermission("commission.rule.manage")
  deactivate(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.deactivateRule(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Get("commission-entries")
  @RequirePermission("commission.entry.read_branch")
  entries(@Query() q: any, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.entries(r.auth, q), r);
  }
  @Get("commission-entries/:id")
  @RequirePermission("commission.entry.read_branch")
  entry(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.entry(r.auth, id), r);
  }
  @Get("staff/:staffId/commissions")
  @RequirePermission("commission.entry.read_branch")
  staff(
    @Param("staffId") id: string,
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.entries(r.auth, { ...q, staffId: id }), r);
  }
  @Get("staff/me/commissions")
  @RequirePermission("commission.entry.read_own")
  own(@Query() q: any, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.entries(r.auth, q, true), r);
  }
  @Get("staff/me/tips") @RequirePermission("commission.entry.read_own") tips(
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.ownTips(r.auth), r);
  }
  @Get("commission-periods")
  @RequirePermission("commission.period.read")
  periods(@Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.periods(r.auth), r);
  }
  @Post("commission-periods")
  @RequirePermission("commission.period.manage")
  createPeriod(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.createPeriod(r.auth, b, key(k), rid(r)), r);
  }
  @Get("commission-periods/:id")
  @RequirePermission("commission.period.read")
  period(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.period(r.auth, id), r);
  }
  @Get("commission-periods/:id/overview")
  @RequirePermission("financial.commission_report.read")
  overview(
    @Param("id") id: string,
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.overview(r.auth, id, q), r);
  }
  @Get("commission-periods/:id/staff-directory")
  @RequirePermission("financial.commission_report.read")
  staffDirectory(
    @Param("id") id: string,
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.staffDirectory(r.auth, id, q), r);
  }
  @Get("commission-periods/:id/staff/:staffId/overview")
  @RequirePermission("financial.commission_report.read")
  staffOverview(
    @Param("id") id: string,
    @Param("staffId") staffId: string,
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.staffOverview(r.auth, id, staffId, q), r);
  }
  @Post("commission-periods/:id/start-review")
  @RequirePermission("commission.period.manage")
  review(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.startReview(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("commission-periods/:id/reopen-review")
  @RequirePermission("commission.period.manage")
  reopen(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.reopenReview(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("commission-periods/:id/lock")
  @RequirePermission("commission.period.lock")
  lock(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.lock(r.auth, id, b, key(k), rid(r)), r);
  }
  @Get("commission-periods/:id/statements")
  @RequirePermission("commission.period.read")
  statements(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.statements(r.auth, id), r);
  }
  @Get("commission-periods/:id/staff/:staffId/statement")
  @RequirePermission("commission.period.read")
  statement(
    @Param("id") id: string,
    @Param("staffId") staffId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.statement(r.auth, id, staffId), r);
  }
  @Get("commission-adjustments")
  @RequirePermission("commission.adjustment.request")
  adjustments(@Query() q: any, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.adjustments(r.auth, q), r);
  }
  @Post("commission-adjustments")
  @RequirePermission("commission.adjustment.request")
  adjustment(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.createAdjustment(r.auth, b, key(k), rid(r)),
      r,
    );
  }
  @Post("commission-adjustments/:id/approve")
  @RequirePermission("commission.adjustment.approve")
  approveAdjustment(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.decideAdjustment(r.auth, id, b, true, key(k), rid(r)),
      r,
    );
  }
  @Post("commission-adjustments/:id/reject")
  @RequirePermission("commission.adjustment.approve")
  rejectAdjustment(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.decideAdjustment(r.auth, id, b, false, key(k), rid(r)),
      r,
    );
  }
  @Post("commission-adjustments/:id/cancel")
  @RequirePermission("commission.adjustment.request")
  cancelAdjustment(
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(
      this.service.cancelAdjustment(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  private async wrap(value: Promise<unknown>, r: AuthenticatedRequest) {
    return ok(await value, r);
  }
}

@ApiTags("financial-reporting")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("financial")
export class Sprint7FinancialController {
  constructor(
    @Inject(FinancialReportingService)
    private readonly service: FinancialReportingService,
  ) {}
  @Get("refunds") @RequirePermission("financial.refund_report.read") refunds(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.refunds(r.auth, q), r);
  }
  @Get("net-sales") @RequirePermission("financial.refund_report.read") net(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.netSales(r.auth, q), r);
  }
  @Get("net-sales/overview") @RequirePermission("financial.refund_report.read") netSalesOverview(
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.netSalesOverview(r.auth, q), r);
  }
  @Get("tax-adjustments")
  @RequirePermission("financial.refund_report.read")
  tax(@Query() q: any, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.taxAdjustments(r.auth, q), r);
  }
  @Get("tip-summary") @RequirePermission("financial.refund_report.read") tips(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.tipSummary(r.auth, q), r);
  }
  @Get("commission-liability")
  @RequirePermission("financial.commission_report.read")
  liability(@Query() q: any, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.commissionLiability(r.auth, q), r);
  }
  @Get("commission-by-staff")
  @RequirePermission("financial.commission_report.read")
  staff(@Query() q: any, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.commissionByStaff(r.auth, q), r);
  }
  @Get("commission-by-service")
  @RequirePermission("financial.commission_report.read")
  serviceReport(@Query() q: any, @Req() r: AuthenticatedRequest) {
    return this.wrap(this.service.commissionByService(r.auth, q), r);
  }
  @Get("credit-notes") @RequirePermission("financial.refund_report.read") notes(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.creditNoteReport(r.auth, q), r);
  }
  @Post("exports") @RequirePermission("financial.export") create(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.createExport(r.auth, b, key(k), rid(r)), r);
  }
  @Get("exports/:id") @RequirePermission("financial.export") export(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.wrap(this.service.export(r.auth, id), r);
  }
  private async wrap(value: Promise<unknown>, r: AuthenticatedRequest) {
    return ok(await value, r);
  }
}
