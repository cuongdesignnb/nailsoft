import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { OutboxEventRouter } from "./outbox-event.router.js";
import { OutboxMetrics } from "./outbox.metrics.js";
import { OutboxRepository } from "./outbox.repository.js";
import { CrossTenantEventError, type OutboxEvent } from "./outbox.types.js";
import { RealtimeEmitter } from "./realtime-emitter.js";
import { BookingNotificationRouter } from "./booking-notification.router.js";

const retrySeconds = [5, 15, 60, 300];

@Injectable()
export class OutboxProcessor {
  readonly sourceOfTruth = "postgresql";
  readonly workerId = `${process.env.HOSTNAME ?? "worker"}:${process.pid}:${randomUUID()}`;
  private readonly logger = new Logger(OutboxProcessor.name);
  private readonly maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);

  constructor(
    @Inject(OutboxRepository) private readonly repo: OutboxRepository,
    @Inject(OutboxEventRouter) private readonly router: OutboxEventRouter,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
    @Inject(OutboxMetrics) private readonly metrics: OutboxMetrics,
    @Inject(BookingNotificationRouter)
    private readonly notifications: BookingNotificationRouter,
  ) {}

  async processBatch() {
    const events = await this.repo.claim({
      workerId: this.workerId,
      batchSize: Number(process.env.OUTBOX_BATCH_SIZE ?? 50),
      lockTimeoutSeconds: Number(process.env.OUTBOX_LOCK_TIMEOUT_SECONDS ?? 60),
    });
    for (const event of events) await this.process(event);
    const state = await this.repo.statistics();
    this.metrics.observe("outbox_pending_total", state.pending);
    this.metrics.observe("outbox_processing_total", state.processing);
    this.metrics.observe("outbox_failed_total", state.failed);
    this.metrics.observe(
      "outbox_oldest_pending_age_seconds",
      state.oldest_pending_age_seconds,
    );
    return events.length;
  }

  private async process(event: OutboxEvent) {
    const started = performance.now();
    try {
      await this.notifications.route(event);
      const route = await this.router.route(event);
      if (route.kind === "ignored") {
        this.metrics.increment("outbox_event_ignored_total");
      } else if (route.kind === "control") {
        await this.emitter.control(route.message);
        this.metrics.increment("realtime_emit_total");
      } else {
        for (const delivery of route.deliveries) {
          await this.emitter.invalidation(delivery.payload, delivery.rooms);
          this.metrics.increment("realtime_emit_total");
        }
      }
      await this.repo.processed(event.id, this.workerId);
      this.metrics.increment("outbox_processed_total");
      this.metrics.observe(
        "outbox_processing_duration_ms",
        performance.now() - started,
      );
      this.logger.log({
        event: "outbox.processed",
        eventId: event.id,
        eventType: event.event_type,
        tenantId: event.tenant_id,
        branchId: event.branch_id,
        attempt: event.attempt_count,
        durationMs: Number((performance.now() - started).toFixed(2)),
      });
    } catch (error) {
      this.metrics.increment("realtime_emit_failure_total");
      if (error instanceof CrossTenantEventError) {
        this.metrics.increment("realtime_cross_tenant_prevented_total");
        await this.repo.failed(event.id, this.workerId, error);
        this.metrics.increment("outbox_failed_total");
        return;
      }
      if (event.attempt_count >= this.maxAttempts) {
        await this.repo.failed(event.id, this.workerId, error);
        this.metrics.increment("outbox_failed_total");
      } else {
        const delay = retrySeconds[event.attempt_count - 1] ?? 900;
        await this.repo.retry(event.id, this.workerId, delay, error);
        this.metrics.increment("outbox_retry_total");
      }
      this.logger.warn({
        event: "outbox.delivery_failed",
        eventId: event.id,
        eventType: event.event_type,
        tenantId: event.tenant_id,
        attempt: event.attempt_count,
      });
    }
  }
}
