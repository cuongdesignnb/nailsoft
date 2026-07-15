/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
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
import { BookingService } from "./booking.service.js";

function meta(req: AuthenticatedRequest) {
  return {
    requestId: req.raw.requestId ?? "unknown",
    timestamp: new Date().toISOString(),
  };
}
function idempotency(value: string | undefined) {
  return value ?? "";
}

@ApiTags("booking-plans")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("booking-plans")
export class BookingPlanController {
  constructor(
    @Inject(BookingService) private readonly service: BookingService,
  ) {}
  @Post()
  @RequireAnyPermission("slot_hold.create", "appointment.create")
  async plan(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return {
      success: true,
      data: await this.service.plan(req.auth, body),
      meta: meta(req),
    };
  }
}

@ApiTags("slot-holds")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("slot-holds")
export class SlotHoldController {
  constructor(
    @Inject(BookingService) private readonly service: BookingService,
  ) {}
  @Post() @RequirePermission("slot_hold.create") async create(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.createHold(
        req.auth,
        body,
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
  @Get(":holdId") @RequirePermission("slot_hold.read") async get(
    @Param("holdId") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.getHold(req.auth, id),
      meta: meta(req),
    };
  }
  @Post(":holdId/release")
  @RequirePermission("slot_hold.release")
  async release(
    @Param("holdId") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.releaseHold(
        req.auth,
        id,
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
}

@ApiTags("appointments")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("appointments")
export class AppointmentController {
  constructor(
    @Inject(BookingService) private readonly service: BookingService,
  ) {}
  @Get()
  @RequireAnyPermission(
    "appointment.read",
    "appointment.read_branch",
    "appointment.read_own",
  )
  async list(@Query() q: any, @Req() req: AuthenticatedRequest) {
    return {
      success: true,
      data: await this.service.list(req.auth, q),
      meta: meta(req),
    };
  }
  @Post() @RequirePermission("appointment.create") async create(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.createAppointment(
        req.auth,
        body,
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
  @Get(":appointmentId")
  @RequireAnyPermission(
    "appointment.read",
    "appointment.read_branch",
    "appointment.read_own",
  )
  async detail(
    @Param("appointmentId") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.detail(req.auth, id),
      meta: meta(req),
    };
  }
  @Get(":appointmentId/history")
  @RequireAnyPermission(
    "appointment.read",
    "appointment.read_branch",
    "appointment.read_own",
  )
  async history(
    @Param("appointmentId") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.historyList(req.auth, id),
      meta: meta(req),
    };
  }
  @Get(":appointmentId/schedule-revisions")
  @RequireAnyPermission(
    "appointment.read",
    "appointment.read_branch",
    "appointment.read_own",
  )
  async revisions(
    @Param("appointmentId") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.revisions(req.auth, id),
      meta: meta(req),
    };
  }
  @Post(":appointmentId/confirm")
  @RequirePermission("appointment.confirm")
  async confirm(
    @Param("appointmentId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.confirm(
        req.auth,
        id,
        body,
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
  @Post(":appointmentId/reschedule-hold")
  @RequirePermission("appointment.reschedule")
  async rescheduleHold(
    @Param("appointmentId") _id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.createHold(
        req.auth,
        { ...(body as object), source: "RECEPTION" },
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
  @Post(":appointmentId/reschedule")
  @RequirePermission("appointment.reschedule")
  async reschedule(
    @Param("appointmentId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.reschedule(
        req.auth,
        id,
        body,
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
  @Post(":appointmentId/cancel")
  @RequirePermission("appointment.cancel")
  async cancel(
    @Param("appointmentId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.cancel(
        req.auth,
        id,
        body,
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
  @Post(":appointmentId/waive-deposit")
  @RequirePermission("appointment.waive_deposit")
  async waive(
    @Param("appointmentId") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.service.waiveDeposit(
        req.auth,
        id,
        body,
        idempotency(key),
        req.raw.requestId ?? "unknown",
      ),
      meta: meta(req),
    };
  }
}
