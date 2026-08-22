/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { loyaltyLedgerDirectoryQuerySchema } from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

const ledgerCte = `
  WITH running AS (
    SELECT e.*,
      SUM(e.pending_delta) OVER (
        PARTITION BY e.account_id ORDER BY e.created_at,e.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS pending_after,
      SUM(e.available_delta) OVER (
        PARTITION BY e.account_id ORDER BY e.created_at,e.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS available_after,
      SUM(e.reserved_delta) OVER (
        PARTITION BY e.account_id ORDER BY e.created_at,e.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS reserved_after,
      SUM(e.lifetime_delta) OVER (
        PARTITION BY e.account_id ORDER BY e.created_at,e.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS lifetime_after
    FROM loyalty_ledger_entries e
    WHERE e.tenant_id=$1 AND e.customer_id=$2
  ), enriched AS (
    SELECT r.*,
      po.order_number AS pos_order_number,
      i.invoice_number,
      rf.refund_reference,
      cn.credit_note_number,
      actor.display_name AS actor_display_name,
      CASE
        WHEN r.refund_id IS NOT NULL THEN 'REFUND'
        WHEN r.invoice_id IS NOT NULL THEN 'INVOICE'
        WHEN r.pos_order_id IS NOT NULL THEN 'POS'
        WHEN r.entry_type='MANUAL_ADJUSTMENT' THEN 'MANUAL'
        ELSE 'SYSTEM'
      END AS source_type,
      CASE
        WHEN r.refund_id IS NOT NULL THEN COALESCE(rf.refund_reference, r.refund_id::text)
        WHEN r.invoice_id IS NOT NULL THEN COALESCE(i.invoice_number, r.invoice_id::text)
        WHEN r.pos_order_id IS NOT NULL THEN COALESCE(po.order_number, r.pos_order_id::text)
        WHEN r.entry_type='MANUAL_ADJUSTMENT' THEN 'Điều chỉnh thủ công'
        ELSE 'Hệ thống'
      END AS source_label,
      CASE
        WHEN r.entry_type IN ('EARN_PENDING','EARN_AVAILABLE') THEN 'EARN'
        WHEN r.entry_type='REDEEM_COMMIT' THEN 'REDEEM'
        WHEN r.entry_type IN ('REDEEM_RESERVE','REDEEM_RELEASE') THEN 'RESERVATION'
        WHEN r.entry_type='REFUND_REVERSAL' THEN 'REFUND'
        WHEN r.entry_type='MANUAL_ADJUSTMENT' THEN 'MANUAL_ADJUSTMENT'
        WHEN r.entry_type='EXPIRE' THEN 'EXPIRE'
        ELSE 'SYSTEM'
      END AS group_key,
      CASE
        WHEN r.entry_type IN ('EARN_PENDING','REDEEM_RESERVE') THEN 'PENDING'
        WHEN r.entry_type='REDEEM_RELEASE' THEN 'RELEASED'
        WHEN r.entry_type='EXPIRE' THEN 'EXPIRED'
        ELSE 'RECORDED'
      END AS display_status,
      CASE
        WHEN r.entry_type='EARN_PENDING' THEN 'Điểm chờ ghi nhận'
        WHEN r.entry_type='EARN_AVAILABLE' THEN 'Tích điểm'
        WHEN r.entry_type='REDEEM_RESERVE' THEN 'Giữ điểm'
        WHEN r.entry_type='REDEEM_COMMIT' THEN 'Sử dụng điểm'
        WHEN r.entry_type='REDEEM_RELEASE' THEN 'Hoàn giữ điểm'
        WHEN r.entry_type='EXPIRE' THEN 'Hết hạn'
        WHEN r.entry_type='MANUAL_ADJUSTMENT' AND r.available_delta >= 0 THEN 'Điều chỉnh tăng'
        WHEN r.entry_type='MANUAL_ADJUSTMENT' THEN 'Điều chỉnh giảm'
        WHEN r.entry_type='REFUND_REVERSAL' AND r.available_delta > 0 AND r.lifetime_delta=0 THEN 'Hoàn lại điểm đã sử dụng'
        WHEN r.entry_type='REFUND_REVERSAL' THEN 'Thu hồi điểm do hoàn tiền'
        WHEN r.entry_type='MIGRATION' THEN 'Di chuyển dữ liệu'
        ELSE r.entry_type
      END AS display_type,
      CASE
        WHEN r.entry_type='EARN_PENDING' THEN 'PENDING'
        WHEN r.entry_type IN ('REDEEM_RESERVE','REDEEM_RELEASE') THEN 'RESERVED'
        WHEN r.entry_type='REDEEM_COMMIT' THEN 'AVAILABLE'
        WHEN r.available_delta <> 0 THEN 'AVAILABLE'
        WHEN r.pending_delta <> 0 THEN 'PENDING'
        WHEN r.reserved_delta <> 0 THEN 'RESERVED'
        ELSE 'LIFETIME'
      END AS primary_bucket,
      CASE
        WHEN r.entry_type='EARN_PENDING' THEN r.pending_delta
        WHEN r.entry_type='EARN_AVAILABLE' THEN r.available_delta
        WHEN r.entry_type IN ('REDEEM_RESERVE','REDEEM_RELEASE') THEN r.reserved_delta
        WHEN r.entry_type='REDEEM_COMMIT' THEN r.available_delta
        WHEN r.available_delta <> 0 THEN r.available_delta
        WHEN r.pending_delta <> 0 THEN r.pending_delta
        WHEN r.reserved_delta <> 0 THEN r.reserved_delta
        ELSE r.lifetime_delta
      END AS primary_delta
    FROM running r
    LEFT JOIN pos_orders po ON po.tenant_id=r.tenant_id AND po.id=r.pos_order_id
    LEFT JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
    LEFT JOIN refunds rf ON rf.tenant_id=r.tenant_id AND rf.id=r.refund_id
    LEFT JOIN credit_notes cn ON cn.tenant_id=r.tenant_id AND cn.id=r.credit_note_id
    LEFT JOIN users actor ON actor.id=r.created_by_user_id
  )`;

function points(value: unknown) {
  return value === null || value === undefined ? "0" : String(value);
}

function subtract(left: unknown, right: unknown) {
  return (BigInt(points(left)) - BigInt(points(right))).toString();
}

function spendable(available: unknown, reserved: unknown) {
  const value = BigInt(points(available)) - BigInt(points(reserved));
  return (value > 0n ? value : 0n).toString();
}

function ref(id: unknown, label: unknown, kind: string) {
  if (!id) return null;
  return { id: String(id), reference: label ? String(label) : `#${String(id).slice(0, 8)}`, kind };
}

function mapRow(row: any) {
  const availableAfter = points(row.available_after);
  const reservedAfter = points(row.reserved_after);
  return {
    id: row.id,
    entryType: row.entry_type,
    displayType: row.display_type,
    displayStatus: row.display_status,
    group: row.group_key,
    primaryBucket: row.primary_bucket,
    primaryDelta: points(row.primary_delta),
    pendingDelta: points(row.pending_delta),
    availableDelta: points(row.available_delta),
    reservedDelta: points(row.reserved_delta),
    lifetimeDelta: points(row.lifetime_delta),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    generationKey: row.generation_key,
    reservationId: row.reservation_id,
    source: {
      type: row.source_type,
      label: row.source_label,
      posOrder: ref(row.pos_order_id, row.pos_order_number, "POS_ORDER"),
      invoice: ref(row.invoice_id, row.invoice_number, "INVOICE"),
      refund: ref(row.refund_id, row.refund_reference, "REFUND"),
      creditNote: ref(row.credit_note_id, row.credit_note_number, "CREDIT_NOTE"),
    },
    actor: row.created_by_user_id
      ? { type: "USER", id: row.created_by_user_id, displayName: row.actor_display_name ?? null }
      : { type: "SYSTEM", id: null, displayName: "Hệ thống" },
    balances: {
      after: {
        pending: points(row.pending_after),
        available: availableAfter,
        reserved: reservedAfter,
        lifetimeEarned: points(row.lifetime_after),
        spendable: spendable(availableAfter, reservedAfter),
      },
    },
    policySnapshot: row.policy_snapshot_json ?? null,
  };
}

@Injectable()
export class LoyaltyLedgerReportingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async directory(auth: AccessClaims, customerId: string, input: unknown) {
    this.access(auth);
    const query = loyaltyLedgerDirectoryQuerySchema.parse(input);
    const params: unknown[] = [auth.tenantId, customerId];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const filters: string[] = [];
    if (query.search) {
      const p = push(`%${query.search}%`);
      filters.push(`(
        e.id::text ILIKE ${p} OR COALESCE(e.generation_key,'') ILIKE ${p}
        OR COALESCE(e.source_label,'') ILIKE ${p}
        OR COALESCE(e.pos_order_number,'') ILIKE ${p}
        OR COALESCE(e.invoice_number,'') ILIKE ${p}
        OR COALESCE(e.refund_reference,'') ILIKE ${p}
        OR COALESCE(e.credit_note_number,'') ILIKE ${p}
      )`);
    }
    if (query.from) filters.push(`e.created_at >= ${push(query.from)}::date`);
    if (query.to) filters.push(`e.created_at < (${push(query.to)}::date + interval '1 day')`);
    if (query.group === "PENDING") filters.push("e.display_status='PENDING'");
    else if (query.group !== "ALL") filters.push(`e.group_key=${push(query.group)}`);
    if (query.sign === "POSITIVE") filters.push("e.primary_delta > 0");
    if (query.sign === "NEGATIVE") filters.push("e.primary_delta < 0");
    if (query.source !== "ALL") filters.push(`e.source_type=${push(query.source)}`);
    if (query.displayStatus !== "ALL") filters.push(`e.display_status=${push(query.displayStatus)}`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const order = query.sort === "OLDEST" ? "ASC" : "DESC";
    const limit = push(query.pageSize);
    const offset = push((query.page - 1) * query.pageSize);
    const filteredCte = `${ledgerCte}, filtered AS (SELECT e.* FROM enriched e ${where})`;
    const [itemsResult, countResult, summaryResult] = await Promise.all([
      this.db.query<any>(
        `${filteredCte}
         SELECT * FROM filtered e ORDER BY e.created_at ${order},e.id ${order}
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.db.query<any>(`${filteredCte} SELECT count(*)::int AS total FROM filtered`, params.slice(0, params.length - 2)),
      this.db.query<any>(
        `${filteredCte}
         SELECT count(*)::int AS transaction_count,
           COALESCE(sum(e.primary_delta) FILTER (WHERE e.primary_delta > 0),0)::bigint AS positive_points,
           COALESCE(sum(e.primary_delta) FILTER (WHERE e.primary_delta < 0),0)::bigint AS negative_points,
           COALESCE(sum(e.available_delta) FILTER (WHERE e.entry_type='EARN_AVAILABLE'),0)::bigint AS earned_points,
           COALESCE(sum(abs(e.available_delta)) FILTER (WHERE e.entry_type='REDEEM_COMMIT' AND e.available_delta < 0),0)::bigint AS redeemed_points,
           COALESCE(sum(abs(e.available_delta)) FILTER (WHERE e.entry_type='EXPIRE' AND e.available_delta < 0),0)::bigint AS expired_points
         FROM filtered e`,
        params.slice(0, params.length - 2),
      ),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    return {
      items: itemsResult.rows.map(mapRow),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
      },
      summary: {
        transactionCount: Number(summaryResult.rows[0]?.transaction_count ?? 0),
        positivePoints: points(summaryResult.rows[0]?.positive_points),
        negativePoints: points(summaryResult.rows[0]?.negative_points),
        earnedPoints: points(summaryResult.rows[0]?.earned_points),
        redeemedPoints: points(summaryResult.rows[0]?.redeemed_points),
        expiredPoints: points(summaryResult.rows[0]?.expired_points),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async detail(auth: AccessClaims, customerId: string, entryId: string) {
    this.access(auth);
    const result = await this.db.query<any>(
      `${ledgerCte}
       SELECT * FROM enriched WHERE id=$3`,
      [auth.tenantId, customerId, entryId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({ code: "LOYALTY_LEDGER_ENTRY_NOT_FOUND", message: "Loyalty ledger entry was not found" });
    }
    const mapped = mapRow(row);
    const before = {
      pending: subtract(row.pending_after, row.pending_delta),
      available: subtract(row.available_after, row.available_delta),
      reserved: subtract(row.reserved_after, row.reserved_delta),
      lifetimeEarned: subtract(row.lifetime_after, row.lifetime_delta),
    };
    return {
      ...mapped,
      balances: {
        before: { ...before, spendable: spendable(before.available, before.reserved) },
        after: mapped.balances.after,
      },
      customerId,
    };
  }

  async overview(auth: AccessClaims, customerId: string) {
    this.access(auth);
    const [accountResult, statsResult, lotsResult] = await Promise.all([
      this.db.query<any>(
        `SELECT c.id customer_id,c.display_name,c.phone_normalized,c.email_normalized,
                a.id account_id,a.pending_points,a.available_points,a.reserved_points,a.lifetime_earned_points,a.version,
                p.id program_id,p.name program_name,p.effective_from program_effective_from,p.effective_to program_effective_to
         FROM customers c
         LEFT JOIN loyalty_accounts a ON a.tenant_id=c.tenant_id AND a.customer_id=c.id
         LEFT JOIN LATERAL (
           SELECT lp.* FROM loyalty_programs lp
           WHERE lp.tenant_id=c.tenant_id AND lp.status='ACTIVE'
             AND lp.effective_from<=now()
             AND (lp.effective_to IS NULL OR lp.effective_to>now())
           ORDER BY lp.effective_from DESC,lp.id DESC LIMIT 1
         ) p ON true
         WHERE c.tenant_id=$1 AND c.id=$2`,
        [auth.tenantId, customerId],
      ),
      this.db.query<any>(
        `SELECT count(*)::int transaction_count,
          COALESCE(sum(e.available_delta) FILTER (WHERE e.entry_type='EARN_AVAILABLE' AND e.created_at>=date_trunc('month',now())),0)::bigint month_earned,
          COALESCE(sum(e.available_delta) FILTER (WHERE e.entry_type='EARN_AVAILABLE'),0)::bigint earned_points,
          COALESCE(sum(abs(e.available_delta)) FILTER (WHERE e.entry_type='REDEEM_COMMIT' AND e.available_delta<0),0)::bigint redeemed_points,
          COALESCE(sum(abs(e.available_delta)) FILTER (WHERE e.entry_type='EXPIRE' AND e.available_delta<0),0)::bigint expired_points,
          COALESCE(sum(e.available_delta) FILTER (WHERE e.entry_type='MANUAL_ADJUSTMENT'),0)::bigint adjustment_points
         FROM loyalty_ledger_entries e WHERE e.tenant_id=$1 AND e.customer_id=$2`,
        [auth.tenantId, customerId],
      ),
      this.db.query<any>(
        `SELECT id,available_points,expires_at,status,original_points
         FROM loyalty_point_lots
         WHERE tenant_id=$1 AND account_id=(SELECT id FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2)
           AND status='AVAILABLE' AND available_points>0 AND expires_at IS NOT NULL
         ORDER BY expires_at ASC,id ASC LIMIT 50`,
        [auth.tenantId, customerId],
      ),
    ]);
    const row = accountResult.rows[0];
    if (!row) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Customer was not found" });
    const available = points(row.available_points);
    const reserved = points(row.reserved_points);
    const expiryBuckets = [7, 30, 90].map((days) => ({
      days,
      points: lotsResult.rows
        .filter((lot) => lot.expires_at && new Date(lot.expires_at).getTime() <= Date.now() + days * 86400000)
        .reduce((sum, lot) => sum + BigInt(points(lot.available_points)), 0n)
        .toString(),
    }));
    return {
      customer: {
        id: row.customer_id,
        displayName: row.display_name,
        phone: row.phone_normalized,
        email: row.email_normalized,
      },
      account: {
        id: row.account_id,
        pendingPoints: points(row.pending_points),
        availablePoints: available,
        reservedPoints: reserved,
        spendablePoints: spendable(available, reserved),
        lifetimeEarnedPoints: points(row.lifetime_earned_points),
        version: row.version,
      },
      program: row.program_id
        ? { id: row.program_id, code: row.program_code, name: row.program_name, effectiveFrom: row.program_effective_from, effectiveTo: row.program_effective_to }
        : null,
      stats: {
        transactionCount: Number(statsResult.rows[0]?.transaction_count ?? 0),
        monthEarnedPoints: points(statsResult.rows[0]?.month_earned),
        earnedPoints: points(statsResult.rows[0]?.earned_points),
        redeemedPoints: points(statsResult.rows[0]?.redeemed_points),
        expiredPoints: points(statsResult.rows[0]?.expired_points),
        adjustmentPoints: points(statsResult.rows[0]?.adjustment_points),
      },
      expiry: {
        nearest: lotsResult.rows[0]
          ? { points: points(lotsResult.rows[0].available_points), expiresAt: lotsResult.rows[0].expires_at }
          : null,
        buckets: expiryBuckets,
        lots: lotsResult.rows.map((lot) => ({ id: lot.id, points: points(lot.available_points), expiresAt: lot.expires_at })),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((role) => role !== "PLATFORM_SUPER_ADMIN") &&
      !auth.supportAccess
    ) {
      throw new ForbiddenException({ code: "PERMISSION_DENIED", message: "Platform support requires an explicit tenant access grant" });
    }
  }
}
