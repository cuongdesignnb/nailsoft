import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { WorkforceProcessor } from "./workforce.processor.js";
@Injectable()
export class WorkforcePoller implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;
  constructor(
    @Inject(WorkforceProcessor) private readonly processor: WorkforceProcessor,
  ) {}
  onModuleInit() {
    if (process.env.WORKFORCE_WORKER_DISABLED !== "true") this.schedule(1500);
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
        count ? 250 : Number(process.env.WORKFORCE_POLL_MS ?? 10000),
      );
    } catch {
      this.schedule(10000);
    } finally {
      this.running = false;
    }
  }
}
