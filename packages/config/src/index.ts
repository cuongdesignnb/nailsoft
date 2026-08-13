import { z } from "zod";

const PLACEHOLDER = /^(change[-_ ]?me|replace[-_ ]?me|dev[-_ ]|example|test|secret)$/i;

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "ci", "staging", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://nailsoft:nailsoft@localhost:5432/nailsoft"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    JWT_SECRET: z.string().min(16).default("development-jwt-secret-change-me"),
    IDENTITY_HASH_SECRET: z
      .string()
      .min(16)
      .default("development-identity-hash-secret-change-me"),
    MFA_ENCRYPTION_KEY: z
      .string()
      .min(16)
      .default("development-mfa-encryption-key-change-me"),
    CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3002"),
    PUBLIC_URL: z.string().url().default("http://localhost:3001"),
    API_VERSION: z.string().min(1).default("v1"),
    APP_VERSION: z.string().min(1).default("0.3.0"),
    COMMIT_SHA: z.string().min(1).default("development"),
    BUILD_TIMESTAMP: z.string().min(1).default("unknown"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(5000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).default(30000),
    DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(5000),
    DB_IDLE_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).default(60000),
    REDIS_REQUIRED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    REDIS_RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    STORAGE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    OBJECT_STORAGE_ENDPOINT: z.string().url().optional(),
    OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
    OBJECT_STORAGE_ACCESS_KEY: z.string().min(1).optional(),
    OBJECT_STORAGE_SECRET_KEY: z.string().min(1).optional(),
    OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
    OTP_PROVIDER: z.enum(["dev", "http", "twilio", "none"]).default("dev"),
    OTP_PROVIDER_URL: z.string().url().optional(),
    OTP_PROVIDER_TOKEN: z.string().min(1).optional(),
    PAYMENT_PROVIDER_MODE: z.enum(["fake", "live", "disabled"]).default("fake"),
    DEBUG: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  })
  .superRefine((config, context) => {
    const production = config.NODE_ENV === "production";
    const rejectPlaceholder = (name: string, value: string) => {
      if (PLACEHOLDER.test(value) || value.toLowerCase().includes("change-me")) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `${name} must not use a placeholder` });
      }
    };
    if (production) {
      for (const [name, value] of [["JWT_SECRET", config.JWT_SECRET], ["IDENTITY_HASH_SECRET", config.IDENTITY_HASH_SECRET], ["MFA_ENCRYPTION_KEY", config.MFA_ENCRYPTION_KEY]] as const) rejectPlaceholder(name, value);
      if (config.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean).length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGINS"], message: "CORS_ORIGINS is required in production" });
      if (config.CORS_ORIGINS.split(",").some((value) => value.trim() === "*")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGINS"], message: "Wildcard CORS is forbidden with credentials" });
      if (!config.PUBLIC_URL.startsWith("https://")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_URL"], message: "PUBLIC_URL must use HTTPS in production" });
      if (/localhost|127\.0\.0\.1/i.test(config.DATABASE_URL)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["DATABASE_URL"], message: "DATABASE_URL must not use a local default in production" });
      if (/localhost|127\.0\.0\.1/i.test(config.REDIS_URL)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["REDIS_URL"], message: "REDIS_URL must not use a local default in production" });
      if (!config.REDIS_REQUIRED) context.addIssue({ code: z.ZodIssueCode.custom, path: ["REDIS_REQUIRED"], message: "REDIS_REQUIRED must be true in production" });
      if (!config.REDIS_RATE_LIMIT_ENABLED) context.addIssue({ code: z.ZodIssueCode.custom, path: ["REDIS_RATE_LIMIT_ENABLED"], message: "REDIS_RATE_LIMIT_ENABLED must be true in production" });
      if (config.CORS_ORIGINS.split(",").some((value) => /localhost|127\.0\.0\.1/i.test(value))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGINS"], message: "Localhost origins are forbidden in production" });
      if (config.PAYMENT_PROVIDER_MODE === "fake") context.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYMENT_PROVIDER_MODE"], message: "Fake payment provider is forbidden in production" });
      if (config.DEBUG) context.addIssue({ code: z.ZodIssueCode.custom, path: ["DEBUG"], message: "DEBUG must be false in production" });
      if (config.STORAGE_ENABLED && (!config.OBJECT_STORAGE_ENDPOINT || !config.OBJECT_STORAGE_BUCKET || !config.OBJECT_STORAGE_ACCESS_KEY || !config.OBJECT_STORAGE_SECRET_KEY)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["STORAGE_ENABLED"], message: "Object storage credentials are required when storage is enabled" });
      if (config.OTP_PROVIDER === "http" && (!config.OTP_PROVIDER_URL || !config.OTP_PROVIDER_TOKEN)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["OTP_PROVIDER"], message: "OTP provider credentials are required" });
    }
  });

export type RuntimeConfig = z.infer<typeof environmentSchema>;

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid runtime configuration: ${details}`);
  }
  return parsed.data;
}

export function parseCorsOrigins(config: Pick<RuntimeConfig, "CORS_ORIGINS">): string[] {
  return config.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
}
