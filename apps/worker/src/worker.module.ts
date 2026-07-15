import { Module } from "@nestjs/common";
import { OutboxEventRouter } from "./outbox-event.router.js";
import { OutboxMetrics } from "./outbox.metrics.js";
import { OutboxPoller } from "./outbox.poller.js";
import { OutboxProcessor } from "./outbox.processor.js";
import { OutboxRepository } from "./outbox.repository.js";
import { RealtimeEmitter } from "./realtime-emitter.js";

@Module({
  providers: [
    OutboxRepository,
    OutboxEventRouter,
    RealtimeEmitter,
    OutboxMetrics,
    OutboxProcessor,
    OutboxPoller,
  ],
  exports: [OutboxRepository, OutboxEventRouter, OutboxProcessor],
})
export class WorkerModule {}
