import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
const tenantUpdate = z
  .object({
    name: z.string().min(1).max(160).optional(),
    defaultLocale: z.enum(["vi-VN", "en-US"]).optional(),
    currency: z.string().length(3).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine((x) => Object.keys(x).length > 0);
const branchInput = z.object({
  name: z.string().min(1).max(160),
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/),
  timezone: z.string().min(1).max(64),
  phone: z.string().max(32).nullable().optional(),
  address: z.record(z.unknown()).default({}),
});
const branchUpdate = branchInput
  .partial()
  .refine((x) => Object.keys(x).length > 0);
const hoursInput = z
  .array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      openTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullable(),
      closeTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullable(),
      isClosed: z.boolean(),
    }),
  )
  .length(7);
@Injectable()
export class OrganizationService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  private branchAllowed(auth: AccessClaims, id: string) {
    return auth.roles.includes("SALON_OWNER") || auth.branchIds.includes(id);
  }
  async tenant(auth: AccessClaims) {
    const result = await this.db.query(
      'SELECT id,name,slug,default_locale "defaultLocale",currency,timezone,status,created_at "createdAt",updated_at "updatedAt" FROM tenants WHERE id=$1',
      [auth.tenantId],
    );
    return result.rows[0];
  }
  async updateTenant(auth: AccessClaims, input: unknown, requestId: string) {
    const body = tenantUpdate.parse(input);
    return this.db.transaction(async (c) => {
      const before = await c.query(
        "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
        [auth.tenantId],
      );
      const result = await c.query(
        'UPDATE tenants SET name=coalesce($2,name),default_locale=coalesce($3,default_locale),currency=coalesce($4,currency),timezone=coalesce($5,timezone),updated_at=now() WHERE id=$1 RETURNING id,name,slug,default_locale "defaultLocale",currency,timezone,status,updated_at "updatedAt"',
        [
          auth.tenantId,
          body.name ?? null,
          body.defaultLocale ?? null,
          body.currency ?? null,
          body.timezone ?? null,
        ],
      );
      await this.audit(
        c,
        auth,
        "organization.update",
        "tenant",
        auth.tenantId,
        before.rows[0],
        result.rows[0],
        requestId,
      );
      return result.rows[0];
    });
  }
  async branches(auth: AccessClaims) {
    const owner = auth.roles.includes("SALON_OWNER");
    const result = await this.db.query(
      'SELECT id,name,code,address_json "address",phone,timezone,status,created_at "createdAt",updated_at "updatedAt" FROM branches WHERE tenant_id=$1 AND ($2 OR id=ANY($3::uuid[])) ORDER BY name',
      [auth.tenantId, owner, auth.branchIds],
    );
    return result.rows;
  }
  async branch(auth: AccessClaims, id: string) {
    if (!this.branchAllowed(auth, id))
      throw new ForbiddenException({
        code: "BRANCH_SCOPE_DENIED",
        message: "Branch is outside the authorized scope",
      });
    const result = await this.db.query(
      'SELECT id,name,code,address_json "address",phone,timezone,status,created_at "createdAt",updated_at "updatedAt" FROM branches WHERE tenant_id=$1 AND id=$2',
      [auth.tenantId, id],
    );
    if (!result.rows[0])
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
    return result.rows[0];
  }
  async createBranch(auth: AccessClaims, input: unknown, requestId: string) {
    const body = branchInput.parse(input);
    return this.db.transaction(async (c) => {
      const id = randomUUID();
      const result = await c.query(
        'INSERT INTO branches(id,tenant_id,name,code,address_json,phone,timezone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,code,address_json "address",phone,timezone,status,created_at "createdAt",updated_at "updatedAt"',
        [
          id,
          auth.tenantId,
          body.name,
          body.code,
          body.address,
          body.phone ?? null,
          body.timezone,
        ],
      );
      await c.query(
        "INSERT INTO branch_settings(tenant_id,branch_id,currency) SELECT $1,$2,currency FROM tenants WHERE id=$1",
        [auth.tenantId, id],
      );
      await c.query(
        "INSERT INTO business_hours(tenant_id,branch_id,day_of_week,open_time,close_time,is_closed) SELECT $1,$2,day,CASE WHEN day=0 THEN NULL ELSE time '09:00' END,CASE WHEN day=0 THEN NULL ELSE time '20:00' END,day=0 FROM generate_series(0,6) day",
        [auth.tenantId, id],
      );
      await this.audit(
        c,
        auth,
        "branch.create",
        "branch",
        id,
        null,
        result.rows[0],
        requestId,
      );
      await this.event(
        c,
        auth,
        "branch.created",
        "branch",
        id,
        1,
        result.rows[0],
        id,
      );
      return result.rows[0];
    });
  }
  async updateBranch(
    auth: AccessClaims,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    if (!this.branchAllowed(auth, id))
      throw new ForbiddenException({
        code: "BRANCH_SCOPE_DENIED",
        message: "Branch is outside the authorized scope",
      });
    const body = branchUpdate.parse(input);
    return this.db.transaction(async (c) => {
      const before = await c.query(
        "SELECT * FROM branches WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, id],
      );
      if (!before.rows[0])
        throw new NotFoundException({
          code: "BRANCH_NOT_FOUND",
          message: "Branch not found",
        });
      const result = await c.query(
        'UPDATE branches SET name=coalesce($3,name),code=coalesce($4,code),timezone=coalesce($5,timezone),phone=CASE WHEN $6::boolean THEN $7 ELSE phone END,address_json=coalesce($8,address_json),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,name,code,address_json "address",phone,timezone,status,updated_at "updatedAt"',
        [
          auth.tenantId,
          id,
          body.name ?? null,
          body.code ?? null,
          body.timezone ?? null,
          Object.hasOwn(body, "phone"),
          body.phone ?? null,
          body.address ?? null,
        ],
      );
      await this.audit(
        c,
        auth,
        "branch.update",
        "branch",
        id,
        before.rows[0],
        result.rows[0],
        requestId,
      );
      await this.event(
        c,
        auth,
        "branch.updated",
        "branch",
        id,
        1,
        result.rows[0],
        id,
      );
      return result.rows[0];
    });
  }
  async hours(auth: AccessClaims, id: string) {
    await this.branch(auth, id);
    const result = await this.db.query(
      'SELECT day_of_week "dayOfWeek",to_char(open_time,\'HH24:MI\') "openTime",to_char(close_time,\'HH24:MI\') "closeTime",is_closed "isClosed" FROM business_hours WHERE tenant_id=$1 AND branch_id=$2 AND valid_to IS NULL ORDER BY day_of_week',
      [auth.tenantId, id],
    );
    return result.rows;
  }
  async updateHours(
    auth: AccessClaims,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    if (!this.branchAllowed(auth, id))
      throw new ForbiddenException({
        code: "BRANCH_SCOPE_DENIED",
        message: "Branch is outside the authorized scope",
      });
    const body = hoursInput.parse(input);
    if (new Set(body.map((x) => x.dayOfWeek)).size !== 7)
      throw new Error("Each day must appear once");
    return this.db.transaction(async (c) => {
      const before = await c.query(
        "SELECT * FROM business_hours WHERE tenant_id=$1 AND branch_id=$2 AND valid_to IS NULL ORDER BY day_of_week",
        [auth.tenantId, id],
      );
      await c.query(
        "DELETE FROM business_hours WHERE tenant_id=$1 AND branch_id=$2 AND valid_to IS NULL",
        [auth.tenantId, id],
      );
      for (const h of body)
        await c.query(
          "INSERT INTO business_hours(tenant_id,branch_id,day_of_week,open_time,close_time,is_closed) VALUES($1,$2,$3,$4,$5,$6)",
          [auth.tenantId, id, h.dayOfWeek, h.openTime, h.closeTime, h.isClosed],
        );
      await this.audit(
        c,
        auth,
        "branch.hours.update",
        "branch",
        id,
        before.rows,
        body,
        requestId,
      );
      await this.event(
        c,
        auth,
        "business_hours.updated",
        "branch",
        id,
        1,
        body,
        id,
      );
      return body;
    });
  }
  private async audit(
    c: { query: (text: string, values?: unknown[]) => Promise<unknown> },
    auth: AccessClaims,
    action: string,
    type: string,
    id: string,
    before: unknown,
    after: unknown,
    requestId: string,
  ) {
    await c.query(
      "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        auth.userId,
        action,
        type,
        id,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        requestId,
      ],
    );
  }
  private async event(
    c: { query: (text: string, values?: unknown[]) => Promise<unknown> },
    auth: AccessClaims,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    version: number,
    data: unknown,
    branchId?: string,
  ) {
    await c.query(
      "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,event_version,branch_id,aggregate_version,actor_json,correlation_id,metadata_json) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)",
      [
        auth.tenantId,
        eventType,
        aggregateType,
        aggregateId,
        JSON.stringify(data),
        branchId ?? null,
        version,
        JSON.stringify({ type: "USER", id: auth.userId }),
        randomUUID(),
        JSON.stringify({ schemaVersion: 1 }),
      ],
    );
  }
}
