/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { SchedulingRealtimeService } from "../availability/scheduling-realtime.service.js";
const createSchema = z.object({
  branchId: z.string().uuid(),
  staffId: z.string().uuid().nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
  blockType: z.enum(["MANUAL", "EXTERNAL", "MAINTENANCE", "SYSTEM"]),
  title: z.string().trim().min(1).max(200),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  source: z.string().max(100).nullable().optional(),
  sourceReference: z.string().max(255).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
const updateSchema = createSchema
  .omit({ branchId: true, blockType: true })
  .partial()
  .extend({ version: z.number().int().positive() });
type Conn = {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: any[]; rowCount: number | null }>;
};
@Injectable()
export class BusyBlockService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SchedulingRealtimeService)
    private readonly realtime: SchedulingRealtimeService,
  ) {}
  private owner(a: AccessClaims) {
    return a.roles.includes("SALON_OWNER");
  }
  private guard(a: AccessClaims, b: string) {
    if (a.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "TENANT_ACCESS_DENIED",
        message: "Platform support grant is required",
      });
    if (!this.owner(a) && !a.branchIds.includes(b))
      throw new ForbiddenException({
        code: "BRANCH_ACCESS_DENIED",
        message: "Branch outside membership scope",
      });
  }
  private async ownStaffId(a: AccessClaims) {
    return (
      await this.db.query<any>(
        "SELECT id FROM staff_profiles WHERE tenant_id=$1 AND membership_id=$2",
        [a.tenantId, a.membershipId],
      )
    ).rows[0]?.id as string | undefined;
  }
  private map(row: any) {
    return {
      id: row.id,
      branchId: row.branch_id,
      staffId: row.staff_id,
      resourceId: row.resource_id,
      blockType: row.block_type,
      title: row.title,
      startAt: row.start_at,
      endAt: row.end_at,
      status: row.status,
      source: row.source,
      sourceReference: row.source_reference,
      notes: row.notes,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cancelledAt: row.cancelled_at,
    };
  }
  private async audit(
    c: Conn,
    a: AccessClaims,
    action: string,
    row: any,
    before: any,
    requestId: string,
  ) {
    await c.query(
      "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) VALUES($1,$2,$3,$4,'availability_block',$5,$6,$7,$8)",
      [
        a.tenantId,
        row.branch_id,
        a.userId,
        action,
        row.id,
        before ? JSON.stringify(before) : null,
        JSON.stringify(row),
        requestId,
      ],
    );
    await c.query(
      "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,'availability_block',$4,$5,$6,$7)",
      [
        a.tenantId,
        row.branch_id,
        action,
        row.id,
        JSON.stringify(this.map(row)),
        JSON.stringify({ type: "USER", id: a.userId }),
        JSON.stringify({
          schemaVersion: 1,
          realtimeEvent: "availability.invalidated",
        }),
      ],
    );
  }
  private range(start: string, end: string) {
    if (new Date(end) <= new Date(start))
      throw new BadRequestException({
        code: "BUSY_BLOCK_INVALID_RANGE",
        message: "endAt must be after startAt",
      });
  }
  private async validateTarget(c: Conn, a: AccessClaims, b: any) {
    if (!b.staffId && !b.resourceId)
      throw new BadRequestException({
        code: "BUSY_BLOCK_TARGET_REQUIRED",
        message: "staffId or resourceId is required",
      });
    if (b.staffId) {
      const x = await c.query(
        "SELECT 1 FROM staff_profiles sp JOIN staff_branch_assignments sa ON sa.tenant_id=sp.tenant_id AND sa.staff_id=sp.id WHERE sp.tenant_id=$1 AND sp.id=$2 AND sa.branch_id=$3 AND sa.status='ACTIVE' LIMIT 1",
        [a.tenantId, b.staffId, b.branchId],
      );
      if (!x.rowCount)
        throw new BadRequestException({
          code: "BUSY_BLOCK_TARGET_MISMATCH",
          message: "Staff is not assigned to branch",
        });
    }
    if (b.resourceId) {
      const x = await c.query(
        "SELECT 1 FROM resources WHERE tenant_id=$1 AND id=$2 AND branch_id=$3",
        [a.tenantId, b.resourceId, b.branchId],
      );
      if (!x.rowCount)
        throw new BadRequestException({
          code: "BUSY_BLOCK_TARGET_MISMATCH",
          message: "Resource is not in branch",
        });
    }
  }
  private async assertActiveBranch(c: Conn, a: AccessClaims, branchId: string) {
    const branch = await c.query(
      "SELECT status FROM branches WHERE tenant_id=$1 AND id=$2",
      [a.tenantId, branchId],
    );
    if (!branch.rowCount)
      throw new NotFoundException({
        code: "AVAILABILITY_BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
    if (branch.rows[0].status !== "ACTIVE")
      throw new ConflictException({
        code: "AVAILABILITY_BRANCH_INACTIVE",
        message: "The branch is not available for scheduling.",
      });
  }
  async list(a: AccessClaims, q: any) {
    this.guard(a, q.branchId);
    const tech = a.roles.includes("NAIL_TECHNICIAN"),
      own = tech ? await this.ownStaffId(a) : null;
    const r = await this.db.query<any>(
      "SELECT * FROM availability_blocks WHERE tenant_id=$1 AND branch_id=$2 AND ($3::uuid IS NULL OR staff_id=$3) AND ($4::uuid IS NULL OR resource_id=$4) AND ($5::text IS NULL OR status=$5) AND ($6::timestamptz IS NULL OR end_at>$6) AND ($7::timestamptz IS NULL OR start_at<$7) AND ($8::uuid IS NULL OR staff_id=$8) ORDER BY start_at",
      [
        a.tenantId,
        q.branchId,
        q.staffId ?? null,
        q.resourceId ?? null,
        q.status ?? null,
        q.from ?? null,
        q.to ?? null,
        own ?? null,
      ],
    );
    return r.rows.map((x) => this.map(x));
  }
  async one(a: AccessClaims, id: string) {
    const row = (
      await this.db.query<any>(
        "SELECT * FROM availability_blocks WHERE tenant_id=$1 AND id=$2",
        [a.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "BUSY_BLOCK_NOT_FOUND",
        message: "Busy block not found",
      });
    this.guard(a, row.branch_id);
    if (
      a.roles.includes("NAIL_TECHNICIAN") &&
      row.staff_id !== (await this.ownStaffId(a))
    )
      throw new ForbiddenException({
        code: "BRANCH_ACCESS_DENIED",
        message: "Technician can only read own blocks",
      });
    return this.map(row);
  }
  async create(a: AccessClaims, input: unknown, requestId: string) {
    const b = createSchema.parse(input);
    this.guard(a, b.branchId);
    if (b.blockType === "SYSTEM")
      throw new ForbiddenException({
        code: "BUSY_BLOCK_STATUS_INVALID",
        message: "SYSTEM blocks cannot be user-created",
      });
    if (b.blockType === "MAINTENANCE" && !b.resourceId)
      throw new BadRequestException({
        code: "BUSY_BLOCK_TARGET_REQUIRED",
        message: "Maintenance requires resourceId",
      });
    if (
      b.blockType === "MAINTENANCE" &&
      !this.owner(a) &&
      !a.roles.includes("BRANCH_MANAGER")
    )
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Resource maintenance permission required",
      });
    if (b.blockType === "EXTERNAL" && (!b.source || !b.sourceReference))
      throw new BadRequestException({
        code: "BUSY_BLOCK_TARGET_REQUIRED",
        message: "External source and reference are required",
      });
    this.range(b.startAt, b.endAt);
    const result = await this.db.transaction(async (c) => {
      await this.assertActiveBranch(c, a, b.branchId);
      await this.validateTarget(c, a, b);
      if (b.blockType === "EXTERNAL") {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${a.tenantId}:${b.source}:${b.sourceReference}`,
        ]);
        const found = (
          await c.query(
            "SELECT * FROM availability_blocks WHERE tenant_id=$1 AND block_type='EXTERNAL' AND source=$2 AND source_reference=$3",
            [a.tenantId, b.source, b.sourceReference],
          )
        ).rows[0];
        if (found) return this.map(found);
      }
      const id = randomUUID();
      const r = (
        await c.query(
          "INSERT INTO availability_blocks(id,tenant_id,branch_id,staff_id,resource_id,block_type,title,start_at,end_at,source,source_reference,notes,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *",
          [
            id,
            a.tenantId,
            b.branchId,
            b.staffId ?? null,
            b.resourceId ?? null,
            b.blockType,
            b.title,
            b.startAt,
            b.endAt,
            b.source ?? null,
            b.sourceReference ?? null,
            b.notes ?? null,
            a.userId,
          ],
        )
      ).rows[0];
      await this.audit(c, a, "availability.block_created", r, null, requestId);
      return this.map(r);
    });
    this.realtime.invalidate({
      tenantId: a.tenantId,
      branchId: result.branchId,
      staffId: result.staffId,
      version: result.version,
      event: "created",
    });
    return result;
  }
  async update(a: AccessClaims, id: string, input: unknown, requestId: string) {
    const b = updateSchema.parse(input);
    const result = await this.db.transaction(async (c) => {
      const before = (
        await c.query(
          "SELECT * FROM availability_blocks WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [a.tenantId, id],
        )
      ).rows[0];
      if (!before)
        throw new NotFoundException({
          code: "BUSY_BLOCK_NOT_FOUND",
          message: "Busy block not found",
        });
      this.guard(a, before.branch_id);
      await this.assertActiveBranch(c, a, before.branch_id);
      if (before.status !== "ACTIVE")
        throw new ConflictException({
          code: "BUSY_BLOCK_STATUS_INVALID",
          message: "Only active blocks can be updated",
        });
      const start = b.startAt ?? before.start_at,
        end = b.endAt ?? before.end_at;
      this.range(start, end);
      await this.validateTarget(c, a, {
        branchId: before.branch_id,
        staffId: b.staffId === undefined ? before.staff_id : b.staffId,
        resourceId:
          b.resourceId === undefined ? before.resource_id : b.resourceId,
      });
      const r = (
        await c.query(
          "UPDATE availability_blocks SET staff_id=CASE WHEN $4 THEN $5 ELSE staff_id END,resource_id=CASE WHEN $6 THEN $7 ELSE resource_id END,title=COALESCE($8,title),start_at=COALESCE($9,start_at),end_at=COALESCE($10,end_at),source=CASE WHEN $11 THEN $12 ELSE source END,source_reference=CASE WHEN $13 THEN $14 ELSE source_reference END,notes=CASE WHEN $15 THEN $16 ELSE notes END,version=version+1,updated_by_user_id=$17,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
          [
            a.tenantId,
            id,
            b.version,
            Object.hasOwn(b, "staffId"),
            b.staffId ?? null,
            Object.hasOwn(b, "resourceId"),
            b.resourceId ?? null,
            b.title ?? null,
            b.startAt ?? null,
            b.endAt ?? null,
            Object.hasOwn(b, "source"),
            b.source ?? null,
            Object.hasOwn(b, "sourceReference"),
            b.sourceReference ?? null,
            Object.hasOwn(b, "notes"),
            b.notes ?? null,
            a.userId,
          ],
        )
      ).rows[0];
      if (!r)
        throw new ConflictException({
          code: "BUSY_BLOCK_VERSION_CONFLICT",
          message: "Busy block was changed by another request",
        });
      await this.audit(
        c,
        a,
        "availability.block_updated",
        r,
        before,
        requestId,
      );
      return this.map(r);
    });
    this.realtime.invalidate({
      tenantId: a.tenantId,
      branchId: result.branchId,
      staffId: result.staffId,
      version: result.version,
      event: "updated",
    });
    return result;
  }
  async cancel(
    a: AccessClaims,
    id: string,
    version: number | undefined,
    requestId: string,
  ) {
    const result = await this.db.transaction(async (c) => {
      const before = (
        await c.query(
          "SELECT * FROM availability_blocks WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [a.tenantId, id],
        )
      ).rows[0];
      if (!before)
        throw new NotFoundException({
          code: "BUSY_BLOCK_NOT_FOUND",
          message: "Busy block not found",
        });
      this.guard(a, before.branch_id);
      if (before.status !== "ACTIVE")
        throw new ConflictException({
          code: "BUSY_BLOCK_STATUS_INVALID",
          message: "Only active blocks can be cancelled",
        });
      const r = (
        await c.query(
          "UPDATE availability_blocks SET status='CANCELLED',cancelled_at=now(),version=version+1,updated_by_user_id=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND ($3::int IS NULL OR version=$3) RETURNING *",
          [a.tenantId, id, version ?? null, a.userId],
        )
      ).rows[0];
      if (!r)
        throw new ConflictException({
          code: "BUSY_BLOCK_VERSION_CONFLICT",
          message: "Busy block was changed by another request",
        });
      await this.audit(
        c,
        a,
        "availability.block_cancelled",
        r,
        before,
        requestId,
      );
      return this.map(r);
    });
    this.realtime.invalidate({
      tenantId: a.tenantId,
      branchId: result.branchId,
      staffId: result.staffId,
      version: result.version,
      event: "removed",
    });
    return result;
  }
}
