import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { AccountingController } from "./accounting.controller.js";
import { AccountingService } from "./accounting.service.js";

@Module({ imports:[DatabaseModule,IdentityModule], controllers:[AccountingController], providers:[AccountingService], exports:[AccountingService] })
export class AccountingModule {}
