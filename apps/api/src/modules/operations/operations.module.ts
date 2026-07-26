import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { AvailabilityModule } from "../availability/availability.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  AppointmentOperationsController,
  OperationsController,
  ServiceSessionController,
  StaffTodayController,
  WalkInController,
} from "./operations.controller.js";
import { ServiceExecutionService } from "./service-execution.service.js";
import { WalkInService } from "./walk-in.service.js";
import { OperationsMetrics } from "./operations.metrics.js";
import { WalkInEtaService } from "./walk-in-eta.service.js";
@Module({
  imports: [DatabaseModule, IdentityModule, AvailabilityModule, BookingModule],
  controllers: [
    WalkInController,
    AppointmentOperationsController,
    ServiceSessionController,
    OperationsController,
    StaffTodayController,
  ],
  providers: [
    WalkInService,
    WalkInEtaService,
    ServiceExecutionService,
    OperationsMetrics,
  ],
})
export class OperationsModule {}
