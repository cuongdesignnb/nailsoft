import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { rateLimitDecision, type RateLimitDecision } from "./rate-limit.js";

/**
 * Shared fixed-window limiter for multi-replica deployments.
 *
 * The in-memory limiter remains available for local/test runs. Production and
 * staging can opt in to the Redis store; when that store is required, a Redis
 * outage denies requests instead of silently downgrading to per-process state.
 */
export class DistributedRateLimiter {
  private client: RedisClientType | undefined;

  constructor(
    private readonly url: string,
    private readonly required: boolean,
    private readonly enabled: boolean,
  ) {}

  async connect() {
    if (!this.enabled) return;
    const client = createClient({
      url: this.url,
      socket: { connectTimeout: 2_000, reconnectStrategy: false },
    });
    client.on("error", () => undefined);
    try {
      await client.connect();
      this.client = client;
    } catch (error) {
      if (client.isOpen) await client.disconnect();
      if (this.required) {
        throw new Error(
          `Redis rate-limit store unavailable: ${error instanceof Error ? error.message : "connection failed"}`,
        );
      }
    }
  }

  async close() {
    if (this.client?.isOpen) await this.client.quit();
    this.client = undefined;
  }

  async decision(
    key: string,
    limit = 120,
    windowMs = 60_000,
    now = Date.now(),
  ): Promise<RateLimitDecision> {
    if (!this.enabled || !this.client?.isOpen) {
      if (this.required) {
        return { allowed: false, limit, remaining: 0, resetAt: now + 1_000 };
      }
      return rateLimitDecision(key, limit, windowMs, now);
    }

    const bucket = `nailsoft:rate-limit:${createHash("sha256").update(key).digest("hex")}`;
    try {
      const count = await this.client.incr(bucket);
      if (count === 1) await this.client.pExpire(bucket, windowMs);
      const ttl = await this.client.pTTL(bucket);
      const resetAt = now + Math.max(1, ttl);
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt,
      };
    } catch {
      if (this.required) {
        return { allowed: false, limit, remaining: 0, resetAt: now + 1_000 };
      }
      return rateLimitDecision(key, limit, windowMs, now);
    }
  }
}
