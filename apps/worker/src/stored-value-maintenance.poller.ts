import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { StoredValueMaintenanceProcessor } from "./stored-value-maintenance.processor.js";

@Injectable()
export class StoredValueMaintenancePoller
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;

  constructor(
    @Inject(StoredValueMaintenanceProcessor)
    private readonly processor: StoredValueMaintenanceProcessor,
  ) {}

  onModuleInit() {
    if (process.env.STORED_VALUE_MAINTENANCE_DISABLED !== "true")
      this.schedule(750);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const processed = await this.processor.run();
      this.schedule(
        processed
          ? 250
          : Number(process.env.STORED_VALUE_MAINTENANCE_POLL_MS ?? 5000),
      );
    } catch {
      this.schedule(5000);
    } finally {
      this.running = false;
    }
  }
}
