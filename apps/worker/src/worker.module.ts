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
  ],
  exports: [OutboxRepository, OutboxEventRouter, OutboxProcessor],
})
export class WorkerModule {}
