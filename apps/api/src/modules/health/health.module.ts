import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { ObservabilityService } from "./observability.service.js";
@Module({ controllers: [HealthController], providers: [ObservabilityService], exports: [ObservabilityService] })
export class HealthModule {}
