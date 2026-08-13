import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import fastifyCookie from "@fastify/cookie";
import { RedisIoAdapter } from "./infrastructure/redis-io.adapter.js";
import { allowedOrigins } from "./common/cors-origins.js";
import { loadRuntimeConfig } from "@nailsoft/config";
import { randomUUID } from "node:crypto";
import { isSensitiveRoute } from "./common/rate-limit.js";
import { DistributedRateLimiter } from "./common/distributed-rate-limit.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ObservabilityService } from "./modules/health/observability.service.js";

export async function createApp() {
  const runtimeConfig = loadRuntimeConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        level: runtimeConfig.LOG_LEVEL,
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
      },
    }),
    { rawBody: true },
  );
  app.setGlobalPrefix("v1");
  await app.register(fastifyCookie);
  const corsOrigins = allowedOrigins();
  app.enableCors({
    // Resolve both headers per request. An unknown Origin receives neither an
    // allow-origin nor an allow-credentials response.
    delegator: (request, callback) => {
      const origin = request.headers.origin;
      const allowed = origin == null || corsOrigins.includes(origin);
      callback(null, { origin: allowed ? (origin ?? true) : false, credentials: allowed });
    },
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
  const realtimeAdapter = new RedisIoAdapter(app);
  await realtimeAdapter.connect();
  app.useWebSocketAdapter(realtimeAdapter);
  const rateLimiter = new DistributedRateLimiter(
    runtimeConfig.REDIS_URL,
    runtimeConfig.REDIS_REQUIRED,
    runtimeConfig.REDIS_RATE_LIMIT_ENABLED,
  );
  await rateLimiter.connect();
  app.getHttpAdapter().getInstance().addHook("onClose", async () => {
    await realtimeAdapter.close();
    await rateLimiter.close();
  });
  const server = app.getHttpAdapter().getInstance();
  const observability = app.get(ObservabilityService);
  server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    observability.requestStarted();
    const supplied = request.headers["x-request-id"];
    const requestId = typeof supplied === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    reply.header("x-request-id", requestId);
    const suppliedCorrelation = request.headers["x-correlation-id"];
    const correlationId = typeof suppliedCorrelation === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedCorrelation) ? suppliedCorrelation : requestId;
    reply.header("x-correlation-id", correlationId);
    const decision = await rateLimiter.decision(`${request.ip}:${isSensitiveRoute(request.url) ? "sensitive" : "standard"}`, isSensitiveRoute(request.url) ? 60 : 600);
    reply.header("x-ratelimit-limit", decision.limit);
    reply.header("x-ratelimit-remaining", decision.remaining);
    reply.header("x-ratelimit-reset", Math.ceil(decision.resetAt / 1000));
    if (runtimeConfig.NODE_ENV === "production" && !decision.allowed) {
      reply.header("retry-after", Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000)));
      return reply.code(429).send({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests", requestId }, meta: { requestId, timestamp: new Date().toISOString() } });
    }
  });
  server.addHook("onSend", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (runtimeConfig.NODE_ENV === "production") reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  });
  server.addHook("onSend", async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (origin && !corsOrigins.includes(origin)) reply.removeHeader("access-control-allow-credentials");
  });
  server.addHook("onResponse", async (_request: FastifyRequest, reply: FastifyReply) => {
    observability.recordRequest(reply.statusCode);
  });
  const config = new DocumentBuilder()
    .setTitle("Nailsoft API")
    .setDescription("Multi-tenant salon management API")
    .setVersion(runtimeConfig.APP_VERSION)
    .addBearerAuth()
    .addApiKey({ type: "apiKey", in: "header", name: "X-Tenant-Id" }, "tenant")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  return app;
}

async function bootstrap() {
  const runtimeConfig = loadRuntimeConfig();
  const app = await createApp();
  await app.listen({ port: runtimeConfig.PORT, host: "0.0.0.0" });
}
if (process.env.NODE_ENV !== "test") void bootstrap();
