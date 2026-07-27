import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { PosModule } from "../pos/pos.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { BenefitsModule } from "../benefits/benefits.module.js";
import { CommissionService } from "./commission.service.js";
import {
  CommissionController,
  CreditNoteController,
  RefundController,
  Sprint7FinancialController,
} from "./finance.controller.js";
import { FinancialReportingService } from "./financial-reporting.service.js";
import { RefundService } from "./refund.service.js";

@Module({
  imports: [
    DatabaseModule,
    BookingModule,
    IdentityModule,
    PosModule,
    BenefitsModule,
  ],
  controllers: [
    RefundController,
    CreditNoteController,
    CommissionController,
    Sprint7FinancialController,
  ],
  providers: [RefundService, CommissionService, FinancialReportingService],
  exports: [RefundService, CommissionService, FinancialReportingService],
})
export class FinanceModule {}
