import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(
    request: FastifyRequest["raw"] & { requestId?: string },
    response: FastifyReply["raw"],
    next: () => void,
  ) {
    const supplied = request.headers["x-request-id"];
    request.requestId =
      typeof supplied === "string" && supplied.length <= 128
        ? supplied
        : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  }
}
