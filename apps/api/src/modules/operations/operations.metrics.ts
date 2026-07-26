import { Injectable, Logger } from "@nestjs/common";
import { performance } from "node:perf_hooks";

@Injectable()
export class OperationsMetrics {
  private readonly logger = new Logger(OperationsMetrics.name);
  private readonly counters = new Map<string, number>();

  async track<T>(name: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await work();
      const total = `${name}_total`;
      this.counters.set(total, (this.counters.get(total) ?? 0) + 1);
      this.logger.debug({ event: total, value: this.counters.get(total) });
      return result;
    } finally {
      this.logger.debug({
        event: `${name}_duration_ms`,
        value: Number((performance.now() - started).toFixed(2)),
      });
    }
  }
}
