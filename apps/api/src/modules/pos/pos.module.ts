import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { BenefitsModule } from "../benefits/benefits.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { CashSessionService } from "./cash-session.service.js";
import { FinancialEvidenceService } from "./financial-evidence.service.js";
import { FinancialReportService } from "./financial-report.service.js";
import { PaymentWebhookService } from "./payment-webhook.service.js";
import { PosPricingService } from "./pos-pricing.service.js";
import { PosService } from "./pos.service.js";
import { RegisterDeviceAuthorizationService } from "./register-device-authorization.service.js";
import {
  AppointmentPosController,
  CashSessionController,
  FinancialController,
  InvoiceController,
  PaymentController,
  PaymentWebhookController,
  PosDiscountApprovalController,
  PosOrderController,
} from "./pos.controller.js";

@Module({
  imports: [DatabaseModule, IdentityModule, BookingModule, BenefitsModule],
  controllers: [
    AppointmentPosController,
    PosOrderController,
    PosDiscountApprovalController,
    PaymentController,
    InvoiceController,
    CashSessionController,
    FinancialController,
    PaymentWebhookController,
  ],
  providers: [
    PosPricingService,
    FinancialEvidenceService,
    RegisterDeviceAuthorizationService,
    PosService,
    CashSessionService,
    FinancialReportService,
    PaymentWebhookService,
  ],
  exports: [FinancialEvidenceService, RegisterDeviceAuthorizationService],
})
export class PosModule {}
