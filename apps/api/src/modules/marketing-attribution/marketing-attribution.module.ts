import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { MarketingAttributionController } from "./marketing-attribution.controller.js";
import { MarketingAttributionService } from "./marketing-attribution.service.js";

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [MarketingAttributionController],
  providers: [MarketingAttributionService],
  exports: [MarketingAttributionService],
})
export class MarketingAttributionModule {}
