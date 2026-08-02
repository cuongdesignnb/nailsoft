/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { comparison, freshness, metricVersion, parseFilters, type AnalyticsFilters } from "./analytics-domain.js";

const json = (value: unknown) => JSON.stringify(value ?? {});
const asBigInt = (value: unknown) => BigInt(String(value ?? 0));
const asNumber = (value: unknown) => Number(value ?? 0);

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  private assertAccess(auth: AccessClaims, permission: string, branchIds: string[] = [], personal = false) {
    if (!auth.tenantId || (auth.roles.includes("PLATFORM_SUPER_ADMIN") && !auth.supportAccess)) throw new ForbiddenException({ code: "PERMISSION_DENIED" });
    if (personal && !auth.ownStaffId) throw new ForbiddenException({ code: "STAFF_SCOPE_REQUIRED" });
    const allowed = auth.supportAccess?.branchIds ?? auth.branchIds;
    if (!auth.roles.includes("SALON_OWNER") && branchIds.some((id) => !allowed.includes(id))) throw new ForbiddenException({ code: "BRANCH_ACCESS_DENIED" });
    // PermissionGuard performs the canonical role lookup. This assertion is kept for direct service calls and support sessions.
    if (auth.supportAccess && !auth.supportAccess.permissions.includes(permission)) throw new ForbiddenException({ code: "SUPPORT_SCOPE_DENIED" });
  }

  private scope(auth: AccessClaims, filters: AnalyticsFilters) {
    const allowed = auth.supportAccess?.branchIds ?? auth.branchIds;
    const tenantWide = auth.roles.includes("SALON_OWNER") && !auth.supportAccess;
    const requested = filters.branchIds.length ? filters.branchIds : tenantWide ? [] : allowed;
    const branchIds = tenantWide ? requested : requested.filter((id) => allowed.includes(id));
    if (requested.length !== branchIds.length) throw new ForbiddenException({ code: "BRANCH_ACCESS_DENIED" });
    return branchIds;
  }

  private async audit(c: PoolClient, auth: AccessClaims, action: string, type: string, id: string, requestId: string, before?: unknown, after?: unknown) {
    await c.query(`INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [auth.tenantId, auth.userId, action, type, id, before == null ? null : json(before), after == null ? null : json(after), requestId]);
  }
  private async event(c: PoolClient, auth: AccessClaims, type: string, aggregate: string, id: string, requestId: string, payload: unknown = {}) {
    await c.query(`INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json)
      VALUES($1,$2,$3,$4,$5)`, [auth.tenantId, type, aggregate, id, json({ ...payload as object, refetch: true, requestId })]);
  }
  private async idempotent<T>(c: PoolClient, auth: AccessClaims, operation: string, key: string | undefined, request: unknown, work: () => Promise<T>) {
    if (!key) return work();
    const hash = Buffer.from(json(request)).toString("base64url");
    const inserted = await c.query(`INSERT INTO idempotency_keys(tenant_id,key,request_hash,response_status,response_body_json,state,expires_at)
      VALUES($1,$2,$3,200,'{}','PROCESSING',now()+interval '24 hours') ON CONFLICT (tenant_id,key) DO NOTHING RETURNING id`, [auth.tenantId, `${operation}:${key}`, hash]);
    if (!inserted.rows[0]) {
      const prior = (await c.query<any>(`SELECT request_hash,response_body_json,state FROM idempotency_keys WHERE tenant_id=$1 AND key=$2 FOR UPDATE`, [auth.tenantId, `${operation}:${key}`])).rows[0];
      if (prior?.request_hash !== hash) throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED" });
      if (prior?.state === "COMPLETED") return prior.response_body_json as T;
      throw new ConflictException({ code: "IDEMPOTENCY_REQUEST_IN_PROGRESS" });
    }
    const value = await work();
    await c.query(`UPDATE idempotency_keys SET state='COMPLETED',response_body_json=$3 WHERE tenant_id=$1 AND key=$2`, [auth.tenantId, `${operation}:${key}`, json(value)]);
    return value;
  }

  private metadata(filters: AnalyticsFilters, timezone: string, currency: string, revision: number, lastRefresh: string | null, status?: string) {
    return { asOf: lastRefresh ?? new Date().toISOString(), timezone, currency, metricVersion, projectionRevision: revision, lastSuccessfulRefreshAt: lastRefresh,
      freshnessStatus: status ?? freshness(lastRefresh).status, lagSeconds: freshness(lastRefresh).lagSeconds, filters };
  }

  async refresh(auth: AccessClaims, input: Record<string, unknown>, requestId: string) {
    const filters = parseFilters(input);
    this.assertAccess(auth, "analytics.rebuild.manage", filters.branchIds);
    const branchIds = this.scope(auth, filters);
    return this.db.transaction(async (c) => this.idempotent(c, auth, "analytics.refresh", String(input.idempotencyKey ?? ""), filters, async () => {
      const revision = asNumber((await c.query(`SELECT COALESCE(max(projection_revision),0)+1 revision FROM analytics_daily_branch_facts WHERE tenant_id=$1`, [auth.tenantId])).rows[0]?.revision);
      const branches = (await c.query<any>(`SELECT b.id,b.timezone,t.currency FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE b.tenant_id=$1 AND b.status='ACTIVE' AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[]))`, [auth.tenantId, branchIds.length ? branchIds : null])).rows;
      for (const branch of branches) {
        const rows = (await c.query<any>(`WITH days AS (SELECT generate_series($2::date,$3::date,'1 day')::date business_date),
          inv AS (SELECT (i.issued_at AT TIME ZONE $4)::date business_date,COALESCE(sum(i.subtotal_minor),0)::bigint gross_sales_minor,COALESCE(sum(i.discount_minor),0)::bigint discount_minor,COALESCE(sum(i.subtotal_minor-i.discount_minor),0)::bigint net_sales_minor,COALESCE(sum(i.tax_minor),0)::bigint tax_collected_minor,COALESCE(sum(i.tip_minor),0)::bigint tips_minor,COALESCE(sum(i.paid_minor),0)::bigint payments_collected_minor FROM invoices i WHERE i.tenant_id=$1 AND i.branch_id=$5 AND i.status='ISSUED' AND i.issued_at >= $2::date AND i.issued_at < ($3::date+1) GROUP BY 1),
          ap AS (SELECT (a.start_at AT TIME ZONE $4)::date business_date,count(*) FILTER(WHERE a.status NOT IN('DRAFT','SLOT_HELD','EXPIRED'))::int bookings_created,count(*) FILTER(WHERE a.status='CONFIRMED')::int bookings_confirmed,count(*) FILTER(WHERE a.status IN('COMPLETED','CHECKED_OUT','PAID'))::int completed_appointments,count(*) FILTER(WHERE a.status LIKE 'CANCELLED%')::int cancelled_appointments,count(*) FILTER(WHERE a.status='NO_SHOW')::int no_show_appointments FROM appointments a WHERE a.tenant_id=$1 AND a.branch_id=$5 AND a.start_at >= $2::date AND a.start_at < ($3::date+1) GROUP BY 1),
          si AS (SELECT (s.actual_started_at AT TIME ZONE $4)::date business_date,COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(s.actual_ended_at,now())-s.actual_started_at))/60) FILTER(WHERE s.status='COMPLETED'),0)::int completed_service_minutes,COALESCE(sum(EXTRACT(EPOCH FROM (s.scheduled_end_at-s.scheduled_start_at))/60),0)::int booked_service_minutes FROM service_sessions s WHERE s.tenant_id=$1 AND s.branch_id=$5 AND s.scheduled_start_at >= $2::date AND s.scheduled_start_at < ($3::date+1) GROUP BY 1),
          wi AS (SELECT local_queue_date business_date,count(*)::int walk_ins FROM walk_in_entries WHERE tenant_id=$1 AND branch_id=$5 AND local_queue_date BETWEEN $2::date AND $3::date GROUP BY 1)
          SELECT d.business_date,COALESCE(inv.gross_sales_minor,0) gross_sales_minor,COALESCE(inv.discount_minor,0) discount_minor,COALESCE(inv.net_sales_minor,0) net_sales_minor,COALESCE(inv.tax_collected_minor,0) tax_collected_minor,COALESCE(inv.tips_minor,0) tips_minor,COALESCE(inv.payments_collected_minor,0) payments_collected_minor,COALESCE(ap.bookings_created,0) bookings_created,COALESCE(ap.bookings_confirmed,0) bookings_confirmed,COALESCE(ap.completed_appointments,0) completed_appointments,COALESCE(ap.cancelled_appointments,0) cancelled_appointments,COALESCE(ap.no_show_appointments,0) no_show_appointments,COALESCE(si.booked_service_minutes,0) booked_service_minutes,COALESCE(si.completed_service_minutes,0) completed_service_minutes,COALESCE(wi.walk_ins,0) walk_ins FROM days d LEFT JOIN inv USING(business_date) LEFT JOIN ap USING(business_date) LEFT JOIN si USING(business_date) LEFT JOIN wi USING(business_date)`, [auth.tenantId, filters.from, filters.to, branch.timezone, branch.id])).rows;
        for (const row of rows) await c.query(`INSERT INTO analytics_daily_branch_facts(tenant_id,branch_id,business_date,timezone,currency_code,metric_version,projection_revision,gross_sales_minor,discount_minor,net_sales_minor,tax_collected_minor,tips_minor,payments_collected_minor,bookings_created,bookings_confirmed,completed_appointments,cancelled_appointments,no_show_appointments,booked_service_minutes,completed_service_minutes,walk_ins) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT(tenant_id,branch_id,business_date,currency_code,metric_version) DO UPDATE SET projection_revision=EXCLUDED.projection_revision,gross_sales_minor=EXCLUDED.gross_sales_minor,discount_minor=EXCLUDED.discount_minor,net_sales_minor=EXCLUDED.net_sales_minor,tax_collected_minor=EXCLUDED.tax_collected_minor,tips_minor=EXCLUDED.tips_minor,payments_collected_minor=EXCLUDED.payments_collected_minor,bookings_created=EXCLUDED.bookings_created,bookings_confirmed=EXCLUDED.bookings_confirmed,completed_appointments=EXCLUDED.completed_appointments,cancelled_appointments=EXCLUDED.cancelled_appointments,no_show_appointments=EXCLUDED.no_show_appointments,booked_service_minutes=EXCLUDED.booked_service_minutes,completed_service_minutes=EXCLUDED.completed_service_minutes,walk_ins=EXCLUDED.walk_ins,updated_at=now()`, [auth.tenantId,branch.id,row.business_date,branch.timezone,branch.currency,metricVersion,revision,row.gross_sales_minor,row.discount_minor,row.net_sales_minor,row.tax_collected_minor,row.tips_minor,row.payments_collected_minor,row.bookings_created,row.bookings_confirmed,row.completed_appointments,row.cancelled_appointments,row.no_show_appointments,row.booked_service_minutes,row.completed_service_minutes,row.walk_ins]);
      }
      const checkpoint = (await c.query<any>(`INSERT INTO analytics_projection_checkpoints(tenant_id,projector_name,projection_revision,last_successful_refresh_at,status,lag_seconds) VALUES($1,'daily-facts',$2,now(),'HEALTHY',0) ON CONFLICT(tenant_id,projector_name) DO UPDATE SET projection_revision=EXCLUDED.projection_revision,last_successful_refresh_at=now(),status='HEALTHY',lag_seconds=0,updated_at=now() RETURNING *`, [auth.tenantId, revision])).rows[0];
      await this.audit(c, auth, "analytics.projection_refreshed", "analytics_projection", checkpoint.id, requestId, null, checkpoint);
      await this.event(c, auth, "analytics.projection.refreshed", "analytics_projection", checkpoint.id, requestId, { revision });
      return { revision, refreshedBranches: branches.length, from: filters.from, to: filters.to, lastSuccessfulRefreshAt: checkpoint.last_successful_refresh_at };
    }));
  }

  private async ensureFacts(auth: AccessClaims, filters: AnalyticsFilters) {
    const branchIds = this.scope(auth, filters);
    const values: unknown[] = [auth.tenantId, filters.from, filters.to, branchIds.length ? branchIds : null];
    return (await this.db.query<any>(`SELECT f.*,b.name branch_name,b.timezone,t.currency FROM analytics_daily_branch_facts f JOIN branches b ON b.tenant_id=f.tenant_id AND b.id=f.branch_id JOIN tenants t ON t.id=f.tenant_id WHERE f.tenant_id=$1 AND f.business_date BETWEEN $2::date AND $3::date AND ($4::uuid[] IS NULL OR f.branch_id=ANY($4::uuid[])) ORDER BY f.business_date,f.branch_id`, values)).rows;
  }

  private async read(auth: AccessClaims, input: Record<string, unknown>, permission: string, personal = false) {
    const filters = parseFilters(input); this.assertAccess(auth, permission, filters.branchIds, personal); let rows = await this.ensureFacts(auth, filters);
    // Owner reads may hydrate an empty range synchronously. This is still a PostgreSQL projection and never fabricates UI data.
    if (!rows.length && auth.roles.includes("SALON_OWNER")) { await this.refresh(auth, filters as unknown as Record<string, unknown>, "analytics-read"); rows = await this.ensureFacts(auth, filters); }
    const checkpoint = (await this.db.query<any>(`SELECT * FROM analytics_projection_checkpoints WHERE tenant_id=$1 AND projector_name='daily-facts'`, [auth.tenantId])).rows[0];
    return { filters, rows, revision: asNumber(checkpoint?.projection_revision), lastRefresh: checkpoint?.last_successful_refresh_at ?? null, status: checkpoint?.status };
  }

  private totals(rows: any[]) {
    const keys = ["gross_sales_minor","discount_minor","net_sales_minor","tax_collected_minor","tips_minor","payments_collected_minor","refunds_minor","bookings_created","bookings_confirmed","completed_appointments","cancelled_appointments","no_show_appointments","walk_ins","booked_service_minutes","completed_service_minutes","eligible_working_minutes","new_customers","returning_customers"];
    return Object.fromEntries(keys.map((key) => [key, rows.reduce((sum, row) => sum + asBigInt(row[key]), 0n).toString()]));
  }

  async commandCenter(auth: AccessClaims, input: Record<string, unknown>) {
    const result = await this.read(auth, input, "analytics.dashboard.read"); const totals = this.totals(result.rows);
    const branchSummary = Object.values(result.rows.reduce((acc: Record<string, any>, row: any) => { const item = acc[row.branch_id] ?? { branchId: row.branch_id, branchName: row.branch_name, netSalesMinor: "0", completedAppointments: 0 }; item.netSalesMinor = (asBigInt(item.netSalesMinor) + asBigInt(row.net_sales_minor)).toString(); item.completedAppointments += asNumber(row.completed_appointments); acc[row.branch_id] = item; return acc; }, {}));
    const trend = result.rows.map((row) => ({ businessDate: row.business_date, branchId: row.branch_id, netSalesMinor: String(row.net_sales_minor), completedAppointments: asNumber(row.completed_appointments) }));
    return { kpis: totals, trend, branches: branchSummary, alerts: await this.alerts(auth, {}), metadata: this.metadata(result.filters, result.rows[0]?.timezone ?? "Asia/Ho_Chi_Minh", result.rows[0]?.currency ?? "VND", result.revision, result.lastRefresh, result.status === "REBUILDING" ? "REBUILDING" : undefined) };
  }

  async kpis(auth: AccessClaims, input: Record<string, unknown>) { const result = await this.read(auth, input, "analytics.dashboard.read"); return { ...this.totals(result.rows), metadata: this.metadata(result.filters, result.rows[0]?.timezone ?? "Asia/Ho_Chi_Minh", result.rows[0]?.currency ?? "VND", result.revision, result.lastRefresh) }; }
  async trends(auth: AccessClaims, input: Record<string, unknown>) { const result = await this.read(auth, input, "analytics.sales.read"); return { rows: result.rows.map((r) => ({ date: r.business_date, branchId: r.branch_id, grossSalesMinor: String(r.gross_sales_minor), netSalesMinor: String(r.net_sales_minor), paymentsCollectedMinor: String(r.payments_collected_minor) })), metadata: this.metadata(result.filters, result.rows[0]?.timezone ?? "Asia/Ho_Chi_Minh", result.rows[0]?.currency ?? "VND", result.revision, result.lastRefresh) }; }
  async branches(auth: AccessClaims, input: Record<string, unknown>) { const result = await this.read(auth, input, "analytics.dashboard.read"); return { rows: Object.values(result.rows.reduce((a: Record<string, any>, r: any) => { const x = a[r.branch_id] ?? { branchId: r.branch_id, branchName: r.branch_name, netSalesMinor: "0", completedAppointments: 0 }; x.netSalesMinor = (asBigInt(x.netSalesMinor) + asBigInt(r.net_sales_minor)).toString(); x.completedAppointments += asNumber(r.completed_appointments); a[r.branch_id] = x; return a; }, {})), metadata: this.metadata(result.filters, result.rows[0]?.timezone ?? "Asia/Ho_Chi_Minh", result.rows[0]?.currency ?? "VND", result.revision, result.lastRefresh) }; }
  async generic(auth: AccessClaims, input: Record<string, unknown>, permission: string, family: string, personal = false) { const result = await this.read(auth, input, permission, personal); return { family, rows: result.rows, totals: this.totals(result.rows), metadata: this.metadata(result.filters, result.rows[0]?.timezone ?? "Asia/Ho_Chi_Minh", result.rows[0]?.currency ?? "VND", result.revision, result.lastRefresh) }; }
  async staff(auth: AccessClaims, input: Record<string, unknown>, staffId?: string) { const id = staffId ?? (auth.roles.includes("NAIL_TECHNICIAN") ? auth.ownStaffId : undefined); if (auth.roles.includes("NAIL_TECHNICIAN") && !id) throw new ForbiddenException({ code: "STAFF_SCOPE_REQUIRED" }); return this.generic(auth, { ...input, ...(id ? { staffId: id } : {}) }, id ? "analytics.staff.personal.read" : "analytics.staff.read", "staff", Boolean(id)); }
  async dataQuality(auth: AccessClaims) { this.assertAccess(auth, "analytics.data_quality.read"); const checkpoints = (await this.db.query<any>("SELECT * FROM analytics_projection_checkpoints WHERE tenant_id=$1 ORDER BY projector_name", [auth.tenantId])).rows; return { checkpoints, metadata: { asOf: new Date().toISOString(), status: checkpoints.some((x) => x.status !== "HEALTHY") ? "DEGRADED" : "FRESH" } }; }

  private async recordCommand(auth: AccessClaims, operation: string, key: string | undefined, request: unknown, requestId: string, work: (c: PoolClient) => Promise<any>) {
    return this.db.transaction((c) => this.idempotent(c, auth, operation, key, request, async () => { const row = await work(c); await this.audit(c, auth, `analytics.${operation}`, `analytics_${operation.split(".")[0]}`, row.id, requestId, null, row); await this.event(c, auth, `analytics.${operation}`, `analytics_${operation.split(".")[0]}`, row.id, requestId); return row; }));
  }

  async targets(auth: AccessClaims) { this.assertAccess(auth, "analytics.dashboard.read"); return (await this.db.query<any>("SELECT * FROM analytics_targets WHERE tenant_id=$1 ORDER BY period_start DESC", [auth.tenantId])).rows; }
  async createTarget(auth: AccessClaims, input: any, key: string | undefined, requestId: string) { this.assertAccess(auth, "analytics.target.manage", input.branchId ? [input.branchId] : []); return this.recordCommand(auth, "target.created", key, input, requestId, async (c) => (await c.query<any>(`INSERT INTO analytics_targets(tenant_id,branch_id,metric_key,period_start,period_end,target_value,currency_code,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [auth.tenantId,input.branchId ?? null,input.metricKey,input.periodStart,input.periodEnd,String(input.targetValue),input.currency ?? null,auth.userId])).rows[0]); }
  async targetStatus(auth: AccessClaims, id: string, target: string, input: any, key: string | undefined, requestId: string) { return this.recordCommand(auth, `target.${target.toLowerCase()}`, key, { id, ...input }, requestId, async (c) => { const old = (await c.query<any>("SELECT * FROM analytics_targets WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [auth.tenantId,id])).rows[0]; if (!old) throw new NotFoundException({ code: "ANALYTICS_TARGET_NOT_FOUND" }); if (input.version != null && Number(input.version) !== Number(old.version)) throw new ConflictException({ code: "VERSION_CONFLICT" }); return (await c.query<any>("UPDATE analytics_targets SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [auth.tenantId,id,target])).rows[0]; }); }
  async alertRules(auth: AccessClaims) { this.assertAccess(auth, "analytics.alert.manage"); return (await this.db.query<any>("SELECT * FROM analytics_alert_rules WHERE tenant_id=$1 ORDER BY created_at DESC", [auth.tenantId])).rows; }
  async createAlertRule(auth: AccessClaims, input: any, key: string | undefined, requestId: string) { this.assertAccess(auth, "analytics.alert.manage", input.branchId ? [input.branchId] : []); return this.recordCommand(auth, "alert_rule.created", key, input, requestId, async (c) => (await c.query<any>(`INSERT INTO analytics_alert_rules(tenant_id,branch_id,metric_key,operator,threshold,cooldown_minutes,recipient_scope_json,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [auth.tenantId,input.branchId ?? null,input.metricKey,input.operator,String(input.threshold),input.cooldownMinutes ?? 60,json(input.recipientScope),auth.userId])).rows[0]); }
  async alerts(auth: AccessClaims, input: any) { this.assertAccess(auth, "analytics.dashboard.read"); const branches = this.scope(auth, parseFilters(input ?? {})); return (await this.db.query<any>("SELECT * FROM analytics_alert_occurrences WHERE tenant_id=$1 AND state<>'RESOLVED' AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY first_seen_at DESC LIMIT 100", [auth.tenantId, branches.length ? branches : null])).rows; }
  async alertStatus(auth: AccessClaims, id: string, target: string, key: string | undefined, requestId: string) { return this.recordCommand(auth, `alert.${target.toLowerCase()}`, key, { id, target }, requestId, async (c) => { const row = (await c.query<any>("SELECT * FROM analytics_alert_occurrences WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [auth.tenantId,id])).rows[0]; if (!row) throw new NotFoundException({ code: "ANALYTICS_ALERT_NOT_FOUND" }); return (await c.query<any>("UPDATE analytics_alert_occurrences SET state=$3,acknowledged_at=CASE WHEN $3='ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,resolved_at=CASE WHEN $3='RESOLVED' THEN now() ELSE resolved_at END,acknowledged_by_user_id=CASE WHEN $3='ACKNOWLEDGED' THEN $4 ELSE acknowledged_by_user_id END WHERE tenant_id=$1 AND id=$2 RETURNING *", [auth.tenantId,id,target,auth.userId])).rows[0]; }); }
  async savedViews(auth: AccessClaims) { this.assertAccess(auth, "analytics.dashboard.read"); return (await this.db.query<any>("SELECT * FROM analytics_saved_views WHERE tenant_id=$1 AND owner_user_id=$2 ORDER BY updated_at DESC", [auth.tenantId,auth.userId])).rows; }
  async saveView(auth: AccessClaims, input: any, key: string | undefined, requestId: string) { return this.recordCommand(auth, "saved_view.created", key, input, requestId, async (c) => (await c.query<any>("INSERT INTO analytics_saved_views(tenant_id,owner_user_id,name,filters_json,display_json) VALUES($1,$2,$3,$4,$5) RETURNING *", [auth.tenantId,auth.userId,input.name,json(input.filters),json(input.display)])).rows[0]); }
  async deleteView(auth: AccessClaims, id: string) { this.assertAccess(auth, "analytics.dashboard.read"); const result = await this.db.query("DELETE FROM analytics_saved_views WHERE tenant_id=$1 AND owner_user_id=$2 AND id=$3 RETURNING id", [auth.tenantId,auth.userId,id]); if (!result.rowCount) throw new NotFoundException({ code: "ANALYTICS_SAVED_VIEW_NOT_FOUND" }); return { id, deleted: true }; }
  async exports(auth: AccessClaims) { this.assertAccess(auth, "analytics.export"); return (await this.db.query<any>("SELECT * FROM analytics_export_jobs WHERE tenant_id=$1 AND requested_by_user_id=$2 ORDER BY created_at DESC", [auth.tenantId,auth.userId])).rows; }
  async createExport(auth: AccessClaims, input: any, key: string | undefined, requestId: string) { this.assertAccess(auth, "analytics.export", input.branchIds ?? []); return this.recordCommand(auth, "export.created", key, input, requestId, async (c) => (await c.query<any>("INSERT INTO analytics_export_jobs(tenant_id,requested_by_user_id,export_type,filters_json) VALUES($1,$2,$3,$4) RETURNING *", [auth.tenantId,auth.userId,input.exportType ?? "COMMAND_CENTER",json(input.filters ?? input)])).rows[0]); }
  async exportById(auth: AccessClaims, id: string) { this.assertAccess(auth, "analytics.export"); const row = (await this.db.query<any>("SELECT * FROM analytics_export_jobs WHERE tenant_id=$1 AND id=$2 AND requested_by_user_id=$3", [auth.tenantId,id,auth.userId])).rows[0]; if (!row) throw new NotFoundException({ code: "ANALYTICS_EXPORT_NOT_FOUND" }); return row; }
  async projectionHealth(auth: AccessClaims) { this.assertAccess(auth, "analytics.data_quality.read"); return this.dataQuality(auth); }
  async rebuilds(auth: AccessClaims) { this.assertAccess(auth, "analytics.rebuild.manage"); return (await this.db.query<any>("SELECT * FROM analytics_rebuild_runs WHERE tenant_id=$1 ORDER BY created_at DESC", [auth.tenantId])).rows; }
  async createRebuild(auth: AccessClaims, input: any, key: string | undefined, requestId: string) { this.assertAccess(auth, "analytics.rebuild.manage", input.branchIds ?? []); return this.recordCommand(auth, "rebuild.created", key, input, requestId, async (c) => (await c.query<any>("INSERT INTO analytics_rebuild_runs(tenant_id,requested_by_user_id,scope_json) VALUES($1,$2,$3) RETURNING *", [auth.tenantId,auth.userId,json(input)])).rows[0]); }
  async rebuildById(auth: AccessClaims, id: string) { this.assertAccess(auth, "analytics.rebuild.manage"); const row = (await this.db.query<any>("SELECT * FROM analytics_rebuild_runs WHERE tenant_id=$1 AND id=$2", [auth.tenantId,id])).rows[0]; if (!row) throw new NotFoundException({ code: "ANALYTICS_REBUILD_NOT_FOUND" }); return row; }
  async comparison(auth: AccessClaims, input: any) { const filters = parseFilters(input); const current = await this.kpis(auth, input) as Record<string, any>; const days = Math.floor((new Date(`${filters.to}T00:00:00Z`).getTime() - new Date(`${filters.from}T00:00:00Z`).getTime()) / 86_400_000) + 1; const previousTo = new Date(`${filters.from}T00:00:00Z`); previousTo.setUTCDate(previousTo.getUTCDate() - 1); const previousFrom = new Date(previousTo); previousFrom.setUTCDate(previousFrom.getUTCDate() - days + 1); const previous = await this.kpis(auth, { ...input, from: previousFrom.toISOString().slice(0,10), to: previousTo.toISOString().slice(0,10), comparisonMode: "NONE" }) as Record<string, any>; return { current, comparison: previous, netSales: comparison(asBigInt(current.net_sales_minor), asBigInt(previous.net_sales_minor), filters.comparisonMode) }; }
}
