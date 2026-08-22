import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { PosModule } from "../pos/pos.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { BenefitsModule } from "../benefits/benefits.module.js";
import { StoredValueModule } from "../stored-value/stored-value.module.js";
import { CommissionService } from "./commission.service.js";
import {
  CommissionController,
  CreditNoteController,
  RefundController,
  Sprint7FinancialController,
  PaymentReconciliationController,
} from "./finance.controller.js";
import { FinancialReportingService } from "./financial-reporting.service.js";
import { RefundService } from "./refund.service.js";
import { PaymentReconciliationService } from "./payment-reconciliation.service.js";

@Module({
  imports: [
    DatabaseModule,
    BookingModule,
    IdentityModule,
    PosModule,
    BenefitsModule,
    StoredValueModule,
  ],
  controllers: [
    RefundController,
    CreditNoteController,
    CommissionController,
    Sprint7FinancialController,
    PaymentReconciliationController,
  ],
  providers: [RefundService, CommissionService, FinancialReportingService, PaymentReconciliationService],
  exports: [RefundService, CommissionService, FinancialReportingService, PaymentReconciliationService],
})
export class FinanceModule {}
