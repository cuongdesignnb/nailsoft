import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ServiceCatalogController } from "./service-catalog.controller.js";
import { ServiceCatalogService } from "./service-catalog.service.js";

@Module({ imports: [DatabaseModule, IdentityModule], controllers: [ServiceCatalogController], providers: [ServiceCatalogService] })
export class ServiceCatalogModule {}
