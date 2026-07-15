import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { AvailabilityModule } from "../availability/availability.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  AppointmentController,
  BookingPlanController,
  SlotHoldController,
} from "./booking.controller.js";
import { BookingIdempotencyService } from "./booking-idempotency.service.js";
import { BookingPlannerService } from "./booking-planner.service.js";
import { BookingService } from "./booking.service.js";
import { BookingTokenService } from "./booking-token.service.js";
import {
  PublicBookingManagementController,
  PublicSalonBookingController,
} from "./public-booking.controller.js";
import { PublicBookingService } from "./public-booking.service.js";
import { ReservationService } from "./reservation.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule, AvailabilityModule],
  controllers: [
    BookingPlanController,
    SlotHoldController,
    AppointmentController,
    PublicSalonBookingController,
    PublicBookingManagementController,
  ],
  providers: [
    BookingIdempotencyService,
    BookingPlannerService,
    BookingTokenService,
    ReservationService,
    BookingService,
    PublicBookingService,
  ],
  exports: [BookingService, ReservationService],
})
export class BookingModule {}
