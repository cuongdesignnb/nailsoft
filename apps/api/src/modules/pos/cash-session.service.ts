/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import {
  cashCloseSchema,
  cashDeclareSchema,
  cashSessionDirectoryQuerySchema,
  cashMovementSchema,
  cashSessionOpenSchema,
  cashSessionVersionSchema,
} from "@nailsoft/validation";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "./financial-evidence.service.js";
import { minorNumber } from "./pos-pricing.service.js";
import { RegisterDeviceAuthorizationService } from "./register-device-authorization.service.js";

@Injectable()
export class CashSessionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
    @Inject(RegisterDeviceAuthorizationService)
    private readonly registerDevice: RegisterDeviceAuthorizationService,
  ) {}

  async registers(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const rows = (
      await this.db.query<any>(
        `SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'currency',d.currency,'status',d.status) ORDER BY d.code) FROM cash_drawers d WHERE d.tenant_id=r.tenant_id AND d.register_id=r.id),'[]'::jsonb) drawers
           FROM pos_registers r WHERE r.tenant_id=$1 AND ($2::uuid[] IS NULL OR r.branch_id=ANY($2::uuid[]))
             AND ($3::uuid IS NULL OR r.branch_id=$3) ORDER BY r.code`,
        [auth.tenantId, branches, query?.branchId ?? null],
      )
    ).rows;
    if (query?.branchId) this.assertBranch(auth, query.branchId);
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      code: row.code,
      name: row.name,
      status: row.status,
      deviceBindingRequired: row.device_binding_required,
      version: Number(row.version),
      drawers: row.drawers,
    }));
  }

  async accessStatus(auth: AccessClaims, registerId: string) {
    this.assertTenant(auth);
    const register = (
      await this.db.query<any>(
        `SELECT r.id,r.branch_id,r.status,r.device_binding_required,b.status branch_status
           FROM pos_registers r
           JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id
          WHERE r.tenant_id=$1 AND r.id=$2`,
        [auth.tenantId, registerId],
      )
    ).rows[0];
    if (!register || register.status !== "ACTIVE")
      throw new NotFoundException({
        code: "CASH_REGISTER_NOT_FOUND",
        message: "Active register not found",
      });
    this.assertBranch(auth, register.branch_id);
    if (register.branch_status !== "ACTIVE")
      throw new ConflictException({
        code: "FINANCIAL_BRANCH_INACTIVE",
        message: "Branch is inactive",
      });
    await this.registerDevice.assertRegisterAccess({
      auth,
      registerId,
      branchId: register.branch_id,
    });
    return {
      registerId,
      status: "READY" as const,
      deviceBindingRequired: Boolean(register.device_binding_required),
      deviceSessionValid: true,
      deviceBound: true,
    };
  }

  async overview(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branchId = String(query?.branchId ?? "");
    if (!branchId)
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "branchId is required",
      });
    this.assertBranch(auth, branchId);
    const branch = (
      await this.db.query<any>(
        `SELECT b.id,b.timezone,bs.currency
           FROM branches b
           JOIN branch_settings bs ON bs.tenant_id=b.tenant_id AND bs.branch_id=b.id
          WHERE b.tenant_id=$1 AND b.id=$2 AND b.status='ACTIVE'`,
        [auth.tenantId, branchId],
      )
    ).rows[0];
    if (!branch)
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
      });

    const businessDate = String(
      query?.businessDate ??
        DateTime.now().setZone(branch.timezone).toISODate(),
    );
    const visibleCashierId =
      auth.roles.includes("CASHIER") && !this.manager(auth)
        ? auth.userId
        : null;
    const financialVisible = auth.roles.some((role) =>
      ["SALON_OWNER", "BRANCH_MANAGER", "ACCOUNTANT"].includes(role),
    );
    const [registerResult, sessionResult, metricResult, movementResult, attentionResult, activityResult] =
      await Promise.all([
        this.db.query<any>(
          `SELECT r.*,
                  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'currency',d.currency,'status',d.status) ORDER BY d.code)
                              FROM cash_drawers d
                             WHERE d.tenant_id=r.tenant_id AND d.register_id=r.id),'[]'::jsonb) drawers
             FROM pos_registers r
            WHERE r.tenant_id=$1 AND r.branch_id=$2
            ORDER BY r.code`,
          [auth.tenantId, branchId],
        ),
        this.db.query<any>(
          `SELECT cs.*,r.code register_code,d.code drawer_code,d.currency,u.display_name cashier_display_name
             FROM cash_sessions cs
             JOIN pos_registers r ON r.tenant_id=cs.tenant_id AND r.id=cs.register_id
             JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id
             JOIN users u ON u.id=cs.cashier_user_id
            WHERE cs.tenant_id=$1 AND cs.branch_id=$2
              AND cs.status IN ('OPEN','CLOSING')
              AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
            ORDER BY cs.opened_at DESC,cs.id`,
          [auth.tenantId, branchId, visibleCashierId],
        ),
        this.db.query<any>(
          `WITH captured AS (
             SELECT p.id,p.cash_session_id,p.pos_order_id,p.captured_minor,p.tender_type
               FROM payments p
               JOIN cash_sessions cs ON cs.tenant_id=p.tenant_id AND cs.id=p.cash_session_id
              WHERE p.tenant_id=$1 AND cs.branch_id=$2 AND p.status='CAPTURED'
                AND cs.status IN ('OPEN','CLOSING')
                AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
           ), payment_totals AS (
             SELECT cash_session_id,count(*) captured_payment_count,count(DISTINCT pos_order_id) order_count,
                    COALESCE(sum(captured_minor),0) total_collected_minor,
                    COALESCE(sum(captured_minor) FILTER (WHERE tender_type='CASH'),0) cash_collected_minor
               FROM captured GROUP BY cash_session_id
           ), allocations AS (
             SELECT c.cash_session_id,
                    COALESCE(sum(pa.amount_minor) FILTER (WHERE pa.allocation_type IN ('ORDER_TOTAL','DEPOSIT')),0) sales_minor
               FROM captured c
               LEFT JOIN payment_allocations pa ON pa.tenant_id=$1 AND pa.payment_id=c.id
              GROUP BY c.cash_session_id
           ), mix AS (
             SELECT cash_session_id,tender_type,sum(captured_minor) amount_minor,count(*) payment_count
               FROM captured GROUP BY cash_session_id,tender_type
           )
           SELECT pt.cash_session_id,pt.captured_payment_count,pt.order_count,pt.total_collected_minor,pt.cash_collected_minor,
                  COALESCE(a.sales_minor,0) sales_minor,
                  COALESCE((SELECT jsonb_object_agg(m.tender_type,jsonb_build_object('amountMinor',m.amount_minor,'count',m.payment_count))
                              FROM mix m WHERE m.cash_session_id=pt.cash_session_id),'{}'::jsonb) payment_mix
             FROM payment_totals pt LEFT JOIN allocations a ON a.cash_session_id=pt.cash_session_id`,
          [auth.tenantId, branchId, visibleCashierId],
        ),
        this.db.query<any>(
          `SELECT cm.cash_session_id,
                  COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='OPENING_FLOAT' AND cm.direction='IN'),0) opening_float_minor,
                  COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_SALE' AND cm.direction='IN'),0) cash_sales_minor,
                  COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_IN' AND cm.direction='IN'),0) cash_in_minor,
                  COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.direction='OUT'),0) cash_out_minor,
                  COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.direction='IN'),0) cash_in_total_minor
             FROM cash_movements cm
             JOIN cash_sessions cs ON cs.tenant_id=cm.tenant_id AND cs.id=cm.cash_session_id
            WHERE cm.tenant_id=$1 AND cs.branch_id=$2 AND cs.status IN ('OPEN','CLOSING')
              AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
            GROUP BY cm.cash_session_id`,
          [auth.tenantId, branchId, visibleCashierId],
        ),
        this.db.query<any>(
          `SELECT * FROM (
             SELECT 'PARTIAL_ORDER' code,o.id event_id,o.id order_id,NULL::uuid session_id,o.register_id,
                    o.amount_due_minor amount_minor,o.updated_at occurred_at
               FROM pos_orders o
              WHERE o.tenant_id=$1 AND o.branch_id=$2 AND o.status='PARTIALLY_PAID'
                AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM cash_sessions cs WHERE cs.tenant_id=o.tenant_id AND cs.id=o.cash_session_id AND cs.cashier_user_id=$3))
             UNION ALL
             SELECT 'FAILED_PAYMENT' code,p.id event_id,o.id order_id,p.cash_session_id,o.register_id,
                    p.requested_minor amount_minor,COALESCE(p.failed_at,p.created_at) occurred_at
               FROM payments p JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
              WHERE p.tenant_id=$1 AND o.branch_id=$2 AND p.status='FAILED'
                AND ($3::uuid IS NULL OR p.created_by_user_id=$3)
             UNION ALL
             SELECT 'UNISSUED_INVOICE' code,o.id event_id,o.id order_id,o.cash_session_id,o.register_id,
                    o.total_minor amount_minor,COALESCE(o.paid_at,o.updated_at) occurred_at
               FROM pos_orders o
              WHERE o.tenant_id=$1 AND o.branch_id=$2 AND o.status='PAID'
                AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.tenant_id=o.tenant_id AND i.pos_order_id=o.id AND i.status='ISSUED')
                AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM cash_sessions cs WHERE cs.tenant_id=o.tenant_id AND cs.id=o.cash_session_id AND cs.cashier_user_id=$3))
             UNION ALL
             SELECT 'CLOSING_SESSION' code,cs.id event_id,NULL::uuid order_id,cs.id session_id,cs.register_id,
                    NULL::bigint amount_minor,COALESCE(cs.closing_started_at,cs.updated_at) occurred_at
               FROM cash_sessions cs
              WHERE cs.tenant_id=$1 AND cs.branch_id=$2 AND cs.status='CLOSING'
                AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
             UNION ALL
             SELECT 'CASH_VARIANCE' code,cs.id event_id,NULL::uuid order_id,cs.id session_id,cs.register_id,
                    cs.variance_minor amount_minor,cs.updated_at occurred_at
               FROM cash_sessions cs
              WHERE cs.tenant_id=$1 AND cs.branch_id=$2 AND cs.status='CLOSING' AND cs.variance_minor IS NOT NULL AND cs.variance_minor<>0
                AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
           ) attention ORDER BY occurred_at DESC NULLS LAST LIMIT 100`,
          [auth.tenantId, branchId, visibleCashierId],
        ),
        this.db.query<any>(
          `SELECT * FROM (
             SELECT 'PAYMENT_CAPTURED' code,p.id event_id,p.cash_session_id session_id,cs.register_id,p.pos_order_id order_id,
                    p.captured_minor amount_minor,p.tender_type detail,COALESCE(p.captured_at,p.created_at) occurred_at,u.display_name actor_name
               FROM payments p
               JOIN cash_sessions cs ON cs.tenant_id=p.tenant_id AND cs.id=p.cash_session_id
               LEFT JOIN users u ON u.id=p.created_by_user_id
              WHERE p.tenant_id=$1 AND cs.branch_id=$2 AND p.status='CAPTURED'
                AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
             UNION ALL
             SELECT 'CASH_SESSION_OPENED' code,cs.id event_id,cs.id session_id,cs.register_id,NULL::uuid order_id,
                    cs.opening_float_minor amount_minor,cs.status detail,cs.opened_at occurred_at,u.display_name actor_name
               FROM cash_sessions cs JOIN users u ON u.id=cs.cashier_user_id
              WHERE cs.tenant_id=$1 AND cs.branch_id=$2 AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
             UNION ALL
             SELECT CASE WHEN cs.status='CLOSING' THEN 'CLOSING_STARTED' ELSE 'CASH_SESSION_UPDATED' END code,
                    cs.id event_id,cs.id session_id,cs.register_id,NULL::uuid order_id,NULL::bigint amount_minor,cs.status detail,
                    COALESCE(cs.closing_started_at,cs.updated_at) occurred_at,u.display_name actor_name
               FROM cash_sessions cs JOIN users u ON u.id=cs.cashier_user_id
              WHERE cs.tenant_id=$1 AND cs.branch_id=$2 AND cs.status='CLOSING' AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
             UNION ALL
             SELECT 'CASH_MOVEMENT' code,cm.id event_id,cm.cash_session_id session_id,cs.register_id,NULL::uuid order_id,
                    cm.amount_minor,cm.movement_type detail,cm.occurred_at,u.display_name actor_name
               FROM cash_movements cm
               JOIN cash_sessions cs ON cs.tenant_id=cm.tenant_id AND cs.id=cm.cash_session_id
               LEFT JOIN users u ON u.id=cm.actor_user_id
              WHERE cm.tenant_id=$1 AND cs.branch_id=$2 AND ($3::uuid IS NULL OR cs.cashier_user_id=$3)
           ) activity ORDER BY occurred_at DESC NULLS LAST LIMIT 16`,
          [auth.tenantId, branchId, visibleCashierId],
        ),
      ]);

    const sessions = sessionResult.rows.map((row) => ({
      row,
      view: sessionView(row, auth),
      cashier:
        row.cashier_display_name
          ? { userId: row.cashier_user_id, displayName: row.cashier_display_name }
          : null,
    }));
    const sessionsByRegister = new Map<string, typeof sessions>();
    sessions.forEach((session) => {
      const list = sessionsByRegister.get(session.row.register_id) ?? [];
      list.push(session);
      sessionsByRegister.set(session.row.register_id, list);
    });
    const metricBySession = new Map(
      metricResult.rows.map((row) => [
        row.cash_session_id,
        {
          orderCount: Number(row.order_count ?? 0),
          capturedPaymentCount: Number(row.captured_payment_count ?? 0),
          salesMinor: minorNumber(row.sales_minor ?? 0),
          totalCollectedMinor: minorNumber(row.total_collected_minor ?? 0),
          cashCollectedMinor: minorNumber(row.cash_collected_minor ?? 0),
          paymentMix: row.payment_mix ?? {},
        },
      ]),
    );
    const movementBySession = new Map(
      movementResult.rows.map((row) => [
        row.cash_session_id,
        {
          openingFloatMinor: minorNumber(row.opening_float_minor ?? 0),
          cashSalesMinor: minorNumber(row.cash_sales_minor ?? 0),
          cashInMinor: minorNumber(row.cash_in_minor ?? 0),
          cashOutMinor: minorNumber(row.cash_out_minor ?? 0),
        },
      ]),
    );
    const attentionByRegister = new Map<string, any[]>();
    attentionResult.rows.forEach((row) => {
      const list = attentionByRegister.get(row.register_id) ?? [];
      list.push({
        code: row.code,
        orderId: row.order_id,
        sessionId: row.session_id,
        amountMinor: row.amount_minor == null ? null : minorNumber(row.amount_minor),
        occurredAt: row.occurred_at,
      });
      attentionByRegister.set(row.register_id, list);
    });
    const registerViews = registerResult.rows.map((row) => {
      const activeSessions = sessionsByRegister.get(row.id) ?? [];
      const current = activeSessions[0];
      const metrics = current ? metricBySession.get(current.row.id) : undefined;
      const movements = current ? movementBySession.get(current.row.id) : undefined;
      return {
        register: {
          id: row.id,
          branchId: row.branch_id,
          code: row.code,
          name: row.name,
          status: row.status,
          deviceBindingRequired: row.device_binding_required,
          version: Number(row.version),
          drawers: row.drawers,
        },
        currentSession: current?.view ?? null,
        cashier: current?.cashier ?? null,
        metrics: metrics
          ? {
              ...metrics,
              salesMinor: financialVisible ? metrics.salesMinor : null,
              totalCollectedMinor: financialVisible ? metrics.totalCollectedMinor : null,
              cashCollectedMinor: current?.view.blindCount ? null : financialVisible ? metrics.cashCollectedMinor : null,
              paymentMix: financialVisible ? metrics.paymentMix : null,
              movements: current?.view.blindCount ? null : financialVisible ? movements ?? null : null,
            }
          : null,
        attention: attentionByRegister.get(row.id) ?? [],
        sessionCount: activeSessions.length,
      };
    });
    const openSessions = sessions.map((session) => {
      const metrics = metricBySession.get(session.row.id);
      const movements = movementBySession.get(session.row.id);
      return {
        ...session.view,
        cashier: session.cashier,
        metrics: metrics
          ? {
              ...metrics,
              salesMinor: financialVisible ? metrics.salesMinor : null,
              totalCollectedMinor: financialVisible ? metrics.totalCollectedMinor : null,
              cashCollectedMinor: session.view.blindCount ? null : financialVisible ? metrics.cashCollectedMinor : null,
              paymentMix: financialVisible ? metrics.paymentMix : null,
              movements: session.view.blindCount ? null : financialVisible ? movements ?? null : null,
            }
          : null,
      };
    });
    const activity = activityResult.rows.map((row) => {
      const session = sessions.find((item) => item.row.id === row.session_id);
      const hidden = !financialVisible || Boolean(session?.view.blindCount);
      return {
        code: row.code,
        id: row.event_id,
        registerId: row.register_id,
        sessionId: row.session_id,
        orderId: row.order_id,
        amountMinor: hidden || row.amount_minor == null ? null : minorNumber(row.amount_minor),
        detail: row.detail,
        actorName: row.actor_name,
        occurredAt: row.occurred_at,
      };
    });
    const allMetrics = Array.from(metricBySession.values());
    const hiddenExpected = sessions.some((session) => session.view.blindCount);
    const paymentMix = financialVisible
      ? allMetrics.reduce<Record<string, { amountMinor: number; count: number }>>((result, metric) => {
          Object.entries(metric.paymentMix as Record<string, { amountMinor?: number; count?: number }>).forEach(([key, value]) => {
            result[key] = {
              amountMinor: (result[key]?.amountMinor ?? 0) + Number(value?.amountMinor ?? 0),
              count: (result[key]?.count ?? 0) + Number(value?.count ?? 0),
            };
          });
          return result;
        }, {})
      : null;
    return {
      branchId,
      businessDate,
      timezone: branch.timezone,
      currency: branch.currency,
      financialVisible,
      totals: {
        registerCount: registerViews.length,
        openRegisterCount: new Set(sessions.map((session) => session.row.register_id)).size,
        closingRegisterCount: new Set(sessions.filter((session) => session.row.status === "CLOSING").map((session) => session.row.register_id)).size,
        unopenedRegisterCount: registerViews.filter((item) => item.register.status === "ACTIVE" && !item.currentSession).length,
        collectedMinor: financialVisible ? allMetrics.reduce((sum, metric) => sum + Number(metric.totalCollectedMinor), 0) : null,
        cashExpectedMinor: hiddenExpected ? null : financialVisible ? sessions.reduce((sum, session) => sum + Number(session.view.expectedCashMinor ?? 0), 0) : null,
        orderCount: financialVisible ? allMetrics.reduce((sum, metric) => sum + Number(metric.orderCount), 0) : null,
        attentionCount: attentionResult.rows.length,
      },
      registers: registerViews,
      openSessions,
      paymentMix,
      activity,
      generatedAt: new Date().toISOString(),
    };
  }

  async list(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches];
    let where = "($2::uuid[] IS NULL OR cs.branch_id=ANY($2::uuid[]))";
    if (query?.branchId) {
      this.assertBranch(auth, query.branchId);
      values.push(query.branchId);
      where += ` AND cs.branch_id=$${values.length}`;
    }
    if (query?.status) {
      values.push(query.status);
      where += ` AND cs.status=$${values.length}`;
    }
    if (auth.roles.includes("CASHIER") && !this.manager(auth)) {
      values.push(auth.userId);
      where += ` AND cs.cashier_user_id=$${values.length}`;
    }
    return (
      await this.db.query<any>(
        `SELECT cs.*,r.code register_code,d.code drawer_code FROM cash_sessions cs JOIN pos_registers r ON r.tenant_id=cs.tenant_id AND r.id=cs.register_id JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id WHERE cs.tenant_id=$1 AND ${where} ORDER BY opened_at DESC,id LIMIT 200`,
        values,
      )
    ).rows.map((row) => sessionView(row, auth));
  }

  async directory(auth: AccessClaims, input: unknown) {
    let query = cashSessionDirectoryQuerySchema.parse(input ?? {});
    this.assertTenant(auth);
    if (query.branchId) this.assertBranch(auth, query.branchId);

    // The history landing view follows the active branch's business date. A
    // caller can still opt into an explicit date range, or intentionally
    // search across all branches by omitting branchId.
    if (query.branchId && !query.businessDateFrom && !query.businessDateTo) {
      const branch = await this.db.query<{ timezone: string }>(
        "SELECT timezone FROM branches WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, query.branchId],
      );
      const timezone = branch.rows[0]?.timezone ?? "UTC";
      const businessDate = DateTime.now().setZone(timezone).toISODate();
      if (businessDate) {
        query = {
          ...query,
          businessDateFrom: businessDate,
          businessDateTo: businessDate,
        };
      }
    }

    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches];
    const filters = [
      "sr.tenant_id=$1",
      "($2::uuid[] IS NULL OR sr.branch_id=ANY($2::uuid[]))",
    ];
    if (auth.roles.includes("CASHIER") && !this.manager(auth)) {
      values.push(auth.userId);
      filters.push(`sr.cashier_user_id=$${values.length}`);
    }
    if (query.branchId) {
      values.push(query.branchId);
      filters.push(`sr.branch_id=$${values.length}`);
    }
    if (query.registerId) {
      values.push(query.registerId);
      filters.push(`sr.register_id=$${values.length}`);
    }
    if (query.cashierUserId) {
      values.push(query.cashierUserId);
      filters.push(`sr.cashier_user_id=$${values.length}`);
    }
    if (query.search) {
      values.push(`%${query.search.toLowerCase()}%`);
      const index = values.length;
      filters.push(
        `(lower(sr.id::text) LIKE $${index}
          OR lower(sr.register_code) LIKE $${index}
          OR lower(sr.register_name) LIKE $${index}
          OR lower(sr.cashier_display_name) LIKE $${index})`,
      );
    }
    if (query.status) {
      values.push(query.status);
      filters.push(`sr.status=$${values.length}`);
    }
    if (query.businessDateFrom) {
      values.push(query.businessDateFrom);
      filters.push(`sr.business_date >= $${values.length}::date`);
    }
    if (query.businessDateTo) {
      values.push(query.businessDateTo);
      filters.push(`sr.business_date <= $${values.length}::date`);
    }
    if (query.reconciliation === "MATCHED") {
      filters.push("sr.status='CLOSED' AND sr.variance_minor=0");
    } else if (query.reconciliation === "VARIANCE") {
      filters.push("sr.status='CLOSED' AND sr.variance_minor<>0");
    }
    if (query.varianceDirection === "SHORT") {
      filters.push("sr.status='CLOSED' AND sr.variance_minor<0");
    } else if (query.varianceDirection === "OVER") {
      filters.push("sr.status='CLOSED' AND sr.variance_minor>0");
    }
    const where = filters.join(" AND ");
    const cte = `
      WITH session_rows AS (
        SELECT cs.tenant_id,cs.id,cs.branch_id,cs.register_id,cs.cash_drawer_id,
               cs.cashier_user_id,cs.business_date,cs.timezone,cs.status,cs.opened_at,
               cs.opening_float_minor,cs.expected_cash_minor,cs.declared_cash_minor,
               cs.variance_minor,cs.variance_threshold_minor,cs.variance_reason,
               cs.variance_approved_by_user_id,cs.closing_started_at,cs.closed_at,
               cs.closed_by_user_id,cs.version,d.currency,
               r.code register_code,r.name register_name,
               b.name branch_name,
               cashier.display_name cashier_display_name,
               approver.display_name variance_approved_by_display_name,
               closer.display_name closed_by_display_name,
               COALESCE(metrics.transaction_count,0)::int transaction_count,
               COALESCE(metrics.session_sales_minor,0)::bigint session_sales_minor,
               COALESCE(metrics.total_captured_minor,0)::bigint total_captured_minor,
               COALESCE(metrics.cash_captured_minor,0)::bigint cash_captured_minor,
               COALESCE(metrics.payment_mix,'{}'::jsonb) payment_mix,
               COALESCE(movements.cash_out_minor,0)::bigint cash_out_minor,
               COALESCE(movements.cash_drop_minor,0)::bigint cash_drop_minor,
               COALESCE(refunds.cash_refund_minor,0)::bigint cash_refund_minor
          FROM cash_sessions cs
          JOIN pos_registers r ON r.tenant_id=cs.tenant_id AND r.id=cs.register_id
          JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id
          JOIN branches b ON b.tenant_id=cs.tenant_id AND b.id=cs.branch_id
          JOIN users cashier ON cashier.id=cs.cashier_user_id
          LEFT JOIN users approver ON approver.id=cs.variance_approved_by_user_id
          LEFT JOIN users closer ON closer.id=cs.closed_by_user_id
          LEFT JOIN LATERAL (
            WITH captured AS (
              SELECT p.pos_order_id,p.tender_type,p.captured_minor,
                     o.status order_status,(COALESCE(o.total_minor,0)+COALESCE(o.tip_minor,0)) order_total_minor
                FROM payments p
                JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
               WHERE p.tenant_id=cs.tenant_id AND p.status='CAPTURED'
                 AND p.register_id=cs.register_id AND p.created_by_user_id=cs.cashier_user_id
                 AND p.captured_at >= cs.opened_at
                 AND p.captured_at < COALESCE(cs.closed_at,now())
                 AND (p.tender_type<>'CASH' OR p.cash_session_id=cs.id)
            ), grouped AS (
              SELECT pos_order_id,MAX(order_status) order_status,MAX(order_total_minor)::bigint order_total_minor,
                     COALESCE(sum(captured_minor),0)::bigint captured_minor,
                     COALESCE(sum(captured_minor) FILTER (WHERE tender_type='CASH'),0)::bigint cash_captured_minor
                FROM captured GROUP BY pos_order_id
            ), mix AS (
              SELECT tender_type,COALESCE(sum(captured_minor),0)::bigint amount_minor,count(*)::int payment_count
                FROM captured GROUP BY tender_type
            )
            SELECT (SELECT count(*) FROM grouped)::int transaction_count,
                   COALESCE((SELECT sum(order_total_minor) FROM grouped WHERE order_status='PAID'),0)::bigint session_sales_minor,
                   COALESCE((SELECT sum(captured_minor) FROM grouped),0)::bigint total_captured_minor,
                   COALESCE((SELECT sum(cash_captured_minor) FROM grouped),0)::bigint cash_captured_minor,
                   COALESCE((SELECT jsonb_object_agg(mix.tender_type,jsonb_build_object('amountMinor',mix.amount_minor,'paymentCount',mix.payment_count)) FROM mix),'{}'::jsonb) payment_mix
          ) metrics ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.direction='OUT'),0)::bigint cash_out_minor,
                   COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_DROP' AND cm.direction='OUT'),0)::bigint cash_drop_minor
              FROM cash_movements cm
             WHERE cm.tenant_id=cs.tenant_id AND cm.cash_session_id=cs.id
          ) movements ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(rpa.completed_minor),0)::bigint cash_refund_minor
              FROM refund_payment_allocations rpa
             WHERE rpa.tenant_id=cs.tenant_id AND rpa.status='COMPLETED'
               AND rpa.tender_type='CASH'
               AND (rpa.execution_cash_session_id=cs.id OR rpa.cash_session_id=cs.id)
          ) refunds ON TRUE
         WHERE cs.tenant_id=$1
      )`;
    const countResult = await this.db.query<any>(
      `${cte}
       SELECT count(*)::int total,
              count(*) FILTER (WHERE sr.status='OPEN')::int open_count,
              count(*) FILTER (WHERE sr.status='CLOSING')::int closing_count,
              count(*) FILTER (WHERE sr.status='CLOSED')::int closed_count,
              count(*) FILTER (WHERE sr.status='CLOSED' AND sr.variance_minor=0)::int matched_count,
              count(*) FILTER (WHERE sr.status='CLOSED' AND sr.variance_minor<>0)::int variance_count,
              COALESCE(sum(sr.transaction_count),0)::int transaction_count,
              COALESCE(sum(sr.session_sales_minor) FILTER (WHERE sr.status='CLOSED'),0)::bigint reconciled_sales_minor,
              COALESCE(sum(sr.variance_minor) FILTER (WHERE sr.status='CLOSED'),0)::bigint net_variance_minor,
              count(*) FILTER (WHERE sr.status='CLOSED' AND sr.variance_minor<>0 AND sr.variance_minor<0)::int short_count,
              count(*) FILTER (WHERE sr.status='CLOSED' AND sr.variance_minor<>0 AND sr.variance_minor>0)::int over_count
         FROM session_rows sr
        WHERE ${where}`,
      values,
    );
    const count = countResult.rows[0] ?? {};
    const blindFinancialSort = auth.roles.includes("CASHIER") && !this.manager(auth);
    const orderBy = {
      NEWEST: "sr.opened_at DESC,sr.id DESC",
      OLDEST: "sr.opened_at ASC,sr.id ASC",
      REVENUE_DESC: `${blindFinancialSort ? "CASE WHEN sr.status='CLOSED' THEN sr.session_sales_minor ELSE NULL END" : "sr.session_sales_minor"} DESC NULLS LAST,sr.opened_at DESC,sr.id DESC`,
      REVENUE_ASC: `${blindFinancialSort ? "CASE WHEN sr.status='CLOSED' THEN sr.session_sales_minor ELSE NULL END" : "sr.session_sales_minor"} ASC NULLS LAST,sr.opened_at ASC,sr.id ASC`,
      VARIANCE_DESC: `${blindFinancialSort ? "CASE WHEN sr.status='CLOSED' THEN ABS(COALESCE(sr.variance_minor,0)) ELSE NULL END" : "ABS(COALESCE(sr.variance_minor,0))"} DESC NULLS LAST,sr.opened_at DESC,sr.id DESC`,
    }[query.sort];
    const offset = (query.page - 1) * query.pageSize;
    const rows = await this.db.query<any>(
      `${cte}
       SELECT sr.* FROM session_rows sr
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.pageSize, offset],
    );
    const items = rows.rows.map((row) => this.directoryItem(row, auth));
    const facetValues: unknown[] = [auth.tenantId, branches];
    const facetFilters = [
      "cs.tenant_id=$1",
      "($2::uuid[] IS NULL OR cs.branch_id=ANY($2::uuid[]))",
    ];
    if (auth.roles.includes("CASHIER") && !this.manager(auth)) {
      facetValues.push(auth.userId);
      facetFilters.push(`cs.cashier_user_id=$${facetValues.length}`);
    }
    const facetResult = await this.db.query<any>(
      `SELECT DISTINCT b.id branch_id,b.name branch_name,r.id register_id,r.code register_code,r.name register_name,
                      u.id cashier_user_id,u.display_name cashier_display_name
         FROM cash_sessions cs
         JOIN branches b ON b.tenant_id=cs.tenant_id AND b.id=cs.branch_id
         JOIN pos_registers r ON r.tenant_id=cs.tenant_id AND r.id=cs.register_id
         JOIN users u ON u.id=cs.cashier_user_id
        WHERE ${facetFilters.join(" AND ")}
        ORDER BY b.name,r.name,u.display_name`,
      facetValues,
    );
    const facets = {
      branches: Array.from(new Map(facetResult.rows.map((row) => [row.branch_id, { id: row.branch_id, name: row.branch_name }])).values()),
      registers: Array.from(new Map(facetResult.rows.map((row) => [row.register_id, { id: row.register_id, branchId: row.branch_id, code: row.register_code, name: row.register_name }])).values()),
      cashiers: Array.from(new Map(facetResult.rows.map((row) => [row.cashier_user_id, { id: row.cashier_user_id, displayName: row.cashier_display_name }])).values()),
    };
    const total = Number(count.total ?? 0);
    return {
      items,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      counts: {
        total,
        open: Number(count.open_count ?? 0),
        closing: Number(count.closing_count ?? 0),
        closed: Number(count.closed_count ?? 0),
        matched: Number(count.matched_count ?? 0),
        variance: Number(count.variance_count ?? 0),
      },
      periodSummary: {
        sessionCount: total,
        closedSessionCount: Number(count.closed_count ?? 0),
        transactionCount: Number(count.transaction_count ?? 0),
        reconciledSalesMinor: minorNumber(count.reconciled_sales_minor ?? 0),
        netVarianceMinor: Number(count.net_variance_minor ?? 0),
        shortSessionCount: Number(count.short_count ?? 0),
        overSessionCount: Number(count.over_count ?? 0),
      },
      facets,
      query,
      generatedAt: new Date().toISOString(),
    };
  }

  async directoryExport(auth: AccessClaims, input: unknown) {
    const parsed = cashSessionDirectoryQuerySchema.parse(input ?? {});
    const items: any[] = [];
    let page = 1;
    while (page <= 10000) {
      const result = await this.directory(auth, { ...parsed, page, pageSize: 100 });
      items.push(...result.items);
      if (page >= result.pagination.totalPages) break;
      page += 1;
    }
    const header = ["Ma phien", "Quay", "Nhan vien", "Ngay kinh doanh", "Bat dau", "Ket thuc", "Giao dich", "Doanh thu", "Du kien", "Thuc te", "Chenh lech", "Trang thai"];
    const rows = items.map((item) => [
      item.reference,
      item.registerName,
      item.cashierDisplayName,
      item.businessDate,
      item.openedAt,
      item.closedAt ?? "",
      item.transactionCount,
      item.sessionSalesMinor ?? "",
      item.expectedCashMinor ?? "",
      item.declaredCashMinor ?? "",
      item.varianceMinor ?? "",
      item.status,
    ]);
    return `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  }

  private directoryItem(row: any, auth: AccessClaims) {
    const view = sessionView(row, auth);
    const blind = Boolean(view.blindCount);
    const variance = view.varianceMinor;
    const reconciliation = view.status !== "CLOSED" ? "PENDING" : variance === 0 ? "MATCHED" : variance == null ? "PENDING" : "VARIANCE";
    return {
      id: view.id,
      reference: `#${String(view.id).slice(0, 8).toUpperCase()}…${String(view.id).slice(-4).toUpperCase()}`,
      branchId: view.branchId,
      branchName: row.branch_name,
      registerId: view.registerId,
      registerCode: row.register_code,
      registerName: row.register_name,
      cashierUserId: view.cashierUserId,
      cashierDisplayName: row.cashier_display_name,
      businessDate: view.businessDate,
      timezone: view.timezone,
      status: view.status,
      openedAt: view.openedAt,
      closingStartedAt: view.closingStartedAt,
      closedAt: view.closedAt,
      openingFloatMinor: view.openingFloatMinor,
      expectedCashMinor: view.expectedCashMinor,
      declaredCashMinor: view.declaredCashMinor,
      varianceMinor: view.varianceMinor,
      varianceThresholdMinor: view.varianceThresholdMinor,
      varianceReason: view.varianceReason,
      varianceApprovedByUserId: view.varianceApprovedByUserId,
      varianceApprovedByDisplayName: blind ? null : row.variance_approved_by_display_name,
      closedByUserId: blind ? null : row.closed_by_user_id,
      closedByDisplayName: blind ? null : row.closed_by_display_name,
      currency: view.currency,
      transactionCount: Number(row.transaction_count ?? 0),
      sessionSalesMinor: blind ? null : minorNumber(row.session_sales_minor ?? 0),
      totalCapturedMinor: blind ? null : minorNumber(row.total_captured_minor ?? 0),
      cashCapturedMinor: blind ? null : minorNumber(row.cash_captured_minor ?? 0),
      cashOutMinor: blind ? null : minorNumber(row.cash_out_minor ?? 0),
      cashRefundMinor: blind ? null : minorNumber(row.cash_refund_minor ?? 0),
      cashDropMinor: blind ? null : minorNumber(row.cash_drop_minor ?? 0),
      paymentMix: blind ? null : row.payment_mix ?? {},
      reconciliation,
      blindCount: blind,
    };
  }

  async detail(auth: AccessClaims, id: string) {
    const session = await this.session(auth, id);
    return { ...session, movements: await this.movements(auth, id) };
  }

  async sessionOverview(auth: AccessClaims, id: string, query: any = {}) {
    const row = await this.sessionRow(auth, id);
    const session = sessionView(row, auth);
    const openedAt = row.opened_at;
    const closedAt = row.closed_at ?? new Date();
    const search = String(query?.search ?? "").trim();
    const status = String(query?.status ?? "").trim();
    const page = Math.max(1, Math.min(10000, Number(query?.page ?? 1) || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query?.pageSize ?? 10) || 10));

    const attribution = `
      p.tenant_id=$1
      AND p.status='CAPTURED'
      AND p.register_id=$2
      AND p.created_by_user_id=$3
      AND p.captured_at >= $4::timestamptz
      AND p.captured_at < $5::timestamptz
      AND (p.tender_type <> 'CASH' OR p.cash_session_id=$6)
    `;
    const attributionParams = [
      auth.tenantId,
      row.register_id,
      row.cashier_user_id,
      openedAt,
      closedAt,
      row.id,
    ];
    const capturedCte = `
      WITH captured AS (
        SELECT p.id payment_id,p.tenant_id,p.pos_order_id,p.tender_type,p.captured_minor,
               p.cash_received_minor,p.captured_at,p.payment_reference,
               o.order_number,o.status order_status,
               (COALESCE(o.total_minor,0)+COALESCE(o.tip_minor,0)) order_total_minor,
               COALESCE(o.customer_snapshot_json->>'displayName',o.customer_snapshot_json->>'display_name','Khách vãng lai') customer_display_name
          FROM payments p
          JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
         WHERE ${attribution}
      )`;

    const [metricResult, mixResult, flowResult, pendingResult, partialResult, failedResult, invoiceResult, refundResult, activityResult, transactionResult] = await Promise.all([
      this.db.query<any>(
        `${capturedCte}, orders AS (
           SELECT pos_order_id,MAX(order_status) order_status,MAX(order_total_minor) order_total_minor
             FROM captured GROUP BY pos_order_id
         )
         SELECT (SELECT count(*) FROM orders)::int captured_order_count,
                (SELECT count(*) FROM orders WHERE order_status='PAID')::int paid_order_count,
                COALESCE((SELECT sum(order_total_minor) FROM orders WHERE order_status='PAID'),0)::bigint session_sales_minor,
                COALESCE((SELECT sum(captured_minor) FROM captured),0)::bigint total_captured_minor,
                COALESCE((SELECT sum(captured_minor) FROM captured WHERE tender_type='CASH'),0)::bigint cash_captured_minor,
                (SELECT count(*) FROM orders WHERE order_status='PARTIALLY_PAID')::int partial_order_count` ,
        attributionParams,
      ),
      this.db.query<any>(
        `${capturedCte}
         SELECT tender_type,COALESCE(sum(captured_minor),0)::bigint amount_minor,count(*)::int payment_count
           FROM captured GROUP BY tender_type ORDER BY tender_type`,
        attributionParams,
      ),
      this.db.query<any>(
        `SELECT
           COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='OPENING_FLOAT' AND cm.direction='IN'),0)::bigint opening_float_minor,
           COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_SALE' AND cm.direction='IN'),0)::bigint cash_sales_minor,
           COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_IN' AND cm.direction='IN'),0)::bigint cash_in_minor,
           COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_OUT' AND cm.direction='OUT'),0)::bigint cash_out_minor,
           COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_DROP' AND cm.direction='OUT'),0)::bigint cash_drop_minor,
           COALESCE(sum(cm.amount_minor) FILTER (WHERE cm.movement_type='CASH_REFUND' AND cm.direction='OUT'),0)::bigint cash_refund_minor
         FROM cash_movements cm
        WHERE cm.tenant_id=$1 AND cm.cash_session_id=$2`,
        [auth.tenantId, row.id],
      ),
      this.db.query<any>(
        `SELECT p.id payment_id,p.pos_order_id,p.payment_reference,p.status,p.requested_minor,p.created_at,
                o.order_number
           FROM payments p
           LEFT JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
          WHERE p.tenant_id=$1 AND p.cash_session_id=$2 AND p.status IN ('PENDING','AUTHORIZED')
          ORDER BY p.created_at DESC,p.id DESC`,
        [auth.tenantId, row.id],
      ),
      this.db.query<any>(
        `${capturedCte}
         SELECT DISTINCT ON (pos_order_id) pos_order_id,order_number,order_total_minor,customer_display_name,captured_at
           FROM captured WHERE order_status='PARTIALLY_PAID'
          ORDER BY pos_order_id,captured_at DESC`,
        attributionParams,
      ),
      this.db.query<any>(
        `SELECT p.id payment_id,p.pos_order_id,p.payment_reference,p.requested_minor,
                COALESCE(p.failed_at,p.created_at) occurred_at,o.order_number
           FROM payments p
           JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
          WHERE p.tenant_id=$1 AND p.status='FAILED'
            AND p.register_id=$2 AND p.created_by_user_id=$3
            AND COALESCE(p.failed_at,p.created_at) >= $4::timestamptz
            AND COALESCE(p.failed_at,p.created_at) < $5::timestamptz
          ORDER BY occurred_at DESC,p.id DESC LIMIT 25`,
        attributionParams.slice(0, 5),
      ),
      this.db.query<any>(
        `${capturedCte}
         SELECT DISTINCT ON (pos_order_id) pos_order_id,order_number,order_total_minor,customer_display_name
           FROM captured
          WHERE order_status='PAID'
            AND NOT EXISTS (
              SELECT 1 FROM invoices i
               WHERE i.tenant_id=captured.tenant_id AND i.pos_order_id=captured.pos_order_id AND i.status='ISSUED'
            )
          ORDER BY pos_order_id,captured_at DESC`,
        attributionParams,
      ),
      this.db.query<any>(
        `SELECT r.id,r.refund_reference,r.status,r.currency,
                COALESCE(sum(a.completed_minor),0)::bigint amount_minor,
                MAX(a.completed_at) occurred_at,MAX(r.reason_code) reason_code
           FROM refund_payment_allocations a
           JOIN refunds r ON r.tenant_id=a.tenant_id AND r.id=a.refund_id
          WHERE a.tenant_id=$1
            AND a.status='COMPLETED'
            AND (a.execution_cash_session_id=$2 OR a.cash_session_id=$2)
          GROUP BY r.id,r.refund_reference,r.status,r.currency
          ORDER BY occurred_at DESC,r.id DESC`,
        [auth.tenantId, row.id],
      ),
      this.db.query<any>(
        `SELECT id,event_type type,occurred_at,amount_minor,currency,NULL::uuid order_id,NULL::uuid payment_id,NULL::uuid refund_id
           FROM financial_events
          WHERE tenant_id=$1 AND aggregate_type='cash_session' AND aggregate_id=$2
         UNION ALL
         SELECT cm.id,'CASH_MOVEMENT',cm.occurred_at,cm.amount_minor,cm.currency,NULL::uuid,NULL::uuid,cm.related_refund_id
           FROM cash_movements cm
          WHERE cm.tenant_id=$1 AND cm.cash_session_id=$2
         UNION ALL
         SELECT p.id,'PAYMENT_CAPTURED',p.captured_at,p.captured_minor,p.currency,p.pos_order_id,p.id,NULL::uuid
           FROM payments p
          WHERE p.tenant_id=$1 AND p.cash_session_id=$2 AND p.status='CAPTURED'
         ORDER BY occurred_at DESC NULLS LAST,id DESC LIMIT 20`,
        [auth.tenantId, row.id],
      ),
      this.sessionTransactions(attribution, attributionParams, search, status, page, pageSize, Boolean(session.blindCount)),
    ]);

    const metric = metricResult.rows[0] ?? {};
    const hidden = Boolean(session.blindCount);
    const cashFlowRow = flowResult.rows[0] ?? {};
    const cashFlow = hidden
      ? {
          openingFloatMinor: null,
          cashSalesMinor: null,
          cashInMinor: null,
          cashOutMinor: null,
          cashDropMinor: null,
          cashRefundMinor: null,
          expectedCashMinor: null,
        }
      : {
          openingFloatMinor: minorNumber(cashFlowRow.opening_float_minor ?? 0),
          cashSalesMinor: minorNumber(cashFlowRow.cash_sales_minor ?? 0),
          cashInMinor: minorNumber(cashFlowRow.cash_in_minor ?? 0),
          cashOutMinor: minorNumber(cashFlowRow.cash_out_minor ?? 0),
          cashDropMinor: minorNumber(cashFlowRow.cash_drop_minor ?? 0),
          cashRefundMinor: minorNumber(cashFlowRow.cash_refund_minor ?? 0),
          expectedCashMinor: session.expectedCashMinor,
        };
    const attention: any[] = [];
    pendingResult.rows.forEach((item) => attention.push({
      code: "PENDING_PAYMENT",
      severity: "BLOCKING",
      blocking: true,
      message: `Thanh toán ${item.payment_reference ?? item.order_number ?? item.payment_id} chưa hoàn tất.`,
      paymentId: item.payment_id,
      orderId: item.pos_order_id,
      amountMinor: hidden ? null : minorNumber(item.requested_minor ?? 0),
    }));
    partialResult.rows.forEach((item) => attention.push({
      code: "PARTIAL_ORDER",
      severity: "WARNING",
      blocking: false,
      message: `Đơn ${item.order_number ?? item.pos_order_id} mới thanh toán một phần.`,
      orderId: item.pos_order_id,
      amountMinor: hidden ? null : minorNumber(item.order_total_minor ?? 0),
    }));
    failedResult.rows.forEach((item) => attention.push({
      code: "FAILED_PAYMENT",
      severity: "WARNING",
      blocking: false,
      message: `Thanh toán ${item.payment_reference ?? item.order_number ?? item.payment_id} bị lỗi.`,
      paymentId: item.payment_id,
      orderId: item.pos_order_id,
      amountMinor: hidden ? null : minorNumber(item.requested_minor ?? 0),
    }));
    invoiceResult.rows.forEach((item) => attention.push({
      code: "UNISSUED_INVOICE",
      severity: "WARNING",
      blocking: false,
      message: `Đơn ${item.order_number ?? item.pos_order_id} chưa phát hành hóa đơn.`,
      orderId: item.pos_order_id,
      amountMinor: hidden ? null : minorNumber(item.order_total_minor ?? 0),
    }));

    const activity = activityResult.rows.map((item) => ({
      id: item.id,
      type: item.type,
      occurredAt: item.occurred_at,
      amountMinor: hidden || item.amount_minor == null ? null : minorNumber(item.amount_minor),
      currency: item.currency ?? row.currency,
      orderId: item.order_id,
      paymentId: item.payment_id,
      refundId: item.refund_id,
      label: activityLabel(item.type),
    }));
    const refunds = refundResult.rows.map((item) => ({
      id: item.id,
      refundReference: item.refund_reference,
      status: item.status,
      currency: item.currency ?? row.currency,
      amountMinor: hidden ? null : minorNumber(item.amount_minor ?? 0),
      occurredAt: item.occurred_at,
      reasonCode: item.reason_code,
    }));
    const blockers = attention.filter((item) => item.blocking);
    return {
      session,
      register: {
        id: row.register_id,
        code: row.register_code,
        name: row.register_name ?? row.register_code,
        branchId: row.branch_id,
        branchName: row.branch_name ?? row.branch_id,
      },
      cashier: {
        id: row.cashier_user_id,
        displayName: row.cashier_display_name ?? row.cashier_user_id,
      },
      metrics: {
        paidOrderCount: Number(metric.paid_order_count ?? 0),
        capturedOrderCount: Number(metric.captured_order_count ?? 0),
        sessionSalesMinor: hidden ? null : minorNumber(metric.session_sales_minor ?? 0),
        totalCapturedMinor: hidden ? null : minorNumber(metric.total_captured_minor ?? 0),
        cashCapturedMinor: hidden ? null : minorNumber(metric.cash_captured_minor ?? 0),
        partialOrderCount: Number(metric.partial_order_count ?? 0),
        paymentMix: hidden
          ? null
          : Object.fromEntries(mixResult.rows.map((item) => [item.tender_type, {
              amountMinor: minorNumber(item.amount_minor ?? 0),
              paymentCount: Number(item.payment_count ?? 0),
            }])),
      },
      cashFlow,
      movements: await this.movements(auth, id),
      refunds,
      attention,
      closingReadiness: {
        canBeginClosing: session.status === "OPEN" && blockers.length === 0,
        blockers,
        warnings: attention.filter((item) => !item.blocking),
      },
      recentActivity: activity,
      transactions: transactionResult,
      generatedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  }

  private async sessionTransactions(
    attribution: string,
    attributionParams: any[],
    search: string,
    status: string,
    page: number,
    pageSize: number,
    hidden: boolean,
  ) {
    const filters: string[] = [];
    const values = [...attributionParams];
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(order_number ILIKE $${values.length} OR customer_display_name ILIKE $${values.length})`);
    }
    if (status && ["DRAFT", "READY_FOR_PAYMENT", "PARTIALLY_PAID", "PAID", "VOIDED", "EXPIRED"].includes(status)) {
      values.push(status);
      filters.push(`order_status=$${values.length}`);
    }
    const grouped = `
      WITH captured AS (
        SELECT p.id payment_id,p.pos_order_id,p.tender_type,p.captured_minor,
               p.captured_at,p.payment_reference,
               o.order_number,o.status order_status,
               (COALESCE(o.total_minor,0)+COALESCE(o.tip_minor,0)) order_total_minor,
               COALESCE(o.customer_snapshot_json->>'displayName',o.customer_snapshot_json->>'display_name','Khách vãng lai') customer_display_name
          FROM payments p
          JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
         WHERE ${attribution}
      ), grouped AS (
        SELECT pos_order_id,MAX(order_number) order_number,MAX(customer_display_name) customer_display_name,
               MAX(order_status) order_status,MAX(order_total_minor)::bigint order_total_minor,
               COALESCE(sum(captured_minor),0)::bigint captured_minor,
               COALESCE(sum(captured_minor) FILTER (WHERE tender_type='CASH'),0)::bigint cash_captured_minor,
               array_agg(DISTINCT tender_type ORDER BY tender_type) payment_methods,
               MAX(captured_at) captured_at,MAX(payment_reference) payment_reference
          FROM captured GROUP BY pos_order_id
      )`;
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await this.db.query<any>(`${grouped} SELECT count(*)::int total FROM grouped ${where}`, values);
    const total = Number(countResult.rows[0]?.total ?? 0);
    const offset = (page - 1) * pageSize;
    const rows = await this.db.query<any>(
      `${grouped}
       SELECT pos_order_id,order_number,customer_display_name,order_status,order_total_minor,
              captured_minor,cash_captured_minor,payment_methods,captured_at,payment_reference
         FROM grouped ${where}
        ORDER BY captured_at DESC NULLS LAST,pos_order_id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    return {
      items: rows.rows.map((item) => ({
        orderId: item.pos_order_id,
        orderNumber: item.order_number,
        customerDisplayName: item.customer_display_name,
        status: item.order_status,
        capturedAt: item.captured_at,
        paymentReference: item.payment_reference,
        paymentMethods: item.payment_methods ?? [],
        totalMinor: hidden ? null : minorNumber(item.order_total_minor ?? 0),
        capturedMinor: hidden ? null : minorNumber(item.captured_minor ?? 0),
        cashCapturedMinor: hidden ? null : minorNumber(item.cash_captured_minor ?? 0),
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      query: { search, status: status || null },
    };
  }

  async closingReview(auth: AccessClaims, id: string) {
    if (!this.manager(auth))
      throw new ForbiddenException({
        code: "FINANCIAL_PERMISSION_DENIED",
        message: "Manager permission is required",
      });
    const row = await this.sessionRow(auth, id);
    return {
      ...sessionView(row, auth, true),
      movements: await this.movements(auth, id),
    };
  }

  async movements(auth: AccessClaims, id: string) {
    const session = await this.session(auth, id);
    return (
      await this.db.query<any>(
        "SELECT * FROM cash_movements WHERE tenant_id=$1 AND cash_session_id=$2 ORDER BY occurred_at,id",
        [auth.tenantId, id],
      )
    ).rows.map((row) => movementView(row, session.blindCount));
  }

  async open(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashSessionOpenSchema.parse(input);
    this.assertTenant(auth);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "cash_session.open",
          key,
          request: body,
          work: async () => {
            const register = (
              await client.query<any>(
                `SELECT r.*,b.status branch_status,b.timezone,bs.currency,bs.tax_policy_json FROM pos_registers r JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id JOIN branch_settings bs ON bs.tenant_id=r.tenant_id AND bs.branch_id=r.branch_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r`,
                [auth.tenantId, body.registerId],
              )
            ).rows[0];
            if (!register || register.status !== "ACTIVE")
              throw new NotFoundException({
                code: "CASH_REGISTER_NOT_FOUND",
                message: "Active register not found",
              });
            this.assertBranch(auth, register.branch_id);
            await this.registerDevice.assertRegisterAccess({
              auth,
              registerId: body.registerId,
              branchId: register.branch_id,
              client,
            });
            if (register.branch_status !== "ACTIVE")
              throw new ConflictException({
                code: "FINANCIAL_BRANCH_INACTIVE",
                message: "Branch is inactive",
              });
            const drawer = (
              await client.query<any>(
                "SELECT * FROM cash_drawers WHERE tenant_id=$1 AND id=$2 AND register_id=$3 FOR UPDATE",
                [auth.tenantId, body.cashDrawerId, body.registerId],
              )
            ).rows[0];
            if (!drawer || drawer.status !== "ACTIVE")
              throw new NotFoundException({
                code: "CASH_DRAWER_NOT_FOUND",
                message: "Active cash drawer not found",
              });
            if (drawer.currency !== register.currency)
              throw new ConflictException({
                code: "CASH_SESSION_CURRENCY_MISMATCH",
                message: "Drawer currency differs from branch currency",
              });
            const opening = BigInt(body.openingFloatMinor);
            const threshold = BigInt(
              register.tax_policy_json?.cashVarianceThresholdMinor ?? 5000,
            );
            const businessDate = DateTime.now()
              .setZone(register.timezone)
              .toISODate()!;
            let row: any;
            try {
              row = (
                await client.query<any>(
                  `INSERT INTO cash_sessions(tenant_id,branch_id,register_id,cash_drawer_id,cashier_user_id,business_date,timezone,status,opening_float_minor,expected_cash_minor,variance_threshold_minor) VALUES($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$8,$9) RETURNING *`,
                  [
                    auth.tenantId,
                    register.branch_id,
                    body.registerId,
                    body.cashDrawerId,
                    auth.userId,
                    businessDate,
                    register.timezone,
                    opening.toString(),
                    threshold.toString(),
                  ],
                )
              ).rows[0];
            } catch (error: any) {
              if (error?.code === "23505")
                throw new ConflictException({
                  code: "CASH_SESSION_ALREADY_OPEN",
                  message:
                    "Drawer or cashier already has an active cash session",
                });
              throw error;
            }
            row.currency = drawer.currency;
            if (opening > 0n)
              await client.query(
                `INSERT INTO cash_movements(tenant_id,branch_id,cash_session_id,movement_type,direction,amount_minor,currency,reason_code,actor_user_id,request_id) VALUES($1,$2,$3,'OPENING_FLOAT','IN',$4,$5,'OPEN_SESSION',$6,$7)`,
                [
                  auth.tenantId,
                  register.branch_id,
                  row.id,
                  opening.toString(),
                  drawer.currency,
                  auth.userId,
                  requestId,
                ],
              );
            await this.record(
              client,
              auth,
              row,
              "cash_session.opened",
              requestId,
              key,
              opening,
              { businessDate },
            );
            return sessionView(row, auth);
          },
        }),
      )
    ).data;
  }

  async move(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashMovementSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.move_cash",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "OPEN") throw state();
        const policy = session.tax_policy_json ?? {};
        if (
          BigInt(body.amountMinor) >
            BigInt(policy.cashMovementApprovalThresholdMinor ?? 100000) &&
          !this.manager(auth)
        )
          throw new ForbiddenException({
            code: "FINANCIAL_PERMISSION_DENIED",
            message: "Manager approval is required for this cash movement",
          });
        const direction = body.movementType === "CASH_IN" ? "IN" : "OUT";
        if (
          direction === "OUT" &&
          BigInt(body.amountMinor) > BigInt(session.expected_cash_minor)
        )
          throw new ConflictException({
            code: "CASH_MOVEMENT_INVALID",
            message: "Cash movement cannot make expected cash negative",
          });
        const movement = (
          await client.query<any>(
            `INSERT INTO cash_movements(tenant_id,branch_id,cash_session_id,movement_type,direction,amount_minor,currency,reason_code,note,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
              auth.tenantId,
              session.branch_id,
              id,
              body.movementType,
              direction,
              body.amountMinor,
              session.currency,
              body.reasonCode,
              body.note ?? null,
              auth.userId,
              requestId,
            ],
          )
        ).rows[0];
        const updated = await this.refreshExpected(client, auth, id);
        await this.record(
          client,
          auth,
          updated,
          "cash_movement.created",
          requestId,
          key,
          BigInt(body.amountMinor),
          {
            movementId: movement.id,
            movementType: body.movementType,
            direction,
            reasonCode: body.reasonCode,
          },
        );
        return {
          session: sessionView(updated, auth),
          movement: movementView(movement),
        };
      },
    );
  }

  async beginClosing(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashSessionVersionSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.begin_close",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "OPEN") throw state();
        const pending = await client.query(
          `SELECT 1 FROM payments WHERE tenant_id=$1 AND cash_session_id=$2 AND status IN ('PENDING','AUTHORIZED') LIMIT 1`,
          [auth.tenantId, id],
        );
        if (pending.rowCount)
          throw new ConflictException({
            code: "CASH_SESSION_STATUS_INVALID",
            message: "Pending payment prevents closing",
          });
        await this.refreshExpected(client, auth, id);
        const updated = {
          ...(
            await client.query<any>(
              "UPDATE cash_sessions SET status='CLOSING',closing_started_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [auth.tenantId, id],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.closing_started",
          requestId,
          key,
        );
        return sessionView(updated, auth);
      },
    );
  }

  async declare(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashDeclareSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.declare",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "CLOSING") throw state();
        if (body.denominations) {
          const counted = body.denominations.reduce(
            (total, row) =>
              total + BigInt(row.denominationMinor) * BigInt(row.count),
            0n,
          );
          if (counted !== BigInt(body.declaredCashMinor))
            throw new ConflictException({
              code: "CASH_SESSION_COUNT_MISMATCH",
              message: "Denomination count does not equal declared cash",
            });
        }
        const expected = BigInt(session.expected_cash_minor);
        const declared = BigInt(body.declaredCashMinor);
        const updated = {
          ...(
            await client.query<any>(
              "UPDATE cash_sessions SET declared_cash_minor=$3,variance_minor=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [
                auth.tenantId,
                id,
                declared.toString(),
                (declared - expected).toString(),
              ],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.declared",
          requestId,
          key,
          declared,
          { denominationCount: body.denominations?.length ?? 0 },
        );
        return sessionView(updated, auth);
      },
    );
  }

  async reopen(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashSessionVersionSchema.parse(input);
    if (!this.manager(auth))
      throw new ForbiddenException({
        code: "FINANCIAL_PERMISSION_DENIED",
        message: "Manager permission is required",
      });
    return this.command(
      auth,
      id,
      "cash_session.reopen",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "CLOSING") throw state();
        const updated = {
          ...(
            await client.query<any>(
              "UPDATE cash_sessions SET status='OPEN',closing_started_at=NULL,declared_cash_minor=NULL,variance_minor=NULL,variance_reason=NULL,variance_approved_by_user_id=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [auth.tenantId, id],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.reopened",
          requestId,
          key,
        );
        return sessionView(updated, auth);
      },
    );
  }

  async close(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashCloseSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.close",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "CLOSING" || session.declared_cash_minor == null)
          throw state();
        session = await this.refreshExpected(client, auth, id);
        const variance =
          BigInt(session.declared_cash_minor) -
          BigInt(session.expected_cash_minor);
        const high = abs(variance) > BigInt(session.variance_threshold_minor);
        if (
          high &&
          (!this.manager(auth) || !body.approveVariance || !body.varianceReason)
        )
          throw new ConflictException({
            code: "CASH_SESSION_VARIANCE_APPROVAL_REQUIRED",
            message:
              "Manager approval and reason are required for high variance",
          });
        if (high && session.cashier_user_id === auth.userId)
          throw new ForbiddenException({
            code: "FINANCIAL_PERMISSION_DENIED",
            message: "Cashier cannot approve an own high variance",
          });
        const updated = {
          ...(
            await client.query<any>(
              `UPDATE cash_sessions SET status='CLOSED',variance_minor=$3,variance_reason=$4,variance_approved_by_user_id=$5,closed_at=now(),closed_by_user_id=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
              [
                auth.tenantId,
                id,
                variance.toString(),
                body.varianceReason ?? null,
                high ? auth.userId : null,
                auth.userId,
              ],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.closed",
          requestId,
          key,
          BigInt(updated.declared_cash_minor),
          { varianceMinor: variance.toString(), varianceApproved: high },
        );
        return sessionView(updated, auth);
      },
    );
  }

  private async command<T>(
    auth: AccessClaims,
    id: string,
    command: string,
    key: string,
    request: unknown,
    requestId: string,
    work: (client: PoolClient, session: any) => Promise<T>,
  ) {
    this.assertTenant(auth);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command,
          key,
          request: { id, ...(request as any) },
          work: async () => {
            const session = await this.lockSession(client, auth, id);
            await this.registerDevice.assertRegisterAccess({
              auth,
              registerId: session.register_id,
              branchId: session.branch_id,
              client,
            });
            return work(client, session);
          },
        }),
      )
    ).data;
  }
  private async lockSession(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
  ) {
    const row = (
      await client.query<any>(
        `SELECT cs.*,d.currency,b.status branch_status,bs.tax_policy_json FROM cash_sessions cs JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id JOIN branches b ON b.tenant_id=cs.tenant_id AND b.id=cs.branch_id JOIN branch_settings bs ON bs.tenant_id=cs.tenant_id AND bs.branch_id=cs.branch_id WHERE cs.tenant_id=$1 AND cs.id=$2 FOR UPDATE OF cs`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
    this.assertBranch(auth, row.branch_id);
    this.assertOwn(auth, row);
    if (row.branch_status !== "ACTIVE")
      throw new ConflictException({
        code: "FINANCIAL_BRANCH_INACTIVE",
        message: "Branch is inactive",
      });
    return row;
  }
  private async sessionRow(auth: AccessClaims, id: string) {
    this.assertTenant(auth);
    const row = (
      await this.db.query<any>(
        `SELECT cs.*,d.currency,r.code register_code,r.name register_name,d.code drawer_code,
                b.name branch_name,u.display_name cashier_display_name
           FROM cash_sessions cs
           JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id
           JOIN pos_registers r ON r.tenant_id=cs.tenant_id AND r.id=cs.register_id
           JOIN branches b ON b.tenant_id=cs.tenant_id AND b.id=cs.branch_id
           JOIN users u ON u.id=cs.cashier_user_id
          WHERE cs.tenant_id=$1 AND cs.id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
    this.assertBranch(auth, row.branch_id);
    this.assertOwn(auth, row);
    return row;
  }
  private async session(auth: AccessClaims, id: string) {
    return sessionView(await this.sessionRow(auth, id), auth);
  }
  private async refreshExpected(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
  ) {
    return (
      (
        await client.query<any>(
          `UPDATE cash_sessions cs SET expected_cash_minor=COALESCE(m.expected,0),version=version+1,updated_at=now() FROM (SELECT cash_session_id,sum(CASE WHEN direction='IN' THEN amount_minor ELSE -amount_minor END) expected FROM cash_movements WHERE tenant_id=$1 AND cash_session_id=$2 GROUP BY cash_session_id)m WHERE cs.tenant_id=$1 AND cs.id=$2 AND cs.id=m.cash_session_id RETURNING cs.*,(SELECT currency FROM cash_drawers d WHERE d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id) currency`,
          [auth.tenantId, id],
        )
      ).rows[0] ??
      (
        await client.query<any>(
          "SELECT cs.*,(SELECT currency FROM cash_drawers d WHERE d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id) currency FROM cash_sessions cs WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id],
        )
      ).rows[0]
    );
  }
  private async record(
    client: PoolClient,
    auth: AccessClaims,
    session: any,
    event: string,
    requestId: string,
    key: string,
    amount?: bigint,
    payload: Record<string, unknown> = {},
  ) {
    await this.evidence.record(client, {
      auth,
      branchId: session.branch_id,
      event,
      aggregateType: "cash_session",
      aggregateId: session.id,
      aggregateVersion: Number(session.version),
      requestId,
      currency: session.currency,
      amountMinor: amount,
      registerId: session.register_id,
      idempotencyKey: key,
      payload: {
        cashSessionId: session.id,
        status: session.status,
        ...payload,
      },
    });
  }
  private assertTenant(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support Access Grant is required",
      });
  }
  private assertBranch(auth: AccessClaims, id: string) {
    if (!auth.roles.includes("SALON_OWNER") && !auth.branchIds.includes(id))
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
  }
  private assertOwn(auth: AccessClaims, row: any) {
    if (
      auth.roles.includes("CASHIER") &&
      !this.manager(auth) &&
      row.cashier_user_id !== auth.userId
    )
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
  }
  private manager(auth: AccessClaims) {
    return auth.roles.some(
      (role) => role === "SALON_OWNER" || role === "BRANCH_MANAGER",
    );
  }
  private assertVersion(row: any, version: number) {
    if (Number(row.version) !== version)
      throw new ConflictException({
        code: "VERSION_CONFLICT",
        message: "Cash session version changed",
      });
  }
}

const state = () =>
  new ConflictException({
    code: "CASH_SESSION_STATUS_INVALID",
    message: "Cash session state does not allow this command",
  });
const abs = (value: bigint) => (value < 0n ? -value : value);
function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function activityLabel(type: string) {
  const labels: Record<string, string> = {
    PAYMENT_CAPTURED: "Đã ghi nhận thanh toán",
    CASH_MOVEMENT: "Đã cập nhật dòng tiền mặt",
    CASH_SESSION_OPENED: "Đã mở phiên thu ngân",
    CASH_SESSION_UPDATED: "Đã cập nhật phiên thu ngân",
    CLOSING_STARTED: "Đã bắt đầu quy trình đóng phiên",
  };
  return labels[type] ?? "Đã ghi nhận hoạt động tài chính";
}
function sessionView(row: any, auth: AccessClaims, reveal = false) {
  const blind =
    !reveal &&
    auth.roles.includes("CASHIER") &&
    !auth.roles.some(
      (role) => role === "SALON_OWNER" || role === "BRANCH_MANAGER",
    ) &&
    row.cashier_user_id === auth.userId &&
    ["OPEN", "CLOSING"].includes(row.status);
  return {
    id: row.id,
    branchId: row.branch_id,
    registerId: row.register_id,
    registerCode: row.register_code,
    cashDrawerId: row.cash_drawer_id,
    drawerCode: row.drawer_code,
    cashierUserId: row.cashier_user_id,
    businessDate: row.business_date,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status,
    blindCount: blind,
    openedAt: row.opened_at,
    openingFloatMinor: blind ? null : minorNumber(row.opening_float_minor),
    expectedCashMinor: blind ? null : minorNumber(row.expected_cash_minor),
    declaredCashMinor:
      row.declared_cash_minor == null
        ? null
        : minorNumber(row.declared_cash_minor),
    varianceMinor:
      blind || row.variance_minor == null ? null : Number(row.variance_minor),
    varianceThresholdMinor: minorNumber(row.variance_threshold_minor),
    varianceReason: blind ? null : row.variance_reason,
    varianceApprovedByUserId: blind ? null : row.variance_approved_by_user_id,
    closingStartedAt: row.closing_started_at,
    closedAt: row.closed_at,
    version: Number(row.version),
  };
}
function movementView(row: any, blind = false) {
  return {
    id: row.id,
    cashSessionId: row.cash_session_id,
    movementType: row.movement_type,
    direction: row.direction,
    amountMinor: blind ? null : minorNumber(row.amount_minor),
    currency: row.currency,
    relatedPaymentId: row.related_payment_id,
    reasonCode: row.reason_code,
    note: row.note,
    occurredAt: row.occurred_at,
  };
}
