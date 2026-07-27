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
import { CashSessionService } from "./cash-session.service.js";
import { FinancialReportService } from "./financial-report.service.js";
import { PosService } from "./pos.service.js";
import { PaymentWebhookService } from "./payment-webhook.service.js";

const requestId = (request: AuthenticatedRequest) =>
  request.raw.requestId ?? "unknown";
const idem = (key: string | undefined) => key ?? "";
const response = (data: unknown, request: AuthenticatedRequest) => ({
  success: true,
  data,
  meta: { requestId: requestId(request), timestamp: new Date().toISOString() },
});

@ApiTags("appointment-pos")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("appointments")
export class AppointmentPosController {
  constructor(@Inject(PosService) private readonly service: PosService) {}
  @Post(":appointmentId/pos-orders")
  @RequirePermission("pos.order.create")
  async create(
    @Param("appointmentId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.createFromAppointment(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
}

@ApiTags("pos-orders")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("pos-orders")
export class PosOrderController {
  constructor(@Inject(PosService) private readonly service: PosService) {}
  @Get() @RequirePermission("pos.order.read") async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.list(request.auth, query), request);
  }
  @Get(":orderId") @RequirePermission("pos.order.read") async detail(
    @Param("orderId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.detail(request.auth, id), request);
  }
  @Get(":orderId/history") @RequirePermission("pos.order.read") async history(
    @Param("orderId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.history(request.auth, id), request);
  }
  @Get(":orderId/payments") @RequirePermission("payment.read") async payments(
    @Param("orderId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.payments(request.auth, { orderId: id }),
      request,
    );
  }
  @Post(":orderId/lines") @RequirePermission("pos.order.update") async line(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.addLine(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post(":orderId/recalculate")
  @RequirePermission("pos.order.update")
  async recalculate(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.recalculate(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post(":orderId/assign-register")
  @RequirePermission("pos.order.update")
  async assignRegister(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.assignRegister(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post(":orderId/discounts")
  @RequirePermission("pos.discount.apply")
  async discount(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.applyDiscount(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post(":orderId/tip") @RequirePermission("pos.tip.set") async tip(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.setTip(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post(":orderId/finalize")
  @RequirePermission("pos.order.finalize")
  async finalize(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.finalize(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post(":orderId/payments")
  @RequirePermission("payment.capture_cash")
  async pay(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.pay(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post(":orderId/void") @RequirePermission("pos.order.void") async void(
    @Param("orderId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.void(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
}

@ApiTags("discount-approvals")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("pos-discount-approvals")
export class PosDiscountApprovalController {
  constructor(@Inject(PosService) private readonly service: PosService) {}
  @Post(":approvalId/approve")
  @RequirePermission("pos.discount.approve")
  async approve(
    @Param("approvalId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.approveDiscount(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
}

@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("payments")
export class PaymentController {
  constructor(@Inject(PosService) private readonly service: PosService) {}
  @Get() @RequirePermission("payment.read") async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.payments(request.auth, query), request);
  }
  @Get(":paymentId") @RequirePermission("payment.read") async detail(
    @Param("paymentId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.payment(request.auth, id), request);
  }
}

@ApiTags("invoices")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("invoices")
export class InvoiceController {
  constructor(@Inject(PosService) private readonly service: PosService) {}
  @Get() @RequirePermission("invoice.read") async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.invoices(request.auth, query), request);
  }
  @Get(":invoiceId") @RequirePermission("invoice.read") async detail(
    @Param("invoiceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.invoice(request.auth, id), request);
  }
  @Get(":invoiceId/print") @RequirePermission("invoice.print") async print(
    @Param("invoiceId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.printInvoice(request.auth, id), request);
  }
  @Post(":invoiceId/deliver")
  @RequirePermission("invoice.deliver")
  async deliver(
    @Param("invoiceId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.deliverInvoice(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
}

@ApiTags("cash-sessions")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class CashSessionController {
  constructor(
    @Inject(CashSessionService) private readonly service: CashSessionService,
  ) {}
  @Get("pos-registers") @RequirePermission("cash_session.read") async registers(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.registers(request.auth, query), request);
  }
  @Get("cash-sessions") @RequirePermission("cash_session.read") async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.list(request.auth, query), request);
  }
  @Post("cash-sessions/open")
  @RequirePermission("cash_session.open")
  async open(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.open(
        request.auth,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Get("cash-sessions/:sessionId")
  @RequirePermission("cash_session.read")
  async detail(
    @Param("sessionId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.detail(request.auth, id), request);
  }
  @Get("cash-sessions/:sessionId/closing-review")
  @RequirePermission("cash_session.approve_variance")
  async closingReview(
    @Param("sessionId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.closingReview(request.auth, id),
      request,
    );
  }
  @Get("cash-sessions/:sessionId/movements")
  @RequirePermission("cash_session.read")
  async movements(
    @Param("sessionId") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.movements(request.auth, id), request);
  }
  @Post("cash-sessions/:sessionId/movements")
  @RequirePermission("cash_session.move_cash")
  async move(
    @Param("sessionId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.move(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post("cash-sessions/:sessionId/begin-closing")
  @RequirePermission("cash_session.begin_close")
  async begin(
    @Param("sessionId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.beginClosing(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post("cash-sessions/:sessionId/declare")
  @RequirePermission("cash_session.declare")
  async declare(
    @Param("sessionId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.declare(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post("cash-sessions/:sessionId/reopen")
  @RequirePermission("cash_session.reopen")
  async reopen(
    @Param("sessionId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.reopen(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
  @Post("cash-sessions/:sessionId/close")
  @RequirePermission("cash_session.close")
  async close(
    @Param("sessionId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(
      await this.service.close(
        request.auth,
        id,
        body,
        idem(key),
        requestId(request),
      ),
      request,
    );
  }
}

@ApiTags("financial")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("financial")
export class FinancialController {
  constructor(
    @Inject(FinancialReportService)
    private readonly service: FinancialReportService,
  ) {}
  @Get("reconciliation/daily")
  @RequirePermission("financial.reconciliation.read")
  async daily(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return response(await this.service.daily(request.auth, query), request);
  }
  @Get("summary") @RequirePermission("financial.summary.read") async summary(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return response(await this.service.summary(request.auth, query), request);
  }
}

@ApiTags("payment-webhooks")
@Controller("payment-providers")
export class PaymentWebhookController {
  constructor(
    @Inject(PaymentWebhookService)
    private readonly service: PaymentWebhookService,
  ) {}
  @Post(":provider/webhook") async receive(
    @Param("provider") provider: string,
    @Headers("x-provider-signature") signature: string | undefined,
    @Headers("x-provider-timestamp") timestamp: string | undefined,
    @Headers("x-provider-event-id") eventId: string | undefined,
    @Req() request: any,
  ) {
    const data = await this.service.receive(provider, {
      rawBody: request.rawBody,
      signature,
      timestamp,
      eventId,
    });
    return { received: data.received, duplicate: data.duplicate };
  }
}
