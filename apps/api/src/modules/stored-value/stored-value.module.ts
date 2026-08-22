import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { StoredValueController } from "./stored-value.controller.js";
import { GiftCardReportingService } from "./gift-card-reporting.service.js";
import { CustomerCreditReportingService } from "./customer-credit-reporting.service.js";
import { StoredValueService } from "./stored-value.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, BookingModule],
  controllers: [StoredValueController],
  providers: [StoredValueService, GiftCardReportingService, CustomerCreditReportingService],
  exports: [StoredValueService],
})
export class StoredValueModule {}
