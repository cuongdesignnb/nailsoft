import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class OutboxMetrics {
  private readonly logger = new Logger(OutboxMetrics.name);
  private readonly counters = new Map<string, number>();

  increment(name: string) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  observe(name: string, value: number) {
    this.logger.debug({ event: name, value });
  }

  snapshot() {
    return Object.fromEntries(this.counters);
  }
}
