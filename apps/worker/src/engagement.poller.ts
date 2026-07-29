import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { EngagementProcessor } from "./engagement.processor.js";

@Injectable()
export class EngagementPoller implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;
  constructor(
    @Inject(EngagementProcessor)
    private readonly processor: EngagementProcessor,
  ) {}
  onModuleInit() {
    if (process.env.ENGAGEMENT_WORKER_DISABLED !== "true") this.schedule(1000);
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
  private schedule(ms: number) {
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), ms);
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.processor.run();
      this.schedule(
        count ? 200 : Number(process.env.ENGAGEMENT_POLL_MS ?? 5000),
      );
    } catch {
      this.schedule(5000);
    } finally {
      this.running = false;
    }
  }
}
