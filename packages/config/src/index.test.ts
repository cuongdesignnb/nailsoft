import { describe, expect, it } from "vitest";
import { loadRuntimeConfig, environmentSchema, parseCorsOrigins } from "./index.js";

describe("runtime configuration", () => {
  it("loads safe local defaults", () => {
    const config = loadRuntimeConfig({ NODE_ENV: "test" });
    expect(config.DATABASE_URL).toContain("localhost");
    expect(parseCorsOrigins(config)).toHaveLength(2);
  });

  it("fails closed for production placeholders and insecure URLs", () => {
    const result = environmentSchema.safeParse({ NODE_ENV: "production", CORS_ORIGINS: "*", PUBLIC_URL: "http://example.test" });
    expect(result.success).toBe(false);
  });

  it("requires the shared Redis controls for production", () => {
    const base = {
      NODE_ENV: "production",
      CORS_ORIGINS: "https://admin.example",
      PUBLIC_URL: "https://api.example",
      DATABASE_URL: "postgresql://app:secret@db.internal:5432/nailsoft",
      REDIS_URL: "rediss://:secret@redis.internal:6380",
      JWT_SECRET: "a".repeat(32),
      IDENTITY_HASH_SECRET: "b".repeat(32),
      MFA_ENCRYPTION_KEY: "c".repeat(32),
      PAYMENT_PROVIDER_MODE: "live",
      REDIS_REQUIRED: "false",
      REDIS_RATE_LIMIT_ENABLED: "false",
    };
    expect(environmentSchema.safeParse(base).success).toBe(false);
    expect(environmentSchema.safeParse({ ...base, REDIS_REQUIRED: "true", REDIS_RATE_LIMIT_ENABLED: "true" }).success).toBe(true);
  });

  it("requires storage credentials when enabled", () => {
    const result = environmentSchema.safeParse({ NODE_ENV: "production", CORS_ORIGINS: "https://admin.example", PUBLIC_URL: "https://api.example", JWT_SECRET: "a".repeat(32), IDENTITY_HASH_SECRET: "b".repeat(32), MFA_ENCRYPTION_KEY: "c".repeat(32), PAYMENT_PROVIDER_MODE: "live", STORAGE_ENABLED: "true" });
    expect(result.success).toBe(false);
  });
});
