import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<
      FastifyRequest & { raw: { requestId?: string } }
    >();
    const reply = context.getResponse<FastifyReply>();
    const databaseCode =
      typeof exception === "object" && exception !== null && "code" in exception
        ? String(exception.code)
        : undefined;
    const status =
      databaseCode === "23505"
        ? HttpStatus.CONFLICT
        : exception instanceof ZodError
          ? HttpStatus.BAD_REQUEST
          : exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      exception instanceof ZodError
        ? "Request validation failed"
        : typeof raw === "object" && raw !== null && "message" in raw
          ? String(raw.message)
          : exception instanceof Error && status < 500
            ? exception.message
            : "Internal server error";
    const code =
      databaseCode === "23505"
        ? "DUPLICATE_RESOURCE"
        : exception instanceof ZodError
          ? "VALIDATION_ERROR"
          : typeof raw === "object" && raw !== null && "code" in raw
            ? String(raw.code)
            : status === 500
              ? "INTERNAL_ERROR"
              : "REQUEST_FAILED";
    if (status >= 500)
      request.log.error(
        { err: exception, requestId: request.raw.requestId },
        "request failed",
      );
    void reply.status(status).send({
      success: false,
      error: {
        code,
        message,
        ...(exception instanceof ZodError
          ? { details: exception.flatten() }
          : {}),
      },
      meta: {
        requestId: request.raw.requestId ?? "unknown",
        timestamp: new Date().toISOString(),
      },
    });
  }
}
