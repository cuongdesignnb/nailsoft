import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { OrganizationController } from "./organization.controller.js";
import { OrganizationService } from "./organization.service.js";
@Module({
  imports: [IdentityModule],
  controllers: [OrganizationController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
