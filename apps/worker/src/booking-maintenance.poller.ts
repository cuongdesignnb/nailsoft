import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { BookingMaintenanceProcessor } from "./booking-maintenance.processor.js";

@Injectable()
export class BookingMaintenancePoller implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;
  constructor(
    @Inject(BookingMaintenanceProcessor)
    private readonly processor: BookingMaintenanceProcessor,
  ) {}
  onModuleInit() {
    if (process.env.BOOKING_MAINTENANCE_DISABLED !== "true") this.schedule(100);
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
        count ? 100 : Number(process.env.BOOKING_MAINTENANCE_POLL_MS ?? 1000),
      );
    } catch {
      this.schedule(1000);
    } finally {
      this.running = false;
    }
  }
}
