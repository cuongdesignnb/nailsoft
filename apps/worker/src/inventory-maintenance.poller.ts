import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { InventoryMaintenanceProcessor } from "./inventory-maintenance.processor.js";
@Injectable()
export class InventoryMaintenancePoller
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private running = false;
  constructor(
    @Inject(InventoryMaintenanceProcessor)
    private readonly processor: InventoryMaintenanceProcessor,
  ) {}
  onModuleInit() {
    if (process.env.INVENTORY_MAINTENANCE_DISABLED !== "true")
      this.schedule(500);
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
      const n = await this.processor.run();
      this.schedule(
        n ? 250 : Number(process.env.INVENTORY_MAINTENANCE_POLL_MS ?? 5000),
      );
    } catch {
      this.schedule(5000);
    } finally {
      this.running = false;
    }
  }
}
