/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

type Scope = string[] | null;
type Query = Record<string, string | undefined>;

const ACTIVITY_TYPES = new Set([
  "ALL",
  "EMAIL",
  "CALL",
  "INTERNAL_NOTE",
  "FOLLOW_UP",
  "SERVICE_RECOVERY",
]);
const DIRECTORY_STATUSES = new Set([
  "ALL",
  "SUCCESS",
  "PENDING",
  "FAILED",
  "SUPPRESSED",
  "FOLLOW_UP_REQUIRED",
  "OVERDUE",
]);

@Injectable()
export class CustomerCareService {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(BookingIdempotencyService) readonly idem: BookingIdempotencyService,
  ) {}

  access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((role) =>
        [
          "SALON_OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER",
          "ACCOUNTANT",
          "MARKETING",
          "NAIL_TECHNICIAN",
        ].includes(role),
      ) &&
      !auth.supportAccess
    ) {
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Support access grant required",
      });
    }
  }

  private scope(auth: AccessClaims): Scope {
    this.access(auth);
    if (auth.roles.includes("SALON_OWNER")) return null;
    return auth.supportAccess?.branchIds ?? auth.branchIds;
  }

  private assertBranch(auth: AccessClaims, branchId?: string | null) {
    if (!branchId || auth.roles.includes("SALON_OWNER")) return;
    const allowed = auth.supportAccess?.branchIds ?? auth.branchIds;
    if (!allowed.includes(branchId)) {
      throw new ForbiddenException({
        code: "BRANCH_ACCESS_DENIED",
        message: "Branch is outside membership scope",
      });
    }
  }

  private value(query: Query, key: string) {
    const value = query[key];
    return value == null || value === "" ? undefined : value;
  }

  private date(value: string | undefined, fallback: string) {
    if (!value) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException({ code: "INVALID_DATE", message: `${value} is not a valid date` });
    }
    return value;
  }

  private integer(value: string | undefined, fallback: number, min: number, max: number) {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException({ code: "INVALID_INTEGER", message: "Query value is outside the allowed range" });
    }
    return parsed;
  }

  private add(values: unknown[], value: unknown) {
    values.push(value);
    return `$${values.length}`;
  }

  private phoneMask(alias = "c") {
    return `CASE WHEN ${alias}.phone_normalized IS NULL THEN NULL ELSE '•••• ' || right(${alias}.phone_normalized,4) END`;
  }

  private messageScope(alias: string, scopeParameter = 2) {
    return `($${scopeParameter}::uuid[] IS NULL OR ${alias}.branch_id IS NULL OR ${alias}.branch_id=ANY($${scopeParameter}::uuid[]))`;
  }

  private branchScope(alias: string, scopeParameter = 2) {
    return `($${scopeParameter}::uuid[] IS NULL OR ${alias}.branch_id=ANY($${scopeParameter}::uuid[]))`;
  }

  private customerScope(alias: string, customerParameter = 5) {
    return `($${customerParameter}::uuid IS NULL OR ${alias}.customer_id=$${customerParameter}::uuid)`;
  }

  private activitySources() {
    return `
      SELECT
        'MESSAGE'::text source_type,
        m.id source_id,
        COALESCE(m.sent_at,m.created_at) occurred_at,
        m.customer_id,
        m.branch_id,
        b.name branch_name,
        c.display_name customer_name,
        ${this.phoneMask("c")} customer_phone_masked,
        'EMAIL'::text channel,
        'EMAIL'::text activity_type,
        COALESCE(m.rendered_subject,m.purpose) title,
        COALESCE(m.rendered_subject,m.purpose) summary,
        'SYSTEM'::text actor_type,
        NULL::uuid actor_id,
        'Hệ thống'::text actor_display_name,
        m.status raw_status,
        CASE WHEN m.status IN('SENT','DELIVERED') THEN 'SUCCESS'
             WHEN m.status IN('PENDING','SCHEDULED','PROCESSING') THEN 'PENDING'
             WHEN m.status IN('FAILED','DEAD_LETTER','BOUNCED','COMPLAINED') THEN 'FAILED'
             WHEN m.status='SUPPRESSED' THEN 'SUPPRESSED'
             ELSE m.status END derived_status,
        m.safe_error_code,
        m.suppression_reason,
        CASE WHEN m.appointment_id IS NOT NULL THEN 'APPOINTMENT'
             WHEN m.marketing_campaign_id IS NOT NULL THEN 'MARKETING_CAMPAIGN'
             WHEN m.review_request_id IS NOT NULL THEN 'REVIEW_REQUEST' END related_type,
        COALESCE(m.appointment_id,m.marketing_campaign_id,m.review_request_id) related_id,
        false follow_up_required
      FROM communication_messages m
      LEFT JOIN customers c ON c.tenant_id=m.tenant_id AND c.id=m.customer_id
      LEFT JOIN branches b ON b.tenant_id=m.tenant_id AND b.id=m.branch_id
      WHERE m.tenant_id=$1 AND ${this.messageScope("m")}

      UNION ALL

      SELECT
        'CARE_ACTIVITY'::text,
        a.id,
        a.occurred_at,
        a.customer_id,
        a.branch_id,
        b.name,
        c.display_name,
        ${this.phoneMask("c")},
        CASE WHEN a.activity_type='CALL' THEN 'CALL' ELSE 'INTERNAL_NOTE' END,
        CASE WHEN a.activity_type='CALL' THEN 'CALL' ELSE 'INTERNAL_NOTE' END,
        CASE WHEN a.activity_type='CALL' THEN 'Cuộc gọi chăm sóc' ELSE 'Ghi chú nội bộ' END,
        a.summary,
        'USER'::text,
        a.created_by_user_id,
        u.display_name,
        'RECORDED'::text,
        'SUCCESS'::text,
        NULL::text,
        NULL::text,
        a.related_entity_type,
        a.related_entity_id,
        false
      FROM customer_care_activities a
      JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id
      LEFT JOIN branches b ON b.tenant_id=a.tenant_id AND b.id=a.branch_id
      LEFT JOIN users u ON u.id=a.created_by_user_id
      WHERE a.tenant_id=$1 AND ${this.branchScope("a")}

      UNION ALL

      SELECT
        'RECOVERY_CONTACT'::text,
        rc.id,
        rc.created_at,
        sc.customer_id,
        sc.branch_id,
        b.name,
        c.display_name,
        ${this.phoneMask("c")},
        CASE WHEN rc.contact_type IN('PHONE_ATTEMPTED','PHONE_CONNECTED') THEN 'CALL' ELSE 'SERVICE_RECOVERY' END,
        CASE WHEN rc.contact_type IN('PHONE_ATTEMPTED','PHONE_CONNECTED') THEN 'CALL' ELSE 'SERVICE_RECOVERY' END,
        'Liên hệ Service Recovery'::text,
        rc.summary_redacted,
        'USER'::text,
        rc.actor_user_id,
        u.display_name,
        'RECORDED'::text,
        'SUCCESS'::text,
        NULL::text,
        NULL::text,
        'SERVICE_RECOVERY_CASE'::text,
        sc.id,
        false
      FROM service_recovery_contacts rc
      JOIN service_recovery_cases sc ON sc.tenant_id=rc.tenant_id AND sc.id=rc.case_id
      JOIN customers c ON c.tenant_id=sc.tenant_id AND c.id=sc.customer_id
      LEFT JOIN branches b ON b.tenant_id=sc.tenant_id AND b.id=sc.branch_id
      LEFT JOIN users u ON u.id=rc.actor_user_id
      WHERE rc.tenant_id=$1 AND ${this.branchScope("sc")}

      UNION ALL

      SELECT
        'CARE_FOLLOWUP'::text,
        f.id,
        f.created_at,
        f.customer_id,
        f.branch_id,
        b.name,
        c.display_name,
        ${this.phoneMask("c")},
        'FOLLOW_UP'::text,
        'FOLLOW_UP'::text,
        f.reason_code,
        COALESCE(f.note,f.reason_code),
        'USER'::text,
        f.created_by_user_id,
        u.display_name,
        f.status,
        CASE WHEN f.status IN('OPEN','IN_PROGRESS') AND f.due_at < now() THEN 'OVERDUE' ELSE f.status END,
        NULL::text,
        NULL::text,
        f.related_entity_type,
        f.related_entity_id,
        true
      FROM customer_care_followups f
      JOIN customers c ON c.tenant_id=f.tenant_id AND c.id=f.customer_id
      LEFT JOIN branches b ON b.tenant_id=f.tenant_id AND b.id=f.branch_id
      LEFT JOIN users u ON u.id=f.created_by_user_id
      WHERE f.tenant_id=$1 AND ${this.branchScope("f")}

      UNION ALL

      SELECT
        'RECOVERY_TASK'::text,
        t.id,
        t.created_at,
        sc.customer_id,
        sc.branch_id,
        b.name,
        c.display_name,
        ${this.phoneMask("c")},
        'SERVICE_RECOVERY'::text,
        'FOLLOW_UP'::text,
        t.task_type,
        COALESCE(t.note,t.task_type),
        'USER'::text,
        t.assigned_user_id,
        u.display_name,
        t.status,
        CASE WHEN t.status IN('OPEN','IN_PROGRESS') AND t.due_at < now() THEN 'OVERDUE' ELSE t.status END,
        NULL::text,
        NULL::text,
        'SERVICE_RECOVERY_CASE'::text,
        sc.id,
        true
      FROM service_recovery_tasks t
      JOIN service_recovery_cases sc ON sc.tenant_id=t.tenant_id AND sc.id=t.case_id
      JOIN customers c ON c.tenant_id=sc.tenant_id AND c.id=sc.customer_id
      LEFT JOIN branches b ON b.tenant_id=sc.tenant_id AND b.id=sc.branch_id
      LEFT JOIN users u ON u.id=t.assigned_user_id
      WHERE t.tenant_id=$1 AND ${this.branchScope("sc")}
    `;
  }

  async overview(auth: AccessClaims, query: Query = {}) {
    const scope = this.scope(auth);
    const today = new Date().toISOString().slice(0, 10);
    const from = this.date(this.value(query, "from"), today.slice(0, 8) + "01");
    const to = this.date(this.value(query, "to"), today);
    const inactivityDays = this.integer(this.value(query, "careInactivityDays"), 60, 1, 3650);
    const branchId = this.value(query, "branchId");
    const customerId = this.value(query, "customerId");
    this.assertBranch(auth, branchId);
    if (customerId && !/^[0-9a-f-]{36}$/i.test(customerId)) {
      throw new BadRequestException({ code: "INVALID_CUSTOMER_ID" });
    }
    const branches = branchId ? [branchId] : scope;
    const args = [auth.tenantId, branches, from, to, customerId ?? null, inactivityDays];
    const totals = await this.db.query<any>(
      `WITH activity AS (
        SELECT COALESCE(m.sent_at,m.created_at) occurred_at,'EMAIL' channel, true automatic
        FROM communication_messages m WHERE m.tenant_id=$1 AND ${this.messageScope("m")} AND ${this.customerScope("m")}
        UNION ALL
        SELECT a.occurred_at,CASE WHEN a.activity_type='CALL' THEN 'CALL' ELSE 'INTERNAL_NOTE' END,false
        FROM customer_care_activities a WHERE a.tenant_id=$1 AND ${this.branchScope("a")} AND ${this.customerScope("a")}
        UNION ALL
        SELECT rc.created_at,CASE WHEN rc.contact_type IN('PHONE_ATTEMPTED','PHONE_CONNECTED') THEN 'CALL' ELSE 'SERVICE_RECOVERY' END,false
        FROM service_recovery_contacts rc JOIN service_recovery_cases sc ON sc.tenant_id=rc.tenant_id AND sc.id=rc.case_id
        WHERE rc.tenant_id=$1 AND ${this.branchScope("sc")} AND ${this.customerScope("sc")}
      ), messages AS (
        SELECT m.status,m.sent_at,m.created_at
        FROM communication_messages m
        WHERE m.tenant_id=$1 AND ${this.messageScope("m")} AND ${this.customerScope("m")}
      )
      SELECT
        (SELECT count(*) FROM activity WHERE occurred_at::date=CURRENT_DATE) activities_today,
        (SELECT count(*) FROM activity WHERE occurred_at::date=CURRENT_DATE AND automatic) automated_activities_today,
        (SELECT count(*) FROM activity WHERE occurred_at::date=CURRENT_DATE AND NOT automatic) manual_activities_today,
        (SELECT count(*) FROM messages WHERE COALESCE(sent_at,created_at)::date BETWEEN $3::date AND $4::date AND status='SENT') emails_sent_in_period,
        (SELECT count(*) FROM messages WHERE COALESCE(sent_at,created_at)::date BETWEEN $3::date AND $4::date AND status IN('FAILED','DEAD_LETTER')) email_failed_in_period,
        (SELECT count(*) FROM messages WHERE COALESCE(sent_at,created_at)::date BETWEEN $3::date AND $4::date AND status IN('SENT','FAILED','DEAD_LETTER')) email_delivery_denominator,
        (SELECT count(*) FROM customer_care_followups f WHERE f.tenant_id=$1 AND ${this.branchScope("f")} AND ${this.customerScope("f")} AND f.status IN('OPEN','IN_PROGRESS')) +
        (SELECT count(*) FROM service_recovery_tasks t JOIN service_recovery_cases sc ON sc.tenant_id=t.tenant_id AND sc.id=t.case_id WHERE t.tenant_id=$1 AND ${this.branchScope("sc")} AND ${this.customerScope("sc")} AND t.status IN('OPEN','IN_PROGRESS')) open_followups,
        (SELECT count(*) FROM customer_care_followups f WHERE f.tenant_id=$1 AND ${this.branchScope("f")} AND ${this.customerScope("f")} AND f.status IN('OPEN','IN_PROGRESS') AND f.due_at < now()) +
        (SELECT count(*) FROM service_recovery_tasks t JOIN service_recovery_cases sc ON sc.tenant_id=t.tenant_id AND sc.id=t.case_id WHERE t.tenant_id=$1 AND ${this.branchScope("sc")} AND ${this.customerScope("sc")} AND t.status IN('OPEN','IN_PROGRESS') AND t.due_at < now()) overdue_followups`,
      args.slice(0, 5),
    );
    const health = await this.db.query<any>(
      `SELECT status,count(*)::int count FROM communication_messages m
       WHERE m.tenant_id=$1 AND ${this.messageScope("m")} AND ${this.customerScope("m")} AND COALESCE(m.sent_at,m.created_at)::date BETWEEN $3::date AND $4::date
       GROUP BY status`,
      args.slice(0, 5),
    );
    const channels = await this.db.query<any>(
      `WITH activity AS (
        SELECT 'EMAIL' channel,COALESCE(m.sent_at,m.created_at) occurred_at FROM communication_messages m WHERE m.tenant_id=$1 AND ${this.messageScope("m")} AND ${this.customerScope("m")}
        UNION ALL SELECT CASE WHEN a.activity_type='CALL' THEN 'CALL' ELSE 'INTERNAL_NOTE' END,a.occurred_at FROM customer_care_activities a WHERE a.tenant_id=$1 AND ${this.branchScope("a")} AND ${this.customerScope("a")}
        UNION ALL SELECT CASE WHEN rc.contact_type IN('PHONE_ATTEMPTED','PHONE_CONNECTED') THEN 'CALL' ELSE 'SERVICE_RECOVERY' END,rc.created_at FROM service_recovery_contacts rc JOIN service_recovery_cases sc ON sc.tenant_id=rc.tenant_id AND sc.id=rc.case_id WHERE rc.tenant_id=$1 AND ${this.branchScope("sc")} AND ${this.customerScope("sc")}
      ) SELECT channel,count(*)::int count FROM activity WHERE occurred_at::date BETWEEN $3::date AND $4::date GROUP BY channel ORDER BY count DESC`,
      args.slice(0, 5),
    );
    const inactive = await this.db.query<any>(
      `WITH visible_customers AS (
        SELECT DISTINCT c.id FROM customers c
        LEFT JOIN appointments a ON a.tenant_id=c.tenant_id AND a.customer_id=c.id
        WHERE c.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR c.id=$3::uuid)
      ), care AS (
        SELECT m.customer_id,COALESCE(m.sent_at,m.created_at) occurred_at FROM communication_messages m WHERE m.tenant_id=$1 AND m.status='SENT' AND m.category IN('ENGAGEMENT','MARKETING') AND ${this.messageScope("m")} AND ${this.customerScope("m", 3)}
        UNION ALL SELECT a.customer_id,a.occurred_at FROM customer_care_activities a WHERE a.tenant_id=$1 AND ${this.branchScope("a")} AND ${this.customerScope("a", 3)}
        UNION ALL SELECT sc.customer_id,rc.created_at FROM service_recovery_contacts rc JOIN service_recovery_cases sc ON sc.tenant_id=rc.tenant_id AND sc.id=rc.case_id WHERE rc.tenant_id=$1 AND ${this.branchScope("sc")} AND ${this.customerScope("sc", 3)}
      ) SELECT count(*)::int count FROM visible_customers v WHERE NOT EXISTS(SELECT 1 FROM care WHERE care.customer_id=v.id AND care.occurred_at >= now() - ($4::int * interval '1 day'))`,
      [auth.tenantId, branches, customerId ?? null, inactivityDays],
    );
    const total = totals.rows[0] ?? {};
    const denominator = Number(total.email_delivery_denominator ?? 0);
    const sent = Number(total.emails_sent_in_period ?? 0);
    const channelTotal = channels.rows.reduce((sum: number, row: any) => sum + Number(row.count ?? 0), 0);
    return {
      generatedAt: new Date().toISOString(),
      period: { from, to },
      careInactivityDays: inactivityDays,
      totals: {
        activitiesToday: Number(total.activities_today ?? 0),
        automatedActivitiesToday: Number(total.automated_activities_today ?? 0),
        manualActivitiesToday: Number(total.manual_activities_today ?? 0),
        emailsSentInPeriod: sent,
        emailFailedInPeriod: Number(total.email_failed_in_period ?? 0),
        emailDeliverySuccessRate: denominator ? Math.round((sent / denominator) * 1000) / 10 : null,
        openFollowUpCount: Number(total.open_followups ?? 0),
        overdueFollowUpCount: Number(total.overdue_followups ?? 0),
        customersWithoutRecentCareCount: Number(inactive.rows[0]?.count ?? 0),
      },
      channels: channels.rows.map((row) => ({
        channel: row.channel,
        count: Number(row.count),
        percentage: channelTotal ? Math.round((Number(row.count) / channelTotal) * 1000) / 10 : 0,
      })),
      communicationHealth: health.rows.reduce((result: Record<string, number>, row) => {
        result[row.status] = Number(row.count);
        return result;
      }, {}),
      access: { canManage: true, canManageFollowups: true },
    };
  }

  async directory(auth: AccessClaims, query: Query = {}) {
    const scope = this.scope(auth);
    const values: unknown[] = [auth.tenantId, scope];
    const where: string[] = [];
    const search = this.value(query, "search");
    const branchId = this.value(query, "branchId");
    const customerId = this.value(query, "customerId");
    const activityType = (this.value(query, "activityType") ?? "ALL").toUpperCase();
    const status = (this.value(query, "status") ?? "ALL").toUpperCase();
    const from = this.value(query, "from");
    const to = this.value(query, "to");
    const page = this.integer(this.value(query, "page"), 1, 1, 100000);
    const pageSize = this.integer(this.value(query, "pageSize"), 10, 10, 50);
    if (!ACTIVITY_TYPES.has(activityType)) throw new BadRequestException({ code: "INVALID_ACTIVITY_TYPE" });
    if (!DIRECTORY_STATUSES.has(status)) throw new BadRequestException({ code: "INVALID_DIRECTORY_STATUS" });
    this.assertBranch(auth, branchId);
    if (search) {
      const p = this.add(values, `%${search.toLowerCase()}%`);
      where.push(`lower(coalesce(n.customer_name,'') || ' ' || coalesce(n.title,'') || ' ' || coalesce(n.summary,'') || ' ' || n.source_id::text) LIKE ${p}`);
    }
    if (branchId) where.push(`n.branch_id=${this.add(values, branchId)}`);
    if (customerId) where.push(`n.customer_id=${this.add(values, customerId)}`);
    if (activityType !== "ALL") where.push(`n.activity_type=${this.add(values, activityType)}`);
    if (status === "SUCCESS") where.push(`n.derived_status='SUCCESS'`);
    if (status === "PENDING") where.push(`n.derived_status IN('PENDING','OPEN','IN_PROGRESS')`);
    if (status === "FAILED") where.push(`n.derived_status='FAILED'`);
    if (status === "SUPPRESSED") where.push(`n.raw_status='SUPPRESSED'`);
    if (status === "FOLLOW_UP_REQUIRED") where.push(`n.follow_up_required=true`);
    if (status === "OVERDUE") where.push(`n.derived_status='OVERDUE'`);
    if (from) where.push(`n.occurred_at >= ${this.add(values, `${this.date(from, from)}T00:00:00.000Z`)}`);
    if (to) where.push(`n.occurred_at < (${this.add(values, `${this.date(to, to)}T00:00:00.000Z`)}::timestamptz + interval '1 day')`);
    const offset = (page - 1) * pageSize;
    const offsetParam = this.add(values, offset);
    const limitParam = this.add(values, pageSize);
    const order = (this.value(query, "sort") ?? "NEWEST").toUpperCase() === "OLDEST" ? "ASC" : "DESC";
    const sql = `WITH normalized AS (${this.activitySources()})
      SELECT n.*,count(*) OVER()::int total_count
      FROM normalized n
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY n.occurred_at ${order}, n.source_id ${order}
      OFFSET ${offsetParam} LIMIT ${limitParam}`;
    const result = await this.db.query<any>(sql, values);
    const total = Number(result.rows[0]?.total_count ?? 0);
    return {
      items: result.rows.map((row) => ({
        sourceType: row.source_type,
        sourceId: row.source_id,
        occurredAt: row.occurred_at,
        customer: row.customer_id ? { id: row.customer_id, displayName: row.customer_name, phoneMasked: row.customer_phone_masked } : null,
        branch: row.branch_id ? { id: row.branch_id, name: row.branch_name } : null,
        channel: row.channel,
        activityType: row.activity_type,
        title: row.title,
        summary: row.summary,
        actor: { type: row.actor_type, id: row.actor_id, displayName: row.actor_display_name },
        related: row.related_id ? { type: row.related_type, id: row.related_id } : null,
        result: { rawStatus: row.raw_status, displayStatus: row.derived_status, safeErrorCode: row.safe_error_code, suppressionReason: row.suppression_reason },
        followUp: { required: Boolean(row.follow_up_required), derivedStatus: row.derived_status === "OVERDUE" ? "OVERDUE" : row.follow_up_required ? row.derived_status : null },
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      generatedAt: new Date().toISOString(),
    };
  }

  async followups(auth: AccessClaims, query: Query = {}) {
    const scope = this.scope(auth);
    const values: unknown[] = [auth.tenantId, scope];
    const where: string[] = [];
    const customerId = this.value(query, "customerId");
    const status = (this.value(query, "status") ?? "ALL").toUpperCase();
    const page = this.integer(this.value(query, "page"), 1, 1, 100000);
    const pageSize = this.integer(this.value(query, "pageSize"), 5, 5, 50);
    if (customerId) where.push(`f.customer_id=${this.add(values, customerId)}`);
    if (status === "OVERDUE") where.push(`f.derived_status='OVERDUE'`);
    else if (["OPEN","IN_PROGRESS","COMPLETED","CANCELLED"].includes(status)) where.push(`f.raw_status=${this.add(values, status)}`);
    const offsetParam = this.add(values, (page - 1) * pageSize);
    const limitParam = this.add(values, pageSize);
    const result = await this.db.query<any>(
      `WITH f AS (
        SELECT 'CUSTOMER_CARE'::text source_domain,f.id,f.customer_id,f.branch_id,b.name branch_name,c.display_name customer_name,
          f.reason_code reason,f.note,f.due_at,f.priority,f.status raw_status,
          CASE WHEN f.status IN('OPEN','IN_PROGRESS') AND f.due_at<now() THEN 'OVERDUE' ELSE f.status END derived_status,
          f.assigned_user_id,u.display_name assigned_user_name,f.related_entity_type,f.related_entity_id,f.created_at
        FROM customer_care_followups f JOIN customers c ON c.tenant_id=f.tenant_id AND c.id=f.customer_id
        LEFT JOIN branches b ON b.tenant_id=f.tenant_id AND b.id=f.branch_id LEFT JOIN users u ON u.id=f.assigned_user_id
        WHERE f.tenant_id=$1 AND ${this.branchScope("f")}
        UNION ALL
        SELECT 'SERVICE_RECOVERY'::text,t.id,sc.customer_id,sc.branch_id,b.name,c.display_name,t.task_type,t.note,t.due_at,'MEDIUM',t.status,
          CASE WHEN t.status IN('OPEN','IN_PROGRESS') AND t.due_at<now() THEN 'OVERDUE' ELSE t.status END,
          t.assigned_user_id,u.display_name,'SERVICE_RECOVERY_CASE',sc.id,t.created_at
        FROM service_recovery_tasks t JOIN service_recovery_cases sc ON sc.tenant_id=t.tenant_id AND sc.id=t.case_id
        JOIN customers c ON c.tenant_id=sc.tenant_id AND c.id=sc.customer_id LEFT JOIN branches b ON b.tenant_id=sc.tenant_id AND b.id=sc.branch_id LEFT JOIN users u ON u.id=t.assigned_user_id
        WHERE t.tenant_id=$1 AND ${this.branchScope("sc")}
      ) SELECT f.*,count(*) OVER()::int total_count FROM f ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY f.due_at NULLS LAST,f.created_at DESC OFFSET ${offsetParam} LIMIT ${limitParam}`,
      values,
    );
    const total = Number(result.rows[0]?.total_count ?? 0);
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        sourceDomain: row.source_domain,
        customer: { id: row.customer_id, displayName: row.customer_name },
        branch: row.branch_id ? { id: row.branch_id, name: row.branch_name } : null,
        reason: row.reason,
        note: row.note,
        dueAt: row.due_at,
        assignedUser: row.assigned_user_id ? { id: row.assigned_user_id, displayName: row.assigned_user_name } : null,
        priority: row.priority,
        rawStatus: row.raw_status,
        derivedStatus: row.derived_status,
        related: row.related_entity_id ? { type: row.related_entity_type, id: row.related_entity_id } : null,
        createdAt: row.created_at,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      generatedAt: new Date().toISOString(),
    };
  }

  private async customerContext(auth: AccessClaims, customerId: string) {
    const scope = this.scope(auth);
    const result = await this.db.query<any>(
      `SELECT c.id,c.display_name,${this.phoneMask("c")} phone_masked,p.email_status,p.marketing_email_allowed,p.review_request_allowed,p.service_recovery_contact_allowed,p.updated_at preferences_updated_at,
        COALESCE(jsonb_agg(jsonb_build_object('purpose',s.purpose,'state',s.state,'updatedAt',s.updated_at) ORDER BY s.purpose) FILTER(WHERE s.purpose IS NOT NULL),'[]'::jsonb) consents
       FROM customers c LEFT JOIN customer_communication_preferences p ON p.tenant_id=c.tenant_id AND p.customer_id=c.id
       LEFT JOIN customer_consent_states s ON s.tenant_id=c.tenant_id AND s.customer_id=c.id
       WHERE c.tenant_id=$1 AND c.id=$2
         AND ( $3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM appointments a WHERE a.tenant_id=c.tenant_id AND a.customer_id=c.id AND a.branch_id=ANY($3::uuid[])) OR EXISTS(SELECT 1 FROM communication_messages m WHERE m.tenant_id=c.tenant_id AND m.customer_id=c.id AND (m.branch_id IS NULL OR m.branch_id=ANY($3::uuid[]))) OR EXISTS(SELECT 1 FROM customer_care_activities ca WHERE ca.tenant_id=c.tenant_id AND ca.customer_id=c.id AND ca.branch_id=ANY($3::uuid[])) OR EXISTS(SELECT 1 FROM customer_care_followups cf WHERE cf.tenant_id=c.tenant_id AND cf.customer_id=c.id AND cf.branch_id=ANY($3::uuid[])) OR EXISTS(SELECT 1 FROM service_recovery_cases sr WHERE sr.tenant_id=c.tenant_id AND sr.customer_id=c.id AND sr.branch_id=ANY($3::uuid[])) )
       GROUP BY c.id,c.display_name,c.phone_normalized,p.email_status,p.marketing_email_allowed,p.review_request_allowed,p.service_recovery_contact_allowed,p.updated_at`,
      [auth.tenantId, customerId, scope],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Customer is not in the current access scope" });
    return {
      customer: { id: row.id, displayName: row.display_name, phoneMasked: row.phone_masked },
      communicationPreferences: row.email_status ? { emailStatus: row.email_status, marketingEmailAllowed: row.marketing_email_allowed, reviewRequestAllowed: row.review_request_allowed, serviceRecoveryContactAllowed: row.service_recovery_contact_allowed, updatedAt: row.preferences_updated_at } : null,
      consents: row.consents,
    };
  }

  async activityDetail(auth: AccessClaims, sourceType: string, sourceId: string) {
    const scope = this.scope(auth);
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) throw new BadRequestException({ code: "INVALID_SOURCE_ID" });
    const normalizedType = sourceType.toUpperCase();
    let row: any;
    if (normalizedType === "MESSAGE") {
      row = (await this.db.query<any>(`SELECT m.id,m.customer_id,m.branch_id,b.name branch_name,c.display_name customer_name,${this.phoneMask("c")} phone_masked,m.category,m.purpose,m.channel,m.status,m.scheduled_at,m.sent_at,m.created_at,m.attempt_count,m.safe_error_code,m.suppression_reason,m.rendered_subject,(m.rendered_text IS NOT NULL) has_rendered_text,m.appointment_id,m.marketing_campaign_id,m.review_request_id FROM communication_messages m LEFT JOIN customers c ON c.tenant_id=m.tenant_id AND c.id=m.customer_id LEFT JOIN branches b ON b.tenant_id=m.tenant_id AND b.id=m.branch_id WHERE m.tenant_id=$1 AND m.id=$2 AND ${this.messageScope("m", 3)}`, [auth.tenantId, sourceId, scope])).rows[0];
      if (!row) throw new NotFoundException({ code: "ACTIVITY_NOT_FOUND" });
      const attempts = await this.db.query<any>(`SELECT attempt_number,provider_reference,result,safe_error_code,retry_after,redacted_metadata_json,created_at FROM communication_delivery_attempts WHERE tenant_id=$1 AND message_id=$2 ORDER BY attempt_number DESC`, [auth.tenantId, sourceId]);
      const customer = row.customer_id ? await this.customerContext(auth, row.customer_id) : null;
      return { sourceType: "MESSAGE", message: { id: row.id, category: row.category, purpose: row.purpose, channel: row.channel, status: row.status, scheduledAt: row.scheduled_at, sentAt: row.sent_at, createdAt: row.created_at, attemptCount: row.attempt_count, safeErrorCode: row.safe_error_code, suppressionReason: row.suppression_reason, subject: row.rendered_subject, hasRenderedText: row.has_rendered_text }, customer: customer?.customer ?? null, branch: row.branch_id ? { id: row.branch_id, name: row.branch_name } : null, related: { appointmentId: row.appointment_id, campaignId: row.marketing_campaign_id, reviewRequestId: row.review_request_id }, attempts: attempts.rows.map((item) => ({ attemptNumber: item.attempt_number, providerReference: item.provider_reference, result: item.result, safeErrorCode: item.safe_error_code, retryAfter: item.retry_after, metadata: item.redacted_metadata_json, createdAt: item.created_at })), consentContext: customer ? { preferences: customer.communicationPreferences, consents: customer.consents } : null, access: { canRetry: ["FAILED","DEAD_LETTER"].includes(row.status) } };
    }
    if (normalizedType === "CARE_ACTIVITY") {
      row = (await this.db.query<any>(`SELECT a.id,a.activity_type,a.outcome_code,a.summary,a.occurred_at,a.customer_id,a.branch_id,b.name branch_name,c.display_name customer_name,${this.phoneMask("c")} phone_masked,a.related_entity_type,a.related_entity_id,u.display_name actor_name FROM customer_care_activities a JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id LEFT JOIN branches b ON b.tenant_id=a.tenant_id AND b.id=a.branch_id LEFT JOIN users u ON u.id=a.created_by_user_id WHERE a.tenant_id=$1 AND a.id=$2 AND ${this.branchScope("a", 3)}`, [auth.tenantId, sourceId, scope])).rows[0];
      if (!row) throw new NotFoundException({ code: "ACTIVITY_NOT_FOUND" });
      const customer = await this.customerContext(auth, row.customer_id);
      return { sourceType: "CARE_ACTIVITY", activity: { id: row.id, type: row.activity_type, outcomeCode: row.outcome_code, summary: row.summary, occurredAt: row.occurred_at, actor: { type: "USER", displayName: row.actor_name }, branch: row.branch_id ? { id: row.branch_id, name: row.branch_name } : null, related: row.related_entity_id ? { type: row.related_entity_type, id: row.related_entity_id } : null }, customer: customer.customer, consentContext: { preferences: customer.communicationPreferences, consents: customer.consents }, access: {} };
    }
    if (normalizedType === "RECOVERY_CONTACT") {
      row = (await this.db.query<any>(`SELECT rc.id,rc.contact_type,rc.summary_redacted,rc.created_at,rc.actor_user_id,sc.id case_id,sc.branch_id,sc.customer_id,sc.status case_status,sc.severity,sc.source,sc.summary case_summary,b.name branch_name,c.display_name customer_name,${this.phoneMask("c")} phone_masked,u.display_name actor_name FROM service_recovery_contacts rc JOIN service_recovery_cases sc ON sc.tenant_id=rc.tenant_id AND sc.id=rc.case_id JOIN customers c ON c.tenant_id=sc.tenant_id AND c.id=sc.customer_id LEFT JOIN branches b ON b.tenant_id=sc.tenant_id AND b.id=sc.branch_id LEFT JOIN users u ON u.id=rc.actor_user_id WHERE rc.tenant_id=$1 AND rc.id=$2 AND ${this.branchScope("sc", 3)}`, [auth.tenantId, sourceId, scope])).rows[0];
      if (!row) throw new NotFoundException({ code: "ACTIVITY_NOT_FOUND" });
      const customer = await this.customerContext(auth, row.customer_id);
      return { sourceType: "RECOVERY_CONTACT", activity: { id: row.id, type: row.contact_type, summary: row.summary_redacted, occurredAt: row.created_at, actor: { type: "USER", displayName: row.actor_name }, branch: { id: row.branch_id, name: row.branch_name }, related: { type: "SERVICE_RECOVERY_CASE", id: row.case_id } }, customer: customer.customer, recovery: { caseId: row.case_id, status: row.case_status, severity: row.severity, source: row.source, summary: row.case_summary }, consentContext: { preferences: customer.communicationPreferences, consents: customer.consents }, access: {} };
    }
    if (normalizedType === "CARE_FOLLOWUP") {
      row = (await this.db.query<any>(`SELECT f.id,f.reason_code,f.note,f.due_at,f.priority,f.status,f.version,f.created_at,f.customer_id,f.branch_id,b.name branch_name,c.display_name customer_name,u.display_name assigned_name,f.related_entity_type,f.related_entity_id FROM customer_care_followups f JOIN customers c ON c.tenant_id=f.tenant_id AND c.id=f.customer_id LEFT JOIN branches b ON b.tenant_id=f.tenant_id AND b.id=f.branch_id LEFT JOIN users u ON u.id=f.assigned_user_id WHERE f.tenant_id=$1 AND f.id=$2 AND ${this.branchScope("f", 3)}`, [auth.tenantId, sourceId, scope])).rows[0];
      if (!row) throw new NotFoundException({ code: "ACTIVITY_NOT_FOUND" });
      const customer = await this.customerContext(auth, row.customer_id);
      return { sourceType: "CARE_FOLLOWUP", followup: { id: row.id, reason: row.reason_code, note: row.note, dueAt: row.due_at, priority: row.priority, rawStatus: row.status, derivedStatus: ["OPEN","IN_PROGRESS"].includes(row.status) && new Date(row.due_at).getTime() < Date.now() ? "OVERDUE" : row.status, version: row.version, createdAt: row.created_at, assignedUser: row.assigned_name ? { displayName: row.assigned_name } : null, related: row.related_entity_id ? { type: row.related_entity_type, id: row.related_entity_id } : null }, customer: customer.customer, consentContext: { preferences: customer.communicationPreferences, consents: customer.consents }, access: {} };
    }
    if (normalizedType === "RECOVERY_TASK") {
      row = (await this.db.query<any>(`SELECT t.id,t.task_type,t.note,t.due_at,t.status,t.version,t.created_at,t.assigned_user_id,sc.id case_id,sc.branch_id,sc.customer_id,sc.status case_status,sc.severity,sc.source,b.name branch_name,c.display_name customer_name,${this.phoneMask("c")} phone_masked,u.display_name assigned_name FROM service_recovery_tasks t JOIN service_recovery_cases sc ON sc.tenant_id=t.tenant_id AND sc.id=t.case_id JOIN customers c ON c.tenant_id=sc.tenant_id AND c.id=sc.customer_id LEFT JOIN branches b ON b.tenant_id=sc.tenant_id AND b.id=sc.branch_id LEFT JOIN users u ON u.id=t.assigned_user_id WHERE t.tenant_id=$1 AND t.id=$2 AND ${this.branchScope("sc", 3)}`, [auth.tenantId, sourceId, scope])).rows[0];
      if (!row) throw new NotFoundException({ code: "ACTIVITY_NOT_FOUND" });
      const customer = await this.customerContext(auth, row.customer_id);
      return { sourceType: "RECOVERY_TASK", followup: { id: row.id, reason: row.task_type, note: row.note, dueAt: row.due_at, priority: "MEDIUM", rawStatus: row.status, derivedStatus: ["OPEN","IN_PROGRESS"].includes(row.status) && new Date(row.due_at).getTime() < Date.now() ? "OVERDUE" : row.status, version: row.version, createdAt: row.created_at, assignedUser: row.assigned_name ? { displayName: row.assigned_name } : null, related: { type: "SERVICE_RECOVERY_CASE", id: row.case_id } }, customer: customer.customer, recovery: { caseId: row.case_id, status: row.case_status, severity: row.severity, source: row.source }, consentContext: { preferences: customer.communicationPreferences, consents: customer.consents }, access: {} };
    }
    throw new BadRequestException({ code: "INVALID_SOURCE_TYPE" });
  }

  private async ensureCustomer(client: PoolClient, auth: AccessClaims, customerId: string) {
    const row = (await client.query<any>("SELECT id FROM customers WHERE tenant_id=$1 AND id=$2", [auth.tenantId, customerId])).rows[0];
    if (!row) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND" });
  }

  private async ensureRelated(
    client: PoolClient,
    auth: AccessClaims,
    customerId: string,
    relatedType: unknown,
    relatedId: unknown,
    requestedBranchId: string | null,
  ) {
    const type = relatedType == null ? "" : String(relatedType).trim().toUpperCase();
    const id = relatedId == null ? "" : String(relatedId).trim();
    if (!type && !id) return requestedBranchId;
    if (!type || !/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException({ code: "INVALID_RELATED_ENTITY" });

    let row: { customer_id: string | null; branch_id: string | null } | undefined;
    if (type === "APPOINTMENT") {
      row = (await client.query<{ customer_id: string | null; branch_id: string | null }>("SELECT customer_id,branch_id FROM appointments WHERE tenant_id=$1 AND id=$2", [auth.tenantId, id])).rows[0];
    } else if (type === "REFUND") {
      row = (await client.query<{ customer_id: string | null; branch_id: string | null }>("SELECT customer_id,branch_id FROM refunds WHERE tenant_id=$1 AND id=$2", [auth.tenantId, id])).rows[0];
    } else if (type === "SERVICE_RECOVERY_CASE") {
      row = (await client.query<{ customer_id: string | null; branch_id: string | null }>("SELECT customer_id,branch_id FROM service_recovery_cases WHERE tenant_id=$1 AND id=$2", [auth.tenantId, id])).rows[0];
    } else {
      throw new BadRequestException({ code: "UNSUPPORTED_RELATED_ENTITY" });
    }
    if (!row) throw new NotFoundException({ code: "RELATED_ENTITY_NOT_FOUND" });
    if (row.customer_id !== customerId) throw new BadRequestException({ code: "RELATED_CUSTOMER_MISMATCH" });
    if (row.branch_id) {
      this.assertBranch(auth, row.branch_id);
      if (requestedBranchId && requestedBranchId !== row.branch_id) throw new BadRequestException({ code: "RELATED_BRANCH_MISMATCH" });
    }
    return requestedBranchId ?? row.branch_id;
  }

  private async ensureSourceActivity(client: PoolClient, auth: AccessClaims, customerId: string, sourceActivityId: unknown) {
    if (sourceActivityId == null || sourceActivityId === "") return;
    const id = String(sourceActivityId).trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException({ code: "INVALID_SOURCE_ACTIVITY_ID" });
    const row = (await client.query("SELECT 1 FROM customer_care_activities WHERE tenant_id=$1 AND id=$2 AND customer_id=$3", [auth.tenantId, id, customerId])).rowCount;
    if (row !== 1) throw new NotFoundException({ code: "SOURCE_ACTIVITY_NOT_FOUND" });
  }

  private async evidence(client: PoolClient, auth: AccessClaims, event: string, type: string, id: string, branchId: string | null, requestId: string, after: Record<string, unknown>) {
    await client.query("INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [auth.tenantId, branchId, auth.userId, event, type, id, JSON.stringify(after), requestId]);
    await client.query("INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [auth.tenantId, branchId, event, type, id, JSON.stringify({ aggregateId: id, branchId, refetch: true }), JSON.stringify({ type: "USER", id: auth.userId }), JSON.stringify({ schemaVersion: 1, pii: false })]);
  }

  private async command<T>(auth: AccessClaims, name: string, key: string, request: unknown, work: (client: PoolClient) => Promise<T>) {
    this.access(auth);
    return this.db.transaction(async (client) => {
      const tenant = (await client.query<{ access_mode: string }>("SELECT access_mode FROM tenants WHERE id=$1 FOR SHARE", [auth.tenantId])).rows[0];
      if (["READ_ONLY","BILLING_ONLY","SUSPENDED","TERMINATED"].includes(tenant?.access_mode ?? "TERMINATED")) throw new ForbiddenException({ code: "TENANT_READ_ONLY", message: "Tenant access mode blocks Customer Care writes" });
      const result = await this.idem.execute(client, { tenantId: auth.tenantId, actorScope: `user:${auth.userId}`, command: name, key, request, work: () => work(client) });
      return result.data;
    });
  }

  async createActivity(auth: AccessClaims, body: any, key: string, requestId: string) {
    const activityType = String(body?.activityType ?? "").toUpperCase();
    if (!["CALL","INTERNAL_NOTE","MANUAL_TOUCHPOINT"].includes(activityType)) throw new BadRequestException({ code: "INVALID_ACTIVITY_TYPE" });
    const customerId = String(body?.customerId ?? "");
    const summary = String(body?.summary ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(customerId) || !summary || summary.length > 2000) throw new BadRequestException({ code: "INVALID_ACTIVITY_INPUT" });
    let branchId = body?.branchId ? String(body.branchId) : null;
    this.assertBranch(auth, branchId);
    const occurredAt = body?.occurredAt ? new Date(String(body.occurredAt)) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException({ code: "INVALID_OCCURRED_AT" });
    return this.command(auth, "customer-care.activity.create", key, body, async (client) => {
      await this.ensureCustomer(client, auth, customerId);
      const relatedType = body?.related?.type ?? body?.relatedEntityType;
      const relatedId = body?.related?.id ?? body?.relatedEntityId;
      const relatedBranchId = await this.ensureRelated(client, auth, customerId, relatedType, relatedId, branchId);
      if (!branchId) branchId = relatedBranchId;
      const inserted = (await client.query<{ id: string }>("INSERT INTO customer_care_activities(tenant_id,branch_id,customer_id,activity_type,outcome_code,summary,occurred_at,related_entity_type,related_entity_id,created_by_user_id,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id", [auth.tenantId, branchId, customerId, activityType, body?.outcomeCode ?? null, summary, occurredAt.toISOString(), body?.related?.type ?? body?.relatedEntityType ?? null, body?.related?.id ?? body?.relatedEntityId ?? null, auth.userId, `care-activity:${auth.userId}:${key}`])).rows[0];
      if (!inserted) throw new ConflictException({ code: "CUSTOMER_CARE_ACTIVITY_CREATE_FAILED" });
      const id = inserted.id;
      await this.evidence(client, auth, "customer_care.activity_created", "customer_care_activity", id, branchId, requestId, { activityType, customerId });
      return { id, activityType, customerId, occurredAt: occurredAt.toISOString() };
    });
  }

  async createFollowup(auth: AccessClaims, body: any, key: string, requestId: string) {
    const customerId = String(body?.customerId ?? "");
    const reason = String(body?.reasonCode ?? body?.reason ?? "").trim();
    const dueAt = new Date(String(body?.dueAt ?? ""));
    if (!/^[0-9a-f-]{36}$/i.test(customerId) || !reason || reason.length > 120 || Number.isNaN(dueAt.getTime())) throw new BadRequestException({ code: "INVALID_FOLLOWUP_INPUT" });
    let branchId = body?.branchId ? String(body.branchId) : null;
    this.assertBranch(auth, branchId);
    const priority = String(body?.priority ?? "MEDIUM").toUpperCase();
    if (!["LOW","MEDIUM","HIGH"].includes(priority)) throw new BadRequestException({ code: "INVALID_PRIORITY" });
    return this.command(auth, "customer-care.followup.create", key, body, async (client) => {
      await this.ensureCustomer(client, auth, customerId);
      await this.ensureSourceActivity(client, auth, customerId, body?.sourceActivityId);
      const relatedType = body?.related?.type ?? body?.relatedEntityType;
      const relatedId = body?.related?.id ?? body?.relatedEntityId;
      const relatedBranchId = await this.ensureRelated(client, auth, customerId, relatedType, relatedId, branchId);
      if (!branchId) branchId = relatedBranchId;
      if (body?.assignedUserId) {
        const assigned = (await client.query("SELECT 1 FROM users u WHERE u.id=$1 AND EXISTS(SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id=$2 AND tm.user_id=u.id AND tm.status='ACTIVE')", [body.assignedUserId, auth.tenantId])).rowCount;
        if (assigned !== 1) throw new BadRequestException({ code: "INVALID_ASSIGNEE" });
      }
      const inserted = (await client.query<{ id: string }>("INSERT INTO customer_care_followups(tenant_id,branch_id,customer_id,reason_code,note,assigned_user_id,due_at,priority,source_activity_id,related_entity_type,related_entity_id,created_by_user_id,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id", [auth.tenantId, branchId, customerId, reason, body?.note ?? null, body?.assignedUserId ?? null, dueAt.toISOString(), priority, body?.sourceActivityId ?? null, body?.related?.type ?? body?.relatedEntityType ?? null, body?.related?.id ?? body?.relatedEntityId ?? null, auth.userId, `care-followup:${auth.userId}:${key}`])).rows[0];
      if (!inserted) throw new ConflictException({ code: "CUSTOMER_CARE_FOLLOWUP_CREATE_FAILED" });
      const id = inserted.id;
      await this.evidence(client, auth, "customer_care.followup_created", "customer_care_followup", id, branchId, requestId, { customerId, priority });
      return { id, customerId, dueAt: dueAt.toISOString(), status: "OPEN", version: 1 };
    });
  }

  async completeFollowup(auth: AccessClaims, id: string, body: any, key: string, requestId: string) {
    return this.transitionFollowup(auth, id, "COMPLETED", body, key, requestId);
  }

  async cancelFollowup(auth: AccessClaims, id: string, body: any, key: string, requestId: string) {
    return this.transitionFollowup(auth, id, "CANCELLED", body, key, requestId);
  }

  private async transitionFollowup(auth: AccessClaims, id: string, status: "COMPLETED" | "CANCELLED", body: any, key: string, requestId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException({ code: "INVALID_FOLLOWUP_ID" });
    const version = Number(body?.version);
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException({ code: "VERSION_REQUIRED" });
    return this.command(auth, `customer-care.followup.${status.toLowerCase()}`, key, body, async (client) => {
      const row = (await client.query<any>("SELECT id,branch_id,version,status FROM customer_care_followups WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [auth.tenantId, id])).rows[0];
      if (!row) throw new NotFoundException({ code: "FOLLOWUP_NOT_FOUND" });
      this.assertBranch(auth, row.branch_id);
      if (row.version !== version) throw new ConflictException({ code: "CUSTOMER_CARE_VERSION_CONFLICT", message: "Follow-up vừa được cập nhật bởi người khác." });
      if (!["OPEN","IN_PROGRESS"].includes(row.status)) throw new ConflictException({ code: "FOLLOWUP_NOT_ACTIVE", message: "Follow-up không còn ở trạng thái có thể cập nhật." });
      const updated = (await client.query<any>("UPDATE customer_care_followups SET status=$3,completed_by_user_id=CASE WHEN $3='COMPLETED' THEN $4::uuid ELSE NULL END,completed_at=CASE WHEN $3='COMPLETED' THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,status,version,completed_at", [auth.tenantId, id, status, auth.userId])).rows[0];
      await this.evidence(client, auth, `customer_care.followup_${status.toLowerCase()}`, "customer_care_followup", id, row.branch_id, requestId, { previousStatus: row.status, status });
      return updated;
    });
  }
}
