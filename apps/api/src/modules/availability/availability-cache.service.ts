import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { AvailabilityInput } from "./availability.types.js";
export function availabilityCacheKey(
  tenantId: string,
  q: AvailabilityInput,
  version: number,
) {
  return `availability:tenant:${tenantId}:branch:${q.branchId}:service:${q.serviceId}:staff:${q.staffId ?? "ANY"}:from:${q.dateFrom}:to:${q.dateTo}:interval:${q.slotIntervalMin}:version:${version}`;
}
@Injectable()
export class AvailabilityCacheService implements OnModuleDestroy {
  private client?: RedisClientType;
  private disabled = false;
  private async ready() {
    if (this.disabled) return null;
    if (!this.client) {
      this.client = createClient({
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
        socket: { connectTimeout: 2000, reconnectStrategy: false },
      });
      this.client.on("error", () => undefined);
      try {
        await this.client.connect();
      } catch {
        this.disabled = true;
        return null;
      }
    }
    return this.client;
  }
  async get(key: string) {
    try {
      return (await (await this.ready())?.get(key)) ?? null;
    } catch {
      return null;
    }
  }
  async set(key: string, value: unknown) {
    try {
      await (await this.ready())?.set(key, JSON.stringify(value), { EX: 45 });
    } catch {
      /* PostgreSQL calculation remains available. */
    }
  }
  async onModuleDestroy() {
    if (this.client?.isOpen) await this.client.quit();
  }
}
