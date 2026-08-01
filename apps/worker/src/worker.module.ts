import { Module } from "@nestjs/common";
import { OutboxEventRouter } from "./outbox-event.router.js";
import { OutboxMetrics } from "./outbox.metrics.js";
import { OutboxPoller } from "./outbox.poller.js";
import { OutboxProcessor } from "./outbox.processor.js";
import { OutboxRepository } from "./outbox.repository.js";
import { RealtimeEmitter } from "./realtime-emitter.js";
import { BookingMaintenancePoller } from "./booking-maintenance.poller.js";
import { BookingMaintenanceProcessor } from "./booking-maintenance.processor.js";
import { BookingNotificationRouter } from "./booking-notification.router.js";
import { BookingOtpPoller } from "./booking-otp.poller.js";
import { BookingOtpProcessor } from "./booking-otp.processor.js";
import { BookingOtpProvider } from "./booking-otp.provider.js";
import { BenefitMaintenancePoller } from "./benefit-maintenance.poller.js";
import { BenefitMaintenanceProcessor } from "./benefit-maintenance.processor.js";
import { InventoryMaintenancePoller } from "./inventory-maintenance.poller.js";
import { InventoryMaintenanceProcessor } from "./inventory-maintenance.processor.js";
import { StoredValueMaintenancePoller } from "./stored-value-maintenance.poller.js";
import { StoredValueMaintenanceProcessor } from "./stored-value-maintenance.processor.js";
import { EmailProvider } from "./email.provider.js";
import { EngagementProcessor } from "./engagement.processor.js";
import { EngagementPoller } from "./engagement.poller.js";
import { WorkforceProcessor } from "./workforce.processor.js";
import { WorkforcePoller } from "./workforce.poller.js";
import { PlatformBillingProcessor } from "./platform-billing.processor.js";
import { PlatformBillingPoller } from "./platform-billing.poller.js";
import { AccountingPostingProcessor } from "./accounting-posting.processor.js";
import { AccountingPostingPoller } from "./accounting-posting.poller.js";
import { VendorPaymentProcessor } from "./vendor-payment.processor.js";
import { VendorPaymentPoller } from "./vendor-payment.poller.js";

@Module({
  providers: [
    OutboxRepository,
    OutboxEventRouter,
    RealtimeEmitter,
    OutboxMetrics,
    OutboxProcessor,
    OutboxPoller,
    BookingNotificationRouter,
    BookingMaintenanceProcessor,
    BookingMaintenancePoller,
    BookingOtpProvider,
    BookingOtpProcessor,
    BookingOtpPoller,
    BenefitMaintenanceProcessor,
    BenefitMaintenancePoller,
    InventoryMaintenanceProcessor,
    InventoryMaintenancePoller,
    StoredValueMaintenanceProcessor,
    StoredValueMaintenancePoller,
    EmailProvider,
    EngagementProcessor,
    EngagementPoller,
    WorkforceProcessor,
    WorkforcePoller,
    PlatformBillingProcessor,
    PlatformBillingPoller,
    AccountingPostingProcessor,
    AccountingPostingPoller,
    VendorPaymentProcessor,
    VendorPaymentPoller,
  ],
  exports: [OutboxRepository, OutboxEventRouter, OutboxProcessor],
})
export class WorkerModule {}
