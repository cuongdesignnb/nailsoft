import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";

export async function createApp() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        level: process.env.LOG_LEVEL ?? "info",
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
      },
    }),
  );
  app.setGlobalPrefix("v1");
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(",") ?? [
      "http://localhost:3000",
      "http://localhost:3002",
    ],
    credentials: true,
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
  const config = new DocumentBuilder()
    .setTitle("Nailsoft API")
    .setDescription("Multi-tenant salon management API")
    .setVersion("0.2.0")
    .addBearerAuth()
    .addApiKey({ type: "apiKey", in: "header", name: "X-Tenant-Id" }, "tenant")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" });
}
if (process.env.NODE_ENV !== "test") void bootstrap();
