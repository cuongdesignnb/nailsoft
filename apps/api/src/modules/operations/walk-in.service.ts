/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  walkInConversionHoldSchema,
  walkInConversionPlanSchema,
  walkInConvertSchema,
  walkInCreateSchema,
  walkInPrioritySchema,
  walkInStatusCommandSchema,
  walkInUpdateSchema,
} from "@nailsoft/validation";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import { BookingService } from "../booking/booking.service.js";
import { assertWalkInTransition } from "./operations-domain.js";

@Injectable()
export class WalkInService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(BookingService) private readonly booking: BookingService,
  ) {}
  private deny(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support access grant is required",
      });
  }
  private branch(auth: AccessClaims, branchId: string) {
    if (
      !auth.roles.includes("SALON_OWNER") &&
      !auth.branchIds.includes(branchId)
    )
      throw new ForbiddenException({
        code: "BRANCH_SCOPE_DENIED",
        message: "Branch is outside the active workspace",
      });
  }

  async list(auth: AccessClaims, q: any) {
    this.deny(auth);
    if (q.branchId) this.branch(auth, q.branchId);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const rows = await this.db.query<any>(
      `SELECT w.*,c.display_name customer_name,(SELECT count(*)::int FROM walk_in_entries x WHERE x.tenant_id=w.tenant_id AND x.branch_id=w.branch_id AND x.local_queue_date=w.local_queue_date AND x.status IN ('WAITING','READY','CALLED') AND (CASE x.priority WHEN 'MANAGER_OVERRIDE' THEN 0 WHEN 'RECOVERY' THEN 1 ELSE 2 END,CASE x.status WHEN 'READY' THEN 0 WHEN 'CALLED' THEN 1 ELSE 2 END,x.created_at,x.queue_number)<(CASE w.priority WHEN 'MANAGER_OVERRIDE' THEN 0 WHEN 'RECOVERY' THEN 1 ELSE 2 END,CASE w.status WHEN 'READY' THEN 0 WHEN 'CALLED' THEN 1 ELSE 2 END,w.created_at,w.queue_number))+1 queue_position FROM walk_in_entries w LEFT JOIN customers c ON c.tenant_id=w.tenant_id AND c.id=w.customer_id WHERE w.tenant_id=$1 AND ($2::uuid[] IS NULL OR w.branch_id=ANY($2)) AND ($3::uuid IS NULL OR w.branch_id=$3) AND ($4::date IS NULL OR w.local_queue_date=$4) AND ($5::text IS NULL OR w.status=$5) ORDER BY CASE w.priority WHEN 'MANAGER_OVERRIDE' THEN 0 WHEN 'RECOVERY' THEN 1 ELSE 2 END,CASE w.status WHEN 'READY' THEN 0 WHEN 'CALLED' THEN 1 ELSE 2 END,w.created_at,w.queue_number LIMIT 200`,
      [
        auth.tenantId,
        branches,
        q.branchId ?? null,
        q.date ?? null,
        q.status ?? null,
      ],
    );
    return rows.rows.map((x) => this.view(x));
  }
  async detail(auth: AccessClaims, id: string) {
    this.deny(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM walk_in_entries WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "WALK_IN_NOT_FOUND",
        message: "Walk-in not found",
      });
    this.branch(auth, row.branch_id);
    const [items, history] = await Promise.all([
      this.db.query<any>(
        "SELECT * FROM walk_in_items WHERE tenant_id=$1 AND walk_in_entry_id=$2 ORDER BY sequence_no",
        [auth.tenantId, id],
      ),
      this.db.query<any>(
        "SELECT from_status,to_status,reason_code,note,created_at FROM walk_in_status_history WHERE tenant_id=$1 AND walk_in_entry_id=$2 ORDER BY created_at,id",
        [auth.tenantId, id],
      ),
    ]);
    return {
      ...this.view(row),
      contact: row.contact_snapshot_json,
      staffPreference: row.staff_preference_json,
      note: row.note,
      items: items.rows.map((x) => ({
        id: x.id,
        sequenceNo: x.sequence_no,
        serviceId: x.service_id,
        service: x.service_snapshot_json,
        staffPreference: x.staff_preference_json,
      })),
      history: history.rows,
    };
  }
  async create(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.deny(auth);
    const body = walkInCreateSchema.parse(input);
    this.branch(auth, body.branchId);
    const planInput = {
      branchId: body.branchId,
      desiredStartAt: new Date(Date.now() + 60_000).toISOString(),
      items: body.items,
    };
    let plan: any = null;
    try {
      plan = await this.booking.plan(auth, planInput);
    } catch {
      /* ETA remains explicitly unavailable */
    }
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "walkin.create",
          key,
          request: body,
          work: async () => {
            const branch = (
              await client.query<any>(
                "SELECT id,timezone FROM branches WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
                [auth.tenantId, body.branchId],
              )
            ).rows[0];
            if (!branch)
              throw new ConflictException({
                code: "BRANCH_INACTIVE",
                message: "Branch is not active",
              });
            const services = (
              await client.query<any>(
                "SELECT id,code,name_json,default_duration_min,status FROM services WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
                [auth.tenantId, body.items.map((x) => x.serviceId)],
              )
            ).rows;
            if (
              services.length !==
                new Set(body.items.map((x) => x.serviceId)).size ||
              services.some((x) => x.status !== "ACTIVE")
            )
              throw new ConflictException({
                code: "SERVICE_INACTIVE",
                message: "Requested service is unavailable",
              });
            const counter = (
              await client.query<any>(
                `INSERT INTO walk_in_queue_counters(tenant_id,branch_id,local_queue_date,last_queue_number) VALUES($1,$2,(now() AT TIME ZONE $3)::date,1) ON CONFLICT(tenant_id,branch_id,local_queue_date) DO UPDATE SET last_queue_number=walk_in_queue_counters.last_queue_number+1,updated_at=now() RETURNING local_queue_date,last_queue_number`,
                [auth.tenantId, body.branchId, branch.timezone],
              )
            ).rows[0];
            const created = (
              await client.query<any>(
                `INSERT INTO walk_in_entries(tenant_id,branch_id,local_queue_date,queue_number,customer_id,contact_snapshot_json,staff_preference_json,estimated_start_at,estimated_wait_minutes,estimate_generated_at,note,source,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
                [
                  auth.tenantId,
                  body.branchId,
                  counter.local_queue_date,
                  counter.last_queue_number,
                  body.customerId ?? null,
                  JSON.stringify({
                    displayName: body.displayName,
                    phone: body.phone ?? null,
                    email: body.email ?? null,
                  }),
                  JSON.stringify(
                    body.items[0]?.staffPreference ?? { type: "ANY" },
                  ),
                  plan?.startAt ?? null,
                  plan
                    ? Math.max(
                        0,
                        Math.ceil(
                          (new Date(plan.startAt).getTime() - Date.now()) /
                            60000,
                        ),
                      )
                    : null,
                  plan ? new Date() : null,
                  body.note ?? null,
                  body.source,
                  auth.userId,
                ],
              )
            ).rows[0];
            for (const [i, item] of body.items.entries()) {
              const svc = services.find((x) => x.id === item.serviceId);
              await client.query(
                "INSERT INTO walk_in_items(tenant_id,walk_in_entry_id,sequence_no,service_id,staff_preference_json,service_snapshot_json) VALUES($1,$2,$3,$4,$5,$6)",
                [
                  auth.tenantId,
                  created.id,
                  i + 1,
                  item.serviceId,
                  JSON.stringify(item.staffPreference),
                  JSON.stringify({
                    code: svc.code,
                    name: svc.name_json,
                    durationMin: svc.default_duration_min,
                  }),
                ],
              );
            }
            await this.history(
              client,
              auth,
              created,
              null,
              "WAITING",
              requestId,
              "walkin.created",
            );
            return this.view(created);
          },
        }),
      )
    ).data;
  }
  async transition(
    auth: AccessClaims,
    id: string,
    to: any,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = walkInStatusCommandSchema.parse(input);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: `walkin.${to.toLowerCase()}`,
          key,
          request: { id, to, ...body },
          work: async () => {
            const row = await this.lock(client, auth, id);
            if (Number(row.version) !== body.version) throw version();
            assertWalkInTransition(row.status, to);
            const updated = (
              await client.query<any>(
                "UPDATE walk_in_entries SET status=$3,called_at=CASE WHEN $3='CALLED' THEN now() ELSE called_at END,cancellation_reason_code=CASE WHEN $3 IN ('CANCELLED','LEFT') THEN $4 ELSE cancellation_reason_code END,version=version+1,updated_by_user_id=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [auth.tenantId, id, to, body.reasonCode ?? null, auth.userId],
              )
            ).rows[0];
            await this.history(
              client,
              auth,
              updated,
              row.status,
              to,
              requestId,
              `walkin.${to.toLowerCase()}`,
              body.reasonCode,
              body.note,
            );
            return this.view(updated);
          },
        }),
      )
    ).data;
  }
  async update(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = walkInUpdateSchema.parse(input);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "walkin.update",
          key,
          request: { id, ...body },
          work: async () => {
            const row = await this.lock(client, auth, id);
            if (Number(row.version) !== body.version) throw version();
            if (["CONVERTED", "CANCELLED", "LEFT"].includes(row.status))
              throw new ConflictException({
                code: "WALK_IN_STATUS_INVALID",
                message: "Terminal queue entry cannot be updated",
              });
            const contact = {
              ...(row.contact_snapshot_json ?? {}),
              ...(body.displayName !== undefined
                ? { displayName: body.displayName }
                : {}),
              ...(body.phone !== undefined ? { phone: body.phone } : {}),
              ...(body.email !== undefined ? { email: body.email } : {}),
            };
            const updated = (
              await client.query<any>(
                `UPDATE walk_in_entries
                 SET contact_snapshot_json=$3,note=COALESCE($4,note),version=version+1,
                     updated_by_user_id=$5,updated_at=now()
                 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
                [
                  auth.tenantId,
                  id,
                  JSON.stringify(contact),
                  body.note ?? null,
                  auth.userId,
                ],
              )
            ).rows[0];
            await this.history(
              client,
              auth,
              updated,
              row.status,
              row.status,
              requestId,
              "walkin.updated",
              "DETAILS_UPDATED",
              body.note ?? undefined,
            );
            return this.view(updated);
          },
        }),
      )
    ).data;
  }
  async priority(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = walkInPrioritySchema.parse(input);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "walkin.priority",
          key,
          request: { id, ...body },
          work: async () => {
            const row = await this.lock(client, auth, id);
            if (Number(row.version) !== body.version) throw version();
            if (["CONVERTED", "CANCELLED", "LEFT"].includes(row.status))
              throw new ConflictException({
                code: "WALK_IN_STATUS_INVALID",
                message: "Terminal queue entry cannot be reprioritized",
              });
            const updated = (
              await client.query<any>(
                "UPDATE walk_in_entries SET priority=$3,priority_reason=$4,version=version+1,updated_by_user_id=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [auth.tenantId, id, body.priority, body.reason, auth.userId],
              )
            ).rows[0];
            await this.history(
              client,
              auth,
              updated,
              row.status,
              row.status,
              requestId,
              "walkin.priority_changed",
              "PRIORITY_CHANGE",
              body.reason,
            );
            return this.view(updated);
          },
        }),
      )
    ).data;
  }
  async conversionPlan(auth: AccessClaims, id: string, input: unknown) {
    const body = walkInConversionPlanSchema.parse(input),
      walk = await this.detail(auth, id);
    if (!["READY", "CALLED"].includes(walk.status))
      throw new ConflictException({
        code: "WALK_IN_STATUS_INVALID",
        message: "Walk-in is not ready for conversion",
      });
    return this.booking.plan(auth, {
      branchId: walk.branchId,
      desiredStartAt:
        body.desiredStartAt ??
        walk.estimatedStartAt ??
        new Date(Date.now() + 60_000).toISOString(),
      items: walk.items.map((x: any) => ({
        serviceId: x.serviceId,
        staffPreference: x.staffPreference,
      })),
    });
  }
  async conversionHold(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = walkInConversionHoldSchema.parse(input),
      walk = await this.detail(auth, id),
      plan = await this.conversionPlan(auth, id, body);
    return this.booking.createHold(
      auth,
      {
        branchId: walk.branchId,
        desiredStartAt: plan.startAt,
        items: walk.items.map((x: any) => ({
          serviceId: x.serviceId,
          staffPreference: x.staffPreference,
        })),
        availabilityDataVersion:
          body.availabilityDataVersion ?? plan.availabilityDataVersion,
        clientKey: `walkin:${id}`,
        source: "RECEPTION",
      },
      key,
      requestId,
    );
  }
  async convert(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = walkInConvertSchema.parse(input);
    const snapshot = await this.detail(auth, id);
    let locked: any;
    let converted: any;
    const appointment = await this.booking.createAppointment(
      auth,
      {
        holdId: body.holdId,
        customer: body.customerId
          ? { customerId: body.customerId }
          : {
              displayName: snapshot.contact.displayName,
              phone: snapshot.contact.phone ?? undefined,
              email: snapshot.contact.email ?? undefined,
              locale: "vi-VN",
            },
        confirm: true,
      },
      key,
      requestId,
      {
        transactionHook: {
          before: async (client) => {
            locked = await this.lock(client, auth, id);
            if (locked.status === "CONVERTED")
              throw new ConflictException({
                code: "WALK_IN_ALREADY_CONVERTED",
                message: "Walk-in has already been converted",
              });
            if (!["READY", "CALLED"].includes(locked.status))
              throw new ConflictException({
                code: "WALK_IN_STATUS_INVALID",
                message: "Walk-in is not ready for conversion",
              });
            if (Number(locked.version) !== body.version) throw version();
          },
          after: async (client, created) => {
            converted = (
              await client.query<any>(
                "UPDATE walk_in_entries SET status='CONVERTED',converted_appointment_id=$3,converted_at=now(),version=version+1,updated_by_user_id=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND converted_appointment_id IS NULL RETURNING *",
                [auth.tenantId, id, created.id, auth.userId],
              )
            ).rows[0];
            if (!converted)
              throw new ConflictException({
                code: "WALK_IN_CONVERSION_CONFLICT",
                message: "Walk-in was converted concurrently",
              });
            await this.history(
              client,
              auth,
              converted,
              locked.status,
              "CONVERTED",
              requestId,
              "walkin.converted",
            );
          },
        },
      },
    );
    const walkIn = converted ?? (await this.detail(auth, id));
    return {
      walkIn: converted ? this.view(converted) : walkIn,
      appointmentId: appointment.id,
      idempotencyReplayed: appointment.idempotencyReplayed,
    };
  }
  private async lock(client: PoolClient, auth: AccessClaims, id: string) {
    this.deny(auth);
    const row = (
      await client.query<any>(
        "SELECT * FROM walk_in_entries WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "WALK_IN_NOT_FOUND",
        message: "Walk-in not found",
      });
    this.branch(auth, row.branch_id);
    return row;
  }
  private async history(
    client: PoolClient,
    auth: AccessClaims,
    row: any,
    from: string | null,
    to: string,
    requestId: string,
    event: string,
    reason?: string,
    note?: string,
  ) {
    await client.query(
      "INSERT INTO walk_in_status_history(tenant_id,walk_in_entry_id,from_status,to_status,actor_user_id,reason_code,note,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        row.id,
        from,
        to,
        auth.userId,
        reason ?? null,
        note ?? null,
        requestId,
      ],
    );
    await client.query(
      "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,reason,request_id) VALUES($1,$2,$3,$4,'walk_in',$5,$6,$7,$8,$9)",
      [
        auth.tenantId,
        row.branch_id,
        auth.userId,
        event,
        row.id,
        JSON.stringify(from ? { status: from } : null),
        JSON.stringify({ status: to, version: row.version }),
        reason ?? null,
        requestId,
      ],
    );
    await client.query(
      "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,'walk_in',$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        row.branch_id,
        event,
        row.id,
        row.version,
        JSON.stringify({
          walkInId: row.id,
          branchId: row.branch_id,
          status: to,
          refetch: true,
        }),
        JSON.stringify({ type: "USER", id: auth.userId }),
        JSON.stringify({ schemaVersion: 1, realtimeEvent: "walkin.updated" }),
      ],
    );
  }
  private view(x: any) {
    return {
      id: x.id,
      branchId: x.branch_id,
      localQueueDate: x.local_queue_date,
      queueNumber: Number(x.queue_number),
      queuePosition: x.queue_position ? Number(x.queue_position) : undefined,
      customerDisplayName:
        x.customer_name ?? x.contact_snapshot_json?.displayName,
      status: x.status,
      priority: x.priority,
      priorityReason: x.priority_reason ?? undefined,
      estimatedStartAt: x.estimated_start_at ?? undefined,
      estimatedWaitMinutes:
        x.estimated_wait_minutes == null
          ? undefined
          : Number(x.estimated_wait_minutes),
      estimateGeneratedAt: x.estimate_generated_at ?? undefined,
      estimateDisclaimer: "ESTIMATED_NOT_GUARANTEED",
      calledAt: x.called_at ?? undefined,
      convertedAppointmentId: x.converted_appointment_id ?? undefined,
      version: Number(x.version),
      createdAt: x.created_at,
    };
  }
}
function version() {
  return new ConflictException({
    code: "VERSION_CONFLICT",
    message: "The queue entry changed; refresh and retry",
  });
}
