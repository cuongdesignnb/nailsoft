import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  PayrollWorkforceController,
  StaffWorkforceController,
  TimeClockController,
  TimesheetController,
} from "./workforce.controller.js";
import { WorkforceService } from "./workforce.service.js";
@Module({
  imports: [DatabaseModule, IdentityModule, BookingModule],
  controllers: [
    TimeClockController,
    StaffWorkforceController,
    TimesheetController,
    PayrollWorkforceController,
  ],
  providers: [WorkforceService],
  exports: [WorkforceService],
})
export class WorkforceModule {}
