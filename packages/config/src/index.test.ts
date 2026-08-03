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

  it("requires storage credentials when enabled", () => {
    const result = environmentSchema.safeParse({ NODE_ENV: "production", CORS_ORIGINS: "https://admin.example", PUBLIC_URL: "https://api.example", JWT_SECRET: "a".repeat(32), IDENTITY_HASH_SECRET: "b".repeat(32), MFA_ENCRYPTION_KEY: "c".repeat(32), PAYMENT_PROVIDER_MODE: "live", STORAGE_ENABLED: "true" });
    expect(result.success).toBe(false);
  });
});
