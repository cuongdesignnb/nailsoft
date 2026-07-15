import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OutboxProcessor } from "./outbox.processor.js";

@Injectable()
export class OutboxPoller implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  constructor(
    @Inject(OutboxProcessor) private readonly processor: OutboxProcessor,
  ) {}

  onModuleInit() {
    if (process.env.OUTBOX_POLL_DISABLED === "true") return;
    this.schedule(0);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.processor.processBatch();
      this.schedule(count > 0 ? 25 : Number(process.env.OUTBOX_POLL_MS ?? 500));
    } catch {
      this.schedule(1_000);
    } finally {
      this.running = false;
    }
  }
}
