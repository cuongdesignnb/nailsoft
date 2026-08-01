import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ProcurementController } from "./procurement.controller.js";
import { ProcurementService } from "./procurement.service.js";

@Module({ imports: [DatabaseModule, IdentityModule, BookingModule], controllers: [ProcurementController], providers: [ProcurementService] })
export class ProcurementModule {}
