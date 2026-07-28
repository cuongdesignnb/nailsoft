/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  addServiceCommitSchema,
  addServicePlanSchema,
  appointmentArrivalSchema,
  appointmentCheckInSchema,
  appointmentRevertCheckInSchema,
  mediaCompleteSchema,
  mediaPresignSchema,
  serviceSessionNoteSchema,
  serviceSessionNoteUpdateSchema,
  sessionCancelSchema,
  sessionCompleteSchema,
  sessionPauseSchema,
  sessionResumeSchema,
  sessionStartSchema,
  sessionTransferSchema,
} from "@nailsoft/validation";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import { BookingService } from "../booking/booking.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { InventoryOperationsService } from "../inventory/inventory-operations.service.js";
import {
  arrivalOffset,
  assertSessionTransition,
  durationSeconds,
  sanitizeNote,
} from "./operations-domain.js";
import {
  branchLocalDate,
  branchLocalDayRange,
  roundUpBranchTime,
} from "./operational-time.js";
import { WalkInEtaService } from "./walk-in-eta.service.js";

@Injectable()
export class ServiceExecutionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(BookingService) private readonly booking: BookingService,
    @Inject(WalkInEtaService) private readonly eta: WalkInEtaService,
    @Inject(InventoryOperationsService)
    private readonly inventory: InventoryOperationsService,
  ) {}
  private deny(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support access grant is required",
      });
  }
  private branch(auth: AccessClaims, id: string) {
    if (!auth.roles.includes("SALON_OWNER") && !auth.branchIds.includes(id))
      throw new ForbiddenException({
        code: "BRANCH_SCOPE_DENIED",
        message: "Branch is outside the active workspace",
      });
  }
  private manager(auth: AccessClaims) {
    return auth.roles.some(
      (x) => x === "SALON_OWNER" || x === "BRANCH_MANAGER",
    );
  }

  async arrive(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = appointmentArrivalSchema.parse(input);
    const result = (
      await this.db.transaction((c) =>
        this.idem.execute(c, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "appointment.arrive",
          key,
          request: { id, ...body },
          work: async () => {
            const a = await this.appointment(c, auth, id, true);
            await this.assertBranchActive(c, auth.tenantId, a.branch_id);
            if (!["CONFIRMED", "CHECKED_IN"].includes(a.status))
              throw new ConflictException({
                code: "APPOINTMENT_CHECK_IN_NOT_ALLOWED",
                message:
                  "Appointment cannot record arrival in its current status",
              });
            const existing = (
              await c.query<any>(
                "SELECT * FROM appointment_arrivals WHERE tenant_id=$1 AND appointment_id=$2 FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (existing && !existing.reverted_at)
              throw new ConflictException({
                code: "APPOINTMENT_ALREADY_ARRIVED",
                message: "Appointment already has an active arrival",
              });
            const now = new Date(),
              offset = arrivalOffset(new Date(a.start_at), now);
            const row = existing
              ? (
                  await c.query<any>(
                    "UPDATE appointment_arrivals SET arrival_method=$3,arrived_at=$4,late_minutes=$5,early_minutes=$6,party_size=$7,note=$8,reverted_at=NULL,revert_reason=NULL,version=version+1,updated_by_user_id=$9,updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2 RETURNING *",
                    [
                      auth.tenantId,
                      id,
                      body.arrivalMethod,
                      now,
                      offset.lateMinutes,
                      offset.earlyMinutes,
                      body.partySize,
                      body.note ?? null,
                      auth.userId,
                    ],
                  )
                ).rows[0]
              : (
                  await c.query<any>(
                    "INSERT INTO appointment_arrivals(tenant_id,branch_id,appointment_id,arrival_method,arrived_at,late_minutes,early_minutes,party_size,note,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *",
                    [
                      auth.tenantId,
                      a.branch_id,
                      id,
                      body.arrivalMethod,
                      now,
                      offset.lateMinutes,
                      offset.earlyMinutes,
                      body.partySize,
                      body.note ?? null,
                      auth.userId,
                    ],
                  )
                ).rows[0];
            await this.record(
              c,
              auth,
              a.branch_id,
              "appointment.arrived",
              "appointment",
              id,
              a.version,
              requestId,
              {
                appointmentId: id,
                branchId: a.branch_id,
                lateMinutes: offset.lateMinutes,
                earlyMinutes: offset.earlyMinutes,
                refetch: true,
              },
            );
            return this.arrivalView(row);
          },
        }),
      )
    ).data;
    return result;
  }
  async checkIn(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = appointmentCheckInSchema.parse(input);
    const result = (
      await this.db.transaction((c) =>
        this.idem.execute(c, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "appointment.check_in",
          key,
          request: { id, ...body },
          work: async () => {
            const a = await this.appointment(c, auth, id, true);
            await this.assertBranchActive(c, auth.tenantId, a.branch_id);
            if (a.status === "CHECKED_IN")
              throw new ConflictException({
                code: "APPOINTMENT_ALREADY_CHECKED_IN",
                message: "Appointment is already checked in",
              });
            if (Number(a.version) !== body.version)
              throw version("APPOINTMENT_VERSION_CONFLICT");
            if (
              a.status === "PENDING_DEPOSIT" ||
              a.deposit_status === "PENDING"
            )
              throw new ConflictException({
                code: "APPOINTMENT_DEPOSIT_BLOCKS_CHECK_IN",
                message: "Outstanding deposit blocks check-in",
              });
            if (a.status !== "CONFIRMED")
              throw new ConflictException({
                code: "APPOINTMENT_CHECK_IN_NOT_ALLOWED",
                message: "Appointment is not confirmed",
              });
            let arrival = (
              await c.query<any>(
                "SELECT * FROM appointment_arrivals WHERE tenant_id=$1 AND appointment_id=$2 AND reverted_at IS NULL FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (!arrival) {
              const now = new Date(),
                offset = arrivalOffset(new Date(a.start_at), now);
              arrival = (
                await c.query<any>(
                  "INSERT INTO appointment_arrivals(tenant_id,branch_id,appointment_id,arrival_method,arrived_at,late_minutes,early_minutes,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,'RECEPTION',$4,$5,$6,$7,$7) RETURNING *",
                  [
                    auth.tenantId,
                    a.branch_id,
                    id,
                    now,
                    offset.lateMinutes,
                    offset.earlyMinutes,
                    auth.userId,
                  ],
                )
              ).rows[0];
            }
            const policy = await this.policy(c, auth.tenantId, a.branch_id),
              hard = Number(policy.lateArrivalHardLimitMinutes ?? 60);
            if (
              Number(arrival.late_minutes) > hard &&
              (!this.manager(auth) || !body.overrideReason)
            )
              throw new ConflictException({
                code: "APPOINTMENT_LATE_OVERRIDE_REQUIRED",
                message:
                  "Manager override reason is required for very late check-in",
              });
            await c.query(
              "UPDATE appointment_arrivals SET checked_in_at=COALESCE(checked_in_at,now()),version=version+1,updated_by_user_id=$3,updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2",
              [auth.tenantId, id, auth.userId],
            );
            const updated = (
              await c.query<any>(
                "UPDATE appointments SET status='CHECKED_IN',version=version+1,updated_by_user_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [auth.tenantId, id, auth.userId],
              )
            ).rows[0];
            await c.query(
              `INSERT INTO service_sessions(tenant_id,branch_id,appointment_id,appointment_item_id,scheduled_start_at,scheduled_end_at) SELECT ai.tenant_id,a.branch_id,a.id,ai.id,ai.service_start_at,ai.service_end_at FROM appointments a JOIN appointment_items ai ON ai.tenant_id=a.tenant_id AND ai.appointment_id=a.id WHERE a.tenant_id=$1 AND a.id=$2 AND ai.status<>'CANCELLED' ON CONFLICT(tenant_id,appointment_item_id) DO NOTHING`,
              [auth.tenantId, id],
            );
            await this.statusHistory(
              c,
              auth,
              id,
              a.status,
              "CHECKED_IN",
              requestId,
              body.overrideReason,
            );
            await this.record(
              c,
              auth,
              a.branch_id,
              "appointment.checked_in",
              "appointment",
              id,
              updated.version,
              requestId,
              {
                appointmentId: id,
                branchId: a.branch_id,
                status: "CHECKED_IN",
                refetch: true,
              },
              body.overrideReason,
            );
            return this.appointmentView(updated);
          },
        }),
      )
    ).data;
    return result;
  }
  async revertCheckIn(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = appointmentRevertCheckInSchema.parse(input);
    if (!this.manager(auth))
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Manager permission is required",
      });
    return (
      await this.db.transaction((c) =>
        this.idem.execute(c, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "appointment.revert_check_in",
          key,
          request: { id, ...body },
          work: async () => {
            const a = await this.appointment(c, auth, id, true);
            if (Number(a.version) !== body.version)
              throw version("APPOINTMENT_VERSION_CONFLICT");
            const active = Number(
              (
                await c.query<any>(
                  "SELECT count(*)::int n FROM service_sessions WHERE tenant_id=$1 AND appointment_id=$2 AND status<>'PENDING'",
                  [auth.tenantId, id],
                )
              ).rows[0].n,
            );
            if (active)
              throw new ConflictException({
                code: "APPOINTMENT_CHECK_IN_NOT_ALLOWED",
                message: "Check-in cannot be reverted after execution starts",
              });
            await c.query(
              "UPDATE appointment_arrivals SET checked_in_at=NULL,reverted_at=now(),revert_reason=$3,version=version+1,updated_by_user_id=$4,updated_at=now() WHERE tenant_id=$1 AND appointment_id=$2 AND reverted_at IS NULL",
              [auth.tenantId, id, body.reason, auth.userId],
            );
            await c.query(
              "DELETE FROM service_sessions WHERE tenant_id=$1 AND appointment_id=$2 AND status='PENDING'",
              [auth.tenantId, id],
            );
            const updated = (
              await c.query<any>(
                "UPDATE appointments SET status='CONFIRMED',checkout_ready=false,version=version+1,updated_by_user_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [auth.tenantId, id, auth.userId],
              )
            ).rows[0];
            await this.statusHistory(
              c,
              auth,
              id,
              a.status,
              "CONFIRMED",
              requestId,
              body.reason,
            );
            await this.record(
              c,
              auth,
              a.branch_id,
              "appointment.check_in_reverted",
              "appointment",
              id,
              updated.version,
              requestId,
              {
                appointmentId: id,
                branchId: a.branch_id,
                status: "CONFIRMED",
                refetch: true,
              },
              body.reason,
            );
            return this.appointmentView(updated);
          },
        }),
      )
    ).data;
  }
  async arrival(auth: AccessClaims, id: string) {
    await this.appointmentQuery(auth, id);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM appointment_arrivals WHERE tenant_id=$1 AND appointment_id=$2 AND reverted_at IS NULL",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "APPOINTMENT_ARRIVAL_NOT_FOUND",
        message: "Arrival not found",
      });
    return this.arrivalView(row);
  }

  async sessions(auth: AccessClaims, q: any) {
    this.deny(auth);
    if (q.branchId) this.branch(auth, q.branchId);
    const own = auth.roles.includes("NAIL_TECHNICIAN")
        ? await this.ownStaff(auth)
        : null,
      branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const rows = await this.db.query<any>(
      `SELECT DISTINCT s.*,a.booking_reference,a.contact_snapshot_json,ai.service_snapshot_json,seg.staff_id current_staff_id FROM service_sessions s JOIN appointments a ON a.tenant_id=s.tenant_id AND a.id=s.appointment_id JOIN appointment_items ai ON ai.tenant_id=s.tenant_id AND ai.id=s.appointment_item_id LEFT JOIN service_session_staff_segments seg ON seg.tenant_id=s.tenant_id AND seg.service_session_id=s.id AND seg.ended_at IS NULL WHERE s.tenant_id=$1 AND ($2::uuid[] IS NULL OR s.branch_id=ANY($2)) AND ($3::uuid IS NULL OR COALESCE(seg.staff_id,(SELECT staff_id FROM appointment_item_staff_assignments x WHERE x.tenant_id=s.tenant_id AND x.appointment_item_id=s.appointment_item_id AND x.status='ACTIVE' AND x.assignment_role='PRIMARY'))=$3) AND ($4::uuid IS NULL OR s.branch_id=$4) AND ($5::text IS NULL OR s.status=$5) AND ($6::uuid IS NULL OR s.appointment_id=$6) ORDER BY s.scheduled_start_at LIMIT 200`,
      [
        auth.tenantId,
        branches,
        own,
        q.branchId ?? null,
        q.status ?? null,
        q.appointmentId ?? null,
      ],
    );
    return rows.rows.map((x) => this.sessionView(x, !!own));
  }
  async session(auth: AccessClaims, id: string) {
    const row = await this.sessionQuery(auth, id);
    const [segments, pauses] = await Promise.all([
      this.db.query<any>(
        "SELECT id,staff_id,segment_role,started_at,ended_at,ended_reason,contribution_weight FROM service_session_staff_segments WHERE tenant_id=$1 AND service_session_id=$2 ORDER BY started_at,id",
        [auth.tenantId, id],
      ),
      this.db.query<any>(
        "SELECT id,started_at,ended_at,reason_code,note FROM service_session_pauses WHERE tenant_id=$1 AND service_session_id=$2 ORDER BY started_at,id",
        [auth.tenantId, id],
      ),
    ]);
    return {
      ...this.sessionView(row, auth.roles.includes("NAIL_TECHNICIAN")),
      segments: segments.rows,
      pauses: pauses.rows,
    };
  }
  async command(
    auth: AccessClaims,
    id: string,
    action: "start" | "pause" | "resume" | "complete" | "cancel",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const schemas = {
        start: sessionStartSchema,
        pause: sessionPauseSchema,
        resume: sessionResumeSchema,
        complete: sessionCompleteSchema,
        cancel: sessionCancelSchema,
      },
      body: any = schemas[action].parse(input);
    const result = (
      await this.db.transaction((c) =>
        this.idem.execute(c, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: `service_session.${action}`,
          key,
          request: { id, ...body },
          work: async () => {
            const s = await this.lockSession(c, auth, id);
            if (Number(s.version) !== body.version)
              throw version("SERVICE_SESSION_VERSION_CONFLICT");
            await this.assertSessionExecutionAccess(c, auth, s);
            const now = new Date();
            if (action === "start") {
              await this.assertBranchActive(c, auth.tenantId, s.branch_id);
              assertSessionTransition(s.status, "IN_PROGRESS");
              await this.qualify(c, auth, s, body.staffId);
              await this.assertPrimaryAssignment(c, auth, s, body.staffId);
              await this.inventory.reserveForServiceStart(
                c,
                auth,
                id,
                requestId,
              );
              await c.query(
                "INSERT INTO service_session_staff_segments(tenant_id,service_session_id,staff_id,segment_role,started_at,created_by_user_id) VALUES($1,$2,$3,'PRIMARY',$4,$5)",
                [auth.tenantId, id, body.staffId, now, auth.userId],
              );
              await c.query(
                "UPDATE service_sessions SET status='IN_PROGRESS',actual_started_at=$3,started_by_user_id=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, id, now, auth.userId],
              );
            }
            if (action === "pause") {
              assertSessionTransition(s.status, "PAUSED");
              await c.query(
                "UPDATE service_session_staff_segments SET ended_at=$3,ended_reason='PAUSED' WHERE tenant_id=$1 AND service_session_id=$2 AND ended_at IS NULL",
                [auth.tenantId, id, now],
              );
              await c.query(
                "INSERT INTO service_session_pauses(tenant_id,service_session_id,started_at,reason_code,note,started_by_user_id) VALUES($1,$2,$3,$4,$5,$6)",
                [
                  auth.tenantId,
                  id,
                  now,
                  body.reasonCode,
                  body.note ?? null,
                  auth.userId,
                ],
              );
              await c.query(
                "UPDATE service_sessions SET status='PAUSED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, id],
              );
            }
            if (action === "resume") {
              await this.assertBranchActive(c, auth.tenantId, s.branch_id);
              assertSessionTransition(s.status, "IN_PROGRESS");
              await this.qualify(c, auth, s, body.staffId);
              await this.assertPrimaryAssignment(c, auth, s, body.staffId);
              await c.query(
                "UPDATE service_session_pauses SET ended_at=$3,ended_by_user_id=$4 WHERE tenant_id=$1 AND service_session_id=$2 AND ended_at IS NULL",
                [auth.tenantId, id, now, auth.userId],
              );
              await c.query(
                "INSERT INTO service_session_staff_segments(tenant_id,service_session_id,staff_id,segment_role,started_at,created_by_user_id) VALUES($1,$2,$3,'PRIMARY',$4,$5)",
                [auth.tenantId, id, body.staffId, now, auth.userId],
              );
              await c.query(
                "UPDATE service_sessions SET status='IN_PROGRESS',total_pause_seconds=(SELECT COALESCE(sum(extract(epoch FROM (ended_at-started_at))),0)::int FROM service_session_pauses WHERE tenant_id=$1 AND service_session_id=$2),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, id],
              );
            }
            if (action === "complete") {
              assertSessionTransition(s.status, "COMPLETED");
              if (!s.actual_started_at)
                throw new ConflictException({
                  code: "SERVICE_SESSION_NOT_STARTED",
                  message: "Service has not started",
                });
              await this.inventory.consumeForServiceCompletion(
                c,
                auth,
                id,
                requestId,
              );
              await c.query(
                "UPDATE service_session_pauses SET ended_at=$3,ended_by_user_id=$4 WHERE tenant_id=$1 AND service_session_id=$2 AND ended_at IS NULL",
                [auth.tenantId, id, now, auth.userId],
              );
              await c.query(
                "UPDATE service_session_staff_segments SET ended_at=$3,ended_reason='COMPLETED' WHERE tenant_id=$1 AND service_session_id=$2 AND ended_at IS NULL",
                [auth.tenantId, id, now],
              );
              const pause = Number(
                (
                  await c.query<any>(
                    "SELECT COALESCE(sum(extract(epoch FROM (ended_at-started_at))),0)::int seconds FROM service_session_pauses WHERE tenant_id=$1 AND service_session_id=$2",
                    [auth.tenantId, id],
                  )
                ).rows[0].seconds,
              );
              await c.query(
                "UPDATE service_sessions SET status='COMPLETED',actual_ended_at=$3,total_pause_seconds=$4,actual_work_seconds=$5,completion_note=$6,completed_by_user_id=$7,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [
                  auth.tenantId,
                  id,
                  now,
                  pause,
                  durationSeconds(new Date(s.actual_started_at), now, pause),
                  body.completionNote ?? null,
                  auth.userId,
                ],
              );
            }
            if (action === "cancel") {
              assertSessionTransition(s.status, "CANCELLED");
              if (s.status === "IN_PROGRESS" && !this.manager(auth))
                throw new ForbiddenException({
                  code: "SERVICE_SESSION_TRANSFER_NOT_ALLOWED",
                  message:
                    "Manager permission is required to cancel active work",
                });
              await this.inventory.releaseForServiceCancellation(
                c,
                auth,
                id,
                requestId,
              );
              await c.query(
                "UPDATE service_session_pauses SET ended_at=$3,ended_by_user_id=$4 WHERE tenant_id=$1 AND service_session_id=$2 AND ended_at IS NULL",
                [auth.tenantId, id, now, auth.userId],
              );
              await c.query(
                "UPDATE service_session_staff_segments SET ended_at=$3,ended_reason='CANCELLED' WHERE tenant_id=$1 AND service_session_id=$2 AND ended_at IS NULL",
                [auth.tenantId, id, now],
              );
              await c.query(
                "UPDATE service_sessions SET status='CANCELLED',actual_ended_at=CASE WHEN actual_started_at IS NULL THEN NULL ELSE $3 END,cancellation_reason_code=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, id, now, body.reasonCode],
              );
              await c.query(
                "UPDATE appointment_items SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, s.appointment_item_id],
              );
              await c.query(
                "UPDATE staff_schedule_reservations SET status='RELEASED',released_at=now() WHERE tenant_id=$1 AND appointment_item_id=$2 AND status='ACTIVE'",
                [auth.tenantId, s.appointment_item_id],
              );
              await c.query(
                "UPDATE resource_schedule_reservations SET status='RELEASED',released_at=now() WHERE tenant_id=$1 AND appointment_item_id=$2 AND status='ACTIVE'",
                [auth.tenantId, s.appointment_item_id],
              );
            }
            const updated = (
              await c.query<any>(
                "SELECT * FROM service_sessions WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, id],
              )
            ).rows[0];
            const appointment = await this.derive(
              c,
              auth,
              s.appointment_id,
              requestId,
            );
            await this.record(
              c,
              auth,
              s.branch_id,
              `service_session.${action === "complete" ? "completed" : action === "pause" ? "paused" : action === "resume" ? "resumed" : action === "cancel" ? "cancelled" : "started"}`,
              "service_session",
              id,
              updated.version,
              requestId,
              {
                sessionId: id,
                appointmentId: s.appointment_id,
                branchId: s.branch_id,
                status: updated.status,
                appointmentStatus: appointment.status,
                checkoutReady: appointment.checkout_ready,
                refetch: true,
              },
              body.reasonCode ?? undefined,
            );
            return this.sessionView(updated, false);
          },
        }),
      )
    ).data;
    if (action === "complete")
      await this.eta.refreshBranch(auth, result.branchId);
    return result;
  }

  async transfer(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = sessionTransferSchema.parse(input);
    if (!this.manager(auth) && !auth.roles.includes("RECEPTIONIST"))
      throw new ForbiddenException({
        code: "SERVICE_SESSION_TRANSFER_NOT_ALLOWED",
        message: "Transfer permission is required",
      });
    const result = (
      await this.db.transaction((c) =>
        this.idem.execute(c, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "service_session.transfer_staff",
          key,
          request: { id, ...body },
          work: async () => {
            const s = await this.lockSession(c, auth, id);
            await this.assertBranchActive(c, auth.tenantId, s.branch_id);
            if (Number(s.version) !== body.version)
              throw version("SERVICE_SESSION_VERSION_CONFLICT");
            if (!["IN_PROGRESS", "PAUSED"].includes(s.status))
              throw new ConflictException({
                code: "SERVICE_SESSION_TRANSFER_NOT_ALLOWED",
                message: "Session cannot be transferred",
              });
            await this.qualify(c, auth, s, body.targetStaffId);
            const current = (
              await c.query<any>(
                "SELECT * FROM service_session_staff_segments WHERE tenant_id=$1 AND service_session_id=$2 AND ended_at IS NULL FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (current?.staff_id === body.targetStaffId)
              throw new ConflictException({
                code: "SERVICE_SESSION_TRANSFER_NOT_ALLOWED",
                message: "Target staff is already primary",
              });
            const now = new Date();
            if (current)
              await c.query(
                "UPDATE service_session_staff_segments SET ended_at=$3,ended_reason='TRANSFERRED' WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, current.id, now],
              );
            await c.query(
              "UPDATE appointment_item_staff_assignments SET status='RELEASED',released_at=now(),version=version+1 WHERE tenant_id=$1 AND appointment_item_id=$2 AND status='ACTIVE' AND assignment_role='PRIMARY'",
              [auth.tenantId, s.appointment_item_id],
            );
            await c.query(
              "INSERT INTO appointment_item_staff_assignments(tenant_id,appointment_item_id,staff_id,assignment_role,status) VALUES($1,$2,$3,'PRIMARY','ACTIVE')",
              [auth.tenantId, s.appointment_item_id, body.targetStaffId],
            );
            await c.query(
              "UPDATE staff_schedule_reservations SET staff_id=$3 WHERE tenant_id=$1 AND appointment_item_id=$2 AND status='ACTIVE'",
              [auth.tenantId, s.appointment_item_id, body.targetStaffId],
            );
            if (s.status === "IN_PROGRESS")
              await c.query(
                "INSERT INTO service_session_staff_segments(tenant_id,service_session_id,staff_id,segment_role,started_at,created_by_user_id) VALUES($1,$2,$3,'PRIMARY',$4,$5)",
                [auth.tenantId, id, body.targetStaffId, now, auth.userId],
              );
            const updated = (
              await c.query<any>(
                "UPDATE service_sessions SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [auth.tenantId, id],
              )
            ).rows[0];
            await this.record(
              c,
              auth,
              s.branch_id,
              "service_session.staff_transferred",
              "service_session",
              id,
              updated.version,
              requestId,
              {
                sessionId: id,
                appointmentId: s.appointment_id,
                branchId: s.branch_id,
                fromStaffId: current?.staff_id ?? null,
                toStaffId: body.targetStaffId,
                refetch: true,
              },
              body.reasonCode,
            );
            return this.sessionView(updated, false);
          },
        }),
      )
    ).data;
    await this.eta.refreshBranch(auth, result.branchId);
    return result;
  }

  async addPlan(auth: AccessClaims, appointmentId: string, input: unknown) {
    const body = addServicePlanSchema.parse(input),
      a = await this.appointmentQuery(auth, appointmentId);
    if (!["CHECKED_IN", "IN_SERVICE", "PARTIALLY_COMPLETED"].includes(a.status))
      throw new ConflictException({
        code: "ADD_SERVICE_NOT_AVAILABLE",
        message: "Appointment is not active for add-service",
      });
    const branch = (
      await this.db.query<any>(
        "SELECT timezone,status FROM branches WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, a.branch_id],
      )
    ).rows[0];
    if (!branch || branch.status !== "ACTIVE")
      throw new ConflictException({
        code: "BRANCH_INACTIVE",
        message: "Branch is not active for add-service",
      });
    if (body.parentItemId) {
      const relation = await this.db.query(
        "SELECT 1 FROM appointment_items parent JOIN service_addons sa ON sa.tenant_id=parent.tenant_id AND sa.service_id=parent.service_id WHERE parent.tenant_id=$1 AND parent.appointment_id=$2 AND parent.id=$3 AND sa.addon_service_id=$4",
        [auth.tenantId, appointmentId, body.parentItemId, body.serviceId],
      );
      if (!relation.rowCount)
        throw new ConflictException({
          code: "ADD_SERVICE_INVALID_RELATION",
          message: "Service is not an allowed add-on",
        });
    }
    const activeCompletion = (
        await this.db.query<any>(
          `SELECT max(GREATEST(s.scheduled_end_at,
             now()+make_interval(secs=>GREATEST(0,extract(epoch FROM (s.scheduled_end_at-s.scheduled_start_at))::int-s.actual_work_seconds)))) estimated_end
           FROM service_sessions s WHERE s.tenant_id=$1 AND s.appointment_id=$2
             AND s.status IN ('IN_PROGRESS','PAUSED')`,
          [auth.tenantId, appointmentId],
        )
      ).rows[0]?.estimated_end,
      roundedNow = roundUpBranchTime(new Date(), branch.timezone, 5),
      earliest = DateTime.max(
        roundedNow,
        DateTime.fromJSDate(new Date(a.end_at), { zone: "utc" }),
        activeCompletion
          ? DateTime.fromJSDate(new Date(activeCompletion), { zone: "utc" })
          : roundedNow,
      );
    let plan: any;
    let lastError: unknown;
    for (let offset = 0; offset <= 360; offset += 5) {
      try {
        plan = await this.booking.plan(auth, {
          branchId: a.branch_id,
          desiredStartAt: earliest.plus({ minutes: offset }).toISO()!,
          items: [
            {
              serviceId: body.serviceId,
              staffPreference: body.staffPreference,
            },
          ],
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!plan)
      throw new ConflictException({
        code: "ADD_SERVICE_NOT_AVAILABLE",
        message: "No conflict-free extension slot is available",
        cause: lastError instanceof Error ? lastError.message : undefined,
      });
    return {
      ...plan,
      parentItemId: body.parentItemId ?? null,
      scheduleImpact: {
        previousEndAt: a.end_at,
        earliestStartAt: earliest.toISO(),
        newEndAt: plan.endAt,
        extendsMinutes: Math.ceil(
          (new Date(plan.endAt).getTime() - new Date(a.end_at).getTime()) /
            60000,
        ),
      },
    };
  }
  async addHold(
    auth: AccessClaims,
    appointmentId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = addServicePlanSchema.parse(input),
      plan = await this.addPlan(auth, appointmentId, body);
    return this.booking.createHold(
      auth,
      {
        branchId: plan.branchId,
        desiredStartAt: plan.startAt,
        items: [
          { serviceId: body.serviceId, staffPreference: body.staffPreference },
        ],
        availabilityDataVersion: plan.availabilityDataVersion,
        clientKey: `add-service:${appointmentId}:${body.serviceId}`,
        source: "RECEPTION",
      },
      key,
      requestId,
    );
  }
  async addCommit(
    auth: AccessClaims,
    appointmentId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = addServiceCommitSchema.parse(input);
    return this.booking.appendServiceFromHold(
      auth,
      appointmentId,
      body,
      key,
      requestId,
    );
  }

  async notes(auth: AccessClaims, id: string) {
    await this.sessionQuery(auth, id);
    return (
      await this.db.query<any>(
        "SELECT id,visibility,note,version,author_user_id,created_at,updated_at FROM service_session_notes WHERE tenant_id=$1 AND service_session_id=$2 AND archived_at IS NULL ORDER BY created_at,id",
        [auth.tenantId, id],
      )
    ).rows.map((x) => ({ ...x, note: sanitizeNote(x.note) }));
  }
  async addNote(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = serviceSessionNoteSchema.parse(input);
    return (
      await this.db.transaction((c) =>
        this.idem.execute(c, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "service_session.note",
          key,
          request: { id, ...body },
          work: async () => {
            const s = await this.lockSession(c, auth, id);
            await this.assertSessionExecutionAccess(c, auth, s);
            const row = (
              await c.query<any>(
                "INSERT INTO service_session_notes(tenant_id,service_session_id,author_user_id,visibility,note) VALUES($1,$2,$3,$4,$5) RETURNING *",
                [
                  auth.tenantId,
                  id,
                  auth.userId,
                  body.visibility,
                  sanitizeNote(body.note),
                ],
              )
            ).rows[0];
            await this.record(
              c,
              auth,
              s.branch_id,
              "service_session.note_added",
              "service_session",
              id,
              s.version,
              requestId,
              {
                sessionId: id,
                noteId: row.id,
                branchId: s.branch_id,
                refetch: true,
              },
            );
            return row;
          },
        }),
      )
    ).data;
  }
  async updateNote(
    auth: AccessClaims,
    id: string,
    noteId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = serviceSessionNoteUpdateSchema.parse(input);
    return this.db.transaction(async (c) => {
      const session = await this.lockSession(c, auth, id);
      await this.assertSessionExecutionAccess(c, auth, session);
      const existing = (
        await c.query<any>(
          "SELECT * FROM service_session_notes WHERE tenant_id=$1 AND service_session_id=$2 AND id=$3 AND archived_at IS NULL FOR UPDATE",
          [auth.tenantId, id, noteId],
        )
      ).rows[0];
      if (!existing)
        throw new NotFoundException({
          code: "SERVICE_SESSION_NOTE_NOT_FOUND",
          message: "Note not found",
        });
      if (
        auth.roles.includes("NAIL_TECHNICIAN") &&
        existing.author_user_id !== auth.userId
      )
        throw new ForbiddenException({
          code: "SERVICE_SESSION_SCOPE_DENIED",
          message: "Technician can only edit an own note",
        });
      if (Number(existing.version) !== body.version)
        throw version("VERSION_CONFLICT");
      const row = (
        await c.query<any>(
          "UPDATE service_session_notes SET visibility=$4,note=$5,version=version+1,updated_at=now() WHERE tenant_id=$1 AND service_session_id=$2 AND id=$3 RETURNING *",
          [auth.tenantId, id, noteId, body.visibility, sanitizeNote(body.note)],
        )
      ).rows[0];
      await this.record(
        c,
        auth,
        session.branch_id,
        "service_session.note_updated",
        "service_session",
        id,
        row.version,
        requestId,
        {
          sessionId: id,
          noteId,
          branchId: session.branch_id,
          before: {
            visibility: existing.visibility,
            version: existing.version,
          },
          after: { visibility: row.visibility, version: row.version },
          refetch: true,
        },
      );
      return row;
    });
  }
  async presign(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = mediaPresignSchema.parse(input);
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT,
      bucket = process.env.OBJECT_STORAGE_BUCKET,
      secret = process.env.OBJECT_STORAGE_SECRET_KEY;
    if (!endpoint || !bucket || !secret)
      return { enabled: false, reason: "OBJECT_STORAGE_NOT_CONFIGURED" };
    return (
      await this.db.transaction((c) =>
        this.idem.execute(c, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "service_session.media_presign",
          key,
          request: { id, ...body },
          work: async () => {
            const s = await this.lockSession(c, auth, id);
            await this.assertSessionExecutionAccess(c, auth, s);
            const mediaId = randomUUID(),
              storageKey = `tenants/${auth.tenantId}/sessions/${id}/${mediaId}`,
              expiresAt = new Date(Date.now() + 5 * 60_000),
              signature = createHmac("sha256", secret)
                .update(`${storageKey}:${expiresAt.toISOString()}`)
                .digest("hex");
            await c.query(
              "INSERT INTO service_session_media(id,tenant_id,service_session_id,media_type,storage_key,mime_type,size_bytes,checksum,uploaded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                mediaId,
                auth.tenantId,
                id,
                body.mediaType,
                storageKey,
                body.mimeType,
                body.sizeBytes,
                body.checksum,
                auth.userId,
              ],
            );
            await this.record(
              c,
              auth,
              s.branch_id,
              "service_session.media_added",
              "service_session",
              id,
              s.version,
              requestId,
              { sessionId: id, mediaId, branchId: s.branch_id, refetch: true },
            );
            return {
              enabled: true,
              mediaId,
              method: "PUT",
              uploadUrl: `${endpoint.replace(/\/$/, "")}/${bucket}/${storageKey}?expires=${encodeURIComponent(expiresAt.toISOString())}&signature=${signature}`,
              expiresAt: expiresAt.toISOString(),
              requiredHeaders: {
                "content-type": body.mimeType,
                "x-checksum-sha256": body.checksum,
              },
            };
          },
        }),
      )
    ).data;
  }
  async completeMedia(
    auth: AccessClaims,
    id: string,
    mediaId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = mediaCompleteSchema.parse(input);
    return this.db.transaction(async (c) => {
      const session = await this.lockSession(c, auth, id);
      await this.assertSessionExecutionAccess(c, auth, session);
      const media = (
        await c.query<any>(
          "SELECT * FROM service_session_media WHERE tenant_id=$1 AND service_session_id=$2 AND id=$3 FOR UPDATE",
          [auth.tenantId, id, mediaId],
        )
      ).rows[0];
      if (!media)
        throw new NotFoundException({
          code: "MEDIA_UPLOAD_NOT_FOUND",
          message: "Media upload not found",
        });
      if (media.checksum !== body.checksum)
        throw new ConflictException({
          code: "MEDIA_CHECKSUM_MISMATCH",
          message: "Upload checksum does not match presigned metadata",
        });
      await this.record(
        c,
        auth,
        session.branch_id,
        "service_session.media_upload_reported",
        "service_session",
        id,
        session.version,
        requestId,
        { sessionId: id, mediaId, branchId: session.branch_id, refetch: true },
      );
      return {
        id: media.id,
        status: "PENDING_UPLOAD",
        verificationRequired: "TRUSTED_PROVIDER_CALLBACK",
      };
    });
  }
  async media(auth: AccessClaims, id: string) {
    await this.sessionQuery(auth, id);
    return (
      await this.db.query<any>(
        "SELECT id,media_type,mime_type,size_bytes,checksum,status,created_at,ready_at FROM service_session_media WHERE tenant_id=$1 AND service_session_id=$2 AND status<>'DELETED' ORDER BY created_at,id",
        [auth.tenantId, id],
      )
    ).rows;
  }
  async deleteMedia(
    auth: AccessClaims,
    id: string,
    mediaId: string,
    requestId: string,
  ) {
    return this.db.transaction(async (c) => {
      const session = await this.lockSession(c, auth, id);
      await this.assertSessionExecutionAccess(c, auth, session);
      const row = (
        await c.query<any>(
          "UPDATE service_session_media SET status='DELETED',deleted_at=now() WHERE tenant_id=$1 AND service_session_id=$2 AND id=$3 AND status<>'DELETED' RETURNING id,status,deleted_at",
          [auth.tenantId, id, mediaId],
        )
      ).rows[0];
      if (!row)
        throw new NotFoundException({
          code: "MEDIA_UPLOAD_NOT_FOUND",
          message: "Media not found",
        });
      await this.record(
        c,
        auth,
        session.branch_id,
        "service_session.media_deleted",
        "service_session",
        id,
        session.version,
        requestId,
        { sessionId: id, mediaId, branchId: session.branch_id, refetch: true },
      );
      return row;
    });
  }

  async checkout(auth: AccessClaims, id: string) {
    const a = await this.appointmentQuery(auth, id);
    const rows = (
      await this.db.query<any>(
        `SELECT ai.id,ai.service_id,ai.item_source,ai.status item_status,ai.service_snapshot_json,ai.price_snapshot_json,s.status session_status,s.actual_started_at,s.actual_ended_at,s.actual_work_seconds,COALESCE((SELECT jsonb_agg(jsonb_build_object('staffId',x.staff_id,'workSeconds',GREATEST(0,extract(epoch FROM (COALESCE(x.ended_at,s.actual_ended_at,now())-x.started_at))::int)) ORDER BY x.started_at) FROM service_session_staff_segments x WHERE x.tenant_id=ai.tenant_id AND x.service_session_id=s.id),'[]') contributions FROM appointment_items ai LEFT JOIN service_sessions s ON s.tenant_id=ai.tenant_id AND s.appointment_item_id=ai.id WHERE ai.tenant_id=$1 AND ai.appointment_id=$2 ORDER BY ai.sequence_no`,
        [auth.tenantId, id],
      )
    ).rows;
    const subtotal = rows
      .filter((x) => x.item_status !== "CANCELLED")
      .reduce((n, x) => n + Number(x.price_snapshot_json?.amountMinor ?? 0), 0);
    return {
      appointmentId: id,
      bookingReference: a.booking_reference,
      checkoutReady: a.checkout_ready,
      status: a.status,
      customer: {
        id: a.customer_id,
        displayName: a.contact_snapshot_json.displayName,
      },
      items: rows.map((x) => ({
        appointmentItemId: x.id,
        serviceId: x.service_id,
        serviceName:
          x.service_snapshot_json?.name?.[a.locale] ??
          x.service_snapshot_json?.code,
        itemSource: x.item_source,
        status: x.item_status === "CANCELLED" ? "CANCELLED" : x.session_status,
        priceSnapshot: x.price_snapshot_json,
        actualStartedAt: x.actual_started_at,
        actualEndedAt: x.actual_ended_at,
        actualWorkSeconds: Number(x.actual_work_seconds ?? 0),
        staffContributions: x.contributions,
      })),
      pricingPreview: {
        subtotalMinor: subtotal,
        currency: a.pricing_summary_json?.currency ?? "VND",
      },
    };
  }
  async board(auth: AccessClaims, q: any) {
    this.deny(auth);
    this.branch(auth, q.branchId);
    const branch = (
        await this.db.query<any>(
          "SELECT timezone FROM branches WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, q.branchId],
        )
      ).rows[0],
      localDate = q.date ?? branchLocalDate(new Date(), branch.timezone),
      { startUtc: from, endUtc: to } = branchLocalDayRange(
        localDate,
        branch.timezone,
      );
    const [appointments, walkins, versionRow] = await Promise.all([
      this.db.query<any>(
        `SELECT a.id,a.booking_reference,a.status,a.start_at,a.end_at,a.checkout_ready,a.contact_snapshot_json,ar.arrived_at,ar.late_minutes,ar.early_minutes,COALESCE(jsonb_agg(jsonb_build_object('sessionId',s.id,'status',s.status,'service',ai.service_snapshot_json,'staffId',seg.staff_id)) FILTER(WHERE ai.id IS NOT NULL),'[]') items FROM appointments a LEFT JOIN appointment_arrivals ar ON ar.tenant_id=a.tenant_id AND ar.appointment_id=a.id AND ar.reverted_at IS NULL LEFT JOIN appointment_items ai ON ai.tenant_id=a.tenant_id AND ai.appointment_id=a.id LEFT JOIN service_sessions s ON s.tenant_id=ai.tenant_id AND s.appointment_item_id=ai.id LEFT JOIN service_session_staff_segments seg ON seg.tenant_id=s.tenant_id AND seg.service_session_id=s.id AND seg.ended_at IS NULL WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.end_at>$3 AND a.start_at<$4 AND a.status NOT IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SALON','EXPIRED') GROUP BY a.id,ar.id ORDER BY a.start_at`,
        [auth.tenantId, q.branchId, from, to],
      ),
      this.db.query<any>(
        "SELECT * FROM walk_in_entries WHERE tenant_id=$1 AND branch_id=$2 AND local_queue_date=$3::date AND status IN ('WAITING','READY','CALLED') ORDER BY CASE priority WHEN 'MANAGER_OVERRIDE' THEN 0 WHEN 'RECOVERY' THEN 1 ELSE 2 END,created_at,queue_number",
        [auth.tenantId, q.branchId, localDate],
      ),
      this.db.query<any>(
        "SELECT version,updated_at FROM branch_operational_versions WHERE tenant_id=$1 AND branch_id=$2",
        [auth.tenantId, q.branchId],
      ),
    ]);
    return {
      branchId: q.branchId,
      localDate,
      timezone: branch.timezone,
      dataVersion: Number(versionRow.rows[0]?.version ?? 1),
      generatedAt: new Date().toISOString(),
      columns: this.columns(appointments.rows),
      walkIns: walkins.rows.map((x) => ({
        id: x.id,
        queueNumber: x.queue_number,
        displayName: x.contact_snapshot_json.displayName,
        status: x.status,
        estimatedStartAt: x.estimated_start_at,
        estimatedWaitMinutes: x.estimated_wait_minutes,
        version: x.version,
      })),
    };
  }
  async summary(auth: AccessClaims, q: any) {
    const board = await this.board(auth, q),
      all = Object.values(board.columns).flat() as any[];
    return {
      branchId: q.branchId,
      waitingCount: board.walkIns.length + board.columns.WAITING.length,
      inServiceCount: board.columns.IN_SERVICE.length,
      readyCheckoutCount: board.columns.READY_FOR_CHECKOUT.length,
      currentDelayCount: all.filter((x) => x.lateMinutes > 0).length,
      staffUtilization: {
        activeStaffIds: [
          ...new Set(
            all.flatMap(
              (x) => x.items?.map((i: any) => i.staffId).filter(Boolean) ?? [],
            ),
          ),
        ],
      },
      generatedAt: board.generatedAt,
    };
  }
  async today(auth: AccessClaims) {
    const staff = await this.ownStaff(auth),
      now = new Date(),
      branches = (
        await this.db.query<any>(
          `SELECT DISTINCT b.id branch_id,b.name branch_name,b.timezone
           FROM branches b JOIN staff_branch_assignments sba ON sba.tenant_id=b.tenant_id AND sba.branch_id=b.id
           WHERE b.tenant_id=$1 AND sba.staff_id=$2 AND sba.status='ACTIVE'
             AND (now() AT TIME ZONE b.timezone)::date BETWEEN sba.effective_from AND COALESCE(sba.effective_to,'infinity'::date)`,
          [auth.tenantId, staff],
        )
      ).rows.map((branch) => {
        const localDate = branchLocalDate(now, branch.timezone),
          range = branchLocalDayRange(localDate, branch.timezone);
        return { ...branch, localDate, ...range };
      });
    if (!branches.length)
      return {
        staffId: staff,
        localDate: branchLocalDate(now, "UTC"),
        branches: [],
        currentService: null,
        nextAppointment: null,
        upcomingServices: [],
        completedToday: [],
        offlinePolicy: {
          commandsRequireInternet: true,
          notesDraftAllowed: true,
          mediaMetadataQueueAllowed: true,
        },
      };
    const start = branches.reduce(
        (value, branch) => (branch.startUtc < value ? branch.startUtc : value),
        branches[0].startUtc,
      ),
      end = branches.reduce(
        (value, branch) => (branch.endUtc > value ? branch.endUtc : value),
        branches[0].endUtc,
      ),
      sessions = await this.db.query<any>(
        `SELECT s.*,a.booking_reference,a.contact_snapshot_json,ai.service_snapshot_json,b.name branch_name,b.timezone
         FROM service_sessions s
         JOIN appointments a ON a.tenant_id=s.tenant_id AND a.id=s.appointment_id
         JOIN appointment_items ai ON ai.tenant_id=s.tenant_id AND ai.id=s.appointment_item_id
         JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
         JOIN appointment_item_staff_assignments asa ON asa.tenant_id=ai.tenant_id AND asa.appointment_item_id=ai.id AND asa.status='ACTIVE' AND asa.assignment_role='PRIMARY' AND asa.staff_id=$2
         WHERE s.tenant_id=$1 AND s.scheduled_start_at >= $3 AND s.scheduled_start_at < $4
         ORDER BY s.scheduled_start_at`,
        [auth.tenantId, staff, start, end],
      );
    const grouped = branches.map((branch) => {
        const rows = sessions.rows.filter(
          (session) =>
            session.branch_id === branch.branch_id &&
            branchLocalDate(session.scheduled_start_at, branch.timezone) ===
              branch.localDate,
        );
        return {
          branchId: branch.branch_id,
          branchName: branch.branch_name,
          timezone: branch.timezone,
          localDate: branch.localDate,
          currentService:
            rows.find((x) => ["IN_PROGRESS", "PAUSED"].includes(x.status)) ??
            null,
          nextAppointment: rows.find((x) => x.status === "PENDING") ?? null,
          upcomingServices: rows
            .filter((x) => x.status === "PENDING")
            .map((x) => this.sessionView(x, true)),
          completedToday: rows
            .filter((x) => x.status === "COMPLETED")
            .map((x) => this.sessionView(x, true)),
        };
      }),
      allUpcoming = grouped.flatMap((branch) => branch.upcomingServices),
      allCompleted = grouped.flatMap((branch) => branch.completedToday);
    return {
      staffId: staff,
      localDate: grouped[0]?.localDate,
      branches: grouped,
      currentService:
        grouped.find((branch) => branch.currentService)?.currentService ?? null,
      nextAppointment: allUpcoming[0] ?? null,
      upcomingServices: allUpcoming,
      completedToday: allCompleted,
      offlinePolicy: {
        commandsRequireInternet: true,
        notesDraftAllowed: true,
        mediaMetadataQueueAllowed: true,
      },
    };
  }

  private async appointment(
    c: PoolClient,
    auth: AccessClaims,
    id: string,
    lock = false,
  ) {
    this.deny(auth);
    const a = (
      await c.query<any>(
        `SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!a)
      throw new NotFoundException({
        code: "BOOKING_NOT_FOUND",
        message: "Appointment not found",
      });
    this.branch(auth, a.branch_id);
    return a;
  }
  private async appointmentQuery(auth: AccessClaims, id: string) {
    return this.db.transaction((c) => this.appointment(c, auth, id));
  }
  private async lockSession(c: PoolClient, auth: AccessClaims, id: string) {
    this.deny(auth);
    const s = (
      await c.query<any>(
        "SELECT * FROM service_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!s)
      throw new NotFoundException({
        code: "SERVICE_SESSION_NOT_FOUND",
        message: "Service session not found",
      });
    this.branch(auth, s.branch_id);
    if (auth.roles.includes("NAIL_TECHNICIAN")) {
      const own = await this.ownStaff(auth, c),
        assigned = await c.query(
          "SELECT 1 FROM appointment_item_staff_assignments WHERE tenant_id=$1 AND appointment_item_id=$2 AND staff_id=$3 AND status='ACTIVE' UNION SELECT 1 FROM service_session_staff_segments WHERE tenant_id=$1 AND service_session_id=$4 AND staff_id=$3",
          [auth.tenantId, s.appointment_item_id, own, id],
        );
      if (!assigned.rowCount)
        throw new ForbiddenException({
          code: "SERVICE_SESSION_SCOPE_DENIED",
          message: "Technician can only access assigned sessions",
        });
    }
    return s;
  }
  private async sessionQuery(auth: AccessClaims, id: string) {
    return this.db.transaction((c) => this.lockSession(c, auth, id));
  }
  private async assertSessionExecutionAccess(
    c: PoolClient,
    auth: AccessClaims,
    session: any,
  ) {
    if (!auth.roles.includes("NAIL_TECHNICIAN")) return;
    const own = await this.ownStaff(auth, c),
      current = (
        await c.query<any>(
          `SELECT asa.staff_id assigned_staff_id,seg.staff_id open_staff_id
           FROM appointment_item_staff_assignments asa
           LEFT JOIN service_session_staff_segments seg ON seg.tenant_id=asa.tenant_id
             AND seg.service_session_id=$4 AND seg.segment_role='PRIMARY' AND seg.ended_at IS NULL
           WHERE asa.tenant_id=$1 AND asa.appointment_item_id=$2
             AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE' AND asa.staff_id=$3`,
          [auth.tenantId, session.appointment_item_id, own, session.id],
        )
      ).rows[0];
    const ownsAssignment = current?.assigned_staff_id === own,
      ownsOpenWork = current?.open_staff_id === own;
    if (!ownsAssignment || (session.status === "IN_PROGRESS" && !ownsOpenWork))
      throw new ForbiddenException({
        code: "SERVICE_SESSION_SCOPE_DENIED",
        message: "Only the current primary technician may execute this session",
      });
  }
  private async assertPrimaryAssignment(
    c: PoolClient,
    auth: AccessClaims,
    session: any,
    staffId: string,
  ) {
    const row = (
      await c.query<any>(
        `SELECT asa.staff_id,
           EXISTS(SELECT 1 FROM staff_schedule_reservations ssr
             WHERE ssr.tenant_id=asa.tenant_id AND ssr.appointment_item_id=asa.appointment_item_id
               AND ssr.staff_id=asa.staff_id AND ssr.status='ACTIVE') reservation_matches
         FROM appointment_item_staff_assignments asa
         WHERE asa.tenant_id=$1 AND asa.appointment_item_id=$2
           AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE' FOR UPDATE`,
        [auth.tenantId, session.appointment_item_id],
      )
    ).rows[0];
    if (!row || row.staff_id !== staffId || row.reservation_matches !== true)
      throw new ConflictException({
        code: "SERVICE_SESSION_STAFF_NOT_ASSIGNED",
        message:
          "Start/resume requires the active primary assignment and matching reservation; reassign first",
      });
  }
  private async assertBranchActive(
    c: PoolClient,
    tenantId: string,
    branchId: string,
  ) {
    const row = await c.query(
      "SELECT 1 FROM branches WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
      [tenantId, branchId],
    );
    if (!row.rowCount)
      throw new ConflictException({
        code: "BRANCH_INACTIVE",
        message: "Branch is not active for operational writes",
      });
  }
  private async ownStaff(auth: AccessClaims, c?: PoolClient) {
    if (auth.ownStaffId) return auth.ownStaffId;
    const row = (
      c
        ? await c.query<any>(
            "SELECT id FROM staff_profiles WHERE tenant_id=$1 AND membership_id=$2 AND status='ACTIVE'",
            [auth.tenantId, auth.membershipId],
          )
        : await this.db.query<any>(
            "SELECT id FROM staff_profiles WHERE tenant_id=$1 AND membership_id=$2 AND status='ACTIVE'",
            [auth.tenantId, auth.membershipId],
          )
    ).rows[0];
    if (!row)
      throw new ForbiddenException({
        code: "STAFF_PROFILE_REQUIRED",
        message: "Active staff profile is required",
      });
    return row.id;
  }
  private async qualify(
    c: PoolClient,
    auth: AccessClaims,
    s: any,
    staffId: string,
  ) {
    if (
      auth.roles.includes("NAIL_TECHNICIAN") &&
      (await this.ownStaff(auth, c)) !== staffId
    )
      throw new ForbiddenException({
        code: "SERVICE_SESSION_SCOPE_DENIED",
        message: "Technician can only act as self",
      });
    const ok = await c.query(
      `SELECT 1 FROM staff_profiles sp
       JOIN staff_branch_assignments sba ON sba.tenant_id=sp.tenant_id AND sba.staff_id=sp.id AND sba.branch_id=$3 AND sba.status='ACTIVE'
       JOIN branches b ON b.tenant_id=sp.tenant_id AND b.id=sba.branch_id
       WHERE sp.tenant_id=$1 AND sp.id=$2 AND sp.status='ACTIVE'
         AND (now() AT TIME ZONE b.timezone)::date BETWEEN sba.effective_from AND COALESCE(sba.effective_to,'infinity'::date)
         AND NOT EXISTS (SELECT 1 FROM appointment_items ai JOIN service_skill_requirements req ON req.tenant_id=ai.tenant_id AND req.service_id=ai.service_id AND req.is_required LEFT JOIN staff_skills ss ON ss.tenant_id=req.tenant_id AND ss.staff_id=sp.id AND ss.skill_id=req.skill_id AND ss.status='ACTIVE' AND (ss.expires_at IS NULL OR ss.expires_at>=(now() AT TIME ZONE b.timezone)::date) WHERE ai.tenant_id=$1 AND ai.id=$4 AND (ss.skill_id IS NULL OR ss.proficiency_level<req.minimum_proficiency))`,
      [auth.tenantId, staffId, s.branch_id, s.appointment_item_id],
    );
    if (!ok.rowCount)
      throw new ConflictException({
        code: "SERVICE_SESSION_STAFF_NOT_QUALIFIED",
        message: "Staff is inactive, out of branch, or missing required skill",
      });
  }
  private async derive(
    c: PoolClient,
    auth: AccessClaims,
    id: string,
    requestId: string,
  ) {
    const a = (
      await c.query<any>(
        "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (
      ["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SALON", "EXPIRED"].includes(
        a.status,
      )
    )
      return a;
    const rows = (
        await c.query<any>(
          "SELECT ai.status item_status,s.status session_status FROM appointment_items ai LEFT JOIN service_sessions s ON s.tenant_id=ai.tenant_id AND s.appointment_item_id=ai.id WHERE ai.tenant_id=$1 AND ai.appointment_id=$2",
          [auth.tenantId, id],
        )
      ).rows,
      active = rows.filter((x) => x.item_status !== "CANCELLED"),
      completed = active.filter((x) => x.session_status === "COMPLETED").length,
      anyActive = rows.some((x) =>
        ["IN_PROGRESS", "PAUSED"].includes(x.session_status),
      );
    let status = a.status,
      ready = false;
    if (anyActive) status = "IN_SERVICE";
    else if (
      active.length > 0 &&
      completed === active.length &&
      !rows.some((x) => x.item_status === "CANCELLED")
    ) {
      status = "COMPLETED";
      ready = true;
    } else if (completed > 0) {
      status = "PARTIALLY_COMPLETED";
      ready = rows.every(
        (x) =>
          x.item_status === "CANCELLED" || x.session_status === "COMPLETED",
      );
    } else if (a.status !== "CONFIRMED") status = "CHECKED_IN";
    if (status === a.status && ready === a.checkout_ready) return a;
    const updated = (
      await c.query<any>(
        "UPDATE appointments SET status=$3,checkout_ready=$4,version=version+1,updated_at=now(),updated_by_user_id=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *",
        [auth.tenantId, id, status, ready, auth.userId],
      )
    ).rows[0];
    if (status !== a.status)
      await this.statusHistory(c, auth, id, a.status, status, requestId);
    await this.record(
      c,
      auth,
      a.branch_id,
      "appointment.operational_status_changed",
      "appointment",
      id,
      updated.version,
      requestId,
      {
        appointmentId: id,
        branchId: a.branch_id,
        status,
        checkoutReady: ready,
        refetch: true,
      },
    );
    if (ready)
      await this.record(
        c,
        auth,
        a.branch_id,
        "appointment.checkout_ready",
        "appointment",
        id,
        updated.version,
        requestId,
        {
          appointmentId: id,
          branchId: a.branch_id,
          checkoutReady: true,
          refetch: true,
        },
      );
    return updated;
  }
  private async policy(c: PoolClient, tenant: string, branch: string) {
    return (
      (
        await c.query<any>(
          "SELECT booking_policy_json FROM branch_settings WHERE tenant_id=$1 AND branch_id=$2",
          [tenant, branch],
        )
      ).rows[0]?.booking_policy_json ?? {}
    );
  }
  private async statusHistory(
    c: PoolClient,
    auth: AccessClaims,
    id: string,
    from: string,
    to: string,
    requestId: string,
    note?: string,
  ) {
    await c.query(
      "INSERT INTO appointment_status_history(tenant_id,appointment_id,from_status,to_status,actor_type,actor_user_id,note,request_id) VALUES($1,$2,$3,$4,'USER',$5,$6,$7)",
      [auth.tenantId, id, from, to, auth.userId, note ?? null, requestId],
    );
  }
  private async record(
    c: PoolClient,
    auth: AccessClaims,
    branch: string,
    event: string,
    type: string,
    id: string,
    versionNo: number,
    requestId: string,
    payload: any,
    reason?: string,
  ) {
    await c.query(
      "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        auth.tenantId,
        branch,
        auth.userId,
        event,
        type,
        id,
        JSON.stringify(payload),
        reason ?? null,
        requestId,
      ],
    );
    await c.query(
      "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        auth.tenantId,
        branch,
        event,
        type,
        id,
        versionNo,
        JSON.stringify(payload),
        JSON.stringify({ type: "USER", id: auth.userId }),
        JSON.stringify({
          schemaVersion: 1,
          realtimeEvent:
            type === "appointment"
              ? "appointment.updated"
              : "service_session.updated",
        }),
      ],
    );
  }
  private columns(rows: any[]) {
    const c: any = {
      UPCOMING: [],
      ARRIVED: [],
      WAITING: [],
      IN_SERVICE: [],
      PARTIALLY_COMPLETED: [],
      READY_FOR_CHECKOUT: [],
    };
    for (const a of rows) {
      const card = {
        id: a.id,
        bookingReference: a.booking_reference,
        customerDisplayName: a.contact_snapshot_json?.displayName,
        startAt: a.start_at,
        endAt: a.end_at,
        status: a.status,
        checkoutReady: a.checkout_ready,
        arrivedAt: a.arrived_at,
        lateMinutes: a.late_minutes,
        earlyMinutes: a.early_minutes,
        items: a.items,
      };
      const col = a.checkout_ready
        ? "READY_FOR_CHECKOUT"
        : a.status === "IN_SERVICE"
          ? "IN_SERVICE"
          : a.status === "PARTIALLY_COMPLETED"
            ? "PARTIALLY_COMPLETED"
            : a.status === "CHECKED_IN"
              ? a.items?.some((x: any) => x.status === "PENDING")
                ? "WAITING"
                : "ARRIVED"
              : a.arrived_at
                ? "ARRIVED"
                : "UPCOMING";
      c[col].push(card);
    }
    return c;
  }
  private sessionView(x: any, privacy: boolean) {
    return {
      id: x.id,
      appointmentId: x.appointment_id,
      appointmentItemId: x.appointment_item_id,
      branchId: x.branch_id,
      bookingReference: x.booking_reference,
      customerDisplayName: x.contact_snapshot_json?.displayName,
      service: x.service_snapshot_json,
      status: x.status,
      scheduledStartAt: x.scheduled_start_at,
      scheduledEndAt: x.scheduled_end_at,
      actualStartedAt: x.actual_started_at ?? undefined,
      actualEndedAt: x.actual_ended_at ?? undefined,
      totalPauseSeconds: Number(x.total_pause_seconds),
      actualWorkSeconds: Number(x.actual_work_seconds),
      currentStaffId: x.current_staff_id ?? undefined,
      completionNote: privacy ? undefined : x.completion_note,
      version: Number(x.version),
    };
  }
  private arrivalView(x: any) {
    return {
      id: x.id,
      appointmentId: x.appointment_id,
      branchId: x.branch_id,
      arrivalMethod: x.arrival_method,
      arrivedAt: x.arrived_at,
      checkedInAt: x.checked_in_at ?? undefined,
      lateMinutes: Number(x.late_minutes),
      earlyMinutes: Number(x.early_minutes),
      partySize: Number(x.party_size),
      note: x.note ?? undefined,
      version: Number(x.version),
    };
  }
  private appointmentView(x: any) {
    return {
      id: x.id,
      bookingReference: x.booking_reference,
      branchId: x.branch_id,
      status: x.status,
      checkoutReady: x.checkout_ready,
      version: Number(x.version),
    };
  }
}
function version(code: string) {
  return new ConflictException({
    code,
    message: "Resource changed; refresh and retry",
  });
}
