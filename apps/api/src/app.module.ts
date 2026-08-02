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
import { BookingModule } from "./modules/booking/booking.module.js";
import { OperationsModule } from "./modules/operations/operations.module.js";
import { PosModule } from "./modules/pos/pos.module.js";
import { FinanceModule } from "./modules/finance/finance.module.js";
import { BenefitsModule } from "./modules/benefits/benefits.module.js";
import { InventoryModule } from "./modules/inventory/inventory.module.js";
import { StoredValueModule } from "./modules/stored-value/stored-value.module.js";
import { EngagementModule } from "./modules/engagement/engagement.module.js";
import { WorkforceModule } from "./modules/workforce/workforce.module.js";
import { PlatformBillingModule } from "./modules/platform-billing/platform-billing.module.js";
import { AccountingModule } from "./modules/accounting/accounting.module.js";
import { ProcurementModule } from "./modules/procurement/procurement.module.js";
import { AssetsModule } from "./modules/assets/assets.module.js";
import { AnalyticsModule } from "./modules/analytics/analytics.module.js";

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    IdentityModule,
    OrganizationModule,
    ServiceCatalogModule,
    AvailabilityModule,
    BusyBlockModule,
    CalendarModule,
    BookingModule,
    OperationsModule,
    PosModule,
    FinanceModule,
    BenefitsModule,
    InventoryModule,
    StoredValueModule,
    EngagementModule,
    WorkforceModule,
    PlatformBillingModule,
    AccountingModule,
    ProcurementModule,
    AssetsModule,
    AnalyticsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
