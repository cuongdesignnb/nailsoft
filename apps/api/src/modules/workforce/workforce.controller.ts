/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequirePermission } from "../identity/permission.decorator.js";
import { WorkforceService } from "./workforce.service.js";
const rid = (r: any) => r.raw?.requestId ?? "unknown",
  key = (k?: string) => k ?? "",
  ok = (data: unknown, r: any) => ({
    success: true,
    data,
    meta: { requestId: rid(r), timestamp: new Date().toISOString() },
  });

@ApiTags("time-clock")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("time-clock")
export class TimeClockController {
  constructor(@Inject(WorkforceService) private readonly s: WorkforceService) {}
  @Get("status") @RequirePermission("time_clock.session.read") async status(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.clockStatus(r.auth), r);
  }
  @Post("clock-in") @RequirePermission("time_clock.session.manage") async in(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.clock(r.auth, b, key(k), rid(r), "CLOCK_IN"), r);
  }
  @Post("clock-out") @RequirePermission("time_clock.session.manage") async out(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.clock(r.auth, b, key(k), rid(r), "CLOCK_OUT"), r);
  }
  @Post("breaks/start")
  @RequirePermission("time_clock.session.manage")
  async breakStart(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.breakCommand(r.auth, b, key(k), rid(r), "start"), r);
  }
  @Post("breaks/end")
  @RequirePermission("time_clock.session.manage")
  async breakEnd(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.breakCommand(r.auth, b, key(k), rid(r), "end"), r);
  }
  @Get("sessions") @RequirePermission("time_clock.session.read") async sessions(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "attendance_sessions"), r);
  }
  @Get("sessions/:id")
  @RequirePermission("time_clock.session.read")
  async session(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.detail(r.auth, "attendance_sessions", id), r);
  }
  @Get("exceptions")
  @RequirePermission("time_clock.exception.read")
  async exceptions(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "attendance_exceptions"), r);
  }
  @Post("exceptions/:id/acknowledge")
  @RequirePermission("time_clock.exception.resolve")
  async acknowledge(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.resolveAttendanceException(
        r.auth,
        id,
        "ACKNOWLEDGED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("exceptions/:id/resolve")
  @RequirePermission("time_clock.exception.resolve")
  async resolve(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.resolveAttendanceException(
        r.auth,
        id,
        "RESOLVED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("exceptions/:id/waive")
  @RequirePermission("time_clock.exception.resolve")
  async waive(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.resolveAttendanceException(
        r.auth,
        id,
        "WAIVED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("devices") @RequirePermission("time_clock.device.read") async devices(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "time_clock_devices"), r);
  }
  @Post("devices") @RequirePermission("time_clock.device.manage") async device(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createDevice(r.auth, b, key(k), rid(r)), r);
  }
  @Post("devices/:id/revoke")
  @RequirePermission("time_clock.device.manage")
  async revoke(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.revokeDevice(r.auth, id, b, key(k), rid(r)), r);
  }
}

@ApiTags("staff-workforce")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller("staff/me")
export class StaffWorkforceController {
  constructor(@Inject(WorkforceService) private readonly s: WorkforceService) {}
  @Get("time-clock/status")
  @RequirePermission("time_clock.self.use")
  async status(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.clockStatus(r.auth), r);
  }
  @Post("time-clock/clock-in")
  @RequirePermission("time_clock.self.use")
  async clockIn(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.clock(r.auth, b, key(k), rid(r), "CLOCK_IN", true),
      r,
    );
  }
  @Post("time-clock/clock-out")
  @RequirePermission("time_clock.self.use")
  async clockOut(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.clock(r.auth, b, key(k), rid(r), "CLOCK_OUT", true),
      r,
    );
  }
  @Post("time-clock/breaks/start")
  @RequirePermission("time_clock.self.use")
  async startBreak(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.breakCommand(r.auth, b, key(k), rid(r), "start", true),
      r,
    );
  }
  @Post("time-clock/breaks/end")
  @RequirePermission("time_clock.self.use")
  async endBreak(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.breakCommand(r.auth, b, key(k), rid(r), "end", true),
      r,
    );
  }
  @Get("attendance") @RequirePermission("timesheet.self.read") async attendance(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.ownAttendance(r.auth), r);
  }
  @Get("timesheets") @RequirePermission("timesheet.self.read") async sheets(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.ownTimesheets(r.auth), r);
  }
  @Get("timesheets/:id") @RequirePermission("timesheet.self.read") async sheet(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.ownTimesheets(r.auth, id), r);
  }
  @Post("timesheets/:id/submit")
  @RequirePermission("timesheet.self.submit")
  async submit(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetTransition(
        r.auth,
        id,
        "SUBMITTED",
        b,
        key(k),
        rid(r),
        true,
      ),
      r,
    );
  }
  @Post("timesheets/:id/adjustments")
  @RequirePermission("timesheet.adjustment.request")
  async adjustment(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.createAdjustment(r.auth, id, b, key(k), rid(r), true),
      r,
    );
  }
  @Get("pay-statements")
  @RequirePermission("payroll.statement.read")
  async statements(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.ownStatements(r.auth), r);
  }
  @Get("pay-statements/:id")
  @RequirePermission("payroll.statement.read")
  async statement(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.ownStatements(r.auth, id), r);
  }
}

@ApiTags("timesheets")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class TimesheetController {
  constructor(@Inject(WorkforceService) private readonly s: WorkforceService) {}
  @Get("timesheet-periods") @RequirePermission("timesheet.read") async periods(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "timesheet_periods"), r);
  }
  @Post("timesheet-periods")
  @RequirePermission("timesheet.review")
  async createPeriod(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createTimesheetPeriod(r.auth, b, key(k), rid(r)), r);
  }
  @Get("timesheet-periods/:id")
  @RequirePermission("timesheet.read")
  async period(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.detail(r.auth, "timesheet_periods", id), r);
  }
  @Post("timesheet-periods/:id/open-submission")
  @RequirePermission("timesheet.review")
  async openSubmission(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetPeriodTransition(
        r.auth,
        id,
        "SUBMISSION_OPEN",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheet-periods/:id/start-review")
  @RequirePermission("timesheet.review")
  async startReview(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetPeriodTransition(
        r.auth,
        id,
        "REVIEW",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheet-periods/:id/lock")
  @RequirePermission("timesheet.lock")
  async periodLock(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetPeriodTransition(
        r.auth,
        id,
        "LOCKED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheet-periods/:id/close")
  @RequirePermission("timesheet.lock")
  async periodClose(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetPeriodTransition(
        r.auth,
        id,
        "CLOSED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("timesheets") @RequirePermission("timesheet.read") async sheets(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "staff_timesheets"), r);
  }
  @Get("timesheets/:id") @RequirePermission("timesheet.read") async sheet(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.detail(r.auth, "staff_timesheets", id), r);
  }
  @Post("timesheets/:id/submit")
  @RequirePermission("timesheet.review")
  async submit(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetTransition(
        r.auth,
        id,
        "SUBMITTED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheets/:id/approve")
  @RequirePermission("timesheet.approve")
  async approve(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetTransition(
        r.auth,
        id,
        "APPROVED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheets/:id/reject")
  @RequirePermission("timesheet.approve")
  async reject(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetTransition(
        r.auth,
        id,
        "REJECTED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheets/:id/reopen")
  @RequirePermission("timesheet.approve")
  async reopen(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetTransition(
        r.auth,
        id,
        "REOPENED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheets/:id/lock") @RequirePermission("timesheet.lock") async lock(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.timesheetTransition(r.auth, id, "LOCKED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("timesheets/:id/adjustments")
  @RequirePermission("timesheet.adjustment.request")
  async adjustment(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createAdjustment(r.auth, id, b, key(k), rid(r)), r);
  }
  @Get("timesheets/:id/adjustments")
  @RequirePermission("timesheet.read")
  async adjustments(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    await this.s.detail(r.auth, "staff_timesheets", id);
    return ok(
      await this.s.list(
        r.auth,
        "timesheet_adjustment_requests",
        "AND timesheet_id=$2",
        [id],
      ),
      r,
    );
  }
  @Post("timesheet-adjustments/:id/submit")
  @RequirePermission("timesheet.adjustment.request")
  async adjustmentSubmit(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustmentTransition(
        r.auth,
        id,
        "PENDING_APPROVAL",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheet-adjustments/:id/approve")
  @RequirePermission("timesheet.approve")
  async adjustmentApprove(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustmentTransition(
        r.auth,
        id,
        "APPROVED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheet-adjustments/:id/reject")
  @RequirePermission("timesheet.approve")
  async adjustmentReject(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustmentTransition(
        r.auth,
        id,
        "REJECTED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("timesheet-adjustments/:id/cancel")
  @RequirePermission("timesheet.adjustment.request")
  async adjustmentCancel(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.adjustmentTransition(
        r.auth,
        id,
        "CANCELLED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
}

@ApiTags("workforce-payroll")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class PayrollWorkforceController {
  constructor(@Inject(WorkforceService) private readonly s: WorkforceService) {}
  @Get("workforce-compliance/policies")
  @RequirePermission("workforce.policy.read")
  async policies(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "workforce_compliance_policies"), r);
  }
  @Post("workforce-compliance/policies")
  @RequirePermission("workforce.policy.manage")
  async policy(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createPolicy(r.auth, b, key(k), rid(r)), r);
  }
  @Post("workforce-compliance/policies/:id/versions")
  @RequirePermission("workforce.policy.manage")
  async policyVersion(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.addPolicyVersion(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("workforce-compliance/policies/:id/versions/:versionId/activate")
  @RequirePermission("workforce.policy.manage")
  async activatePolicy(
    @Param("id") id: string,
    @Param("versionId") vid: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.activatePolicy(r.auth, id, vid, b, key(k), rid(r)),
      r,
    );
  }
  @Post("workforce-compliance/policies/:id/retire")
  @RequirePermission("workforce.policy.manage")
  async retirePolicy(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.retirePolicy(r.auth, id, b, key(k), rid(r)), r);
  }
  @Get("staff/:staffId/pay-profile")
  @RequirePermission("pay_profile.read")
  async profile(@Param("staffId") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.payProfile(r.auth, id), r);
  }
  @Post("staff/:staffId/pay-profile/update")
  @RequirePermission("pay_profile.manage")
  async profileUpdate(
    @Param("staffId") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.updatePayProfile(r.auth, id, b, key(k), rid(r)), r);
  }
  @Get("staff/:staffId/pay-rates")
  @RequirePermission("pay_rate.read")
  async rates(@Param("staffId") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.payRates(r.auth, id), r);
  }
  @Post("staff/:staffId/pay-rates")
  @RequirePermission("pay_rate.manage")
  async rate(
    @Param("staffId") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createPayRate(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("staff/:staffId/pay-rates/:rateId/deactivate")
  @RequirePermission("pay_rate.manage")
  async rateDeactivate(
    @Param("staffId") staffId: string,
    @Param("rateId") rateId: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.deactivatePayRate(
        r.auth,
        staffId,
        rateId,
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("payroll-calendars")
  @RequirePermission("payroll.calendar.read")
  async calendars(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "payroll_calendars"), r);
  }
  @Post("payroll-calendars")
  @RequirePermission("payroll.calendar.manage")
  async calendar(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createCalendar(r.auth, b, key(k), rid(r)), r);
  }
  @Post("payroll-calendars/:id/update")
  @RequirePermission("payroll.calendar.manage")
  async calendarUpdate(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.updateCalendar(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("payroll-calendars/:id/activate")
  @RequirePermission("payroll.calendar.manage")
  async calendarActivate(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.calendarTransition(r.auth, id, "ACTIVE", b, key(k), rid(r)),
      r,
    );
  }
  @Post("payroll-calendars/:id/deactivate")
  @RequirePermission("payroll.calendar.manage")
  async calendarDeactivate(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.calendarTransition(
        r.auth,
        id,
        "INACTIVE",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("payroll/periods")
  @RequirePermission("payroll.run.read")
  async payrollPeriods(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "payroll_periods"), r);
  }
  @Post("payroll/periods/generate")
  @RequirePermission("payroll.calendar.manage")
  async generate(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.generatePeriod(r.auth, b, key(k), rid(r)), r);
  }
  @Get("payroll/runs") @RequirePermission("payroll.run.read") async runs(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "payroll_runs"), r);
  }
  @Post("payroll/runs") @RequirePermission("payroll.run.create") async run(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createRun(r.auth, b, key(k), rid(r)), r);
  }
  @Get("payroll/runs/:id")
  @RequirePermission("payroll.run.read")
  async runDetail(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.detail(r.auth, "payroll_runs", id), r);
  }
  @Get("payroll/runs/:id/workers")
  @RequirePermission("payroll.run.read")
  async runWorkers(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    await this.s.detail(r.auth, "payroll_runs", id);
    return ok(
      await this.s.list(
        r.auth,
        "payroll_run_workers",
        "AND payroll_run_id=$2",
        [id],
      ),
      r,
    );
  }
  @Get("payroll/runs/:runId/workers/:workerId")
  @RequirePermission("payroll.run.read")
  async runWorker(
    @Param("runId") runId: string,
    @Param("workerId") workerId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    const worker = await this.s.detail(r.auth, "payroll_run_workers", workerId);
    if ((worker as any).payrollRunId !== runId) {
      throw new NotFoundException({
        code: "PAYROLL_WORKER_NOT_FOUND",
        message: "Payroll worker not found",
      });
    }
    return ok(worker, r);
  }
  @Post("payroll/runs/:id/calculate")
  @RequirePermission("payroll.run.calculate")
  async calculate(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.calculateRun(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("payroll/runs/:id/recalculate")
  @RequirePermission("payroll.run.calculate")
  async recalculate(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.calculateRun(r.auth, id, b, key(k), rid(r)), r);
  }
  @Post("payroll/runs/:id/submit")
  @RequirePermission("payroll.run.submit")
  async submit(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollTransition(
        r.auth,
        id,
        "PENDING_APPROVAL",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payroll/runs/:id/approve")
  @RequirePermission("payroll.run.approve")
  async approve(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollTransition(r.auth, id, "APPROVED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("payroll/runs/:id/finalize")
  @RequirePermission("payroll.run.finalize")
  async finalize(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollTransition(
        r.auth,
        id,
        "FINALIZED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payroll/runs/:id/request-void")
  @RequirePermission("payroll.run.void")
  async voidRequest(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollTransition(
        r.auth,
        id,
        "VOID_PENDING",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payroll/runs/:id/approve-void")
  @RequirePermission("payroll.run.void")
  async voidApprove(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollTransition(r.auth, id, "VOIDED", b, key(k), rid(r)),
      r,
    );
  }
  @Get("payroll/runs/:id/exceptions")
  @RequirePermission("payroll.run.read")
  async exceptions(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(
      await this.s.list(r.auth, "payroll_exceptions", "AND payroll_run_id=$2", [
        id,
      ]),
      r,
    );
  }
  @Get("payroll/exceptions")
  @RequirePermission("payroll.run.read")
  async allExceptions(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "payroll_exceptions"), r);
  }
  @Post("payroll/exceptions/:id/acknowledge")
  @RequirePermission("payroll.exception.resolve")
  async exceptionAck(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollExceptionTransition(
        r.auth,
        id,
        "ACKNOWLEDGED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payroll/exceptions/:id/resolve")
  @RequirePermission("payroll.exception.resolve")
  async exceptionResolve(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollExceptionTransition(
        r.auth,
        id,
        "RESOLVED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payroll/exceptions/:id/waive")
  @RequirePermission("payroll.exception.resolve")
  async exceptionWaive(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payrollExceptionTransition(
        r.auth,
        id,
        "WAIVED",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("pay-statements")
  @RequirePermission("payroll.statement.read")
  async statements(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "pay_statements"), r);
  }
  @Get("pay-statements/:id")
  @RequirePermission("payroll.statement.read")
  async statement(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.detail(r.auth, "pay_statements", id), r);
  }
  @Get("payout-batches") @RequirePermission("payout.batch.read") async batches(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "payout_batches"), r);
  }
  @Post("payout-batches") @RequirePermission("payout.batch.create") async batch(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createPayoutBatch(r.auth, b, key(k), rid(r)), r);
  }
  @Get("payout-batches/:id")
  @RequirePermission("payout.batch.read")
  async batchDetail(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.detail(r.auth, "payout_batches", id), r);
  }
  @Post("payout-batches/:id/submit")
  @RequirePermission("payout.batch.create")
  async batchSubmit(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payoutTransition(
        r.auth,
        id,
        "PENDING_APPROVAL",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payout-batches/:id/approve")
  @RequirePermission("payout.batch.approve")
  async batchApprove(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payoutTransition(r.auth, id, "APPROVED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("payout-batches/:id/process")
  @RequirePermission("payout.batch.process")
  async batchProcess(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payoutTransition(
        r.auth,
        id,
        "PROCESSING",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payout-batches/:id/cancel")
  @RequirePermission("payout.batch.create")
  async batchCancel(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payoutTransition(r.auth, id, "CANCELLED", b, key(k), rid(r)),
      r,
    );
  }
  @Post("payout-batches/:id/retry-failed")
  @RequirePermission("payout.batch.process")
  async batchRetry(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payoutTransition(
        r.auth,
        id,
        "PROCESSING",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Get("payout-batches/:id/items")
  @RequirePermission("payout.batch.read")
  async items(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(
      await this.s.list(r.auth, "payout_items", "AND batch_id=$2", [id]),
      r,
    );
  }
  @Get("payout-items/:id") @RequirePermission("payout.batch.read") async item(
    @Param("id") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.detail(r.auth, "payout_items", id), r);
  }
  @Post("payout-items/:id/record-manual-payment")
  @RequirePermission("payout.manual_record")
  async paid(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.recordManualPayment(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Post("payout-items/:id/request-reversal")
  @RequirePermission("payout.reverse")
  async reversalRequest(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payoutReversal(
        r.auth,
        id,
        "REVERSAL_PENDING",
        b,
        key(k),
        rid(r),
      ),
      r,
    );
  }
  @Post("payout-items/:id/approve-reversal")
  @RequirePermission("payout.reverse")
  async reversalApprove(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.payoutReversal(r.auth, id, "REVERSED", b, key(k), rid(r)),
      r,
    );
  }
  @Get("payout-reconciliations")
  @RequirePermission("payout.reconciliation.read")
  async reconciliations(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "payout_reconciliations"), r);
  }
  @Post("payout-reconciliations/:id/resolve")
  @RequirePermission("payout.reconciliation.resolve")
  async reconciliationResolve(
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.resolveReconciliation(r.auth, id, b, key(k), rid(r)),
      r,
    );
  }
  @Get("workforce/reports/:report")
  @RequirePermission("workforce.report.read")
  async workforceReport(@Req() r: AuthenticatedRequest) {
    return ok(
      {
        generatedAt: new Date().toISOString(),
        sessions: await this.s.list(r.auth, "attendance_sessions"),
      },
      r,
    );
  }
  @Get("payroll/reports/:report")
  @RequirePermission("payroll.report.read")
  async payrollReport(@Req() r: AuthenticatedRequest) {
    return ok(
      {
        generatedAt: new Date().toISOString(),
        runs: await this.s.list(r.auth, "payroll_runs"),
      },
      r,
    );
  }
  @Post("payroll/exports")
  @RequirePermission("payroll.export")
  async export(
    @Body() b: any,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createExport(r.auth, b, key(k), rid(r)), r);
  }
  @Get("payroll/exports/:id")
  @RequirePermission("payroll.export")
  async exportDetail(@Param("id") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.detail(r.auth, "payroll_export_jobs", id), r);
  }
}
