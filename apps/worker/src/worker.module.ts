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
  ],
  exports: [OutboxRepository, OutboxEventRouter, OutboxProcessor],
})
export class WorkerModule {}
