/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { DateTime } from "luxon";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import {
  assertPayrollTransition,
  assertPayoutTransition,
  assertTimesheetTransition,
  calculateHourlyMinor,
  calculateNetPay,
  deterministicFingerprint,
  elapsedSeconds,
  providerConfigured,
  redactWorkforceEvidence,
  type PayrollRunState,
  type PayoutState,
  type TimesheetState,
} from "./workforce-domain.js";

@Injectable()
export class WorkforceService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
  ) {}
  private tenant(a: AccessClaims) {
    if (!a.tenantId || a.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "TENANT_ACCESS_DENIED",
        message: "Salon support access grant required",
      });
  }
  private branch(a: AccessClaims, id: string) {
    this.tenant(a);
    if (!a.roles.includes("SALON_OWNER") && !a.branchIds.includes(id))
      throw new ForbiddenException({
        code: "TIME_CLOCK_BRANCH_ACCESS_DENIED",
        message: "Branch access denied",
      });
  }
  private ownStaff(a: AccessClaims) {
    this.tenant(a);
    if (!a.ownStaffId)
      throw new ForbiddenException({
        code: "STAFF_SCOPE_REQUIRED",
        message: "Staff profile required",
      });
    return a.ownStaffId;
  }
  private required(value: any, name: string) {
    if (!value)
      throw new ConflictException({
        code: "VALIDATION_FAILED",
        message: `${name} is required`,
      });
    return String(value);
  }
  private async command<T>(
    a: AccessClaims,
    key: string,
    name: string,
    request: unknown,
    work: (c: PoolClient) => Promise<T>,
  ) {
    this.tenant(a);
    return this.db
      .transaction((c) =>
        this.idem.execute(c, {
          tenantId: a.tenantId,
          actorScope: `user:${a.userId}`,
          command: name,
          key,
          request,
          work: () => work(c),
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  private async emit(
    c: PoolClient,
    a: AccessClaims,
    event: string,
    type: string,
    id: string,
    branchId: string | null,
    requestId: string,
    before: any,
    after: any,
    reason?: string,
    key?: string,
  ) {
    const safeBefore = before ? redactWorkforceEvidence(before) : null,
      safeAfter = after ? redactWorkforceEvidence(after) : null;
    await c.query(
      `INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        a.tenantId,
        branchId,
        a.userId,
        event,
        type,
        id,
        safeBefore ? JSON.stringify(safeBefore) : null,
        safeAfter ? JSON.stringify(safeAfter) : null,
        reason ?? null,
        requestId,
      ],
    );
    await c.query(
      `INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        a.tenantId,
        branchId,
        event,
        type,
        id,
        JSON.stringify({ id, refetch: true }),
        JSON.stringify({ type: "USER", id: a.userId }),
        JSON.stringify({
          schemaVersion: 1,
          idempotencyKeyHash: key ? this.idem.subject(key) : null,
        }),
      ],
    );
  }
  private view(row: any) {
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, x) => x.toUpperCase()),
        v,
      ]),
    );
  }

  private allocate(total: bigint, weights: bigint[]) {
    const sum = weights.reduce((value, item) => value + item, 0n);
    if (sum <= 0n) return weights.map(() => 0n);
    let used = 0n;
    return weights.map((weight, index) => {
      const value =
        index === weights.length - 1 ? total - used : (total * weight) / sum;
      used += value;
      return value;
    });
  }

  private async rebuildTimesheet(
    c: PoolClient,
    tenantId: string,
    timesheetId: string,
  ) {
    const sheet = (
      await c.query<any>(
        `SELECT t.*,p.starts_on::text starts_on,p.ends_on::text ends_on,p.timezone
         FROM staff_timesheets t JOIN timesheet_periods p ON p.tenant_id=t.tenant_id AND p.id=t.period_id
         WHERE t.tenant_id=$1 AND t.id=$2 FOR UPDATE OF t`,
        [tenantId, timesheetId],
      )
    ).rows[0];
    if (!sheet)
      throw new NotFoundException({
        code: "TIMESHEET_NOT_FOUND",
        message: "Timesheet not found",
      });
    if (sheet.state === "LOCKED" || sheet.source_locked_at)
      throw new ConflictException({
        code: "TIMESHEET_LOCKED",
        message: "Locked timesheet projection is immutable",
      });

    const sessions = (
      await c.query<any>(
        `SELECT s.*,b.timezone branch_timezone
         FROM attendance_sessions s JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
         WHERE s.tenant_id=$1 AND s.staff_id=$2 AND s.ended_at IS NOT NULL
           AND (s.started_at AT TIME ZONE b.timezone)::date <= $4::date
           AND (s.ended_at AT TIME ZONE b.timezone)::date >= $3::date
           AND s.state IN('CLOSED','REVIEW_REQUIRED','ADJUSTED')
         ORDER BY s.started_at,s.id FOR SHARE OF s`,
        [tenantId, sheet.staff_id, sheet.starts_on, sheet.ends_on],
      )
    ).rows;
    const entries = new Map<
      string,
      {
        localDate: string;
        branchId: string;
        sessionIds: string[];
        regular: bigint;
        overtime: bigint;
        payable: bigint;
        paidBreak: bigint;
        unpaidBreak: bigint;
      }
    >();
    for (const session of sessions) {
      const zone = session.branch_timezone || sheet.timezone;
      const start = DateTime.fromJSDate(new Date(session.started_at), {
        zone: "utc",
      }).setZone(zone);
      const end = DateTime.fromJSDate(new Date(session.ended_at), {
        zone: "utc",
      }).setZone(zone);
      const slices: Array<{ date: string; seconds: bigint }> = [];
      let cursor = start;
      while (cursor < end) {
        const boundary = cursor.startOf("day").plus({ days: 1 });
        const sliceEnd = boundary < end ? boundary : end;
        const seconds = BigInt(
          Math.max(0, Math.floor(sliceEnd.diff(cursor, "seconds").seconds)),
        );
        if (seconds > 0n) slices.push({ date: cursor.toISODate()!, seconds });
        cursor = sliceEnd;
      }
      const weights = slices.map((slice) => slice.seconds);
      const regular = this.allocate(BigInt(session.regular_seconds), weights);
      const overtime = this.allocate(BigInt(session.overtime_seconds), weights);
      const payable = this.allocate(BigInt(session.payable_seconds), weights);
      const paidBreak = this.allocate(
        BigInt(session.paid_break_seconds),
        weights,
      );
      const unpaidBreak = this.allocate(
        BigInt(session.unpaid_break_seconds),
        weights,
      );
      slices.forEach((slice, index) => {
        if (
          slice.date < String(sheet.starts_on) ||
          slice.date > String(sheet.ends_on)
        )
          return;
        const mapKey = `${slice.date}:${session.branch_id}`;
        const entry =
          entries.get(mapKey) ??
          ({
            localDate: slice.date,
            branchId: session.branch_id,
            sessionIds: [] as string[],
            regular: 0n,
            overtime: 0n,
            payable: 0n,
            paidBreak: 0n,
            unpaidBreak: 0n,
          } satisfies typeof entries extends Map<string, infer V> ? V : never);
        entry.sessionIds.push(session.id);
        entry.regular += regular[index]!;
        entry.overtime += overtime[index]!;
        entry.payable += payable[index]!;
        entry.paidBreak += paidBreak[index]!;
        entry.unpaidBreak += unpaidBreak[index]!;
        entries.set(mapKey, entry);
      });
    }
    const ordered = [...entries.values()].sort((left, right) =>
      `${left.localDate}:${left.branchId}`.localeCompare(
        `${right.localDate}:${right.branchId}`,
      ),
    );
    const inputFingerprint = deterministicFingerprint(
      sessions.map((session: any) => ({
        id: session.id,
        fingerprint: session.fingerprint,
        version: session.version,
      })),
    );
    const fingerprint = deterministicFingerprint(
      ordered.map((entry) => ({
        ...entry,
        regular: entry.regular.toString(),
        overtime: entry.overtime.toString(),
        payable: entry.payable.toString(),
        paidBreak: entry.paidBreak.toString(),
        unpaidBreak: entry.unpaidBreak.toString(),
      })),
    );
    await c.query(
      "DELETE FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id=$2",
      [tenantId, timesheetId],
    );
    for (const entry of ordered)
      await c.query(
        `INSERT INTO timesheet_day_entries(
           tenant_id,timesheet_id,local_date,branch_id,source_session_ids,
           regular_seconds,overtime_seconds,payable_seconds,paid_break_seconds,unpaid_break_seconds,fingerprint
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          tenantId,
          timesheetId,
          entry.localDate,
          entry.branchId,
          entry.sessionIds,
          entry.regular.toString(),
          entry.overtime.toString(),
          entry.payable.toString(),
          entry.paidBreak.toString(),
          entry.unpaidBreak.toString(),
          deterministicFingerprint(entry),
        ],
      );
    const totals = ordered.reduce(
      (value, entry) => ({
        regular: value.regular + entry.regular,
        overtime: value.overtime + entry.overtime,
        payable: value.payable + entry.payable,
        paidBreak: value.paidBreak + entry.paidBreak,
        unpaidBreak: value.unpaidBreak + entry.unpaidBreak,
      }),
      {
        regular: 0n,
        overtime: 0n,
        payable: 0n,
        paidBreak: 0n,
        unpaidBreak: 0n,
      },
    );
    const branchAllocation = Object.fromEntries(
      ordered.map((entry) => [
        `${entry.localDate}:${entry.branchId}`,
        entry.payable.toString(),
      ]),
    );
    return (
      await c.query<any>(
        `UPDATE staff_timesheets SET regular_seconds=$3,overtime_seconds=$4,payable_seconds=$5,
           paid_break_seconds=$6,unpaid_break_seconds=$7,branch_allocation_json=$8,
           fingerprint=$9,projection_input_fingerprint=$10,projected_at=now(),
           state=CASE WHEN state='APPROVED' THEN 'REOPENED' ELSE state END,
           approved_by_user_id=CASE WHEN state='APPROVED' THEN NULL ELSE approved_by_user_id END,
           approved_fingerprint=CASE WHEN state='APPROVED' THEN NULL ELSE approved_fingerprint END,
           version=version+1,updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [
          tenantId,
          timesheetId,
          totals.regular.toString(),
          totals.overtime.toString(),
          totals.payable.toString(),
          totals.paidBreak.toString(),
          totals.unpaidBreak.toString(),
          JSON.stringify(branchAllocation),
          fingerprint,
          inputFingerprint,
        ],
      )
    ).rows[0];
  }

  private async projectClosedSession(
    c: PoolClient,
    a: AccessClaims,
    session: any,
  ) {
    const bounds = (
      await c.query<any>(
        `SELECT (s.started_at AT TIME ZONE b.timezone)::date::text starts_on,
                (s.ended_at AT TIME ZONE b.timezone)::date::text ends_on,b.timezone
         FROM attendance_sessions s JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
         WHERE s.tenant_id=$1 AND s.id=$2`,
        [a.tenantId, session.id],
      )
    ).rows[0];
    let period = (
      await c.query<any>(
        `SELECT * FROM timesheet_periods WHERE tenant_id=$1 AND starts_on<=$2 AND ends_on>=$3 AND state<>'LOCKED'
         ORDER BY starts_on DESC LIMIT 1 FOR UPDATE`,
        [a.tenantId, bounds.starts_on, bounds.ends_on],
      )
    ).rows[0];
    if (!period) {
      period = (
        await c.query<any>(
          `INSERT INTO timesheet_periods(tenant_id,code,starts_on,ends_on,timezone)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(tenant_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING *`,
          [
            a.tenantId,
            `AUTO-${bounds.starts_on}-${bounds.ends_on}`,
            bounds.starts_on,
            bounds.ends_on,
            bounds.timezone,
          ],
        )
      ).rows[0];
    }
    const sheet = (
      await c.query<any>(
        `INSERT INTO staff_timesheets(tenant_id,period_id,staff_id,fingerprint)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(tenant_id,period_id,staff_id) DO UPDATE SET updated_at=staff_timesheets.updated_at
         RETURNING *`,
        [a.tenantId, period.id, session.staff_id, deterministicFingerprint([])],
      )
    ).rows[0];
    return this.rebuildTimesheet(c, a.tenantId, sheet.id);
  }

  private async assertTimesheetClear(
    c: PoolClient,
    tenantId: string,
    sheet: any,
    transition: TimesheetState,
  ) {
    const blockers = (
      await c.query<any>(
        `SELECT
           EXISTS(
             SELECT 1 FROM attendance_sessions s JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
             WHERE s.tenant_id=t.tenant_id AND s.staff_id=t.staff_id AND s.state='OPEN'
               AND (s.started_at AT TIME ZONE b.timezone)::date BETWEEN p.starts_on AND p.ends_on
           ) open_session,
           EXISTS(
             SELECT 1 FROM attendance_breaks br JOIN attendance_sessions s ON s.tenant_id=br.tenant_id AND s.id=br.session_id
             JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
             WHERE br.tenant_id=t.tenant_id AND s.staff_id=t.staff_id AND br.state='OPEN'
               AND (br.started_at AT TIME ZONE b.timezone)::date BETWEEN p.starts_on AND p.ends_on
           ) open_break,
           EXISTS(
             SELECT 1 FROM attendance_exceptions e LEFT JOIN attendance_sessions s ON s.tenant_id=e.tenant_id AND s.id=e.session_id
             JOIN branches b ON b.tenant_id=e.tenant_id AND b.id=e.branch_id
             WHERE e.tenant_id=t.tenant_id AND e.staff_id=t.staff_id AND e.severity='BLOCKING'
               AND e.state IN('OPEN','ACKNOWLEDGED')
               AND COALESCE((s.started_at AT TIME ZONE b.timezone)::date,e.created_at::date) BETWEEN p.starts_on AND p.ends_on
           ) blocking_exception,
           EXISTS(
             SELECT 1 FROM timesheet_adjustment_requests r WHERE r.tenant_id=t.tenant_id AND r.timesheet_id=t.id AND r.state='APPROVED'
           ) unapplied_adjustment,
           COALESCE((SELECT sum(d.payable_seconds) FROM timesheet_day_entries d WHERE d.tenant_id=t.tenant_id AND d.timesheet_id=t.id),0)::text entry_payable,
           (SELECT count(*) FROM timesheet_day_entries d WHERE d.tenant_id=t.tenant_id AND d.timesheet_id=t.id AND d.branch_id IS NULL)::int missing_branch
         FROM staff_timesheets t JOIN timesheet_periods p ON p.tenant_id=t.tenant_id AND p.id=t.period_id
         WHERE t.tenant_id=$1 AND t.id=$2`,
        [tenantId, sheet.id],
      )
    ).rows[0];
    if (blockers?.open_session || blockers?.open_break)
      throw new ConflictException({
        code: "TIMESHEET_OPEN_ATTENDANCE_SESSION",
        message: "Open attendance session or break blocks review",
      });
    if (blockers?.blocking_exception)
      throw new ConflictException({
        code: "TIMESHEET_HAS_BLOCKING_EXCEPTION",
        message: "Blocking attendance exception must be resolved",
      });
    if (blockers?.unapplied_adjustment)
      throw new ConflictException({
        code: "TIMESHEET_ADJUSTMENT_NOT_APPLIED",
        message: "Approved adjustment must be applied",
      });
    if (
      BigInt(blockers?.entry_payable ?? "0") !==
        BigInt(sheet.payable_seconds) ||
      Number(blockers?.missing_branch ?? 0) > 0 ||
      !sheet.projected_at ||
      !sheet.projection_input_fingerprint
    )
      throw new ConflictException({
        code: "TIMESHEET_PROJECTION_STALE",
        message: "Timesheet projection is stale or incomplete",
      });
    if (
      transition === "APPROVED" &&
      sheet.submitted_fingerprint &&
      sheet.submitted_fingerprint !== sheet.fingerprint
    )
      throw new ConflictException({
        code: "TIMESHEET_FINGERPRINT_CHANGED",
        message: "Timesheet changed after submission",
      });
    if (
      transition === "LOCKED" &&
      sheet.approved_fingerprint !== sheet.fingerprint
    )
      throw new ConflictException({
        code: "TIMESHEET_FINGERPRINT_CHANGED",
        message: "Approved fingerprint no longer matches",
      });
  }

  async clockStatus(a: AccessClaims, staffId?: string) {
    this.tenant(a);
    const id = staffId ?? this.ownStaff(a);
    const session = (
      await this.db.query<any>(
        `SELECT s.*,b.id AS open_break_id,b.break_type FROM attendance_sessions s LEFT JOIN attendance_breaks b ON b.tenant_id=s.tenant_id AND b.session_id=s.id AND b.state='OPEN' WHERE s.tenant_id=$1 AND s.staff_id=$2 AND s.state='OPEN'`,
        [a.tenantId, id],
      )
    ).rows[0];
    return session
      ? {
          clockedIn: true,
          serverNow: new Date().toISOString(),
          session: this.view(session),
        }
      : {
          clockedIn: false,
          serverNow: new Date().toISOString(),
          session: null,
        };
  }
  async clock(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
    eventType: "CLOCK_IN" | "CLOCK_OUT",
    self = false,
  ) {
    const staffId = self
        ? this.ownStaff(a)
        : this.required(body?.staffId, "staffId"),
      branchId = this.required(body?.branchId, "branchId");
    this.branch(a, branchId);
    return this.command(
      a,
      key,
      `time-clock.${eventType.toLowerCase()}`,
      { ...body, staffId, branchId },
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `clock:${a.tenantId}:${staffId}`,
        ]);
        const branch = (
          await c.query<any>(
            "SELECT timezone,status FROM branches WHERE tenant_id=$1 AND id=$2 FOR SHARE",
            [a.tenantId, branchId],
          )
        ).rows[0];
        if (!branch || branch.status !== "ACTIVE")
          throw new ForbiddenException({
            code: "TIME_CLOCK_BRANCH_ACCESS_DENIED",
            message: "Branch unavailable",
          });
        const policy = (
          await c.query<any>(
            "SELECT * FROM time_clock_policies WHERE tenant_id=$1 AND (branch_id=$2 OR branch_id IS NULL) ORDER BY branch_id NULLS LAST LIMIT 1",
            [a.tenantId, branchId],
          )
        ).rows[0];
        if (policy?.geofence_mode === "ENFORCED" && !body?.locationEvidence)
          throw new ConflictException({
            code: "TIME_CLOCK_LOCATION_REQUIRED",
            message: "Location evidence required",
          });
        if (body?.deviceId) {
          const device = (
            await c.query<any>(
              "SELECT status,branch_id FROM time_clock_devices WHERE tenant_id=$1 AND id=$2",
              [a.tenantId, body.deviceId],
            )
          ).rows[0];
          if (
            !device ||
            device.status !== "TRUSTED" ||
            device.branch_id !== branchId
          )
            throw new ConflictException({
              code: "TIME_CLOCK_DEVICE_NOT_TRUSTED",
              message: "Trusted branch device required",
            });
        }
        const open = (
          await c.query<any>(
            "SELECT * FROM attendance_sessions WHERE tenant_id=$1 AND staff_id=$2 AND state='OPEN' FOR UPDATE",
            [a.tenantId, staffId],
          )
        ).rows[0];
        if (eventType === "CLOCK_IN" && open)
          throw new ConflictException({
            code: "TIME_CLOCK_ALREADY_CLOCKED_IN",
            message: "Staff already clocked in",
          });
        if (eventType === "CLOCK_OUT" && !open)
          throw new ConflictException({
            code: "TIME_CLOCK_NOT_CLOCKED_IN",
            message: "Staff is not clocked in",
          });
        const now = new Date();
        const ev = (
          await c.query<any>(
            `INSERT INTO time_clock_events(tenant_id,branch_id,staff_id,event_type,occurred_at,client_occurred_at,branch_timezone_snapshot,source,device_id,location_evidence_json,reason_code,note,actor_user_id,idempotency_key_hash,generation_key,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [
              a.tenantId,
              branchId,
              staffId,
              eventType,
              now,
              body?.clientOccurredAt ?? null,
              branch.timezone,
              body?.source ?? (self ? "STAFF_MOBILE" : "ADMIN_WEB"),
              body?.deviceId ?? null,
              JSON.stringify(
                redactWorkforceEvidence(body?.locationEvidence ?? {}),
              ),
              body?.reasonCode ?? null,
              body?.note ?? null,
              a.userId,
              this.idem.subject(key),
              body?.generationKey ?? null,
              requestId,
            ],
          )
        ).rows[0];
        let session: any;
        if (eventType === "CLOCK_IN") {
          const fp = deterministicFingerprint({
            eventId: ev.id,
            staffId,
            branchId,
            startedAt: now.toISOString(),
          });
          session = (
            await c.query<any>(
              `INSERT INTO attendance_sessions(tenant_id,branch_id,staff_id,clock_in_event_id,started_at,state,fingerprint) VALUES($1,$2,$3,$4,$5,'OPEN',$6) RETURNING *`,
              [a.tenantId, branchId, staffId, ev.id, now, fp],
            )
          ).rows[0];
        } else {
          const activeBreak = (
            await c.query<any>(
              "SELECT * FROM attendance_breaks WHERE tenant_id=$1 AND session_id=$2 AND state='OPEN' FOR UPDATE",
              [a.tenantId, open.id],
            )
          ).rows[0];
          let state = "CLOSED";
          if (activeBreak) {
            state = "REVIEW_REQUIRED";
            await c.query(
              "UPDATE attendance_breaks SET state='CLOSED',end_event_id=$3,ended_at=$4,duration_seconds=GREATEST(0,EXTRACT(EPOCH FROM ($4::timestamptz-started_at))::bigint) WHERE tenant_id=$1 AND id=$2",
              [a.tenantId, activeBreak.id, ev.id, now],
            );
            await this.createAttendanceException(
              c,
              a,
              open,
              "OPEN_BREAK_AT_CLOCK_OUT",
              requestId,
            );
          }
          const total = elapsedSeconds(new Date(open.started_at), now);
          const breaks = (
            await c.query<any>(
              "SELECT COALESCE(sum(duration_seconds) FILTER(WHERE break_type='UNPAID_MEAL'),0)::text unpaid,COALESCE(sum(duration_seconds) FILTER(WHERE break_type<>'UNPAID_MEAL'),0)::text paid FROM attendance_breaks WHERE tenant_id=$1 AND session_id=$2 AND state='CLOSED'",
              [a.tenantId, open.id],
            )
          ).rows[0];
          const unpaid = BigInt(breaks.unpaid),
            paid = BigInt(breaks.paid),
            payable = total > unpaid ? total - unpaid : 0n;
          session = (
            await c.query<any>(
              `UPDATE attendance_sessions SET clock_out_event_id=$3,ended_at=$4,state=$5,regular_seconds=$6,payable_seconds=$6,paid_break_seconds=$7,unpaid_break_seconds=$8,version=version+1,fingerprint=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
              [
                a.tenantId,
                open.id,
                ev.id,
                now,
                state,
                payable.toString(),
                paid.toString(),
                unpaid.toString(),
                deterministicFingerprint({
                  clockIn: open.clock_in_event_id,
                  clockOut: ev.id,
                  payable: payable.toString(),
                }),
              ],
            )
          ).rows[0];
          await this.projectClosedSession(c, a, session);
        }
        await this.emit(
          c,
          a,
          eventType === "CLOCK_IN"
            ? "time_clock.clocked_in"
            : "time_clock.clocked_out",
          "attendance_session",
          session.id,
          branchId,
          requestId,
          null,
          this.view(session),
          body?.reasonCode,
          key,
        );
        return this.view(session);
      },
    );
  }
  private async createAttendanceException(
    c: PoolClient,
    a: AccessClaims,
    session: any,
    type: string,
    requestId: string,
  ) {
    const generation = `${session.id}:${type}`;
    const row = (
      await c.query<any>(
        `INSERT INTO attendance_exceptions(tenant_id,branch_id,staff_id,session_id,exception_type,severity,evidence_json,generation_key) VALUES($1,$2,$3,$4,$5,'WARNING',$6,$7) ON CONFLICT(tenant_id,generation_key) DO UPDATE SET generation_key=EXCLUDED.generation_key RETURNING *`,
        [
          a.tenantId,
          session.branch_id,
          session.staff_id,
          session.id,
          type,
          JSON.stringify({ requestId }),
          generation,
        ],
      )
    ).rows[0];
    return row;
  }
  async breakCommand(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
    action: "start" | "end",
    self = false,
  ) {
    const staffId = self
      ? this.ownStaff(a)
      : this.required(body?.staffId, "staffId");
    return this.command(
      a,
      key,
      `time-clock.break.${action}`,
      { ...body, staffId },
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `clock:${a.tenantId}:${staffId}`,
        ]);
        const session = (
          await c.query<any>(
            "SELECT * FROM attendance_sessions WHERE tenant_id=$1 AND staff_id=$2 AND state='OPEN' FOR UPDATE",
            [a.tenantId, staffId],
          )
        ).rows[0];
        if (!session)
          throw new ConflictException({
            code: "TIME_CLOCK_NOT_CLOCKED_IN",
            message: "Open attendance session required",
          });
        this.branch(a, session.branch_id);
        const open = (
          await c.query<any>(
            "SELECT * FROM attendance_breaks WHERE tenant_id=$1 AND session_id=$2 AND state='OPEN' FOR UPDATE",
            [a.tenantId, session.id],
          )
        ).rows[0];
        if (action === "start" && open)
          throw new ConflictException({
            code: "TIME_CLOCK_BREAK_ALREADY_OPEN",
            message: "Break already open",
          });
        if (action === "end" && !open)
          throw new ConflictException({
            code: "TIME_CLOCK_BREAK_NOT_OPEN",
            message: "No open break",
          });
        const type = action === "start" ? "BREAK_START" : "BREAK_END",
          now = new Date();
        const ev = (
          await c.query<any>(
            `INSERT INTO time_clock_events(tenant_id,branch_id,staff_id,event_type,occurred_at,branch_timezone_snapshot,source,break_type,actor_user_id,idempotency_key_hash,request_id,note) SELECT $1,$2,$3,$4,$5,b.timezone,$6,$7,$8,$9,$10,$11 FROM branches b WHERE b.tenant_id=$1 AND b.id=$2 RETURNING *`,
            [
              a.tenantId,
              session.branch_id,
              staffId,
              type,
              now,
              body?.source ?? (self ? "STAFF_MOBILE" : "ADMIN_WEB"),
              body?.breakType ?? open?.break_type ?? "OTHER",
              a.userId,
              this.idem.subject(key),
              requestId,
              body?.note ?? null,
            ],
          )
        ).rows[0];
        let result;
        if (action === "start")
          result = (
            await c.query<any>(
              `INSERT INTO attendance_breaks(tenant_id,session_id,start_event_id,break_type,started_at) VALUES($1,$2,$3,$4,$5) RETURNING *`,
              [a.tenantId, session.id, ev.id, body?.breakType ?? "OTHER", now],
            )
          ).rows[0];
        else
          result = (
            await c.query<any>(
              `UPDATE attendance_breaks SET state='CLOSED',end_event_id=$3,ended_at=$4,duration_seconds=GREATEST(0,EXTRACT(EPOCH FROM ($4::timestamptz-started_at))::bigint) WHERE tenant_id=$1 AND id=$2 RETURNING *`,
              [a.tenantId, open.id, ev.id, now],
            )
          ).rows[0];
        await this.emit(
          c,
          a,
          action === "start"
            ? "time_clock.break_started"
            : "time_clock.break_ended",
          "attendance_break",
          result.id,
          session.branch_id,
          requestId,
          null,
          this.view(result),
          undefined,
          key,
        );
        return this.view(result);
      },
    );
  }

  async list(
    a: AccessClaims,
    table: string,
    where = "",
    values: unknown[] = [],
  ) {
    this.tenant(a);
    const allowed = new Set([
      "attendance_sessions",
      "attendance_exceptions",
      "time_clock_devices",
      "timesheet_periods",
      "staff_timesheets",
      "timesheet_adjustment_requests",
      "workforce_compliance_policies",
      "payroll_calendars",
      "payroll_periods",
      "payroll_runs",
      "payroll_run_workers",
      "payroll_exceptions",
      "pay_statements",
      "payout_batches",
      "payout_items",
      "payout_reconciliations",
      "payroll_export_jobs",
    ]);
    if (!allowed.has(table)) throw new Error("unsafe table");
    const orderColumn =
      table === "pay_statements" ? "generated_at" : "created_at";
    let rows = (
      await this.db.query<any>(
        `SELECT * FROM ${table} WHERE tenant_id=$1 ${where} ORDER BY ${orderColumn} DESC LIMIT 250`,
        [a.tenantId, ...values],
      )
    ).rows;
    if (!a.roles.includes("SALON_OWNER") && !a.roles.includes("ACCOUNTANT")) {
      const branchScoped = new Set([
        "attendance_sessions",
        "attendance_exceptions",
        "time_clock_devices",
      ]);
      if (branchScoped.has(table))
        rows = rows.filter((row) => a.branchIds.includes(row.branch_id));
      const staffScoped = new Set([
        "staff_timesheets",
        "pay_statements",
        "payroll_run_workers",
      ]);
      if (staffScoped.has(table)) {
        if (a.roles.includes("NAIL_TECHNICIAN"))
          rows = rows.filter((row) => row.staff_id === a.ownStaffId);
        else {
          const allowedStaff = new Set(
            (
              await this.db.query<{ staff_id: string }>(
                `SELECT DISTINCT staff_id FROM staff_branch_assignments
                 WHERE tenant_id=$1 AND branch_id=ANY($2::uuid[])
                 AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)`,
                [a.tenantId, a.branchIds],
              )
            ).rows.map((row) => row.staff_id),
          );
          rows = rows.filter((row) => allowedStaff.has(row.staff_id));
        }
      }
    }
    return rows.map((x) => this.view(x));
  }
  async detail(a: AccessClaims, table: string, id: string) {
    const row = (await this.list(a, table, "AND id=$2", [id]))[0];
    if (!row)
      throw new NotFoundException({
        code: "RESOURCE_NOT_FOUND",
        message: "Resource not found",
      });
    return row;
  }
  async resolveAttendanceException(
    a: AccessClaims,
    id: string,
    state: "ACKNOWLEDGED" | "RESOLVED" | "WAIVED",
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      `attendance.exception.${state.toLowerCase()}`,
      { id, ...body },
      async (c) => {
        if (state !== "ACKNOWLEDGED" && !body?.reason)
          throw new ConflictException({
            code: "VALIDATION_FAILED",
            message: "Reason required",
          });
        const old = (
          await c.query<any>(
            "SELECT * FROM attendance_exceptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException({
            code: "ATTENDANCE_EXCEPTION_NOT_FOUND",
            message: "Exception not found",
          });
        this.branch(a, old.branch_id);
        const row = (
          await c.query<any>(
            "UPDATE attendance_exceptions SET state=$3,resolution_reason=$4,resolved_by_user_id=$5,resolved_at=CASE WHEN $3='ACKNOWLEDGED' THEN NULL ELSE now() END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [a.tenantId, id, state, body?.reason ?? null, a.userId],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          "time_clock.exception_resolved",
          "attendance_exception",
          id,
          old.branch_id,
          requestId,
          this.view(old),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async createDevice(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    const branchId = this.required(body?.branchId, "branchId");
    this.branch(a, branchId);
    return this.command(a, key, "time-clock.device.create", body, async (c) => {
      const row = (
        await c.query<any>(
          `INSERT INTO time_clock_devices(tenant_id,branch_id,name,device_type,secret_hash,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            a.tenantId,
            branchId,
            this.required(body?.name, "name"),
            body?.deviceType ?? "KIOSK",
            body?.secret ? this.idem.subject(body.secret) : null,
            a.userId,
          ],
        )
      ).rows[0];
      await this.emit(
        c,
        a,
        "time_clock.device_created",
        "time_clock_device",
        row.id,
        branchId,
        requestId,
        null,
        this.view(row),
        undefined,
        key,
      );
      return { ...this.view(row), secretConfigured: Boolean(body?.secret) };
    });
  }
  async revokeDevice(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "time-clock.device.revoke",
      { id, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE time_clock_devices SET status='REVOKED',revoked_at=now(),secret_hash=NULL WHERE tenant_id=$1 AND id=$2 AND status<>'REVOKED' RETURNING *",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!row)
          throw new NotFoundException({
            code: "TIME_CLOCK_DEVICE_NOT_TRUSTED",
            message: "Device not found or revoked",
          });
        this.branch(a, row.branch_id);
        await this.emit(
          c,
          a,
          "time_clock.device_revoked",
          "time_clock_device",
          id,
          row.branch_id,
          requestId,
          null,
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }

  async createTimesheetPeriod(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(a, key, "timesheet.period.create", body, async (c) => {
      const row = (
        await c.query<any>(
          `INSERT INTO timesheet_periods(tenant_id,code,starts_on,ends_on,timezone) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [
            a.tenantId,
            this.required(body?.code, "code"),
            this.required(body?.startsOn, "startsOn"),
            this.required(body?.endsOn, "endsOn"),
            body?.timezone ?? "Asia/Ho_Chi_Minh",
          ],
        )
      ).rows[0];
      await this.emit(
        c,
        a,
        "timesheet.period_created",
        "timesheet_period",
        row.id,
        null,
        requestId,
        null,
        this.view(row),
        undefined,
        key,
      );
      return this.view(row);
    });
  }
  async timesheetTransition(
    a: AccessClaims,
    id: string,
    to: TimesheetState,
    body: any,
    key: string,
    requestId: string,
    self = false,
  ) {
    return this.command(
      a,
      key,
      `timesheet.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM staff_timesheets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException({
            code: "TIMESHEET_NOT_FOUND",
            message: "Timesheet not found",
          });
        if (
          !self &&
          !a.roles.includes("SALON_OWNER") &&
          !a.roles.includes("ACCOUNTANT")
        ) {
          const scoped = (
            await c.query(
              `SELECT 1 FROM staff_branch_assignments WHERE tenant_id=$1 AND staff_id=$2
               AND branch_id=ANY($3::uuid[]) AND effective_from<=CURRENT_DATE
               AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) LIMIT 1`,
              [a.tenantId, old.staff_id, a.branchIds],
            )
          ).rowCount;
          if (!scoped)
            throw new NotFoundException({
              code: "TIMESHEET_NOT_FOUND",
              message: "Timesheet not found",
            });
        }
        if (self && old.staff_id !== this.ownStaff(a))
          throw new ForbiddenException({
            code: "STAFF_SCOPE_DENIED",
            message: "Own timesheet only",
          });
        if (old.source_locked_at)
          throw new ConflictException({
            code: "TIMESHEET_ALREADY_USED_IN_PAYROLL",
            message: "Timesheet source is payroll locked",
          });
        try {
          assertTimesheetTransition(old.state, to);
        } catch {
          throw new ConflictException({
            code: "TIMESHEET_STATUS_INVALID",
            message: `Cannot transition ${old.state} to ${to}`,
          });
        }
        if (
          (to === "APPROVED" || to === "LOCKED") &&
          old.submitted_by_user_id === a.userId
        )
          throw new ForbiddenException({
            code: "TIMESHEET_SELF_APPROVAL_DENIED",
            message: "Dual control required",
          });
        if (["SUBMITTED", "APPROVED", "LOCKED"].includes(to))
          await this.assertTimesheetClear(c, a.tenantId, old, to);
        if (body?.fingerprint && body.fingerprint !== old.fingerprint)
          throw new ConflictException({
            code: "TIMESHEET_FINGERPRINT_CHANGED",
            message: "Expected fingerprint does not match",
          });
        const fields =
          to === "SUBMITTED"
            ? ",submitted_by_user_id=$4,submitted_fingerprint=fingerprint"
            : to === "APPROVED"
              ? ",approved_by_user_id=$4,approved_fingerprint=fingerprint"
              : to === "LOCKED"
                ? ",locked_fingerprint=fingerprint"
                : to === "REOPENED"
                  ? ",approved_by_user_id=NULL,approved_fingerprint=NULL"
                  : "";
        const capturesActor = ["SUBMITTED", "APPROVED"].includes(to);
        const versionParameter = capturesActor ? 5 : 4;
        const parameters = capturesActor
          ? [a.tenantId, id, to, a.userId, body?.version ?? old.version]
          : [a.tenantId, id, to, body?.version ?? old.version];
        const row = (
          await c.query<any>(
            `UPDATE staff_timesheets SET state=$3,version=version+1,updated_at=now()${fields} WHERE tenant_id=$1 AND id=$2 AND version=$${versionParameter} RETURNING *`,
            parameters,
          )
        ).rows[0];
        if (!row)
          throw new ConflictException({
            code: "TIMESHEET_VERSION_CONFLICT",
            message: "Timesheet changed",
          });
        await c.query(
          `INSERT INTO timesheet_approvals(tenant_id,timesheet_id,decision,actor_user_id,reason,snapshot_json,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            a.tenantId,
            id,
            to,
            a.userId,
            body?.reason ?? null,
            JSON.stringify(this.view(row)),
            row.fingerprint,
          ],
        );
        await this.emit(
          c,
          a,
          `timesheet.${to.toLowerCase()}`,
          "staff_timesheet",
          id,
          null,
          requestId,
          this.view(old),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async createAdjustment(
    a: AccessClaims,
    timesheetId: string,
    body: any,
    key: string,
    requestId: string,
    self = false,
  ) {
    return this.command(
      a,
      key,
      "timesheet.adjustment.create",
      { timesheetId, ...body },
      async (c) => {
        const sheet = (
          await c.query<any>(
            "SELECT * FROM staff_timesheets WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, timesheetId],
          )
        ).rows[0];
        if (!sheet)
          throw new NotFoundException({
            code: "TIMESHEET_NOT_FOUND",
            message: "Timesheet not found",
          });
        if (self && sheet.staff_id !== this.ownStaff(a))
          throw new ForbiddenException({
            code: "STAFF_SCOPE_DENIED",
            message: "Own timesheet only",
          });
        if (sheet.state === "LOCKED" || sheet.source_locked_at)
          throw new ConflictException({
            code: "TIMESHEET_LOCKED",
            message: "Locked timesheet cannot be adjusted",
          });
        const row = (
          await c.query<any>(
            `INSERT INTO timesheet_adjustment_requests(tenant_id,timesheet_id,adjustment_type,requested_change_json,before_calculation_json,after_calculation_json,reason,requester_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              a.tenantId,
              timesheetId,
              this.required(body?.adjustmentType, "adjustmentType"),
              JSON.stringify(body?.change ?? {}),
              JSON.stringify(body?.beforeCalculation ?? {}),
              JSON.stringify(body?.afterCalculation ?? {}),
              this.required(body?.reason, "reason"),
              a.userId,
            ],
          )
        ).rows[0];
        await this.adjustmentHistory(c, a, row, null, "DRAFT", requestId);
        await this.emit(
          c,
          a,
          "timesheet.adjustment_requested",
          "timesheet_adjustment",
          row.id,
          null,
          requestId,
          null,
          this.view(row),
          body.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  private async adjustmentHistory(
    c: PoolClient,
    a: AccessClaims,
    row: any,
    from: string | null,
    to: string,
    requestId: string,
  ) {
    await c.query(
      `INSERT INTO timesheet_adjustment_history(tenant_id,adjustment_id,from_state,to_state,actor_user_id,reason,snapshot_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        a.tenantId,
        row.id,
        from,
        to,
        a.userId,
        row.reason,
        JSON.stringify(this.view(row)),
        requestId,
      ],
    );
  }
  async adjustmentTransition(
    a: AccessClaims,
    id: string,
    to: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED",
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      `timesheet.adjustment.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM timesheet_adjustment_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException({
            code: "TIMESHEET_ADJUSTMENT_NOT_FOUND",
            message: "Adjustment not found",
          });
        const valid: any = {
          DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
          PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
        };
        if (!valid[old.state]?.includes(to))
          throw new ConflictException({
            code: "TIMESHEET_ADJUSTMENT_STATUS_INVALID",
            message: "Invalid adjustment transition",
          });
        if (to === "APPROVED" && old.requester_user_id === a.userId)
          throw new ForbiddenException({
            code: "TIMESHEET_SELF_APPROVAL_DENIED",
            message: "Requester cannot approve",
          });
        const row = (
          await c.query<any>(
            `UPDATE timesheet_adjustment_requests SET state=$3,approver_user_id=CASE WHEN $3 IN('APPROVED','REJECTED') THEN $4 ELSE approver_user_id END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [a.tenantId, id, to, a.userId],
          )
        ).rows[0];
        await this.adjustmentHistory(c, a, row, old.state, to, requestId);
        await this.emit(
          c,
          a,
          `timesheet.adjustment_${to.toLowerCase()}`,
          "timesheet_adjustment",
          id,
          null,
          requestId,
          this.view(old),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }

  async applyAdjustment(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "timesheet.adjustment.apply",
      { id, ...body },
      async (c) => {
        const adjustment = (
          await c.query<any>(
            `SELECT r.*,t.staff_id,t.state timesheet_state,t.source_locked_at,t.fingerprint timesheet_fingerprint
             FROM timesheet_adjustment_requests r
             JOIN staff_timesheets t ON t.tenant_id=r.tenant_id AND t.id=r.timesheet_id
             WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r,t`,
            [a.tenantId, id],
          )
        ).rows[0];
        if (!adjustment)
          throw new NotFoundException({
            code: "TIMESHEET_ADJUSTMENT_NOT_FOUND",
            message: "Adjustment not found",
          });
        if (adjustment.state === "APPLIED") {
          const applied = (
            await c.query<any>(
              "SELECT * FROM attendance_correction_events WHERE tenant_id=$1 AND adjustment_id=$2",
              [a.tenantId, id],
            )
          ).rows[0];
          return {
            ...this.view(adjustment),
            correctionEvent: this.view(applied),
          };
        }
        if (adjustment.state !== "APPROVED")
          throw new ConflictException({
            code: "TIMESHEET_ADJUSTMENT_STATUS_INVALID",
            message: "Only an approved adjustment can be applied",
          });
        if (
          adjustment.timesheet_state === "LOCKED" ||
          adjustment.source_locked_at
        )
          throw new ConflictException({
            code: "TIMESHEET_LOCKED",
            message: "Timesheet was locked before adjustment apply",
          });
        const change = adjustment.requested_change_json ?? {};
        const sessionId = change.sessionId ? String(change.sessionId) : null;
        let session: any = null;
        if (sessionId) {
          session = (
            await c.query<any>(
              "SELECT * FROM attendance_sessions WHERE tenant_id=$1 AND id=$2 AND staff_id=$3 FOR UPDATE",
              [a.tenantId, sessionId, adjustment.staff_id],
            )
          ).rows[0];
          if (!session)
            throw new NotFoundException({
              code: "ATTENDANCE_SESSION_NOT_FOUND",
              message: "Adjustment target session not found",
            });
        }
        const beforeFingerprint = String(adjustment.timesheet_fingerprint);
        if (session) {
          const startedAt = change.startedAt ?? session.started_at;
          let endedAt = change.endedAt ?? session.ended_at;
          let branchId = change.branchId ?? session.branch_id;
          let state = session.state;
          let regular = BigInt(session.regular_seconds);
          let overtime = BigInt(session.overtime_seconds);
          let payable = BigInt(session.payable_seconds);
          let paidBreak = BigInt(session.paid_break_seconds);
          let unpaidBreak = BigInt(session.unpaid_break_seconds);
          if (
            adjustment.adjustment_type === "ADD_CLOCK_EVENT" ||
            adjustment.adjustment_type === "REPLACE_CLOCK_EVENT"
          ) {
            endedAt = change.occurredAt ?? change.endedAt ?? endedAt;
            if (!endedAt)
              throw new ConflictException({
                code: "TIMESHEET_ADJUSTMENT_INVALID",
                message: "Corrected clock-out time is required",
              });
            state = "ADJUSTED";
            const elapsed = elapsedSeconds(
              new Date(startedAt),
              new Date(endedAt),
            );
            payable =
              change.payableSeconds === undefined
                ? elapsed > unpaidBreak
                  ? elapsed - unpaidBreak
                  : 0n
                : BigInt(change.payableSeconds);
            regular =
              change.regularSeconds === undefined
                ? payable
                : BigInt(change.regularSeconds);
            overtime = BigInt(change.overtimeSeconds ?? 0);
          } else if (adjustment.adjustment_type === "VOID_CLOCK_EVENT") {
            state = "VOIDED";
            regular = overtime = payable = paidBreak = unpaidBreak = 0n;
          } else if (adjustment.adjustment_type === "CHANGE_PAYABLE_TIME") {
            payable = BigInt(
              this.required(change.payableSeconds, "payableSeconds"),
            );
            overtime = BigInt(change.overtimeSeconds ?? 0);
            regular = BigInt(change.regularSeconds ?? payable - overtime);
            state = "ADJUSTED";
          } else if (
            adjustment.adjustment_type === "CHANGE_BRANCH_ATTRIBUTION"
          ) {
            branchId = this.required(change.branchId, "branchId");
            state = "ADJUSTED";
          } else if (
            adjustment.adjustment_type === "CHANGE_BREAK_TYPE" ||
            adjustment.adjustment_type === "ADD_BREAK"
          ) {
            const breakSeconds = BigInt(
              this.required(change.durationSeconds, "durationSeconds"),
            );
            const isUnpaid = change.breakType === "UNPAID_MEAL";
            if (isUnpaid) {
              unpaidBreak = breakSeconds;
              payable =
                elapsedSeconds(new Date(startedAt), new Date(endedAt)) -
                unpaidBreak;
            } else paidBreak = breakSeconds;
            regular = payable > overtime ? payable - overtime : 0n;
            state = "ADJUSTED";
          }
          if (regular < 0n || overtime < 0n || payable < 0n)
            throw new ConflictException({
              code: "TIMESHEET_ADJUSTMENT_INVALID",
              message: "Corrected attendance values cannot be negative",
            });
          const sessionFingerprint = deterministicFingerprint({
            correctionId: id,
            branchId,
            startedAt: new Date(startedAt).toISOString(),
            endedAt: endedAt ? new Date(endedAt).toISOString() : null,
            regular: regular.toString(),
            overtime: overtime.toString(),
            payable: payable.toString(),
            paidBreak: paidBreak.toString(),
            unpaidBreak: unpaidBreak.toString(),
          });
          await c.query(
            `UPDATE attendance_sessions SET branch_id=$3,started_at=$4,ended_at=$5,state=$6,
               regular_seconds=$7,overtime_seconds=$8,payable_seconds=$9,paid_break_seconds=$10,
               unpaid_break_seconds=$11,fingerprint=$12,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND id=$2`,
            [
              a.tenantId,
              session.id,
              branchId,
              startedAt,
              endedAt,
              state,
              regular.toString(),
              overtime.toString(),
              payable.toString(),
              paidBreak.toString(),
              unpaidBreak.toString(),
              sessionFingerprint,
            ],
          );
        }
        const rebuilt = await this.rebuildTimesheet(
          c,
          a.tenantId,
          adjustment.timesheet_id,
        );
        const correction = (
          await c.query<any>(
            `INSERT INTO attendance_correction_events(
               tenant_id,adjustment_id,timesheet_id,session_id,correction_type,correction_json,
               before_fingerprint,after_fingerprint,actor_user_id,request_id,idempotency_key_hash
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
              a.tenantId,
              id,
              adjustment.timesheet_id,
              sessionId,
              adjustment.adjustment_type,
              JSON.stringify(change),
              beforeFingerprint,
              rebuilt.fingerprint,
              a.userId,
              requestId,
              this.idem.subject(key),
            ],
          )
        ).rows[0];
        const row = (
          await c.query<any>(
            `UPDATE timesheet_adjustment_requests SET state='APPLIED',applied_at=now(),applied_by_user_id=$3,
               before_fingerprint=$4,after_fingerprint=$5,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [a.tenantId, id, a.userId, beforeFingerprint, rebuilt.fingerprint],
          )
        ).rows[0];
        await this.adjustmentHistory(
          c,
          a,
          row,
          "APPROVED",
          "APPLIED",
          requestId,
        );
        await this.emit(
          c,
          a,
          "timesheet.adjustment_applied",
          "timesheet_adjustment",
          id,
          null,
          requestId,
          this.view(adjustment),
          this.view(row),
          body?.reason ?? adjustment.reason,
          key,
        );
        return {
          ...this.view(row),
          correctionEvent: this.view(correction),
          timesheet: this.view(rebuilt),
        };
      },
    );
  }

  async createPolicy(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(a, key, "workforce.policy.create", body, async (c) => {
      const row = (
        await c.query<any>(
          `INSERT INTO workforce_compliance_policies(tenant_id,code,name,jurisdiction_code,created_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [
            a.tenantId,
            this.required(body?.code, "code"),
            this.required(body?.name, "name"),
            body?.jurisdictionCode ?? null,
            a.userId,
          ],
        )
      ).rows[0];
      await this.emit(
        c,
        a,
        "workforce.policy_created",
        "workforce_policy",
        row.id,
        null,
        requestId,
        null,
        this.view(row),
        undefined,
        key,
      );
      return this.view(row);
    });
  }
  async addPolicyVersion(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    _requestId: string,
  ) {
    void _requestId;
    return this.command(
      a,
      key,
      "workforce.policy.version.create",
      { id, ...body },
      async (c) => {
        const policy = (
          await c.query<any>(
            "SELECT * FROM workforce_compliance_policies WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!policy)
          throw new NotFoundException({
            code: "WORKFORCE_POLICY_NOT_FOUND",
            message: "Policy not found",
          });
        const version = (
          await c.query<any>(
            "SELECT COALESCE(max(version),0)+1 value FROM workforce_compliance_policy_versions WHERE tenant_id=$1 AND policy_id=$2",
            [a.tenantId, id],
          )
        ).rows[0].value;
        const fp = deterministicFingerprint(body);
        const row = (
          await c.query<any>(
            `INSERT INTO workforce_compliance_policy_versions(tenant_id,policy_id,version,effective_from,effective_to,timezone_basis,max_continuous_work_minutes,meal_break_required_after_minutes,meal_break_minimum_minutes,rest_break_rules_json,daily_overtime_rules_json,weekly_overtime_rules_json,consecutive_day_rules_json,grace_period_minutes,rounding_policy_json,geofence_policy_json,manual_adjustment_dual_control,timesheet_dual_control,payroll_dual_control,payout_dual_control,legal_review_status,policy_json,fingerprint,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
            [
              a.tenantId,
              id,
              version,
              this.required(body?.effectiveFrom, "effectiveFrom"),
              body?.effectiveTo ?? null,
              body?.timezoneBasis ?? "BRANCH",
              body?.maxContinuousWorkMinutes ?? null,
              body?.mealBreakRequiredAfterMinutes ?? null,
              body?.mealBreakMinimumMinutes ?? null,
              JSON.stringify(body?.restBreakRules ?? {}),
              JSON.stringify(body?.dailyOvertimeRules ?? {}),
              JSON.stringify(body?.weeklyOvertimeRules ?? {}),
              JSON.stringify(body?.consecutiveDayRules ?? {}),
              body?.gracePeriodMinutes ?? 0,
              JSON.stringify(body?.roundingPolicy ?? {}),
              JSON.stringify(body?.geofencePolicy ?? {}),
              body?.manualAdjustmentDualControl ?? true,
              body?.timesheetDualControl ?? true,
              body?.payrollDualControl ?? true,
              body?.payoutDualControl ?? true,
              body?.legalReviewStatus ?? "PENDING",
              JSON.stringify(body?.policy ?? {}),
              fp,
              a.userId,
            ],
          )
        ).rows[0];
        return this.view(row);
      },
    );
  }
  async activatePolicy(
    a: AccessClaims,
    id: string,
    versionId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "workforce.policy.activate",
      { id, versionId, ...body },
      async (c) => {
        const v = (
          await c.query<any>(
            "SELECT * FROM workforce_compliance_policy_versions WHERE tenant_id=$1 AND id=$2 AND policy_id=$3 FOR UPDATE",
            [a.tenantId, versionId, id],
          )
        ).rows[0];
        if (!v)
          throw new NotFoundException({
            code: "WORKFORCE_POLICY_NOT_FOUND",
            message: "Policy version not found",
          });
        if (v.legal_review_status !== "APPROVED")
          throw new ConflictException({
            code: "WORKFORCE_POLICY_NOT_LEGALLY_REVIEWED",
            message: "Legal review approval required",
          });
        await c.query(
          "UPDATE workforce_compliance_policies SET status='SUPERSEDED' WHERE tenant_id=$1 AND status='ACTIVE' AND id<>$2",
          [a.tenantId, id],
        );
        const row = (
          await c.query<any>(
            "UPDATE workforce_compliance_policies SET status='ACTIVE' WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [a.tenantId, id],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          "workforce.policy_activated",
          "workforce_policy",
          id,
          null,
          requestId,
          null,
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async retirePolicy(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "workforce.policy.retire",
      { id, ...body },
      async (c) => {
        const reason = this.required(body?.reason, "reason");
        const before = (
          await c.query<any>(
            "SELECT * FROM workforce_compliance_policies WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!before)
          throw new NotFoundException({
            code: "WORKFORCE_POLICY_NOT_FOUND",
            message: "Policy not found",
          });
        const row = (
          await c.query<any>(
            "UPDATE workforce_compliance_policies SET status='RETIRED' WHERE tenant_id=$1 AND id=$2 AND status<>'RETIRED' RETURNING *",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!row)
          throw new ConflictException({
            code: "WORKFORCE_POLICY_STATUS_INVALID",
            message: "Policy is already retired",
          });
        await this.emit(
          c,
          a,
          "workforce.policy_retired",
          "workforce_policy",
          id,
          null,
          requestId,
          this.view(before),
          this.view(row),
          reason,
          key,
        );
        return this.view(row);
      },
    );
  }

  async payProfile(a: AccessClaims, staffId: string) {
    this.tenant(a);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id=$2",
        [a.tenantId, staffId],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "PAY_PROFILE_INCOMPLETE",
        message: "Pay profile not initialized",
      });
    return this.view(row);
  }
  async updatePayProfile(
    a: AccessClaims,
    staffId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "pay-profile.update",
      { staffId, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            `INSERT INTO staff_pay_profiles(tenant_id,staff_id,profile_type,status,currency,effective_from,effective_to) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6) ON CONFLICT(tenant_id,staff_id) DO UPDATE SET profile_type=EXCLUDED.profile_type,status='ACTIVE',currency=EXCLUDED.currency,effective_from=EXCLUDED.effective_from,effective_to=EXCLUDED.effective_to,version=staff_pay_profiles.version+1,updated_at=now() RETURNING *`,
            [
              a.tenantId,
              staffId,
              this.required(body?.profileType, "profileType"),
              this.required(body?.currency, "currency"),
              body?.effectiveFrom ?? null,
              body?.effectiveTo ?? null,
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          "pay_profile.updated",
          "staff_pay_profile",
          row.id,
          null,
          requestId,
          null,
          this.view(row),
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }
  async payRates(a: AccessClaims, staffId: string) {
    const p: any = await this.payProfile(a, staffId);
    return this.listRate(a, p.id);
  }
  private async listRate(a: AccessClaims, profileId: string) {
    return (
      await this.db.query<any>(
        "SELECT * FROM staff_pay_rate_versions WHERE tenant_id=$1 AND pay_profile_id=$2 ORDER BY effective_from DESC,version DESC",
        [a.tenantId, profileId],
      )
    ).rows.map((x) => this.view(x));
  }
  async createPayRate(
    a: AccessClaims,
    staffId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "pay-rate.create",
      { staffId, ...body },
      async (c) => {
        const p = (
          await c.query<any>(
            "SELECT * FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id=$2 AND status='ACTIVE'",
            [a.tenantId, staffId],
          )
        ).rows[0];
        if (!p)
          throw new ConflictException({
            code: "PAY_PROFILE_INCOMPLETE",
            message: "Active pay profile required",
          });
        if (p.currency !== body?.currency)
          throw new ConflictException({
            code: "PAY_RATE_CURRENCY_MISMATCH",
            message: "Rate currency must match profile",
          });
        if (body?.branchId) this.branch(a, body.branchId);
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `pay-rate:${a.tenantId}:${p.id}:${body?.branchId ?? "*"}:${body?.componentType}`,
        ]);
        const version = (
          await c.query<any>(
            "SELECT COALESCE(max(version),0)+1 value FROM staff_pay_rate_versions WHERE tenant_id=$1 AND pay_profile_id=$2",
            [a.tenantId, p.id],
          )
        ).rows[0].value;
        try {
          const row = (
            await c.query<any>(
              `INSERT INTO staff_pay_rate_versions(tenant_id,pay_profile_id,branch_id,component_type,amount_minor,multiplier_numerator,multiplier_denominator,currency,effective_from,effective_to,version,fingerprint,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
              [
                a.tenantId,
                p.id,
                body?.branchId ?? null,
                this.required(body?.componentType, "componentType"),
                body?.amountMinor ?? null,
                body?.multiplierNumerator ?? null,
                body?.multiplierDenominator ?? null,
                this.required(body?.currency, "currency"),
                this.required(body?.effectiveFrom, "effectiveFrom"),
                body?.effectiveTo ?? null,
                version,
                deterministicFingerprint(body),
                a.userId,
              ],
            )
          ).rows[0];
          await this.emit(
            c,
            a,
            "pay_rate.created",
            "staff_pay_rate",
            row.id,
            body?.branchId ?? null,
            requestId,
            null,
            this.view(row),
            undefined,
            key,
          );
          return this.view(row);
        } catch (e: any) {
          if (e?.constraint === "staff_pay_rate_no_overlap")
            throw new ConflictException({
              code: "PAY_RATE_OVERLAP",
              message: "Active effective rate overlaps",
            });
          throw e;
        }
      },
    );
  }

  async createCalendar(
    a: AccessClaims,
    body: any,
    key: string,
    _requestId: string,
  ) {
    void _requestId;
    return this.command(a, key, "payroll.calendar.create", body, async (c) => {
      const row = (
        await c.query<any>(
          `INSERT INTO payroll_calendars(tenant_id,name,frequency,timezone,currency,policy_json) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            a.tenantId,
            this.required(body?.name, "name"),
            this.required(body?.frequency, "frequency"),
            body?.timezone ?? "Asia/Ho_Chi_Minh",
            this.required(body?.currency, "currency"),
            JSON.stringify(body?.policy ?? {}),
          ],
        )
      ).rows[0];
      return this.view(row);
    });
  }
  async updateCalendar(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "payroll.calendar.update",
      { id, ...body },
      async (c) => {
        const before = (
          await c.query<any>(
            "SELECT * FROM payroll_calendars WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!before)
          throw new NotFoundException({
            code: "PAYROLL_CALENDAR_NOT_FOUND",
            message: "Calendar not found",
          });
        if (
          body?.version !== undefined &&
          Number(body.version) !== before.version
        )
          throw new ConflictException({
            code: "VERSION_CONFLICT",
            message: "Payroll calendar changed; refresh and retry",
          });
        const row = (
          await c.query<any>(
            `UPDATE payroll_calendars SET name=COALESCE($3,name),frequency=COALESCE($4,frequency),timezone=COALESCE($5,timezone),currency=COALESCE($6,currency),policy_json=COALESCE($7,policy_json),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [
              a.tenantId,
              id,
              body?.name ?? null,
              body?.frequency ?? null,
              body?.timezone ?? null,
              body?.currency ?? null,
              body?.policy ? JSON.stringify(body.policy) : null,
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          "payroll.calendar_updated",
          "payroll_calendar",
          id,
          null,
          requestId,
          this.view(before),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async generatePeriod(
    a: AccessClaims,
    body: any,
    key: string,
    _requestId: string,
  ) {
    void _requestId;
    return this.command(a, key, "payroll.period.generate", body, async (c) => {
      const row = (
        await c.query<any>(
          `INSERT INTO payroll_periods(tenant_id,calendar_id,timesheet_period_id,starts_on,ends_on,pay_date,state) VALUES($1,$2,$3,$4,$5,$6,'READY') RETURNING *`,
          [
            a.tenantId,
            this.required(body?.calendarId, "calendarId"),
            body?.timesheetPeriodId ?? null,
            this.required(body?.startsOn, "startsOn"),
            this.required(body?.endsOn, "endsOn"),
            this.required(body?.payDate, "payDate"),
          ],
        )
      ).rows[0];
      return this.view(row);
    });
  }
  async createRun(a: AccessClaims, body: any, key: string, requestId: string) {
    return this.command(a, key, "payroll.run.create", body, async (c) => {
      const runType = body?.runType ?? "REGULAR";
      const correctionOf = body?.correctionOfPayrollRunId ?? null;
      if (["SUPPLEMENTAL", "CORRECTION"].includes(runType)) {
        const original = (
          await c.query<any>(
            "SELECT id FROM payroll_runs WHERE tenant_id=$1 AND id=$2 AND state='FINALIZED'",
            [a.tenantId, correctionOf],
          )
        ).rows[0];
        if (!original)
          throw new ConflictException({
            code: "PAYROLL_CORRECTION_ORIGINAL_REQUIRED",
            message: "Supplemental payroll requires a finalized original run",
          });
      }
      const period = (
        await c.query<any>(
          "SELECT p.*,c.currency FROM payroll_periods p JOIN payroll_calendars c ON c.tenant_id=p.tenant_id AND c.id=p.calendar_id WHERE p.tenant_id=$1 AND p.id=$2 AND p.state='READY'",
          [a.tenantId, this.required(body?.payrollPeriodId, "payrollPeriodId")],
        )
      ).rows[0];
      if (!period)
        throw new ConflictException({
          code: "PAYROLL_PERIOD_NOT_READY",
          message: "Payroll period is not ready",
        });
      const row = (
        await c.query<any>(
          `INSERT INTO payroll_runs(tenant_id,payroll_period_id,run_type,currency,prepared_by_user_id,correction_of_payroll_run_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            a.tenantId,
            period.id,
            runType,
            period.currency,
            a.userId,
            correctionOf,
          ],
        )
      ).rows[0];
      await this.emit(
        c,
        a,
        "payroll.run_created",
        "payroll_run",
        row.id,
        null,
        requestId,
        null,
        this.view(row),
        undefined,
        key,
      );
      return this.view(row);
    });
  }
  async createPayrollCorrection(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "payroll.correction.create",
      body,
      async (c) => {
        const original = (
          await c.query<any>(
            `SELECT s.*,r.state run_state FROM pay_statements s
           JOIN payroll_runs r ON r.tenant_id=s.tenant_id AND r.id=s.payroll_run_id
           WHERE s.tenant_id=$1 AND s.id=$2 AND r.id=$3`,
            [
              a.tenantId,
              this.required(body?.originalStatementId, "originalStatementId"),
              this.required(body?.originalPayrollRunId, "originalPayrollRunId"),
            ],
          )
        ).rows[0];
        if (!original || original.run_state !== "FINALIZED")
          throw new ConflictException({
            code: "PAYROLL_CORRECTION_ORIGINAL_REQUIRED",
            message: "Correction must reference a finalized pay statement",
          });
        const delta = BigInt(this.required(body?.deltaMinor, "deltaMinor"));
        if (delta === 0n)
          throw new ConflictException({
            code: "PAYROLL_CORRECTION_ZERO_DELTA",
            message: "Correction delta cannot be zero",
          });
        if (body?.currency !== original.currency)
          throw new ConflictException({
            code: "PAYROLL_CURRENCY_MISMATCH",
            message: "Correction currency must match original statement",
          });
        const reason = this.required(body?.reason, "reason");
        const fingerprint = deterministicFingerprint({
          originalPayrollRunId: original.payroll_run_id,
          originalStatementId: original.id,
          staffId: original.staff_id,
          deltaMinor: delta.toString(),
          currency: original.currency,
          reason,
          evidence: redactWorkforceEvidence(body?.evidence ?? {}),
        });
        const row = (
          await c.query<any>(
            `INSERT INTO payroll_correction_sources(
             tenant_id,original_payroll_run_id,original_statement_id,staff_id,delta_minor,currency,
             reason,evidence_json,fingerprint,requested_by_user_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [
              a.tenantId,
              original.payroll_run_id,
              original.id,
              original.staff_id,
              delta.toString(),
              original.currency,
              reason,
              JSON.stringify(redactWorkforceEvidence(body?.evidence ?? {})),
              fingerprint,
              a.userId,
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          "payroll.correction_created",
          "payroll_correction",
          row.id,
          null,
          requestId,
          null,
          this.view(row),
          reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async payrollCorrectionTransition(
    a: AccessClaims,
    id: string,
    to: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED",
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      `payroll.correction.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM payroll_correction_sources WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException({
            code: "PAYROLL_CORRECTION_NOT_FOUND",
            message: "Payroll correction not found",
          });
        const valid: Record<string, string[]> = {
          DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
          PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
        };
        if (!valid[old.state]?.includes(to))
          throw new ConflictException({
            code: "PAYROLL_CORRECTION_STATUS_INVALID",
            message: "Invalid payroll correction transition",
          });
        if (to === "APPROVED" && old.requested_by_user_id === a.userId)
          throw new ForbiddenException({
            code: "PAYROLL_SELF_APPROVAL_DENIED",
            message: "Correction requester cannot approve",
          });
        const row = (
          await c.query<any>(
            `UPDATE payroll_correction_sources SET state=$3,
               approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,
               approved_at=CASE WHEN $3='APPROVED' THEN now() ELSE approved_at END,
               version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [a.tenantId, id, to, a.userId],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          `payroll.correction_${to.toLowerCase()}`,
          "payroll_correction",
          id,
          null,
          requestId,
          this.view(old),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async calculateRun(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "payroll.run.calculate.v2",
      { id, ...body },
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `payroll:${a.tenantId}:${id}`,
        ]);
        const run = (
          await c.query<any>(
            `SELECT r.*,p.starts_on,p.ends_on,p.timesheet_period_id
             FROM payroll_runs r JOIN payroll_periods p ON p.tenant_id=r.tenant_id AND p.id=r.payroll_period_id
             WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r`,
            [a.tenantId, id],
          )
        ).rows[0];
        if (!run)
          throw new NotFoundException({
            code: "PAYROLL_RUN_NOT_FOUND",
            message: "Payroll run not found",
          });
        if (
          ![
            "DRAFT",
            "CALCULATED",
            "FAILED",
            "PENDING_APPROVAL",
            "APPROVED",
          ].includes(run.state)
        )
          throw new ConflictException({
            code: "PAYROLL_RUN_STATUS_INVALID",
            message: "Finalized payroll cannot be recalculated",
          });

        const policy = (
          await c.query<any>(
            `SELECT v.* FROM workforce_compliance_policies p
             JOIN workforce_compliance_policy_versions v ON v.tenant_id=p.tenant_id AND v.policy_id=p.id
             WHERE p.tenant_id=$1 AND p.status='ACTIVE' AND v.legal_review_status='APPROVED'
               AND v.effective_from<=$2 AND (v.effective_to IS NULL OR v.effective_to>=$3)
             ORDER BY v.version DESC LIMIT 1`,
            [a.tenantId, run.ends_on, run.starts_on],
          )
        ).rows[0];

        // FK-safe recalculation: children first, then workers; only this run's
        // unconsumed claims are released.
        await c.query(
          "DELETE FROM payroll_deduction_lines d USING payroll_run_workers w WHERE d.tenant_id=$1 AND d.tenant_id=w.tenant_id AND d.payroll_worker_id=w.id AND w.payroll_run_id=$2",
          [a.tenantId, id],
        );
        await c.query(
          "DELETE FROM payroll_employer_contribution_lines d USING payroll_run_workers w WHERE d.tenant_id=$1 AND d.tenant_id=w.tenant_id AND d.payroll_worker_id=w.id AND w.payroll_run_id=$2",
          [a.tenantId, id],
        );
        await c.query(
          "DELETE FROM payroll_earning_lines d USING payroll_run_workers w WHERE d.tenant_id=$1 AND d.tenant_id=w.tenant_id AND d.payroll_worker_id=w.id AND w.payroll_run_id=$2",
          [a.tenantId, id],
        );
        await c.query(
          "DELETE FROM payroll_exceptions WHERE tenant_id=$1 AND payroll_run_id=$2",
          [a.tenantId, id],
        );
        await c.query(
          "DELETE FROM payroll_source_allocations WHERE tenant_id=$1 AND payroll_run_id=$2 AND state='CLAIMED'",
          [a.tenantId, id],
        );
        await c.query(
          "UPDATE payroll_correction_sources SET state='APPROVED',claimed_by_payroll_run_id=NULL,updated_at=now() WHERE tenant_id=$1 AND claimed_by_payroll_run_id=$2 AND state='CLAIMED'",
          [a.tenantId, id],
        );
        await c.query(
          "DELETE FROM payroll_run_workers WHERE tenant_id=$1 AND payroll_run_id=$2",
          [a.tenantId, id],
        );
        if (["PENDING_APPROVAL", "APPROVED"].includes(run.state))
          await c.query(
            `INSERT INTO payroll_approval_history(tenant_id,payroll_run_id,decision,actor_user_id,reason,snapshot_json,source_fingerprint)
             VALUES($1,$2,'CALCULATION_INVALIDATED',$3,'Recalculation invalidated approval',$4,$5)`,
            [
              a.tenantId,
              id,
              a.userId,
              JSON.stringify(this.view(run)),
              run.source_fingerprint ?? "",
            ],
          );

        if (!policy) {
          await c.query(
            `INSERT INTO payroll_exceptions(tenant_id,payroll_run_id,exception_type,severity,details_json,generation_key)
             VALUES($1,$2,'MISSING_POLICY','BLOCKING',$3,$4)`,
            [
              a.tenantId,
              id,
              JSON.stringify({ startsOn: run.starts_on, endsOn: run.ends_on }),
              `${id}:MISSING_POLICY`,
            ],
          );
          const failed = (
            await c.query<any>(
              `UPDATE payroll_runs SET state='FAILED',approved_by_user_id=NULL,blocking_exception_count=1,
                 gross_pay_minor=0,net_pay_minor=0,worker_count=0,calculation_generation=calculation_generation+1,
                 source_fingerprint=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
              [
                a.tenantId,
                id,
                deterministicFingerprint({ runId: id, missingPolicy: true }),
              ],
            )
          ).rows[0];
          return this.view(failed);
        }

        const supplemental = ["SUPPLEMENTAL", "CORRECTION"].includes(
          run.run_type,
        );
        const profiles = (
          await c.query<any>(
            `SELECT p.* FROM staff_pay_profiles p
             WHERE p.tenant_id=$1 AND p.status='ACTIVE' AND p.profile_type IS NOT NULL
               AND (p.effective_from IS NULL OR p.effective_from<=$3)
               AND (p.effective_to IS NULL OR p.effective_to>=$2)
               AND (
                 EXISTS(SELECT 1 FROM staff_timesheets t WHERE t.tenant_id=p.tenant_id AND t.staff_id=p.staff_id AND t.period_id=$4 AND t.state='LOCKED')
                 OR EXISTS(SELECT 1 FROM commission_entries e WHERE e.tenant_id=p.tenant_id AND e.staff_id=p.staff_id AND e.status='LOCKED' AND e.business_date BETWEEN $2 AND $3)
                 OR EXISTS(SELECT 1 FROM pos_tip_allocations a JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id AND t.status='ACTIVE' JOIN pos_orders o ON o.tenant_id=t.tenant_id AND o.id=t.pos_order_id AND o.status='PAID' WHERE a.tenant_id=p.tenant_id AND a.staff_id=p.staff_id AND o.paid_at::date BETWEEN $2 AND $3)
                 OR EXISTS(SELECT 1 FROM payroll_correction_sources x WHERE x.tenant_id=p.tenant_id AND x.staff_id=p.staff_id AND x.state='APPROVED' AND x.original_payroll_run_id=$5)
               ) ORDER BY p.staff_id`,
            [
              a.tenantId,
              run.starts_on,
              run.ends_on,
              run.timesheet_period_id,
              run.correction_of_payroll_run_id,
            ],
          )
        ).rows;
        let gross = 0n;
        let blocking = 0;
        const workerFingerprints: unknown[] = [];
        for (const profile of profiles) {
          const sheet = (
            await c.query<any>(
              `SELECT * FROM staff_timesheets WHERE tenant_id=$1 AND period_id=$2 AND staff_id=$3 AND state='LOCKED' FOR SHARE`,
              [a.tenantId, run.timesheet_period_id, profile.staff_id],
            )
          ).rows[0];
          const worker = (
            await c.query<any>(
              `INSERT INTO payroll_run_workers(
                 tenant_id,payroll_run_id,staff_id,pay_profile_version_json,policy_version_json,
                 pay_profile_id,policy_version_id,source_fingerprint,gross_pay_minor,net_pay_minor,currency
               ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9) RETURNING *`,
              [
                a.tenantId,
                id,
                profile.staff_id,
                JSON.stringify({
                  profileId: profile.id,
                  profileType: profile.profile_type,
                  version: profile.version,
                }),
                JSON.stringify({
                  id: policy.id,
                  version: policy.version,
                  fingerprint: policy.fingerprint,
                }),
                profile.id,
                policy.id,
                deterministicFingerprint({
                  profile: profile.id,
                  policy: policy.fingerprint,
                }),
                run.currency,
              ],
            )
          ).rows[0];
          let workerGross = 0n;
          let workerBlocking = 0;
          const sourceEvidence: unknown[] = [];
          const addException = async (type: string, details: any) => {
            workerBlocking += 1;
            blocking += 1;
            await c.query(
              `INSERT INTO payroll_exceptions(tenant_id,payroll_run_id,payroll_worker_id,exception_type,severity,details_json,generation_key)
               VALUES($1,$2,$3,$4,'BLOCKING',$5,$6)`,
              [
                a.tenantId,
                id,
                worker.id,
                type,
                JSON.stringify(details),
                `${id}:${profile.staff_id}:${type}:${workerBlocking}`,
              ],
            );
          };
          if (profile.currency !== run.currency)
            await addException("CURRENCY_MISMATCH", {
              profileCurrency: profile.currency,
              runCurrency: run.currency,
            });

          const hourly = ["HOURLY", "HOURLY_PLUS_COMMISSION"].includes(
            profile.profile_type,
          );
          const commissioned = [
            "COMMISSION_ONLY",
            "HOURLY_PLUS_COMMISSION",
            "SALARY_PLUS_COMMISSION",
          ].includes(profile.profile_type);
          const salaried = ["SALARY", "SALARY_PLUS_COMMISSION"].includes(
            profile.profile_type,
          );

          if (!supplemental && hourly) {
            if (!sheet) await addException("MISSING_TIMESHEET", {});
            else {
              const days = (
                await c.query<any>(
                  `SELECT * FROM timesheet_day_entries WHERE tenant_id=$1 AND timesheet_id=$2 ORDER BY local_date,branch_id`,
                  [a.tenantId, sheet.id],
                )
              ).rows;
              for (const day of days) {
                const rate = (
                  await c.query<any>(
                    `SELECT * FROM staff_pay_rate_versions
                     WHERE tenant_id=$1 AND pay_profile_id=$2 AND component_type='REGULAR_HOURLY_RATE'
                       AND status='ACTIVE' AND (branch_id=$3 OR branch_id IS NULL)
                       AND effective_from<=$4 AND (effective_to IS NULL OR effective_to>=$4)
                     ORDER BY (branch_id=$3) DESC NULLS LAST,effective_from DESC,version DESC LIMIT 1`,
                    [a.tenantId, profile.id, day.branch_id, day.local_date],
                  )
                ).rows[0];
                if (!rate) {
                  await addException("MISSING_PAY_RATE", {
                    branchId: day.branch_id,
                    localDate: day.local_date,
                    componentType: "REGULAR_HOURLY_RATE",
                  });
                  continue;
                }
                if (rate.currency !== run.currency) {
                  await addException("CURRENCY_MISMATCH", {
                    rateId: rate.id,
                    rateCurrency: rate.currency,
                  });
                  continue;
                }
                const regularAmount = calculateHourlyMinor(
                  BigInt(day.regular_seconds),
                  BigInt(rate.amount_minor),
                );
                if (BigInt(day.regular_seconds) > 0n)
                  await c.query(
                    `INSERT INTO payroll_earning_lines(
                       tenant_id,payroll_worker_id,earning_type,quantity_seconds,rate_minor,amount_minor,currency,
                       source_type,source_id,source_fingerprint,pay_rate_version_id,branch_id,metadata_json
                     ) VALUES($1,$2,'REGULAR_HOURS',$3,$4,$5,$6,'LOCKED_TIMESHEET',$7,$8,$9,$10,$11)`,
                    [
                      a.tenantId,
                      worker.id,
                      day.regular_seconds,
                      rate.amount_minor,
                      regularAmount.toString(),
                      run.currency,
                      sheet.id,
                      sheet.fingerprint,
                      rate.id,
                      day.branch_id,
                      JSON.stringify({
                        localDate: day.local_date,
                        rateId: rate.id,
                      }),
                    ],
                  );
                workerGross += regularAmount;
                if (BigInt(day.overtime_seconds) > 0n) {
                  const multiplier = (
                    await c.query<any>(
                      `SELECT * FROM staff_pay_rate_versions
                       WHERE tenant_id=$1 AND pay_profile_id=$2 AND component_type='OVERTIME_MULTIPLIER'
                         AND status='ACTIVE' AND (branch_id=$3 OR branch_id IS NULL)
                         AND effective_from<=$4 AND (effective_to IS NULL OR effective_to>=$4)
                       ORDER BY (branch_id=$3) DESC NULLS LAST,effective_from DESC,version DESC LIMIT 1`,
                      [a.tenantId, profile.id, day.branch_id, day.local_date],
                    )
                  ).rows[0];
                  const numerator = BigInt(
                    multiplier?.multiplier_numerator ??
                      policy.daily_overtime_rules_json?.multiplierNumerator ??
                      0,
                  );
                  const denominator = BigInt(
                    multiplier?.multiplier_denominator ??
                      policy.daily_overtime_rules_json?.multiplierDenominator ??
                      0,
                  );
                  if (numerator <= 0n || denominator <= 0n) {
                    await addException("MISSING_PAY_RATE", {
                      branchId: day.branch_id,
                      localDate: day.local_date,
                      componentType: "OVERTIME_MULTIPLIER",
                    });
                  } else {
                    const overtimeAmount = calculateHourlyMinor(
                      BigInt(day.overtime_seconds),
                      BigInt(rate.amount_minor),
                      numerator,
                      denominator,
                    );
                    await c.query(
                      `INSERT INTO payroll_earning_lines(
                         tenant_id,payroll_worker_id,earning_type,quantity_seconds,rate_minor,multiplier_numerator,multiplier_denominator,
                         amount_minor,currency,source_type,source_id,source_fingerprint,pay_rate_version_id,branch_id,metadata_json
                       ) VALUES($1,$2,'OVERTIME',$3,$4,$5,$6,$7,$8,'LOCKED_TIMESHEET',$9,$10,$11,$12,$13)`,
                      [
                        a.tenantId,
                        worker.id,
                        day.overtime_seconds,
                        rate.amount_minor,
                        numerator.toString(),
                        denominator.toString(),
                        overtimeAmount.toString(),
                        run.currency,
                        sheet.id,
                        sheet.fingerprint,
                        multiplier?.id ?? rate.id,
                        day.branch_id,
                        JSON.stringify({
                          localDate: day.local_date,
                          baseRateId: rate.id,
                          multiplierRateId: multiplier?.id ?? null,
                          policyVersionId: policy.id,
                        }),
                      ],
                    );
                    workerGross += overtimeAmount;
                  }
                }
              }
              const currentHourly = workerGross;
              await c.query(
                `INSERT INTO payroll_source_allocations(
                   tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency
                 ) VALUES($1,$2,$3,'LOCKED_TIMESHEET',$4,'PAYABLE_TIME',$5,$6,$7)`,
                [
                  a.tenantId,
                  id,
                  worker.id,
                  sheet.id,
                  sheet.fingerprint,
                  currentHourly.toString(),
                  run.currency,
                ],
              );
              sourceEvidence.push({
                type: "TIMESHEET",
                id: sheet.id,
                fingerprint: sheet.fingerprint,
              });
            }
          }

          if (!supplemental && salaried) {
            const salary = (
              await c.query<any>(
                `SELECT * FROM staff_pay_rate_versions WHERE tenant_id=$1 AND pay_profile_id=$2
                   AND component_type='SALARY_PERIOD_AMOUNT' AND status='ACTIVE' AND branch_id IS NULL
                   AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>=$3)
                 ORDER BY effective_from DESC,version DESC LIMIT 1`,
                [a.tenantId, profile.id, run.ends_on],
              )
            ).rows[0];
            if (!salary)
              await addException("MISSING_PAY_RATE", {
                componentType: "SALARY_PERIOD_AMOUNT",
              });
            else if (salary.currency !== run.currency)
              await addException("CURRENCY_MISMATCH", { rateId: salary.id });
            else {
              const salaryAmount = BigInt(salary.amount_minor);
              await c.query(
                `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,rate_minor,amount_minor,currency,pay_rate_version_id,metadata_json)
                 VALUES($1,$2,'SALARY',$3,$3,$4,$5,$6)`,
                [
                  a.tenantId,
                  worker.id,
                  salaryAmount.toString(),
                  run.currency,
                  salary.id,
                  JSON.stringify({ rateId: salary.id }),
                ],
              );
              workerGross += salaryAmount;
              sourceEvidence.push({ type: "SALARY", rateId: salary.id });
            }
          }

          if (!supplemental && commissioned) {
            const commissions = (
              await c.query<any>(
                `SELECT id,commission_minor,currency,generation_key FROM commission_entries
                 WHERE tenant_id=$1 AND staff_id=$2 AND status='LOCKED' AND business_date BETWEEN $3 AND $4 ORDER BY id FOR SHARE`,
                [a.tenantId, profile.staff_id, run.starts_on, run.ends_on],
              )
            ).rows;
            for (const source of commissions) {
              if (source.currency !== run.currency) {
                await addException("CURRENCY_MISMATCH", {
                  sourceId: source.id,
                });
                continue;
              }
              const amount = BigInt(source.commission_minor);
              await c.query(
                `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,amount_minor,currency,source_type,source_id,source_fingerprint)
                 VALUES($1,$2,'SERVICE_COMMISSION',$3,$4,'LOCKED_COMMISSION_ENTRIES',$5,$6)`,
                [
                  a.tenantId,
                  worker.id,
                  amount.toString(),
                  run.currency,
                  source.id,
                  source.generation_key,
                ],
              );
              await c.query(
                `INSERT INTO payroll_source_allocations(tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency)
                 VALUES($1,$2,$3,'LOCKED_COMMISSION_ENTRIES',$4,'COMMISSION_NET',$5,$6,$7)`,
                [
                  a.tenantId,
                  id,
                  worker.id,
                  source.id,
                  source.generation_key,
                  amount.toString(),
                  run.currency,
                ],
              );
              workerGross += amount;
              sourceEvidence.push({
                type: "COMMISSION",
                id: source.id,
                fingerprint: source.generation_key,
              });
            }
            const tips = (
              await c.query<any>(
                `SELECT a.id,a.amount_minor,t.currency FROM pos_tip_allocations a
                 JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id AND t.status='ACTIVE'
                 JOIN pos_orders o ON o.tenant_id=t.tenant_id AND o.id=t.pos_order_id AND o.status='PAID'
                 WHERE a.tenant_id=$1 AND a.staff_id=$2 AND o.paid_at::date BETWEEN $3 AND $4 ORDER BY a.id FOR SHARE OF a`,
                [a.tenantId, profile.staff_id, run.starts_on, run.ends_on],
              )
            ).rows;
            for (const source of tips) {
              if (source.currency !== run.currency) {
                await addException("CURRENCY_MISMATCH", {
                  sourceId: source.id,
                });
                continue;
              }
              const amount = BigInt(source.amount_minor);
              await c.query(
                `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,amount_minor,currency,source_type,source_id,source_fingerprint)
                 VALUES($1,$2,'TIP',$3,$4,'LOCKED_TIP_ALLOCATIONS',$5,$6)`,
                [
                  a.tenantId,
                  worker.id,
                  amount.toString(),
                  run.currency,
                  source.id,
                  `tip:${source.id}`,
                ],
              );
              await c.query(
                `INSERT INTO payroll_source_allocations(tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency)
                 VALUES($1,$2,$3,'LOCKED_TIP_ALLOCATIONS',$4,'SETTLED_TIP',$5,$6,$7)`,
                [
                  a.tenantId,
                  id,
                  worker.id,
                  source.id,
                  `tip:${source.id}`,
                  amount.toString(),
                  run.currency,
                ],
              );
              workerGross += amount;
              sourceEvidence.push({ type: "TIP", id: source.id });
            }
          }

          if (supplemental) {
            const corrections = (
              await c.query<any>(
                `SELECT * FROM payroll_correction_sources WHERE tenant_id=$1 AND staff_id=$2
                   AND original_payroll_run_id=$3 AND state='APPROVED' ORDER BY id FOR UPDATE`,
                [
                  a.tenantId,
                  profile.staff_id,
                  run.correction_of_payroll_run_id,
                ],
              )
            ).rows;
            for (const source of corrections) {
              if (
                source.currency !== run.currency ||
                BigInt(source.delta_minor) < 0n
              ) {
                await addException(
                  source.currency !== run.currency
                    ? "CURRENCY_MISMATCH"
                    : "NEGATIVE_NET_PAY",
                  { correctionSourceId: source.id },
                );
                continue;
              }
              const amount = BigInt(source.delta_minor);
              await c.query(
                `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,amount_minor,currency,source_type,source_id,source_fingerprint,metadata_json)
                 VALUES($1,$2,'CORRECTION',$3,$4,'PRIOR_RUN_CORRECTIONS',$5,$6,$7)`,
                [
                  a.tenantId,
                  worker.id,
                  amount.toString(),
                  run.currency,
                  source.id,
                  source.fingerprint,
                  JSON.stringify({
                    originalStatementId: source.original_statement_id,
                  }),
                ],
              );
              await c.query(
                `INSERT INTO payroll_source_allocations(tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency)
                 VALUES($1,$2,$3,'PRIOR_RUN_CORRECTIONS',$4,'CORRECTION_DELTA',$5,$6,$7)`,
                [
                  a.tenantId,
                  id,
                  worker.id,
                  source.id,
                  source.fingerprint,
                  amount.toString(),
                  run.currency,
                ],
              );
              await c.query(
                "UPDATE payroll_correction_sources SET state='CLAIMED',claimed_by_payroll_run_id=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
                [a.tenantId, source.id, id],
              );
              workerGross += amount;
              sourceEvidence.push({
                type: "CORRECTION",
                id: source.id,
                fingerprint: source.fingerprint,
              });
            }
          }

          const workerFingerprint = deterministicFingerprint({
            profile: { id: profile.id, version: profile.version },
            policy: policy.fingerprint,
            sources: sourceEvidence,
            gross: workerGross.toString(),
          });
          await c.query(
            `UPDATE payroll_run_workers SET gross_pay_minor=$3,net_pay_minor=$3,source_fingerprint=$4,
               state=CASE WHEN $5::integer>0 THEN 'EXCEPTION' ELSE 'CALCULATED' END,updated_at=now()
             WHERE tenant_id=$1 AND id=$2`,
            [
              a.tenantId,
              worker.id,
              workerGross.toString(),
              workerFingerprint,
              workerBlocking,
            ],
          );
          workerFingerprints.push({
            id: worker.id,
            fingerprint: workerFingerprint,
          });
          gross += workerGross;
        }
        const allocations = (
          await c.query<any>(
            `SELECT source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency
             FROM payroll_source_allocations WHERE tenant_id=$1 AND payroll_run_id=$2 ORDER BY source_type,source_id,earning_usage_key`,
            [a.tenantId, id],
          )
        ).rows;
        const fingerprint = deterministicFingerprint({
          runId: id,
          generation: Number(run.calculation_generation) + 1,
          policy: policy.fingerprint,
          workers: workerFingerprints,
          allocations,
        });
        const row = (
          await c.query<any>(
            `UPDATE payroll_runs SET state='CALCULATED',source_fingerprint=$3,gross_pay_minor=$4,net_pay_minor=$4,
               worker_count=$5,blocking_exception_count=$6,approved_by_user_id=NULL,
               calculation_generation=calculation_generation+1,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [
              a.tenantId,
              id,
              fingerprint,
              gross.toString(),
              profiles.length,
              blocking,
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          "payroll.calculated",
          "payroll_run",
          id,
          null,
          requestId,
          this.view(run),
          this.view(row),
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }

  async calculateRunLegacy(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "payroll.run.calculate",
      { id, ...body },
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `payroll:${a.tenantId}:${id}`,
        ]);
        const run = (
          await c.query<any>(
            `SELECT r.*,p.starts_on,p.ends_on,p.timesheet_period_id FROM payroll_runs r JOIN payroll_periods p ON p.tenant_id=r.tenant_id AND p.id=r.payroll_period_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r`,
            [a.tenantId, id],
          )
        ).rows[0];
        if (!run)
          throw new NotFoundException({
            code: "PAYROLL_RUN_NOT_FOUND",
            message: "Payroll run not found",
          });
        if (!["DRAFT", "CALCULATED", "FAILED"].includes(run.state))
          throw new ConflictException({
            code: "PAYROLL_RUN_STATUS_INVALID",
            message: "Run cannot calculate",
          });
        const policy = (
          await c.query<any>(
            `SELECT v.* FROM workforce_compliance_policies p JOIN workforce_compliance_policy_versions v ON v.tenant_id=p.tenant_id AND v.policy_id=p.id WHERE p.tenant_id=$1 AND p.status='ACTIVE' AND v.legal_review_status='APPROVED' AND v.effective_from<=$2 AND (v.effective_to IS NULL OR v.effective_to>=$3) ORDER BY v.version DESC LIMIT 1`,
            [a.tenantId, run.ends_on, run.starts_on],
          )
        ).rows[0];
        if (!policy)
          throw new ConflictException({
            code: "PAYROLL_POLICY_NOT_ACTIVATED",
            message: "Legally reviewed active payroll policy required",
          });
        await c.query(
          "DELETE FROM payroll_source_allocations WHERE tenant_id=$1 AND payroll_run_id=$2 AND state='CLAIMED'",
          [a.tenantId, id],
        );
        await c.query(
          "DELETE FROM payroll_run_workers WHERE tenant_id=$1 AND payroll_run_id=$2",
          [a.tenantId, id],
        );
        const sheets = (
          await c.query<any>(
            `SELECT t.*,p.profile_type,p.currency profile_currency FROM staff_timesheets t JOIN staff_pay_profiles p ON p.tenant_id=t.tenant_id AND p.staff_id=t.staff_id AND p.status='ACTIVE' WHERE t.tenant_id=$1 AND t.period_id=$2 AND t.state='LOCKED' ORDER BY t.staff_id FOR UPDATE OF t`,
            [a.tenantId, run.timesheet_period_id],
          )
        ).rows;
        let gross = 0n,
          net = 0n;
        for (const sheet of sheets) {
          const rate = (
            await c.query<any>(
              `SELECT * FROM staff_pay_rate_versions WHERE tenant_id=$1 AND pay_profile_id=(SELECT id FROM staff_pay_profiles WHERE tenant_id=$1 AND staff_id=$2) AND component_type='REGULAR_HOURLY_RATE' AND status='ACTIVE' AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>=$3) ORDER BY branch_id NULLS LAST,effective_from DESC LIMIT 1`,
              [a.tenantId, sheet.staff_id, run.ends_on],
            )
          ).rows[0];
          if (!rate)
            throw new ConflictException({
              code: "PAY_PROFILE_INCOMPLETE",
              message: `Missing active pay rate for staff ${sheet.staff_id}`,
            });
          if (rate.currency !== run.currency)
            throw new ConflictException({
              code: "PAYROLL_CURRENCY_MISMATCH",
              message: "Payroll source currency mismatch",
            });
          const amount = calculateHourlyMinor(
            BigInt(sheet.regular_seconds),
            BigInt(rate.amount_minor),
          );
          const worker = (
            await c.query<any>(
              `INSERT INTO payroll_run_workers(tenant_id,payroll_run_id,staff_id,pay_profile_version_json,policy_version_json,source_fingerprint,gross_pay_minor,net_pay_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING *`,
              [
                a.tenantId,
                id,
                sheet.staff_id,
                JSON.stringify({
                  profileType: sheet.profile_type,
                  rateId: rate.id,
                  rateVersion: rate.version,
                }),
                JSON.stringify({
                  id: policy.id,
                  version: policy.version,
                  fingerprint: policy.fingerprint,
                }),
                sheet.fingerprint,
                amount.toString(),
                run.currency,
              ],
            )
          ).rows[0];
          await c.query(
            `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,quantity_seconds,rate_minor,amount_minor,currency,source_type,source_id,source_fingerprint) VALUES($1,$2,'REGULAR_HOURS',$3,$4,$5,$6,'LOCKED_TIMESHEET',$7,$8)`,
            [
              a.tenantId,
              worker.id,
              sheet.regular_seconds,
              rate.amount_minor,
              amount.toString(),
              run.currency,
              sheet.id,
              sheet.fingerprint,
            ],
          );
          await c.query(
            `INSERT INTO payroll_source_allocations(tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency) VALUES($1,$2,$3,'LOCKED_TIMESHEET',$4,'PAYABLE_TIME',$5,$6,$7)`,
            [
              a.tenantId,
              id,
              worker.id,
              sheet.id,
              sheet.fingerprint,
              amount.toString(),
              run.currency,
            ],
          );
          let workerGross = amount;
          const commissions = (
            await c.query<any>(
              `SELECT id,commission_minor,currency,generation_key FROM commission_entries
               WHERE tenant_id=$1 AND staff_id=$2 AND status='LOCKED'
               AND business_date BETWEEN $3 AND $4 ORDER BY id FOR SHARE`,
              [a.tenantId, sheet.staff_id, run.starts_on, run.ends_on],
            )
          ).rows;
          for (const commission of commissions) {
            if (commission.currency !== run.currency)
              throw new ConflictException({
                code: "PAYROLL_CURRENCY_MISMATCH",
                message: "Commission source currency mismatch",
              });
            const commissionMinor = BigInt(commission.commission_minor);
            await c.query(
              `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,amount_minor,currency,source_type,source_id,source_fingerprint)
               VALUES($1,$2,'SERVICE_COMMISSION',$3,$4,'LOCKED_COMMISSION_ENTRIES',$5,$6)`,
              [
                a.tenantId,
                worker.id,
                commissionMinor.toString(),
                run.currency,
                commission.id,
                commission.generation_key,
              ],
            );
            await c.query(
              `INSERT INTO payroll_source_allocations(tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency)
               VALUES($1,$2,$3,'LOCKED_COMMISSION_ENTRIES',$4,'COMMISSION_NET',$5,$6,$7)`,
              [
                a.tenantId,
                id,
                worker.id,
                commission.id,
                commission.generation_key,
                commissionMinor.toString(),
                run.currency,
              ],
            );
            workerGross += commissionMinor;
          }
          const tips = (
            await c.query<any>(
              `SELECT a.id,a.amount_minor,t.currency FROM pos_tip_allocations a
               JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id AND t.status='ACTIVE'
               JOIN pos_orders o ON o.tenant_id=t.tenant_id AND o.id=t.pos_order_id AND o.status='PAID'
               WHERE a.tenant_id=$1 AND a.staff_id=$2 AND o.paid_at::date BETWEEN $3 AND $4 ORDER BY a.id FOR SHARE OF a`,
              [a.tenantId, sheet.staff_id, run.starts_on, run.ends_on],
            )
          ).rows;
          for (const tip of tips) {
            if (tip.currency !== run.currency)
              throw new ConflictException({
                code: "PAYROLL_CURRENCY_MISMATCH",
                message: "Tip source currency mismatch",
              });
            const tipMinor = BigInt(tip.amount_minor);
            await c.query(
              `INSERT INTO payroll_earning_lines(tenant_id,payroll_worker_id,earning_type,amount_minor,currency,source_type,source_id,source_fingerprint)
               VALUES($1,$2,'TIP',$3,$4,'LOCKED_TIP_ALLOCATIONS',$5,$6)`,
              [
                a.tenantId,
                worker.id,
                tipMinor.toString(),
                run.currency,
                tip.id,
                `tip:${tip.id}`,
              ],
            );
            await c.query(
              `INSERT INTO payroll_source_allocations(tenant_id,payroll_run_id,payroll_worker_id,source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency)
               VALUES($1,$2,$3,'LOCKED_TIP_ALLOCATIONS',$4,'SETTLED_TIP',$5,$6,$7)`,
              [
                a.tenantId,
                id,
                worker.id,
                tip.id,
                `tip:${tip.id}`,
                tipMinor.toString(),
                run.currency,
              ],
            );
            workerGross += tipMinor;
          }
          if (workerGross < 0n)
            throw new ConflictException({
              code: "PAYROLL_NEGATIVE_NET_PAY",
              message: "Worker gross pay cannot be negative",
            });
          await c.query(
            "UPDATE payroll_run_workers SET gross_pay_minor=$3,net_pay_minor=$3,source_fingerprint=$4 WHERE tenant_id=$1 AND id=$2",
            [
              a.tenantId,
              worker.id,
              workerGross.toString(),
              deterministicFingerprint({
                timesheet: sheet.fingerprint,
                commissions: commissions.map((x: any) => x.id),
                tips: tips.map((x: any) => x.id),
              }),
            ],
          );
          gross += workerGross;
          net += calculateNetPay(workerGross, 0n, 0n, 0n);
        }
        const allocatedSources = (
          await c.query<any>(
            `SELECT source_type,source_id,earning_usage_key,source_fingerprint,allocated_minor,currency
             FROM payroll_source_allocations WHERE tenant_id=$1 AND payroll_run_id=$2 ORDER BY source_type,source_id,earning_usage_key`,
            [a.tenantId, id],
          )
        ).rows;
        const fp = deterministicFingerprint({
          runId: id,
          policy: policy.fingerprint,
          workers: sheets.map((s: any) => ({
            id: s.id,
            fingerprint: s.fingerprint,
          })),
          sources: allocatedSources,
        });
        const row = (
          await c.query<any>(
            `UPDATE payroll_runs SET state='CALCULATED',source_fingerprint=$3,gross_pay_minor=$4,net_pay_minor=$5,worker_count=$6,blocking_exception_count=0,approved_by_user_id=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [
              a.tenantId,
              id,
              fp,
              gross.toString(),
              net.toString(),
              sheets.length,
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          "payroll.calculated",
          "payroll_run",
          id,
          null,
          requestId,
          this.view(run),
          this.view(row),
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }
  async payrollTransition(
    a: AccessClaims,
    id: string,
    to: PayrollRunState,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      `payroll.run.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM payroll_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException({
            code: "PAYROLL_RUN_NOT_FOUND",
            message: "Payroll run not found",
          });
        try {
          assertPayrollTransition(old.state, to);
        } catch {
          throw new ConflictException({
            code: "PAYROLL_RUN_STATUS_INVALID",
            message: `Cannot transition ${old.state} to ${to}`,
          });
        }
        if (to === "APPROVED" && old.prepared_by_user_id === a.userId)
          throw new ForbiddenException({
            code: "PAYROLL_SELF_APPROVAL_DENIED",
            message: "Preparer cannot approve",
          });
        if (
          to === "FINALIZED" &&
          (old.prepared_by_user_id === a.userId ||
            old.approved_by_user_id === a.userId)
        )
          throw new ForbiddenException({
            code: "PAYROLL_SELF_FINALIZATION_DENIED",
            message: "Independent finalizer required",
          });
        if (
          (to === "PENDING_APPROVAL" || to === "FINALIZED") &&
          Number(old.blocking_exception_count) > 0
        )
          throw new ConflictException({
            code: "PAYROLL_BLOCKING_EXCEPTION",
            message: "Blocking exceptions remain",
          });
        if (to === "VOID_PENDING") {
          if (!body?.reason)
            throw new ConflictException({
              code: "PAYROLL_VOID_NOT_ALLOWED",
              message: "Void reason and evidence are required",
            });
          const paid = (
            await c.query(
              `SELECT 1 FROM payout_batches b JOIN payout_items i ON i.tenant_id=b.tenant_id AND i.batch_id=b.id
               WHERE b.tenant_id=$1 AND b.payroll_run_id=$2 AND i.state IN('PAID','REVERSAL_PENDING') LIMIT 1`,
              [a.tenantId, id],
            )
          ).rowCount;
          if (paid)
            throw new ConflictException({
              code: "PAYROLL_VOID_NOT_ALLOWED",
              message: "Paid payout must be reversed before payroll void",
            });
        }
        if (to === "VOIDED") {
          const requester = (
            await c.query<{ actor_user_id: string }>(
              `SELECT actor_user_id FROM payroll_approval_history WHERE tenant_id=$1 AND payroll_run_id=$2 AND decision='VOID_REQUESTED' ORDER BY created_at DESC LIMIT 1`,
              [a.tenantId, id],
            )
          ).rows[0]?.actor_user_id;
          if (!requester || requester === a.userId)
            throw new ForbiddenException({
              code: "PAYROLL_SELF_APPROVAL_DENIED",
              message: "Void request requires independent approval",
            });
        }
        if (to === "FINALIZED") {
          const mismatch = (
            await c.query<{ count: string }>(
              `SELECT count(*)::text count FROM payroll_source_allocations s
               WHERE s.tenant_id=$1 AND s.payroll_run_id=$2 AND s.state='CLAIMED' AND (
                 (s.source_type='LOCKED_TIMESHEET' AND NOT EXISTS(SELECT 1 FROM staff_timesheets t WHERE t.tenant_id=s.tenant_id AND t.id=s.source_id AND t.state='LOCKED' AND t.fingerprint=s.source_fingerprint)) OR
                 (s.source_type='LOCKED_COMMISSION_ENTRIES' AND NOT EXISTS(SELECT 1 FROM commission_entries e WHERE e.tenant_id=s.tenant_id AND e.id=s.source_id AND e.status='LOCKED' AND e.generation_key=s.source_fingerprint AND e.commission_minor=s.allocated_minor)) OR
                 (s.source_type='LOCKED_TIP_ALLOCATIONS' AND NOT EXISTS(SELECT 1 FROM pos_tip_allocations a JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id AND t.status='ACTIVE' JOIN pos_orders o ON o.tenant_id=t.tenant_id AND o.id=t.pos_order_id AND o.status='PAID' WHERE a.tenant_id=s.tenant_id AND a.id=s.source_id AND a.amount_minor=s.allocated_minor)) OR
                 (s.source_type='PRIOR_RUN_CORRECTIONS' AND NOT EXISTS(SELECT 1 FROM payroll_correction_sources x WHERE x.tenant_id=s.tenant_id AND x.id=s.source_id AND x.state='CLAIMED' AND x.claimed_by_payroll_run_id=s.payroll_run_id AND x.fingerprint=s.source_fingerprint AND x.delta_minor=s.allocated_minor))
               )`,
              [a.tenantId, id],
            )
          ).rows[0]?.count;
          if (BigInt(mismatch ?? "0") > 0n)
            throw new ConflictException({
              code: "PAYROLL_SOURCE_FINGERPRINT_CHANGED",
              message: "A payroll source changed after calculation",
            });
          // Consume claims while the run is still APPROVED. Once the run is
          // FINALIZED, the database immutability trigger correctly rejects any
          // mutation of its source-allocation evidence.
          await c.query(
            "UPDATE payroll_source_allocations SET state='CONSUMED',consumed_at=now() WHERE tenant_id=$1 AND payroll_run_id=$2 AND state='CLAIMED'",
            [a.tenantId, id],
          );
          await c.query(
            "UPDATE payroll_correction_sources SET state='CONSUMED',consumed_at=now(),updated_at=now() WHERE tenant_id=$1 AND claimed_by_payroll_run_id=$2 AND state='CLAIMED'",
            [a.tenantId, id],
          );
        }
        const row = (
          await c.query<any>(
            `UPDATE payroll_runs SET state=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,finalized_by_user_id=CASE WHEN $3='FINALIZED' THEN $4 ELSE finalized_by_user_id END,finalized_at=CASE WHEN $3='FINALIZED' THEN now() ELSE finalized_at END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$5 RETURNING *`,
            [a.tenantId, id, to, a.userId, body?.version ?? old.version],
          )
        ).rows[0];
        if (!row)
          throw new ConflictException({
            code: "PAYROLL_RUN_VERSION_CONFLICT",
            message: "Payroll run changed",
          });
        await c.query(
          `INSERT INTO payroll_approval_history(tenant_id,payroll_run_id,decision,actor_user_id,reason,snapshot_json,source_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            a.tenantId,
            id,
            to === "PENDING_APPROVAL"
              ? "SUBMITTED"
              : to === "VOID_PENDING"
                ? "VOID_REQUESTED"
                : to,
            a.userId,
            body?.reason ?? null,
            JSON.stringify(this.view(row)),
            row.source_fingerprint,
          ],
        );
        if (to === "FINALIZED") {
          await c.query(
            `INSERT INTO payroll_finalization_snapshots(tenant_id,payroll_run_id,snapshot_json,source_fingerprint,calculation_version,finalized_by_user_id) VALUES($1,$2,$3,$4,$5,$6)`,
            [
              a.tenantId,
              id,
              JSON.stringify(this.view(row)),
              row.source_fingerprint,
              row.calculation_version,
              a.userId,
            ],
          );
          await c.query(
            "UPDATE payroll_run_workers SET state='FINALIZED',updated_at=now() WHERE tenant_id=$1 AND payroll_run_id=$2",
            [a.tenantId, id],
          );
          await c.query(
            `INSERT INTO pay_statements(tenant_id,payroll_run_id,payroll_worker_id,staff_id,employer_snapshot_json,statement_json,net_pay_minor,currency,correction_of_statement_id)
             SELECT w.tenant_id,w.payroll_run_id,w.id,w.staff_id,jsonb_build_object('tenantId',w.tenant_id),
               jsonb_build_object('grossPayMinor',w.gross_pay_minor::text,'deductionMinor',w.deduction_minor::text,'withholdingMinor',w.withholding_minor::text,'netPayMinor',w.net_pay_minor::text,'currency',w.currency),
               w.net_pay_minor,w.currency,
               (SELECT x.original_statement_id FROM payroll_correction_sources x WHERE x.tenant_id=w.tenant_id AND x.claimed_by_payroll_run_id=w.payroll_run_id AND x.staff_id=w.staff_id ORDER BY x.id LIMIT 1)
             FROM payroll_run_workers w WHERE w.tenant_id=$1 AND w.payroll_run_id=$2 ON CONFLICT DO NOTHING`,
            [a.tenantId, id],
          );
          await c.query(
            "UPDATE staff_timesheets t SET source_locked_at=now(),source_locked_by_payroll_run_id=$2 WHERE t.tenant_id=$1 AND EXISTS(SELECT 1 FROM payroll_source_allocations s WHERE s.tenant_id=t.tenant_id AND s.payroll_run_id=$2 AND s.source_type='LOCKED_TIMESHEET' AND s.source_id=t.id)",
            [a.tenantId, id],
          );
        }
        await this.emit(
          c,
          a,
          `payroll.${to.toLowerCase()}`,
          "payroll_run",
          id,
          null,
          requestId,
          this.view(old),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }

  async createPayoutBatch(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(a, key, "payout.batch.create", body, async (c) => {
      const run = (
        await c.query<any>(
          "SELECT * FROM payroll_runs WHERE tenant_id=$1 AND id=$2 AND state='FINALIZED'",
          [a.tenantId, this.required(body?.payrollRunId, "payrollRunId")],
        )
      ).rows[0];
      if (!run)
        throw new ConflictException({
          code: "PAYROLL_FINALIZED_IMMUTABLE",
          message: "Finalized payroll required",
        });
      const statements = (
        await c.query<any>(
          "SELECT * FROM pay_statements WHERE tenant_id=$1 AND payroll_run_id=$2 AND payment_status='UNPAID'",
          [a.tenantId, run.id],
        )
      ).rows;
      if (!statements.length)
        throw new ConflictException({
          code: "PAYOUT_ITEM_ALREADY_PAID",
          message: "No unpaid statements",
        });
      if (
        statements.some((statement: any) => statement.currency !== run.currency)
      )
        throw new ConflictException({
          code: "PAYOUT_CURRENCY_MISMATCH",
          message: "All payout statements must use the run currency",
        });
      const total = (
        await c.query<{ total: string }>(
          `SELECT COALESCE(sum(net_pay_minor),0)::text total FROM pay_statements
           WHERE tenant_id=$1 AND payroll_run_id=$2 AND payment_status='UNPAID'`,
          [a.tenantId, run.id],
        )
      ).rows[0]!.total;
      const batch = (
        await c.query<any>(
          `INSERT INTO payout_batches(tenant_id,payroll_run_id,method,provider_code,currency,total_minor,item_count,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            a.tenantId,
            run.id,
            this.required(body?.method, "method"),
            body?.providerCode ?? null,
            run.currency,
            total,
            statements.length,
            a.userId,
          ],
        )
      ).rows[0];
      for (const s of statements) {
        const requestedMethod = body?.paymentMethods?.[s.staff_id] ?? null;
        const paymentMethod = (
          await c.query<any>(
            `SELECT * FROM staff_payment_methods WHERE tenant_id=$1 AND staff_id=$2 AND status='ACTIVE'
               AND method_type=$3 AND ($4::uuid IS NULL OR id=$4)
             ORDER BY (id=$4::uuid) DESC,is_primary DESC,created_at LIMIT 1`,
            [a.tenantId, s.staff_id, batch.method, requestedMethod],
          )
        ).rows[0];
        if (!paymentMethod)
          throw new ConflictException({
            code: "PAYOUT_METHOD_MISSING",
            message: `Active ${batch.method} payment method missing for payout staff`,
          });
        await c.query(
          `INSERT INTO payout_items(tenant_id,batch_id,pay_statement_id,staff_id,payment_method_id,requested_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            a.tenantId,
            batch.id,
            s.id,
            s.staff_id,
            paymentMethod.id,
            s.net_pay_minor,
            s.currency,
          ],
        );
      }
      await this.emit(
        c,
        a,
        "payout.batch_created",
        "payout_batch",
        batch.id,
        null,
        requestId,
        null,
        this.view(batch),
        undefined,
        key,
      );
      return this.view(batch);
    });
  }
  async payoutTransition(
    a: AccessClaims,
    id: string,
    to: PayoutState,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      `payout.batch.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM payout_batches WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException({
            code: "PAYOUT_BATCH_NOT_FOUND",
            message: "Payout batch not found",
          });
        try {
          assertPayoutTransition(old.state, to);
        } catch {
          throw new ConflictException({
            code: "PAYOUT_BATCH_STATUS_INVALID",
            message: "Invalid payout transition",
          });
        }
        if (to === "APPROVED" && old.requested_by_user_id === a.userId)
          throw new ForbiddenException({
            code: "PAYOUT_SELF_APPROVAL_DENIED",
            message: "Requester cannot approve payout",
          });
        if (
          to === "PROCESSING" &&
          old.method === "EXTERNAL_PAYROLL_PROVIDER" &&
          !providerConfigured()
        )
          throw new ConflictException({
            code: "PAYOUT_PROVIDER_NOT_CONFIGURED",
            message: "Payout provider is not configured",
          });
        const row = (
          await c.query<any>(
            `UPDATE payout_batches SET state=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$5 RETURNING *`,
            [a.tenantId, id, to, a.userId, body?.version ?? old.version],
          )
        ).rows[0];
        if (!row)
          throw new ConflictException({
            code: "PAYOUT_BATCH_STATUS_INVALID",
            message: "Payout batch changed",
          });
        if (to === "PROCESSING")
          await c.query(
            "UPDATE payout_items SET state='PROCESSING',version=version+1,updated_at=now() WHERE tenant_id=$1 AND batch_id=$2 AND state IN('PENDING','FAILED')",
            [a.tenantId, id],
          );
        await this.emit(
          c,
          a,
          `payout.batch_${to.toLowerCase()}`,
          "payout_batch",
          id,
          null,
          requestId,
          this.view(old),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async recordManualPayment(
    a: AccessClaims,
    itemId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "payout.item.manual-paid",
      { itemId, ...body },
      async (c) => {
        const item = (
          await c.query<any>(
            `SELECT i.*,b.method,b.state batch_state,b.requested_by_user_id,b.approved_by_user_id,
                    m.method_type,m.staff_id method_staff_id,m.status method_status
             FROM payout_items i JOIN payout_batches b ON b.tenant_id=i.tenant_id AND b.id=i.batch_id
             LEFT JOIN staff_payment_methods m ON m.tenant_id=i.tenant_id AND m.id=i.payment_method_id
             WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE OF i,b`,
            [a.tenantId, itemId],
          )
        ).rows[0];
        if (!item)
          throw new NotFoundException({
            code: "PAYOUT_BATCH_NOT_FOUND",
            message: "Payout item not found",
          });
        if (item.state === "PAID")
          throw new ConflictException({
            code: "PAYOUT_ITEM_ALREADY_PAID",
            message: "Payout already paid",
          });
        if (
          !["APPROVED", "PROCESSING", "PARTIALLY_PAID"].includes(
            item.batch_state,
          )
        )
          throw new ConflictException({
            code: "PAYOUT_BATCH_NOT_APPROVED",
            message: "Manual payout requires an approved batch",
          });
        if (!["PENDING", "PROCESSING", "FAILED"].includes(item.state))
          throw new ConflictException({
            code: "PAYOUT_ITEM_STATUS_INVALID",
            message: "Payout item cannot be manually recorded",
          });
        if (
          !item.payment_method_id ||
          item.method_status !== "ACTIVE" ||
          item.method_staff_id !== item.staff_id ||
          item.method_type !== item.method ||
          item.method === "EXTERNAL_PAYROLL_PROVIDER"
        )
          throw new ConflictException({
            code: "PAYOUT_PAYMENT_METHOD_INVALID",
            message: "Staff-owned manual-compatible payment method required",
          });
        if (
          item.requested_by_user_id === a.userId ||
          item.approved_by_user_id === a.userId
        )
          throw new ForbiddenException({
            code: "PAYOUT_DUAL_CONTROL_REQUIRED",
            message: "Requester or approver cannot record manual payout",
          });
        if (!body?.evidence || !body?.externalReference)
          throw new ConflictException({
            code: "PAYOUT_EVIDENCE_REQUIRED",
            message: "Approved payment evidence required",
          });
        if (
          String(body?.confirmedMinor) !== String(item.requested_minor) ||
          body?.currency !== item.currency
        )
          throw new ConflictException({
            code: "PAYOUT_AMOUNT_MISMATCH",
            message:
              "Evidence amount and currency must exactly match payout item",
          });
        const evidence = redactWorkforceEvidence(body.evidence);
        const evidenceHash = deterministicFingerprint({
          reference: String(body.externalReference),
          amountMinor: String(body.confirmedMinor),
          currency: body.currency,
          evidence,
        });
        const row = (
          await c.query<any>(
            `UPDATE payout_items SET state='PAID',confirmed_minor=requested_minor,provider_reference=$3,
               manual_evidence_json=$4,manual_evidence_hash=$5,manual_recorded_by_user_id=$6,
               paid_at=now(),failure_code=NULL,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [
              a.tenantId,
              itemId,
              String(body.externalReference),
              JSON.stringify(evidence),
              evidenceHash,
              a.userId,
            ],
          )
        ).rows[0];
        await c.query(
          "UPDATE pay_statements SET payment_status='PAID' WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, item.pay_statement_id],
        );
        await c.query(
          `INSERT INTO payout_reconciliations(tenant_id,payout_item_id,state,expected_minor,confirmed_minor,currency,external_reference) VALUES($1,$2,'MATCHED',$3,$3,$4,$5) ON CONFLICT(tenant_id,payout_item_id) DO UPDATE SET state='MATCHED',confirmed_minor=EXCLUDED.confirmed_minor,external_reference=EXCLUDED.external_reference,updated_at=now()`,
          [
            a.tenantId,
            itemId,
            item.requested_minor,
            item.currency,
            String(body.externalReference),
          ],
        );
        const counts = (
          await c.query<any>(
            "SELECT count(*) FILTER(WHERE state='PAID') paid,count(*) total FROM payout_items WHERE tenant_id=$1 AND batch_id=$2",
            [a.tenantId, item.batch_id],
          )
        ).rows[0];
        await c.query(
          "UPDATE payout_batches SET state=CASE WHEN $3=$4 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [a.tenantId, item.batch_id, counts.paid, counts.total],
        );
        await this.emit(
          c,
          a,
          "payout.item_paid",
          "payout_item",
          itemId,
          null,
          requestId,
          this.view(item),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async recordPayoutProviderEvent(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(a, key, "payout.provider-event", body, async (c) => {
      const providerCode = this.required(body?.providerCode, "providerCode");
      const providerEventId = this.required(
        body?.providerEventId,
        "providerEventId",
      );
      const outcome = this.required(body?.outcome, "outcome");
      if (!["CONFIRMED", "FAILED", "UNKNOWN"].includes(outcome))
        throw new ConflictException({
          code: "PAYOUT_PROVIDER_EVENT_INVALID",
          message: "Unsupported payout provider outcome",
        });
      const providerKey = this.required(
        body?.providerRequestKey,
        "providerRequestKey",
      );
      const event = (
        await c.query<any>(
          `INSERT INTO payout_provider_events(
             tenant_id,provider_code,provider_event_id,event_type,payload_hash,signature_verified,safe_payload_json
           ) VALUES($1,$2,$3,$4,$5,true,$6)
           ON CONFLICT(tenant_id,provider_code,provider_event_id) DO UPDATE SET provider_event_id=EXCLUDED.provider_event_id
           RETURNING *`,
          [
            a.tenantId,
            providerCode,
            providerEventId,
            outcome,
            deterministicFingerprint(body),
            JSON.stringify(
              redactWorkforceEvidence({
                providerRequestKey: providerKey,
                outcome,
                providerReference: body?.providerReference ?? null,
              }),
            ),
          ],
        )
      ).rows[0];
      if (event.processed_at) return { ...this.view(event), duplicate: true };
      const item = (
        await c.query<any>(
          "SELECT * FROM payout_items WHERE tenant_id=$1 AND provider_request_key=$2 FOR UPDATE",
          [a.tenantId, providerKey],
        )
      ).rows[0];
      if (!item)
        throw new NotFoundException({
          code: "PAYOUT_ITEM_NOT_FOUND",
          message: "Provider event payout item not found",
        });
      if (item.state !== "PAID") {
        if (outcome === "CONFIRMED") {
          const reference = this.required(
            body?.providerReference,
            "providerReference",
          );
          await c.query(
            `UPDATE payout_attempts SET state='CONFIRMED',provider_reference=$3,completed_at=now()
             WHERE tenant_id=$1 AND payout_item_id=$2 AND state IN('SUBMITTED','UNKNOWN')`,
            [a.tenantId, item.id, reference],
          );
          await c.query(
            `UPDATE payout_items SET state='PAID',confirmed_minor=requested_minor,provider_reference=$3,
               paid_at=now(),failure_code=NULL,unknown_since=NULL,version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND id=$2`,
            [a.tenantId, item.id, reference],
          );
          await c.query(
            "UPDATE pay_statements SET payment_status='PAID' WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, item.pay_statement_id],
          );
        } else if (outcome === "FAILED") {
          await c.query(
            `UPDATE payout_attempts SET state='FAILED',error_code='PROVIDER_CONFIRMED_FAILED',completed_at=now()
             WHERE tenant_id=$1 AND payout_item_id=$2 AND state IN('SUBMITTED','UNKNOWN')`,
            [a.tenantId, item.id],
          );
          await c.query(
            "UPDATE payout_items SET state='FAILED',failure_code='PROVIDER_CONFIRMED_FAILED',unknown_since=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, item.id],
          );
        } else {
          await c.query(
            "UPDATE payout_items SET state='MANUAL_REVIEW',failure_code='PROVIDER_OUTCOME_REQUIRES_REVIEW',unknown_since=COALESCE(unknown_since,now()),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, item.id],
          );
        }
      }
      await c.query(
        "UPDATE payout_provider_events SET processed_at=now() WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, event.id],
      );
      await this.emit(
        c,
        a,
        "payout.provider_event_reconciled",
        "payout_item",
        item.id,
        null,
        requestId,
        this.view(item),
        { outcome },
        undefined,
        key,
      );
      return { ...this.view(event), payoutItemId: item.id, outcome };
    });
  }
  async timesheetPeriodTransition(
    a: AccessClaims,
    id: string,
    to: "SUBMISSION_OPEN" | "REVIEW" | "LOCKED" | "CLOSED",
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      `timesheet.period.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM timesheet_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, id],
          )
        ).rows[0];
        const valid: Record<string, string[]> = {
          OPEN: ["SUBMISSION_OPEN"],
          SUBMISSION_OPEN: ["REVIEW"],
          REVIEW: ["LOCKED"],
          LOCKED: ["CLOSED"],
        };
        if (!old || !valid[old.state]?.includes(to))
          throw new ConflictException({
            code: "TIMESHEET_STATUS_INVALID",
            message: "Invalid timesheet-period transition",
          });
        if (to === "LOCKED") {
          const notLocked = (
            await c.query(
              "SELECT 1 FROM staff_timesheets WHERE tenant_id=$1 AND period_id=$2 AND state<>'LOCKED' LIMIT 1",
              [a.tenantId, id],
            )
          ).rowCount;
          if (notLocked)
            throw new ConflictException({
              code: "TIMESHEET_HAS_BLOCKING_EXCEPTION",
              message: "All staff timesheets must be locked",
            });
        }
        const row = (
          await c.query<any>(
            "UPDATE timesheet_periods SET state=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [a.tenantId, id, to],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          `timesheet.period_${to.toLowerCase()}`,
          "timesheet_period",
          id,
          null,
          requestId,
          this.view(old),
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async deactivatePayRate(
    a: AccessClaims,
    staffId: string,
    rateId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "pay-rate.deactivate",
      { staffId, rateId, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            `UPDATE staff_pay_rate_versions r SET status='INACTIVE',deactivated_at=now() FROM staff_pay_profiles p WHERE r.tenant_id=$1 AND r.id=$2 AND p.tenant_id=r.tenant_id AND p.id=r.pay_profile_id AND p.staff_id=$3 AND r.status='ACTIVE' RETURNING r.*`,
            [a.tenantId, rateId, staffId],
          )
        ).rows[0];
        if (!row)
          throw new NotFoundException({
            code: "PAY_RATE_NOT_FOUND",
            message: "Active rate not found",
          });
        await this.emit(
          c,
          a,
          "pay_rate.deactivated",
          "staff_pay_rate",
          rateId,
          row.branch_id,
          requestId,
          null,
          this.view(row),
          body?.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async calendarTransition(
    a: AccessClaims,
    id: string,
    to: "ACTIVE" | "INACTIVE",
    body: any,
    key: string,
    _requestId: string,
  ) {
    void _requestId;
    return this.command(
      a,
      key,
      `payroll.calendar.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE payroll_calendars SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [a.tenantId, id, to],
          )
        ).rows[0];
        if (!row)
          throw new NotFoundException({
            code: "PAYROLL_CALENDAR_NOT_FOUND",
            message: "Calendar not found",
          });
        return this.view(row);
      },
    );
  }
  async payrollExceptionTransition(
    a: AccessClaims,
    id: string,
    to: "ACKNOWLEDGED" | "RESOLVED" | "WAIVED",
    body: any,
    key: string,
    _requestId: string,
  ) {
    void _requestId;
    return this.command(
      a,
      key,
      `payroll.exception.${to.toLowerCase()}`,
      { id, to, ...body },
      async (c) => {
        if (to !== "ACKNOWLEDGED" && !body?.reason)
          throw new ConflictException({
            code: "VALIDATION_FAILED",
            message: "Reason required",
          });
        const row = (
          await c.query<any>(
            `UPDATE payroll_exceptions SET state=$3,resolution_reason=$4,resolved_by_user_id=$5,resolved_at=CASE WHEN $3='ACKNOWLEDGED' THEN NULL ELSE now() END WHERE tenant_id=$1 AND id=$2 AND state IN('OPEN','ACKNOWLEDGED') RETURNING *`,
            [a.tenantId, id, to, body?.reason ?? null, a.userId],
          )
        ).rows[0];
        if (!row)
          throw new NotFoundException({
            code: "PAYROLL_EXCEPTION_NOT_FOUND",
            message: "Open payroll exception not found",
          });
        return this.view(row);
      },
    );
  }
  async payoutReversal(
    a: AccessClaims,
    itemId: string,
    to: "REVERSAL_PENDING" | "REVERSED",
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      `payout.item.${to.toLowerCase()}`,
      { itemId, to, ...body },
      async (c) => {
        if (!body?.reason || !body?.evidence)
          throw new ConflictException({
            code: "PAYOUT_EVIDENCE_REQUIRED",
            message: "Reason and evidence required",
          });
        const old = (
          await c.query<any>(
            "SELECT * FROM payout_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [a.tenantId, itemId],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException({
            code: "PAYOUT_BATCH_NOT_FOUND",
            message: "Payout item not found",
          });
        if (to === "REVERSAL_PENDING" && old.state !== "PAID")
          throw new ConflictException({
            code: "PAYOUT_REVERSAL_NOT_ALLOWED",
            message: "Only paid item can request reversal",
          });
        if (to === "REVERSED") {
          if (old.state !== "REVERSAL_PENDING")
            throw new ConflictException({
              code: "PAYOUT_REVERSAL_NOT_ALLOWED",
              message: "Approved reversal request required",
            });
          const actor = (
            await c.query<{ actor_user_id: string }>(
              `SELECT actor_user_id FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='payout.reversal_requested' ORDER BY created_at DESC LIMIT 1`,
              [a.tenantId, itemId],
            )
          ).rows[0]?.actor_user_id;
          if (!actor || actor === a.userId)
            throw new ForbiddenException({
              code: "PAYOUT_SELF_APPROVAL_DENIED",
              message: "Independent reversal approval required",
            });
        }
        const row = (
          await c.query<any>(
            "UPDATE payout_items SET state=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [a.tenantId, itemId, to],
          )
        ).rows[0];
        if (to === "REVERSED") {
          await c.query(
            "UPDATE pay_statements SET payment_status='REVERSED' WHERE tenant_id=$1 AND id=$2",
            [a.tenantId, old.pay_statement_id],
          );
          await c.query(
            "UPDATE payout_reconciliations SET state='MATCHED',reversed_minor=confirmed_minor,updated_at=now() WHERE tenant_id=$1 AND payout_item_id=$2",
            [a.tenantId, itemId],
          );
        }
        await this.emit(
          c,
          a,
          to === "REVERSAL_PENDING"
            ? "payout.reversal_requested"
            : "payout.reversed",
          "payout_item",
          itemId,
          null,
          requestId,
          this.view(old),
          this.view(row),
          body.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async resolveReconciliation(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      a,
      key,
      "payout.reconciliation.resolve",
      { id, ...body },
      async (c) => {
        if (!body?.reason)
          throw new ConflictException({
            code: "VALIDATION_FAILED",
            message: "Reason required",
          });
        const row = (
          await c.query<any>(
            "UPDATE payout_reconciliations SET state='RESOLVED',variance_reason=$3,resolved_by_user_id=$4,resolved_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN('UNMATCHED','VARIANCE') RETURNING *",
            [a.tenantId, id, body.reason, a.userId],
          )
        ).rows[0];
        if (!row)
          throw new NotFoundException({
            code: "PAYOUT_RECONCILIATION_VARIANCE",
            message: "Open variance not found",
          });
        await this.emit(
          c,
          a,
          "payout.reconciliation_resolved",
          "payout_reconciliation",
          id,
          null,
          requestId,
          null,
          this.view(row),
          body.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async createExport(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    return this.command(a, key, "payroll.export.create", body, async (c) => {
      const row = (
        await c.query<any>(
          `INSERT INTO payroll_export_jobs(tenant_id,requested_by_user_id,export_type,filters_json) VALUES($1,$2,$3,$4) RETURNING *`,
          [
            a.tenantId,
            a.userId,
            this.required(body?.exportType, "exportType"),
            JSON.stringify(body?.filters ?? {}),
          ],
        )
      ).rows[0];
      await this.emit(
        c,
        a,
        "payroll.export_requested",
        "payroll_export",
        row.id,
        null,
        requestId,
        null,
        this.view(row),
        undefined,
        key,
      );
      return this.view(row);
    });
  }
  async ownAttendance(a: AccessClaims) {
    return this.list(a, "attendance_sessions", "AND staff_id=$2", [
      this.ownStaff(a),
    ]);
  }
  async ownTimesheets(a: AccessClaims, id?: string) {
    const where = id ? "AND staff_id=$2 AND id=$3" : "AND staff_id=$2";
    return id
      ? this.detailOwn(a, "staff_timesheets", id, this.ownStaff(a))
      : this.list(a, "staff_timesheets", where, [this.ownStaff(a)]);
  }
  private async detailOwn(
    a: AccessClaims,
    table: string,
    id: string,
    staffId: string,
  ) {
    const rows = await this.list(a, table, "AND staff_id=$2 AND id=$3", [
      staffId,
      id,
    ]);
    if (!rows[0])
      throw new NotFoundException({
        code: "RESOURCE_NOT_FOUND",
        message: "Resource not found",
      });
    return rows[0];
  }
  async ownStatements(a: AccessClaims, id?: string) {
    const staff = this.ownStaff(a);
    return id
      ? this.detailOwn(a, "pay_statements", id, staff)
      : this.list(a, "pay_statements", "AND staff_id=$2", [staff]);
  }
}
