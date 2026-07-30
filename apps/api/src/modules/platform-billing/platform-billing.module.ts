import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { PlatformBillingController, PlatformUsageController, TenantBillingController, TenantSupportController } from "./platform-billing.controller.js";
import { PlatformBillingService } from "./platform-billing.service.js";

@Module({
  imports:[IdentityModule,BookingModule],
  controllers:[TenantBillingController,TenantSupportController,PlatformBillingController,PlatformUsageController],
  providers:[PlatformBillingService],
  exports:[PlatformBillingService],
})
export class PlatformBillingModule {}
