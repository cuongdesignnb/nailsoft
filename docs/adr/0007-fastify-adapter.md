# ADR 0007: NestJS Fastify adapter

- Status: Accepted by CR-0001
- Decision: Replace the Express platform adapter with `@nestjs/platform-fastify` before Sprint 1 controller growth. Keep REST/OpenAPI, common validation, compatible WebSocket transport and structured logging.
- Verification: authentication middleware, optional cookies, multipart, rate limits, CORS, Swagger, WebSocket, exception filters, request IDs, integration tests and a load smoke test.
- Consequences: Adapter-specific APIs are prohibited outside infrastructure. No performance claim is made without p50, p95 and error-rate measurements.
