import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { BenefitsCatalogService } from "./benefits-catalog.service.js";
import { BenefitsEligibilityService } from "./benefits-eligibility.service.js";
import { BenefitsReportingService } from "./benefits-reporting.service.js";
import { BenefitsTransactionService } from "./benefits-transaction.service.js";
import {
  AppointmentBenefitsController,
  BenefitsReportController,
  CustomerWalletController,
  LoyaltyController,
  MembershipController,
  PackageController,
  PosBenefitsController,
  PublicPackageController,
  VoucherCampaignController,
  VoucherCodeController,
  VoucherWalletController,
} from "./benefits.controller.js";

@Module({
  imports: [DatabaseModule, IdentityModule, BookingModule],
  controllers: [
    VoucherCampaignController,
    VoucherCodeController,
    VoucherWalletController,
    LoyaltyController,
    MembershipController,
    PackageController,
    PosBenefitsController,
    AppointmentBenefitsController,
    CustomerWalletController,
    BenefitsReportController,
    PublicPackageController,
  ],
  providers: [
    BenefitsCatalogService,
    BenefitsEligibilityService,
    BenefitsTransactionService,
    BenefitsReportingService,
  ],
  exports: [
    BenefitsEligibilityService,
    BenefitsTransactionService,
    BenefitsCatalogService,
    BenefitsReportingService,
  ],
})
export class BenefitsModule {}
