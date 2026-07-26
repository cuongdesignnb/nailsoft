/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import {
  RequireAnyPermission,
  RequirePermission,
} from "../identity/permission.decorator.js";
import { ServiceExecutionService } from "./service-execution.service.js";
import { WalkInService } from "./walk-in.service.js";
import { OperationsMetrics } from "./operations.metrics.js";
const key = (v: string | undefined) => v ?? "",
  requestId = (r: AuthenticatedRequest) => r.raw.requestId ?? "unknown";
const response = (data: unknown, r: AuthenticatedRequest) => ({
  success: true,
  data,
  meta: { requestId: requestId(r), timestamp: new Date().toISOString() },
});

@ApiTags("walk-ins")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("walk-ins")
export class WalkInController {
  constructor(
    @Inject(WalkInService) private readonly service: WalkInService,
    @Inject(OperationsMetrics) private readonly metrics: OperationsMetrics,
  ) {}
  @Get() @RequirePermission("walkin.read") async list(
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(await this.service.list(r.auth, q), r);
  }
  @Post() @RequirePermission("walkin.create") async create(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("walkin_created", () =>
        this.service.create(r.auth, b, key(k), requestId(r)),
      ),
      r,
    );
  }
  @Get("queue-summary") @RequirePermission("walkin.read") async summary(
    @Query() q: any,
    @Req() r: AuthenticatedRequest,
  ) {
    const rows = await this.service.list(r.auth, q);
    return response(
      {
        total: rows.length,
        waiting: rows.filter((x: any) => x.status === "WAITING").length,
        ready: rows.filter((x: any) => x.status === "READY").length,
        called: rows.filter((x: any) => x.status === "CALLED").length,
        entries: rows,
      },
      r,
    );
  }
  @Get(":walkInId") @RequirePermission("walkin.read") async detail(
    @Param("walkInId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(await this.service.detail(r.auth, id), r);
  }
  @Patch(":walkInId") @RequirePermission("walkin.update") async update(
    @Param("walkInId") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.update(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post(":walkInId/ready") @RequirePermission("walkin.call") ready(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.state(id, "READY", b, k, r);
  }
  @Post(":walkInId/call") @RequirePermission("walkin.call") call(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.state(id, "CALLED", b, k, r);
  }
  @Post(":walkInId/return-to-waiting") @RequirePermission("walkin.call") wait(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.state(id, "WAITING", b, k, r);
  }
  @Post(":walkInId/cancel") @RequirePermission("walkin.cancel") cancel(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.state(id, "CANCELLED", b, k, r);
  }
  @Post(":walkInId/mark-left") @RequirePermission("walkin.cancel") left(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.state(id, "LEFT", b, k, r);
  }
  @Post(":walkInId/priority")
  @RequirePermission("walkin.priority")
  async priority(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.priority(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post(":walkInId/conversion-plans")
  @RequirePermission("walkin.convert")
  async plan(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(await this.service.conversionPlan(r.auth, id, b), r);
  }
  @Post(":walkInId/conversion-holds")
  @RequirePermission("walkin.convert")
  async hold(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.conversionHold(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post(":walkInId/convert") @RequirePermission("walkin.convert") async convert(
    @Param("walkInId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("walkin_conversion", () =>
        this.service.convert(r.auth, id, b, key(k), requestId(r)),
      ),
      r,
    );
  }
  private async state(
    id: string,
    to: any,
    b: unknown,
    k: string | undefined,
    r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.transition(r.auth, id, to, b, key(k), requestId(r)),
      r,
    );
  }
}

@ApiTags("appointment-operations")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("appointments")
export class AppointmentOperationsController {
  constructor(
    @Inject(ServiceExecutionService)
    private readonly service: ServiceExecutionService,
    @Inject(OperationsMetrics) private readonly metrics: OperationsMetrics,
  ) {}
  @Post(":appointmentId/arrive")
  @RequirePermission("appointment.arrive")
  async arrive(
    @Param("appointmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("appointment_arrival", () =>
        this.service.arrive(r.auth, id, b, key(k), requestId(r)),
      ),
      r,
    );
  }
  @Post(":appointmentId/check-in")
  @RequirePermission("appointment.check_in")
  async checkin(
    @Param("appointmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("appointment_checkin", () =>
        this.service.checkIn(r.auth, id, b, key(k), requestId(r)),
      ),
      r,
    );
  }
  @Post(":appointmentId/revert-check-in")
  @RequirePermission("appointment.revert_check_in")
  async revert(
    @Param("appointmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.revertCheckIn(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Get(":appointmentId/arrival")
  @RequireAnyPermission(
    "appointment.arrive",
    "appointment.check_in",
    "appointment.read_branch",
  )
  async arrival(
    @Param("appointmentId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(await this.service.arrival(r.auth, id), r);
  }
  @Post(":appointmentId/add-service-plans")
  @RequirePermission("service_session.add_service")
  async plan(
    @Param("appointmentId") id: string,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(await this.service.addPlan(r.auth, id, b), r);
  }
  @Post(":appointmentId/add-service-holds")
  @RequirePermission("service_session.add_service")
  async hold(
    @Param("appointmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.addHold(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post(":appointmentId/add-service")
  @RequirePermission("service_session.add_service")
  async commit(
    @Param("appointmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("add_service", () =>
        this.service.addCommit(r.auth, id, b, key(k), requestId(r)),
      ),
      r,
    );
  }
  @Get(":appointmentId/checkout-summary")
  @RequirePermission("appointment.checkout_summary")
  async checkout(
    @Param("appointmentId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("checkout_summary", () =>
        this.service.checkout(r.auth, id),
      ),
      r,
    );
  }
}

@ApiTags("service-sessions")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("service-sessions")
export class ServiceSessionController {
  constructor(
    @Inject(ServiceExecutionService)
    private readonly service: ServiceExecutionService,
    @Inject(OperationsMetrics) private readonly metrics: OperationsMetrics,
  ) {}
  @Get()
  @RequireAnyPermission(
    "service_session.read_branch",
    "service_session.read_own",
  )
  async list(@Query() q: unknown, @Req() r: AuthenticatedRequest) {
    return response(await this.service.sessions(r.auth, q), r);
  }
  @Get(":sessionId")
  @RequireAnyPermission(
    "service_session.read_branch",
    "service_session.read_own",
  )
  async detail(@Param("sessionId") id: string, @Req() r: AuthenticatedRequest) {
    return response(await this.service.session(r.auth, id), r);
  }
  @Post(":sessionId/start") @RequirePermission("service_session.start") start(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.command(id, "start", b, k, r);
  }
  @Post(":sessionId/pause") @RequirePermission("service_session.pause") pause(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.command(id, "pause", b, k, r);
  }
  @Post(":sessionId/resume")
  @RequirePermission("service_session.resume")
  resume(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.command(id, "resume", b, k, r);
  }
  @Post(":sessionId/complete")
  @RequirePermission("service_session.complete")
  complete(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.command(id, "complete", b, k, r);
  }
  @Post(":sessionId/cancel")
  @RequirePermission("service_session.cancel")
  cancel(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.command(id, "cancel", b, k, r);
  }
  @Post(":sessionId/transfer-staff")
  @RequirePermission("service_session.transfer_staff")
  async transfer(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("service_session_transfer", () =>
        this.service.transfer(r.auth, id, b, key(k), requestId(r)),
      ),
      r,
    );
  }
  @Get(":sessionId/notes")
  @RequirePermission("service_session.note")
  async notes(@Param("sessionId") id: string, @Req() r: AuthenticatedRequest) {
    return response(await this.service.notes(r.auth, id), r);
  }
  @Post(":sessionId/notes")
  @RequirePermission("service_session.note")
  async addNote(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.addNote(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Patch(":sessionId/notes/:noteId")
  @RequirePermission("service_session.note")
  async updateNote(
    @Param("sessionId") id: string,
    @Param("noteId") noteId: string,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.updateNote(r.auth, id, noteId, b, requestId(r)),
      r,
    );
  }
  @Post(":sessionId/media/presign")
  @RequirePermission("service_session.media")
  async presign(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string | undefined,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.presign(r.auth, id, b, key(k), requestId(r)),
      r,
    );
  }
  @Post(":sessionId/media/:mediaId/complete")
  @RequirePermission("service_session.media")
  async mediaComplete(
    @Param("sessionId") id: string,
    @Param("mediaId") mediaId: string,
    @Body() b: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.completeMedia(r.auth, id, mediaId, b, requestId(r)),
      r,
    );
  }
  @Get(":sessionId/media")
  @RequirePermission("service_session.media")
  async media(@Param("sessionId") id: string, @Req() r: AuthenticatedRequest) {
    return response(await this.service.media(r.auth, id), r);
  }
  @Post(":sessionId/media/:mediaId/delete")
  @RequirePermission("service_session.media")
  async mediaDelete(
    @Param("sessionId") id: string,
    @Param("mediaId") mediaId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.service.deleteMedia(r.auth, id, mediaId, requestId(r)),
      r,
    );
  }
  private async command(
    id: string,
    action: any,
    b: unknown,
    k: string | undefined,
    r: AuthenticatedRequest,
  ) {
    const metricAction =
      action === "start"
        ? "started"
        : action === "pause"
          ? "paused"
          : action === "resume"
            ? "resumed"
            : action === "complete"
              ? "completed"
              : "cancelled";
    return response(
      await this.metrics.track(`service_session_${metricAction}`, () =>
        this.service.command(r.auth, id, action, b, key(k), requestId(r)),
      ),
      r,
    );
  }
}

@ApiTags("operations")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("operations")
export class OperationsController {
  constructor(
    @Inject(ServiceExecutionService)
    private readonly service: ServiceExecutionService,
    @Inject(OperationsMetrics) private readonly metrics: OperationsMetrics,
  ) {}
  @Get("board") @RequirePermission("operations.board.read") async board(
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(
      await this.metrics.track("operations_board_query", () =>
        this.service.board(r.auth, q),
      ),
      r,
    );
  }
  @Get("summary") @RequirePermission("operations.board.read") async summary(
    @Query() q: unknown,
    @Req() r: AuthenticatedRequest,
  ) {
    return response(await this.service.summary(r.auth, q), r);
  }
}
@ApiTags("staff-today")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("staff/me")
export class StaffTodayController {
  constructor(
    @Inject(ServiceExecutionService)
    private readonly service: ServiceExecutionService,
  ) {}
  @Get("today") @RequirePermission("service_session.read_own") async today(
    @Req() r: AuthenticatedRequest,
  ) {
    return response(await this.service.today(r.auth), r);
  }
}
