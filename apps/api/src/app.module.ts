import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { DatabaseModule } from "./infrastructure/database.module.js";
import { RequestContextMiddleware } from "./common/request-context.middleware.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { OrganizationModule } from "./modules/organization/organization.module.js";
import { ServiceCatalogModule } from "./modules/service-catalog/service-catalog.module.js";
import { AvailabilityModule } from "./modules/availability/availability.module.js";
import { BusyBlockModule } from "./modules/busy-block/busy-block.module.js";
import { CalendarModule } from "./modules/calendar/calendar.module.js";

@Module({
  imports: [DatabaseModule, HealthModule, IdentityModule, OrganizationModule, ServiceCatalogModule, AvailabilityModule, BusyBlockModule, CalendarModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
