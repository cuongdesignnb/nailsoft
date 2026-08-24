import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BenefitsModule } from "../benefits/benefits.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { MarketingAttributionModule } from "../marketing-attribution/marketing-attribution.module.js";
import { StoredValueModule } from "../stored-value/stored-value.module.js";
import { CommunicationService } from "./communication.service.js";
import { MarketingService } from "./marketing.service.js";
import { ReviewRecoveryService } from "./review-recovery.service.js";
import { CustomerCareController } from "./customer-care.controller.js";
import { CustomerCareService } from "./customer-care.service.js";
import {
  CommunicationController,
  CustomerSelfEngagementController,
  MarketingController,
  PublicEngagementController,
  ReviewRecoveryController,
} from "./engagement.controller.js";

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    BookingModule,
    BenefitsModule,
    StoredValueModule,
    MarketingAttributionModule,
  ],
  controllers: [
    CommunicationController,
    CustomerSelfEngagementController,
    MarketingController,
    ReviewRecoveryController,
    PublicEngagementController,
    CustomerCareController,
  ],
  providers: [
    CommunicationService,
    MarketingService,
    ReviewRecoveryService,
    CustomerCareService,
  ],
  exports: [
    CommunicationService,
    MarketingService,
    ReviewRecoveryService,
    CustomerCareService,
  ],
})
export class EngagementModule {}
