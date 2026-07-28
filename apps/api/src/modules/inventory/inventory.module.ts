import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { InventoryCatalogService } from "./inventory-catalog.service.js";
import {
  InventoryCatalogController,
  InventoryOperationsController,
  InventoryProcurementController,
} from "./inventory.controller.js";
import { InventoryCoreService } from "./inventory-core.service.js";
import { InventoryOperationsService } from "./inventory-operations.service.js";
import { InventoryProcurementService } from "./inventory-procurement.service.js";
@Module({
  imports: [DatabaseModule, IdentityModule, BookingModule],
  controllers: [
    InventoryCatalogController,
    InventoryProcurementController,
    InventoryOperationsController,
  ],
  providers: [
    InventoryCoreService,
    InventoryCatalogService,
    InventoryProcurementService,
    InventoryOperationsService,
  ],
  exports: [InventoryOperationsService],
})
export class InventoryModule {}
