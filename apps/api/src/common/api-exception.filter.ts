import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { redactSensitive } from "./redact-sensitive.js";

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
    const databaseConstraint =
      typeof exception === "object" &&
      exception !== null &&
      "constraint" in exception
        ? String(exception.constraint)
        : undefined;
    const databaseDomainCode: Record<string, string> = {
      service_prices_active_no_overlap: "PRICE_OVERLAP",
      staff_branch_assignment_no_overlap: "STAFF_BRANCH_ASSIGNMENT_OVERLAP",
      staff_primary_assignment_no_overlap: "STAFF_PRIMARY_BRANCH_CONFLICT",
      shifts_published_no_overlap: "SHIFT_OVERLAP",
      service_addon_cycle: "SERVICE_ADDON_CYCLE",
      staff_schedule_no_active_overlap: "STAFF_RESERVED",
      appointments_tenant_reference_unique: "BOOKING_REFERENCE_CONFLICT",
      appointment_item_one_primary_active: "APPOINTMENT_ASSIGNMENT_INVALID",
      service_segment_one_open_per_staff: "SERVICE_SESSION_STAFF_BUSY",
      service_segment_one_open_primary: "SERVICE_SESSION_VERSION_CONFLICT",
      service_pause_one_open: "SERVICE_SESSION_OPEN_PAUSE_EXISTS",
      appointment_arrivals_tenant_id_appointment_id_key:
        "APPOINTMENT_ALREADY_ARRIVED",
      walk_in_entries_tenant_id_branch_id_local_queue_date_queue_number_key:
        "WALK_IN_QUEUE_CONFLICT",
      commission_rules_active_scope_no_overlap: "COMMISSION_RULE_OVERLAP",
      refund_allocations_tenant_provider_reference_unique:
        "REFUND_PROVIDER_REFERENCE_CONFLICT",
      commission_entries_one_adjustment_request:
        "COMMISSION_ADJUSTMENT_ALREADY_POSTED",
      attendance_one_active_session_idx: "TIME_CLOCK_ALREADY_CLOCKED_IN",
      attendance_one_open_break_idx: "TIME_CLOCK_BREAK_ALREADY_OPEN",
      staff_pay_rate_no_overlap: "PAY_RATE_OVERLAP",
      payroll_source_unique_usage: "PAYROLL_SOURCE_ALREADY_USED",
      payout_item_paid_evidence: "PAYOUT_EVIDENCE_REQUIRED",
    };
    const status =
      databaseCode === "23505" ||
      databaseCode === "23P01" ||
      databaseCode === "23514"
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
      databaseDomainCode[databaseConstraint ?? ""] ??
      (databaseCode === "23505" ||
      databaseCode === "23P01" ||
      databaseCode === "23514"
        ? "DUPLICATE_RESOURCE"
        : exception instanceof ZodError
          ? "VALIDATION_ERROR"
          : typeof raw === "object" && raw !== null && "code" in raw
            ? String(raw.code)
            : status === 500
              ? "INTERNAL_ERROR"
              : "REQUEST_FAILED");
    if (status >= 500)
      request.log.error(
        { err: redactSensitive(exception), requestId: request.raw.requestId },
        "request failed",
      );
    void reply.status(status).send({
      success: false,
      error: {
        code,
        message,
        requestId: request.raw.requestId ?? "unknown",
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
