import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Emitter } from "@socket.io/redis-emitter";
import { createClient, type RedisClientType } from "redis";
import type {
  AvailabilityInvalidatedEvent,
  RealtimeControlMessage,
} from "./outbox.types.js";

@Injectable()
export class RealtimeEmitter implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private client?: RedisClientType;
  private emitter?: Emitter;

  async invalidation(payload: AvailabilityInvalidatedEvent, rooms: string[]) {
    await this.ensureConnected();
    const target = this.emitter!.of("/scheduling").to(rooms);
    target.emit("availability.invalidated", payload);
    if (
      payload.sourceEventType.startsWith("appointment.") ||
      payload.sourceEventType.startsWith("slot_hold.")
    ) {
      const removed = [
        "appointment.cancelled",
        "appointment.expired",
        "slot_hold.consumed",
        "slot_hold.released",
        "slot_hold.expired",
      ].includes(payload.sourceEventType);
      const created = ["appointment.created", "slot_hold.created"].includes(
        payload.sourceEventType,
      );
      target.emit(
        removed
          ? "calendar.event_removed"
          : created
            ? "calendar.event_created"
            : "calendar.event_updated",
        payload,
      );
    }
  }

  async control(message: RealtimeControlMessage) {
    await this.ensureConnected();
    await this.client!.publish(
      "nailsoft:realtime:control",
      JSON.stringify(message),
    );
  }

  private async ensureConnected() {
    if (this.client?.isReady && this.emitter) return;
    this.client = createClient({
      url: process.env.REDIS_URL ?? "redis://localhost:6379",
      socket: { connectTimeout: 1_000, reconnectStrategy: false },
    });
    this.client.on("error", (error) =>
      this.logger.warn({
        event: "realtime.emit_failure",
        message: error.message,
      }),
    );
    await this.client.connect();
    this.emitter = new Emitter(this.client);
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) await this.client.quit();
  }
}
