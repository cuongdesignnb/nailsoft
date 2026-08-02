import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { AssetsController } from "./assets.controller.js";
import { AssetsService } from "./assets.service.js";

@Module({ imports:[DatabaseModule,IdentityModule], controllers:[AssetsController], providers:[AssetsService], exports:[AssetsService] })
export class AssetsModule {}
