/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  customerCreditDirectoryQuerySchema,
  customerCreditLedgerDirectoryQuerySchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

const amount = (value: unknown) => (value == null ? null : String(value));

/**
 * Read-only Customer Credit projections.  The legacy Customer Credit endpoints
 * intentionally remain on StoredValueService; this service only owns the
 * additive directory/detail read models used by the admin workspace.
 */
@Injectable()
export class CustomerCreditReportingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((role) => ["SALON_OWNER", "BRANCH_MANAGER"].includes(role))
    ) {
      throw new ForbiddenException({
        code: "STORED_VALUE_PERMISSION_DENIED",
        message: "Platform support requires an explicit tenant access grant",
      });
    }
  }

  private scopedBranches(auth: AccessClaims) {
    return auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
  }

  private async ownCustomerId(auth: AccessClaims) {
    if (!auth.roles.includes("CUSTOMER")) return null;
    const row = (
      await this.db.query<any>(
        `SELECT c.id
           FROM users u
           JOIN customers c ON c.tenant_id=$1
            AND ((u.phone_normalized IS NOT NULL AND c.phone_normalized=u.phone_normalized)
              OR (u.email IS NOT NULL AND lower(c.email_normalized)=lower(u.email)))
          WHERE u.id=$2
          LIMIT 1`,
        [auth.tenantId, auth.userId],
      )
    ).rows[0];
    if (!row) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND" });
    return row.id as string;
  }

  private async permissions(auth: AccessClaims) {
    if (auth.supportAccess) return new Set(auth.supportAccess.permissions);
    const rows = (
      await this.db.query<any>(
        `SELECT DISTINCT rp.permission_code
           FROM membership_roles mr
           JOIN role_permissions rp ON rp.role=mr.role
          WHERE mr.membership_id=$1`,
        [auth.membershipId],
      )
    ).rows;
    return new Set<string>(rows.map((row) => row.permission_code));
  }

  private baseCte() {
    return `
      WITH ledger_metrics AS (
        SELECT l.account_id,
          MAX(l.occurred_at) AS last_activity_at,
          COALESCE(SUM(ABS(l.redeemed_delta_minor)) FILTER (
            WHERE l.entry_type='REDEEM' AND l.occurred_at>=date_trunc('month',now())
          ),0)::bigint AS redeemed_this_period_minor,
          COUNT(*) FILTER (
            WHERE l.entry_type='REDEEM' AND l.occurred_at>=date_trunc('month',now())
          )::int AS redeemed_this_period_count,
          COALESCE(SUM(
            CASE
              WHEN l.entry_type IN ('MANUAL_CREDIT','SERVICE_RECOVERY_CREDIT')
                THEN GREATEST(l.available_delta_minor,0)
              WHEN l.entry_type='REFUND_RESTORE' AND ra.destination='CUSTOMER_CREDIT'
                THEN GREATEST(l.available_delta_minor,0)
              ELSE 0
            END
          ) FILTER (WHERE l.occurred_at>=date_trunc('month',now())),0)::bigint AS credit_issued_this_period_minor,
          COALESCE(SUM(
            CASE
              WHEN l.entry_type IN ('MANUAL_CREDIT','SERVICE_RECOVERY_CREDIT')
                THEN GREATEST(l.available_delta_minor,0)
              WHEN l.entry_type='REFUND_RESTORE' AND ra.destination='CUSTOMER_CREDIT'
                THEN GREATEST(l.available_delta_minor,0)
              ELSE 0
            END
          ),0)::bigint AS lifetime_issued_from_ledger
        FROM stored_value_ledger_entries l
        LEFT JOIN stored_value_refund_allocations ra
          ON ra.tenant_id=l.tenant_id AND ra.ledger_entry_id=l.id
        WHERE l.tenant_id=$1
          AND ($2::uuid[] IS NULL OR l.branch_id=ANY($2::uuid[]))
        GROUP BY l.account_id
      ), latest_activity AS (
        SELECT DISTINCT ON (l.account_id)
          l.account_id,l.id ledger_entry_id,l.entry_type,l.occurred_at,
           l.available_delta_minor,l.reserved_delta_minor,l.redeemed_delta_minor,
           (l.pending_delta_minor+l.available_delta_minor+l.reserved_delta_minor+
            l.redeemed_delta_minor+l.expired_delta_minor+l.cancelled_delta_minor)::bigint latest_delta_minor,
          l.order_id,l.invoice_id,l.payment_id,l.refund_id,l.credit_note_id,
          l.reservation_id,l.adjustment_request_id,l.actor_user_id,l.branch_id,
          o.order_number,inv.invoice_number,p.payment_reference,
          r.refund_reference,cn.credit_note_number,
          u.display_name actor_name,b.name branch_name,
          ra.destination refund_destination
        FROM stored_value_ledger_entries l
        LEFT JOIN pos_orders o ON o.tenant_id=l.tenant_id AND o.id=l.order_id
        LEFT JOIN invoices inv ON inv.tenant_id=l.tenant_id AND inv.id=l.invoice_id
        LEFT JOIN payments p ON p.tenant_id=l.tenant_id AND p.id=l.payment_id
        LEFT JOIN refunds r ON r.tenant_id=l.tenant_id AND r.id=l.refund_id
        LEFT JOIN credit_notes cn ON cn.tenant_id=l.tenant_id AND cn.id=l.credit_note_id
        LEFT JOIN users u ON u.id=l.actor_user_id
        LEFT JOIN branches b ON b.tenant_id=l.tenant_id AND b.id=l.branch_id
        LEFT JOIN LATERAL (
          SELECT x.destination
            FROM stored_value_refund_allocations x
           WHERE x.tenant_id=l.tenant_id AND x.ledger_entry_id=l.id
           ORDER BY x.created_at DESC,x.id DESC
           LIMIT 1
        ) ra ON true
        WHERE l.tenant_id=$1
          AND ($2::uuid[] IS NULL OR l.branch_id=ANY($2::uuid[]))
        ORDER BY l.account_id,l.occurred_at DESC,l.id DESC
      ), raw AS (
        SELECT
          a.id account_id,a.tenant_id,a.customer_id,a.currency,a.status account_status,
          a.pending_minor,a.available_minor,a.reserved_minor,a.redeemed_minor,
          a.expired_minor,a.cancelled_minor,a.lifetime_issued_minor,a.lifetime_redeemed_minor,
          a.version,a.created_at,a.updated_at,
          c.display_name customer_name,
          lm.last_activity_at,
          COALESCE(lm.redeemed_this_period_minor,0)::bigint redeemed_this_period_minor,
          COALESCE(lm.redeemed_this_period_count,0)::int redeemed_this_period_count,
          COALESCE(lm.credit_issued_this_period_minor,0)::bigint credit_issued_this_period_minor,
          COALESCE(lm.lifetime_issued_from_ledger,0)::bigint lifetime_issued_from_ledger,
          la.ledger_entry_id latest_ledger_entry_id,la.entry_type latest_entry_type,
           la.occurred_at latest_entry_at,la.latest_delta_minor,
           la.available_delta_minor latest_available_delta_minor,
          la.reserved_delta_minor latest_reserved_delta_minor,la.redeemed_delta_minor latest_redeemed_delta_minor,
          la.order_id latest_order_id,la.invoice_id latest_invoice_id,la.payment_id latest_payment_id,
          la.refund_id latest_refund_id,la.credit_note_id latest_credit_note_id,
          la.reservation_id latest_reservation_id,la.adjustment_request_id latest_adjustment_request_id,
          la.actor_user_id latest_actor_user_id,la.branch_id latest_branch_id,
          la.order_number latest_order_number,la.invoice_number latest_invoice_number,
          la.payment_reference latest_payment_reference,la.refund_reference latest_refund_reference,
          la.credit_note_number latest_credit_note_number,la.actor_name latest_actor_name,
          la.branch_name latest_branch_name,la.refund_destination latest_refund_destination
        FROM stored_value_accounts a
        JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id
        LEFT JOIN ledger_metrics lm ON lm.account_id=a.id
        LEFT JOIN latest_activity la ON la.account_id=a.id
        WHERE a.tenant_id=$1
          AND a.account_type='CUSTOMER_CREDIT'
          AND ($2::uuid[] IS NULL OR EXISTS (
            SELECT 1 FROM stored_value_ledger_entries scope_l
             WHERE scope_l.tenant_id=a.tenant_id AND scope_l.account_id=a.id
               AND scope_l.branch_id=ANY($2::uuid[])
          ))
          AND ($3::uuid IS NULL OR a.customer_id=$3)
      ), base AS (
        SELECT raw.*,
          (available_minor+reserved_minor)::bigint liability_minor,
          (
            available_minor>0 AND last_activity_at IS NOT NULL
            AND last_activity_at < now()-make_interval(days=>$4)
          ) AS is_dormant,
          CASE
            WHEN available_minor>0 AND last_activity_at IS NOT NULL
              AND last_activity_at < now()-make_interval(days=>$4) THEN 'DORMANT'
            WHEN reserved_minor>0 THEN 'RESERVED'
            WHEN available_minor>0 THEN 'HAS_BALANCE'
            ELSE 'ZERO_BALANCE'
          END AS derived_state
        FROM raw
      )`;
  }

  private queryParams(auth: AccessClaims, query: any, customerScope: string | null) {
    return [auth.tenantId, this.scopedBranches(auth), customerScope, query.inactiveDays];
  }

  private filters(query: any, start: number) {
    const where = ["TRUE"];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      const placeholder = `$${start + params.length}`;
      params.push(value);
      where.push(sql.replace("?", placeholder));
    };
    if (query.search) {
      const value = `%${query.search.toLowerCase()}%`;
      const first = start + params.length;
      params.push(value, value, value, value, value, value);
      where.push(`(
        lower(b.customer_name) LIKE $${first}
        OR lower(COALESCE(b.latest_order_number,'')) LIKE $${first + 1}
        OR lower(COALESCE(b.latest_invoice_number,'')) LIKE $${first + 2}
        OR lower(COALESCE(b.latest_payment_reference,'')) LIKE $${first + 3}
        OR lower(COALESCE(b.latest_refund_reference,'')) LIKE $${first + 4}
        OR b.account_id::text LIKE $${first + 5}
      )`);
    }
    if (query.branchId) {
      add(
        `EXISTS (SELECT 1 FROM stored_value_ledger_entries f_branch
          WHERE f_branch.tenant_id=b.tenant_id AND f_branch.account_id=b.account_id
            AND f_branch.branch_id=?::uuid)`,
        query.branchId,
      );
    }
    if (query.customerId) add("b.customer_id=?::uuid", query.customerId);
    if (query.currency) add("b.currency=?", query.currency);
    if (query.balanceState === "HAS_BALANCE") where.push("b.available_minor>0");
    if (query.balanceState === "RESERVED") where.push("b.reserved_minor>0");
    if (query.balanceState === "ZERO_BALANCE") where.push("b.available_minor=0 AND b.reserved_minor=0");
    if (query.balanceState === "DORMANT") where.push("b.is_dormant=true");
    if (query.activityFrom) {
      add(
        `EXISTS (SELECT 1 FROM stored_value_ledger_entries f_from
          WHERE f_from.tenant_id=b.tenant_id AND f_from.account_id=b.account_id
            AND f_from.occurred_at::date>=?::date)`,
        query.activityFrom,
      );
    }
    if (query.activityTo) {
      add(
        `EXISTS (SELECT 1 FROM stored_value_ledger_entries f_to
          WHERE f_to.tenant_id=b.tenant_id AND f_to.account_id=b.account_id
            AND f_to.occurred_at::date<=?::date)`,
        query.activityTo,
      );
    }
    if (query.sourceType === "REFUND") {
      where.push(`EXISTS (SELECT 1 FROM stored_value_ledger_entries f_refund
        LEFT JOIN stored_value_refund_allocations f_ra
          ON f_ra.tenant_id=f_refund.tenant_id AND f_ra.ledger_entry_id=f_refund.id
        WHERE f_refund.tenant_id=b.tenant_id AND f_refund.account_id=b.account_id
          AND (f_refund.entry_type='REFUND_RESTORE' OR f_ra.destination='CUSTOMER_CREDIT'))`);
    } else if (query.sourceType === "SERVICE_RECOVERY") {
      where.push(`EXISTS (SELECT 1 FROM stored_value_ledger_entries f_recovery
        WHERE f_recovery.tenant_id=b.tenant_id AND f_recovery.account_id=b.account_id
          AND f_recovery.entry_type='SERVICE_RECOVERY_CREDIT')`);
    } else if (query.sourceType === "MANUAL") {
      where.push(`EXISTS (SELECT 1 FROM stored_value_ledger_entries f_manual
        WHERE f_manual.tenant_id=b.tenant_id AND f_manual.account_id=b.account_id
          AND f_manual.entry_type IN ('MANUAL_CREDIT','MANUAL_DEBIT'))`);
    }
    return { where: where.join(" AND "), params };
  }

  private order(query: any) {
    switch (query.sort) {
      case "BALANCE_DESC": return "available_minor DESC,account_id DESC";
      case "BALANCE_ASC": return "available_minor ASC,account_id ASC";
      case "LAST_ACTIVITY_DESC": return "last_activity_at DESC NULLS LAST,account_id DESC";
      case "LAST_ACTIVITY_ASC": return "last_activity_at ASC NULLS FIRST,account_id ASC";
      default: return "lower(customer_name) ASC,currency ASC,account_id ASC";
    }
  }

  private json(value: unknown, fallback: any) {
    if (value == null) return fallback;
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  private item(row: any, canReadBalance: boolean) {
    const balances = canReadBalance
      ? {
          availableMinor: amount(row.available_minor),
          reservedMinor: amount(row.reserved_minor),
          liabilityMinor: amount(row.liability_minor),
          netRedeemedMinor: amount(row.redeemed_minor),
          lifetimeRedeemedMinor: amount(row.lifetime_redeemed_minor),
          lifetimeIssuedMinor: amount(row.lifetime_issued_minor),
        }
      : {
          availableMinor: null,
          reservedMinor: null,
          liabilityMinor: null,
          netRedeemedMinor: null,
          lifetimeRedeemedMinor: null,
          lifetimeIssuedMinor: null,
        };
    return {
      accountId: row.account_id,
      customer: { id: row.customer_id, displayName: row.customer_name },
      currency: row.currency,
      rawAccountStatus: row.account_status,
      derivedState: row.derived_state,
      ...balances,
      lastFinancialActivityAt: row.last_activity_at,
      inactivityDays: row.last_activity_at
        ? Math.max(0, Math.floor((Date.now() - new Date(row.last_activity_at).getTime()) / 86400000))
        : null,
      recentSource: this.source(row),
      version: Number(row.version ?? 1),
      access: { balance: canReadBalance },
    };
  }

  private source(row: any) {
    if (!row.latest_ledger_entry_id) return null;
    const type = row.latest_entry_type === "REFUND_RESTORE"
      ? row.latest_refund_destination === "CUSTOMER_CREDIT"
        ? "REFUND_TO_CUSTOMER_CREDIT"
        : row.latest_refund_destination === "ORIGINAL_STORED_VALUE"
          ? "REFUND_RESTORE_ORIGINAL_CREDIT"
          : "REFUND_RESTORE"
      : row.latest_entry_type === "SERVICE_RECOVERY_CREDIT"
        ? "SERVICE_RECOVERY"
        : ["MANUAL_CREDIT", "MANUAL_DEBIT"].includes(row.latest_entry_type)
          ? "MANUAL"
          : row.latest_entry_type;
    return {
      type,
      entryType: row.latest_entry_type,
      ledgerEntryId: row.latest_ledger_entry_id,
      occurredAt: row.latest_entry_at,
      amountMinor: amount(row.latest_available_delta_minor),
      refundId: row.latest_refund_id,
      refundReference: row.latest_refund_reference,
      creditNoteId: row.latest_credit_note_id,
      creditNoteNumber: row.latest_credit_note_number,
      orderId: row.latest_order_id,
      orderNumber: row.latest_order_number,
      invoiceId: row.latest_invoice_id,
      invoiceNumber: row.latest_invoice_number,
      paymentId: row.latest_payment_id,
      paymentReference: row.latest_payment_reference,
      reservationId: row.latest_reservation_id,
      adjustmentRequestId: row.latest_adjustment_request_id,
      actorUserId: row.latest_actor_user_id,
      actorDisplayName: row.latest_actor_name,
      branchId: row.latest_branch_id,
      branchName: row.latest_branch_name,
    };
  }

  async directory(auth: AccessClaims, input: unknown) {
    this.access(auth);
    const query = customerCreditDirectoryQuerySchema.parse(input ?? {});
    const [customerScope, permissions] = await Promise.all([
      this.ownCustomerId(auth),
      this.permissions(auth),
    ]);
    const canReadBalance = permissions.has("customer_credit.read") || permissions.has("customer_credit.balance.read");
    const baseParams = this.queryParams(auth, query, customerScope);
    const filter = this.filters(query, baseParams.length + 1);
    const cte = `${this.baseCte()}, filtered AS (SELECT * FROM base b WHERE ${filter.where})`;
    const params = [...baseParams, ...filter.params];
    const total = (
      await this.db.query<any>(`${cte} SELECT COUNT(*)::int total FROM filtered`, params)
    ).rows[0]?.total ?? 0;
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;
    const rows = (
      await this.db.query<any>(
        `${cte} SELECT * FROM filtered ORDER BY ${this.order(query)} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      )
    ).rows;
    const summaryRows = (
      await this.db.query<any>(
        `${cte}, currency_summary AS (
          SELECT currency,
            COALESCE(SUM(available_minor),0)::bigint available_minor,
            COALESCE(SUM(reserved_minor),0)::bigint reserved_minor,
            COALESCE(SUM(redeemed_this_period_minor),0)::bigint redeemed_period_minor,
            COALESCE(SUM(credit_issued_this_period_minor),0)::bigint credit_issued_minor,
            COALESCE(SUM(available_minor+reserved_minor) FILTER (WHERE is_dormant),0)::bigint dormant_minor
           FROM filtered GROUP BY currency
        ) SELECT * FROM currency_summary ORDER BY currency`,
        params,
      )
    ).rows;
    const summary = {
      accountCount: Number(total),
      customerCount: Number((await this.db.query<any>(`${cte} SELECT COUNT(DISTINCT customer_id)::int count FROM filtered`, params)).rows[0]?.count ?? 0),
      availableByCurrency: summaryRows.map((row) => ({ currency: row.currency, amountMinor: amount(row.available_minor) ?? "0" })),
      reservedByCurrency: summaryRows.map((row) => ({ currency: row.currency, amountMinor: amount(row.reserved_minor) ?? "0" })),
      redeemedThisPeriodByCurrency: summaryRows.map((row) => ({ currency: row.currency, amountMinor: amount(row.redeemed_period_minor) ?? "0" })),
      redeemedTransactionCount: Number((await this.db.query<any>(`${cte} SELECT COALESCE(SUM(redeemed_this_period_count),0)::int count FROM filtered`, params)).rows[0]?.count ?? 0),
      creditIssuedThisPeriodByCurrency: summaryRows.map((row) => ({ currency: row.currency, amountMinor: amount(row.credit_issued_minor) ?? "0" })),
      dormantCustomerCount: Number((await this.db.query<any>(`${cte} SELECT COUNT(DISTINCT customer_id)::int count FROM filtered WHERE is_dormant`, params)).rows[0]?.count ?? 0),
      dormantBalanceByCurrency: summaryRows.map((row) => ({ currency: row.currency, amountMinor: amount(row.dormant_minor) ?? "0" })),
      pendingAdjustmentCount: Number((await this.db.query<any>(
        `SELECT COUNT(*)::int count FROM stored_value_adjustment_requests ar
          WHERE ar.tenant_id=$1 AND ar.status='PENDING'
            AND ($2::uuid[] IS NULL OR ar.branch_id=ANY($2::uuid[]))
            AND ($3::uuid IS NULL OR ar.customer_id=$3)`,
        [auth.tenantId, this.scopedBranches(auth), customerScope],
      )).rows[0]?.count ?? 0),
    };
    const distribution = (
      await this.db.query<any>(`${cte} SELECT derived_state,COUNT(*)::int count FROM filtered GROUP BY derived_state`, params)
    ).rows.reduce<Record<string, number>>((result, row) => {
      result[row.derived_state] = Number(row.count);
      return result;
    }, {});
    const sourceRows = (
      await this.db.query<any>(
        `${cte}, source_events AS (
          SELECT CASE
            WHEN l.entry_type='REFUND_RESTORE' AND ra.destination='CUSTOMER_CREDIT' THEN 'REFUND_TO_CUSTOMER_CREDIT'
            WHEN l.entry_type='REFUND_RESTORE' AND ra.destination='ORIGINAL_STORED_VALUE' THEN 'REFUND_RESTORE_ORIGINAL_CREDIT'
            WHEN l.entry_type='SERVICE_RECOVERY_CREDIT' THEN 'SERVICE_RECOVERY'
            WHEN l.entry_type IN ('MANUAL_CREDIT','MANUAL_DEBIT') THEN 'MANUAL'
            ELSE l.entry_type END source_type,
            l.currency,
            GREATEST(l.available_delta_minor,0)::bigint amount_minor
           FROM filtered f
           JOIN stored_value_ledger_entries l ON l.tenant_id=f.tenant_id AND l.account_id=f.account_id
           LEFT JOIN stored_value_refund_allocations ra ON ra.tenant_id=l.tenant_id AND ra.ledger_entry_id=l.id
           WHERE l.occurred_at>=date_trunc('month',now())
             AND ($2::uuid[] IS NULL OR l.branch_id=ANY($2::uuid[]))
             AND (l.entry_type IN ('MANUAL_CREDIT','SERVICE_RECOVERY_CREDIT')
              OR (l.entry_type='REFUND_RESTORE' AND ra.destination IS NOT NULL))
        ) SELECT source_type,currency,COUNT(*)::int count,COALESCE(SUM(amount_minor),0)::bigint amount_minor
            FROM source_events GROUP BY source_type,currency ORDER BY source_type,currency`,
        params,
      )
    ).rows;
    return {
      items: rows.map((row) => this.item(row, canReadBalance)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / query.pageSize),
      },
      summary,
      sourceBreakdown: sourceRows.map((row) => ({
        type: row.source_type,
        currency: row.currency,
        count: Number(row.count),
        amountMinor: amount(row.amount_minor) ?? "0",
      })),
      stateDistribution: distribution,
      generatedAt: new Date().toISOString(),
      access: {
        balance: canReadBalance,
        ledger: permissions.has("customer_credit.ledger.read"),
        adjustmentRequest: permissions.has("customer_credit.adjustment.request"),
        adjustmentApprove: permissions.has("customer_credit.adjustment.approve"),
        eligibility: permissions.has("stored_value.eligibility.read"),
        export: permissions.has("stored_value.export"),
      },
    };
  }

  async overview(auth: AccessClaims, input: unknown) {
    const result = await this.directory(auth, input);
    return {
      summary: result.summary,
      sourceBreakdown: result.sourceBreakdown,
      stateDistribution: result.stateDistribution,
      generatedAt: result.generatedAt,
      access: result.access,
    };
  }

  private async accountRow(auth: AccessClaims, accountId: string) {
    const customerScope = await this.ownCustomerId(auth);
    const query = { inactiveDays: 90 };
    const rows = (
      await this.db.query<any>(
        `${this.baseCte()} SELECT * FROM base WHERE account_id=$5`,
        [auth.tenantId, this.scopedBranches(auth), customerScope, query.inactiveDays, accountId],
      )
    ).rows;
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: "CUSTOMER_CREDIT_NOT_FOUND" });
    return row;
  }

  private ledgerCte(auth: AccessClaims, accountId: string) {
    return {
      sql: `
        WITH chronological AS (
          SELECT l.*,
            SUM(l.pending_delta_minor) OVER (ORDER BY l.occurred_at,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) pending_after_minor,
            SUM(l.available_delta_minor) OVER (ORDER BY l.occurred_at,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) available_after_minor,
            SUM(l.reserved_delta_minor) OVER (ORDER BY l.occurred_at,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) reserved_after_minor,
            SUM(l.redeemed_delta_minor) OVER (ORDER BY l.occurred_at,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) redeemed_after_minor,
            SUM(l.expired_delta_minor) OVER (ORDER BY l.occurred_at,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) expired_after_minor,
            SUM(l.cancelled_delta_minor) OVER (ORDER BY l.occurred_at,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cancelled_after_minor
           FROM stored_value_ledger_entries l
          WHERE l.tenant_id=$1 AND l.account_id=$2
            AND ($3::uuid[] IS NULL OR l.branch_id=ANY($3::uuid[]))
        ), enriched AS (
          SELECT c.*,
            (c.available_after_minor+c.reserved_after_minor)::bigint liability_after_minor,
            o.order_number,inv.invoice_number,p.payment_reference,
            r.refund_reference,cn.credit_note_number,u.display_name actor_name,
            b.name branch_name,ar.adjustment_type,
            ra.destination refund_destination
           FROM chronological c
           LEFT JOIN pos_orders o ON o.tenant_id=c.tenant_id AND o.id=c.order_id
           LEFT JOIN invoices inv ON inv.tenant_id=c.tenant_id AND inv.id=c.invoice_id
           LEFT JOIN payments p ON p.tenant_id=c.tenant_id AND p.id=c.payment_id
           LEFT JOIN refunds r ON r.tenant_id=c.tenant_id AND r.id=c.refund_id
           LEFT JOIN credit_notes cn ON cn.tenant_id=c.tenant_id AND cn.id=c.credit_note_id
           LEFT JOIN users u ON u.id=c.actor_user_id
           LEFT JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
           LEFT JOIN stored_value_adjustment_requests ar ON ar.tenant_id=c.tenant_id AND ar.id=c.adjustment_request_id
           LEFT JOIN LATERAL (
             SELECT x.destination FROM stored_value_refund_allocations x
              WHERE x.tenant_id=c.tenant_id AND x.ledger_entry_id=c.id
              ORDER BY x.created_at DESC,x.id DESC LIMIT 1
           ) ra ON true
        )`,
      params: [auth.tenantId, accountId, this.scopedBranches(auth)],
    };
  }

  private ledgerItem(row: any) {
    const sourceType = row.entry_type === "REFUND_RESTORE"
      ? row.refund_destination === "CUSTOMER_CREDIT"
        ? "REFUND_TO_CUSTOMER_CREDIT"
        : row.refund_destination === "ORIGINAL_STORED_VALUE"
          ? "REFUND_RESTORE_ORIGINAL_CREDIT"
          : "REFUND_RESTORE"
      : row.entry_type === "SERVICE_RECOVERY_CREDIT"
        ? "SERVICE_RECOVERY"
        : ["MANUAL_CREDIT", "MANUAL_DEBIT"].includes(row.entry_type)
          ? "MANUAL"
          : row.entry_type;
    return {
      id: row.id,
      entryType: row.entry_type,
      displayType: sourceType,
      occurredAt: row.occurred_at,
      currency: row.currency,
      pendingDeltaMinor: amount(row.pending_delta_minor),
      availableDeltaMinor: amount(row.available_delta_minor),
      reservedDeltaMinor: amount(row.reserved_delta_minor),
      redeemedDeltaMinor: amount(row.redeemed_delta_minor),
      expiredDeltaMinor: amount(row.expired_delta_minor),
      cancelledDeltaMinor: amount(row.cancelled_delta_minor),
      availableAfterMinor: amount(row.available_after_minor),
      reservedAfterMinor: amount(row.reserved_after_minor),
      liabilityAfterMinor: amount(row.liability_after_minor),
      orderId: row.order_id,
      orderNumber: row.order_number,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      paymentId: row.payment_id,
      paymentReference: row.payment_reference,
      refundId: row.refund_id,
      refundReference: row.refund_reference,
      creditNoteId: row.credit_note_id,
      creditNoteNumber: row.credit_note_number,
      reservationId: row.reservation_id,
      adjustmentRequestId: row.adjustment_request_id,
      adjustmentType: row.adjustment_type,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_name,
      branchId: row.branch_id,
      branchName: row.branch_name,
      source: {
        type: sourceType,
        refundDestination: row.refund_destination,
      },
      policySnapshot: row.policy_snapshot_json,
    };
  }

  private ledgerFilters(query: any, start: number) {
    const where = ["TRUE"];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      const placeholder = `$${start + params.length}`;
      params.push(value);
      where.push(sql.replace("?", placeholder));
    };
    if (query.from) add("occurred_at::date>=?::date", query.from);
    if (query.to) add("occurred_at::date<=?::date", query.to);
    if (query.group === "CREDIT") where.push("entry_type IN ('ACTIVATE','RELOAD_COMMIT','REFUND_RESTORE','MANUAL_CREDIT','SERVICE_RECOVERY_CREDIT','CORRECTION','MIGRATION') AND available_delta_minor>0");
    if (query.group === "REDEEM") where.push("entry_type='REDEEM'");
    if (query.group === "RESERVE") where.push("entry_type='RESERVE'");
    if (query.group === "REFUND") where.push("entry_type='REFUND_RESTORE'");
    if (query.group === "ADJUSTMENT") where.push("entry_type IN ('MANUAL_CREDIT','MANUAL_DEBIT','SERVICE_RECOVERY_CREDIT')");
    if (query.source === "REFUND") where.push("entry_type='REFUND_RESTORE'");
    if (query.source === "POS") where.push("(entry_type IN ('RESERVE','REDEEM','RELEASE') OR order_id IS NOT NULL)");
    if (query.source === "MANUAL") where.push("entry_type IN ('MANUAL_CREDIT','MANUAL_DEBIT')");
    if (query.source === "SERVICE_RECOVERY") where.push("entry_type='SERVICE_RECOVERY_CREDIT'");
    if (query.sign === "POSITIVE") where.push("(available_delta_minor>0 OR pending_delta_minor>0 OR reserved_delta_minor>0 OR redeemed_delta_minor<0)");
    if (query.sign === "NEGATIVE") where.push("(available_delta_minor<0 OR pending_delta_minor<0 OR reserved_delta_minor<0 OR redeemed_delta_minor>0)");
    if (query.search) {
      const value = `%${query.search.toLowerCase()}%`;
      const first = start + params.length;
      params.push(value, value, value, value, value, value);
      where.push(`(
        lower(COALESCE(order_number,'')) LIKE $${first}
        OR lower(COALESCE(invoice_number,'')) LIKE $${first + 1}
        OR lower(COALESCE(payment_reference,'')) LIKE $${first + 2}
        OR lower(COALESCE(refund_reference,'')) LIKE $${first + 3}
        OR lower(COALESCE(credit_note_number,'')) LIKE $${first + 4}
        OR lower(COALESCE(actor_name,'')) LIKE $${first + 5}
      )`);
    }
    return { where: where.join(" AND "), params };
  }

  async accountOverview(auth: AccessClaims, accountId: string) {
    this.access(auth);
    const [row, permissions] = await Promise.all([
      this.accountRow(auth, accountId),
      this.permissions(auth),
    ]);
    const canReadBalance = permissions.has("customer_credit.read") || permissions.has("customer_credit.balance.read");
    const canReadLedger = permissions.has("customer_credit.ledger.read");
    const cte = this.ledgerCte(auth, accountId);
    const recentRows = canReadLedger
      ? (await this.db.query<any>(`${cte.sql} SELECT * FROM enriched ORDER BY occurred_at DESC,id DESC LIMIT 8`, cte.params)).rows
      : [];
    const sourceRows = (
      await this.db.query<any>(
        `${cte.sql} SELECT * FROM enriched
          WHERE available_delta_minor>0 OR entry_type IN ('REFUND_RESTORE','SERVICE_RECOVERY_CREDIT','MANUAL_CREDIT')
          ORDER BY occurred_at DESC,id DESC LIMIT 6`,
        cte.params,
      )
    ).rows;
    const reservations = (
      await this.db.query<any>(
        `SELECT r.id reservation_id,r.order_id,o.order_number,r.accepted_minor::text accepted_minor,
                r.requested_minor::text requested_minor,r.currency,r.status,r.expires_at,
                r.branch_id,b.name branch_name
           FROM stored_value_reservations r
           JOIN pos_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id
           LEFT JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id
          WHERE r.tenant_id=$1 AND r.account_id=$2 AND r.status='ACTIVE'
            AND ($3::uuid[] IS NULL OR r.branch_id=ANY($3::uuid[]))
          ORDER BY r.created_at DESC,r.id DESC LIMIT 8`,
        [auth.tenantId, accountId, this.scopedBranches(auth)],
      )
    ).rows;
    const pendingAdjustments = (
      await this.db.query<any>(
        `SELECT id,customer_id "customerId",account_id "accountId",currency,adjustment_type "adjustmentType",
                amount_minor::text "amountMinor",reason_code "reasonCode",note,status,version,created_at "createdAt"
           FROM stored_value_adjustment_requests
          WHERE tenant_id=$1 AND customer_id=$2 AND currency=$3 AND status='PENDING'
            AND ($4::uuid[] IS NULL OR branch_id=ANY($4::uuid[]))
          ORDER BY created_at DESC,id DESC LIMIT 8`,
        [auth.tenantId, row.customer_id, row.currency, this.scopedBranches(auth)],
      )
    ).rows;
    return {
      account: {
        id: row.account_id,
        customerId: row.customer_id,
        currency: row.currency,
        status: row.account_status,
        version: Number(row.version ?? 1),
        pendingMinor: canReadBalance ? amount(row.pending_minor) : null,
        availableMinor: canReadBalance ? amount(row.available_minor) : null,
        reservedMinor: canReadBalance ? amount(row.reserved_minor) : null,
        liabilityMinor: canReadBalance ? amount(row.liability_minor) : null,
        redeemedMinor: canReadBalance ? amount(row.redeemed_minor) : null,
        lifetimeRedeemedMinor: canReadBalance ? amount(row.lifetime_redeemed_minor) : null,
        lifetimeIssuedMinor: canReadBalance ? amount(row.lifetime_issued_minor) : null,
      },
      customer: { id: row.customer_id, displayName: row.customer_name },
      recentSources: sourceRows.map((source) => this.ledgerItem(source)),
      recentLedger: recentRows.map((entry) => this.ledgerItem(entry)),
      pendingAdjustments,
      currentReservations: reservations.map((reservation) => ({
        reservationId: reservation.reservation_id,
        orderId: reservation.order_id,
        orderNumber: reservation.order_number,
        acceptedMinor: reservation.accepted_minor,
        requestedMinor: reservation.requested_minor,
        currency: reservation.currency,
        status: reservation.status,
        expiresAt: reservation.expires_at,
        branchId: reservation.branch_id,
        branchName: reservation.branch_name,
      })),
      lastFinancialActivityAt: row.last_activity_at,
      generatedAt: new Date().toISOString(),
      access: {
        balance: canReadBalance,
        ledger: canReadLedger,
        adjustmentRequest: permissions.has("customer_credit.adjustment.request"),
        eligibility: permissions.has("stored_value.eligibility.read"),
      },
    };
  }

  async ledgerDirectory(auth: AccessClaims, accountId: string, input: unknown) {
    this.access(auth);
    const query = customerCreditLedgerDirectoryQuerySchema.parse(input ?? {});
    const permissions = await this.permissions(auth);
    if (!permissions.has("customer_credit.ledger.read")) {
      return {
        items: [],
        pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 },
        access: { ledger: false },
        generatedAt: new Date().toISOString(),
      };
    }
    await this.accountRow(auth, accountId);
    const cte = this.ledgerCte(auth, accountId);
    const filter = this.ledgerFilters(query, cte.params.length + 1);
    const params = [...cte.params, ...filter.params];
    const filtered = `${cte.sql}, filtered AS (SELECT * FROM enriched WHERE ${filter.where})`;
    const total = (
      await this.db.query<any>(`${filtered} SELECT COUNT(*)::int total FROM filtered`, params)
    ).rows[0]?.total ?? 0;
    const direction = query.sort === "OLDEST" ? "ASC" : "DESC";
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;
    const rows = (
      await this.db.query<any>(
        `${filtered} SELECT * FROM filtered ORDER BY occurred_at ${direction},id ${direction} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      )
    ).rows;
    return {
      items: rows.map((row) => this.ledgerItem(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / query.pageSize),
      },
      access: { ledger: true },
      generatedAt: new Date().toISOString(),
    };
  }
}
