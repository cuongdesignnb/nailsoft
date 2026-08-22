import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { BenefitsCatalogService } from "./benefits-catalog.service.js";
import { BenefitsEligibilityService } from "./benefits-eligibility.service.js";
import { BenefitsReportingService } from "./benefits-reporting.service.js";
import { MembershipHubReportingService } from "./membership-hub-reporting.service.js";
import { PackageHubReportingService } from "./package-hub-reporting.service.js";
import { BenefitsTransactionService } from "./benefits-transaction.service.js";
import { LoyaltyLedgerReportingService } from "./loyalty-ledger-reporting.service.js";
import { VoucherHubReportingService } from "./voucher-hub-reporting.service.js";
import {
  AppointmentBenefitsController,
  BenefitsReportController,
  CustomerBenefitsController,
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
    CustomerBenefitsController,
    PublicPackageController,
  ],
  providers: [
    BenefitsCatalogService,
    BenefitsEligibilityService,
    BenefitsTransactionService,
    BenefitsReportingService,
    MembershipHubReportingService,
    PackageHubReportingService,
    LoyaltyLedgerReportingService,
    VoucherHubReportingService,
  ],
  exports: [
    BenefitsEligibilityService,
    BenefitsTransactionService,
    BenefitsCatalogService,
    BenefitsReportingService,
    MembershipHubReportingService,
    PackageHubReportingService,
    LoyaltyLedgerReportingService,
    VoucherHubReportingService,
  ],
})
export class BenefitsModule {}
