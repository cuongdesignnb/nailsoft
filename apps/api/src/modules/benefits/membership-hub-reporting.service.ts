/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { membershipHubDirectoryQuerySchema } from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

const effectiveTiers = `
  SELECT t.*
  FROM membership_tiers t
  WHERE t.tenant_id=$1
    AND t.status='ACTIVE'
    AND t.effective_from<=now()
    AND (t.effective_to IS NULL OR t.effective_to>now())`;

const directoryCte = `
  WITH effective_tiers AS (${effectiveTiers}),
  current_assignments AS (
    SELECT DISTINCT ON (a.customer_id)
      a.id assignment_id,a.customer_id,a.tier_id current_tier_id,a.status assignment_status,
      a.effective_from,a.effective_to,a.benefit_snapshot_json,a.qualification_snapshot_json,
      a.supersedes_assignment_id,a.reason_code,a.assigned_by_user_id,a.assignment_source,a.grace_until,
      t.code current_tier_code,t.name_json current_tier_name,t.priority current_priority,
      t.qualification_type current_qualification_type,t.qualification_threshold current_threshold,
      t.rolling_window_days current_rolling_window_days
    FROM customer_membership_assignments a
    JOIN effective_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
    WHERE a.tenant_id=$1
      AND a.status='ACTIVE'
      AND a.effective_from<=now()
      AND (a.effective_to IS NULL OR a.effective_to>now())
    ORDER BY a.customer_id,a.effective_from DESC,a.id DESC
  ),
  metrics AS (
    SELECT m.tenant_id,m.customer_id,m.rolling_spend_minor,m.lifetime_spend_minor,m.visit_count,
      COALESCE(la.lifetime_earned_points,0)::bigint lifetime_earned_points,
      m.last_evaluated_at
    FROM customer_membership_metrics m
    LEFT JOIN loyalty_accounts la ON la.tenant_id=m.tenant_id AND la.customer_id=m.customer_id
    WHERE m.tenant_id=$1
  ),
  spending AS (
    SELECT o.customer_id,
      COALESCE(sum(GREATEST(i.total_minor-COALESCE((
        SELECT sum(r.service_refund_minor+r.tax_refund_minor)
        FROM refunds r
        WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'
      ),0),0)),0)::bigint customer_value_minor
    FROM pos_orders o
    JOIN invoices i ON i.tenant_id=o.tenant_id AND i.pos_order_id=o.id AND i.status='ISSUED'
    WHERE o.tenant_id=$1
    GROUP BY o.customer_id
  ),
  base AS (
    SELECT c.id customer_id,c.display_name,c.phone_normalized,c.email_normalized,c.status customer_status,
      ca.assignment_id,ca.current_tier_id,ca.assignment_status,ca.effective_from,ca.effective_to,
      ca.benefit_snapshot_json,ca.qualification_snapshot_json,ca.supersedes_assignment_id,
      ca.reason_code,ca.assigned_by_user_id,ca.assignment_source,ca.grace_until,
       ca.current_tier_code,ca.current_tier_name,ca.current_priority current_tier_priority,ca.current_qualification_type,
      ca.current_threshold,ca.current_rolling_window_days,
      m.rolling_spend_minor,m.lifetime_spend_minor,m.visit_count,m.lifetime_earned_points,m.last_evaluated_at,
      COALESCE(s.customer_value_minor,0)::bigint customer_value_minor
    FROM customers c
    LEFT JOIN current_assignments ca ON ca.customer_id=c.id
    LEFT JOIN metrics m ON m.customer_id=c.id
    LEFT JOIN spending s ON s.customer_id=c.id
    WHERE c.tenant_id=$1
  ),
  enriched AS (
    SELECT b.*,nt.id next_tier_id,nt.code next_tier_code,nt.name_json next_tier_name,
      nt.priority next_tier_priority,nt.qualification_type next_qualification_type,
      nt.qualification_threshold next_threshold,nt.rolling_window_days next_rolling_window_days,
      CASE
        WHEN nt.qualification_type='ROLLING_SPEND' THEN COALESCE(b.rolling_spend_minor,0)::numeric
        WHEN nt.qualification_type='LIFETIME_SPEND' THEN COALESCE(b.lifetime_spend_minor,0)::numeric
        WHEN nt.qualification_type='VISIT_COUNT' THEN COALESCE(b.visit_count,0)::numeric
        WHEN nt.qualification_type='POINTS_EARNED' THEN COALESCE(b.lifetime_earned_points,0)::numeric
        ELSE NULL
      END progress_value
    FROM base b
    LEFT JOIN LATERAL (
      SELECT t.*
      FROM effective_tiers t
       WHERE (b.current_tier_id IS NULL OR t.priority>b.current_tier_priority)
      ORDER BY t.priority ASC,t.qualification_threshold ASC,t.id ASC
      LIMIT 1
    ) nt ON true
  ),
  scored AS (
    SELECT e.*,
      CASE
        WHEN e.next_tier_id IS NULL OR e.next_qualification_type='MANUAL' THEN NULL
        WHEN e.next_threshold<=0 THEN 100
        ELSE LEAST(100,FLOOR((COALESCE(e.progress_value,0)*100)/e.next_threshold))::int
      END progress_percent,
      CASE
        WHEN e.assignment_id IS NULL THEN 'NO_ACTIVE'
        WHEN e.effective_to IS NOT NULL AND e.effective_to<=now()+make_interval(days=>$2) THEN 'EXPIRING'
        ELSE 'ACTIVE'
      END assignment_state,
      CASE
        WHEN e.assignment_id IS NULL THEN 'NO_CURRENT'
        WHEN e.assignment_source='MANUAL' OR e.next_qualification_type='MANUAL' THEN 'MANUAL'
        WHEN e.next_tier_id IS NULL THEN 'MAX_TIER'
        WHEN e.next_threshold<=0 OR (COALESCE(e.progress_value,0)*100)>=e.next_threshold*90 THEN 'NEAR_UPGRADE'
        ELSE 'IN_PROGRESS'
      END progress_bucket
    FROM enriched e
  )`;

function jsonValue(value: unknown) {
  return value ?? null;
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function tier(row: any, prefix: "current" | "next") {
  const id = row[`${prefix}_tier_id`];
  if (!id) return null;
  return {
    id: String(id),
    code: row[`${prefix}_tier_code`] ?? null,
    name: jsonValue(row[`${prefix}_tier_name`]),
    priority: Number(row[`${prefix}_tier_priority`] ?? 0),
    qualificationType: row[`${prefix}_qualification_type`] ?? null,
    qualificationThreshold: stringValue(row[`${prefix}_threshold`]),
    rollingWindowDays: row[`${prefix}_rolling_window_days`] == null ? null : Number(row[`${prefix}_rolling_window_days`]),
  };
}

function rowToDirectory(row: any, canSeePii: boolean, canSeeFinancial: boolean) {
  const currentTier = tier(row, "current");
  const nextTier = tier(row, "next");
  return {
    customer: {
      id: row.customer_id,
      displayName: row.display_name,
      phone: canSeePii ? row.phone_normalized ?? null : null,
      email: canSeePii ? row.email_normalized ?? null : null,
      status: row.customer_status,
    },
    current: row.assignment_id
      ? {
          assignmentId: row.assignment_id,
          tier: currentTier,
          status: row.assignment_status,
          source: row.assignment_source,
          reasonCode: row.reason_code ?? null,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          graceUntil: row.grace_until,
          benefitSnapshot: jsonValue(row.benefit_snapshot_json),
          qualificationSnapshot: jsonValue(row.qualification_snapshot_json),
          assignedByUserId: row.assigned_by_user_id ?? null,
        }
      : null,
    progress: {
      bucket: row.progress_bucket,
      currentValue: stringValue(row.progress_value) ?? "0",
      targetValue: stringValue(row.next_threshold),
      percentage: row.progress_percent == null ? null : Number(row.progress_percent),
      qualificationType: row.next_qualification_type ?? null,
      nextTier,
      lastEvaluatedAt: row.last_evaluated_at ?? null,
    },
    customerValueMinor: canSeeFinancial ? String(row.customer_value_minor ?? "0") : null,
  };
}

@Injectable()
export class MembershipHubReportingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async overview(auth: AccessClaims) {
    this.assertTenantScope(auth);
    const [tiersResult, totalsResult, expiringResult, opportunitiesResult] = await Promise.all([
      this.db.query<any>(
        `WITH effective_tiers AS (${effectiveTiers}), current_assignments AS (
          SELECT DISTINCT ON (a.customer_id) a.customer_id,a.tier_id,a.effective_to
          FROM customer_membership_assignments a
          JOIN effective_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
          WHERE a.tenant_id=$1 AND a.status='ACTIVE' AND a.effective_from<=now()
            AND (a.effective_to IS NULL OR a.effective_to>now())
          ORDER BY a.customer_id,a.effective_from DESC,a.id DESC
        )
        SELECT t.id,t.code,t.name_json "name",t.qualification_type "qualificationType",
          t.qualification_threshold "qualificationThreshold",t.rolling_window_days "rollingWindowDays",
          t.benefits_json benefits,t.priority,t.effective_from "effectiveFrom",t.effective_to "effectiveTo",t.version,
          count(ca.customer_id)::int "activeCount"
        FROM effective_tiers t
        LEFT JOIN current_assignments ca ON ca.tier_id=t.id
         GROUP BY t.id,t.code,t.name_json,t.qualification_type,t.qualification_threshold,t.rolling_window_days,t.benefits_json,t.priority,t.effective_from,t.effective_to,t.version
        ORDER BY t.priority ASC,t.id ASC`,
        [auth.tenantId],
      ),
      this.db.query<any>(
        `WITH effective_tiers AS (${effectiveTiers}), current_assignments AS (
          SELECT DISTINCT ON (a.customer_id) a.customer_id,a.tier_id,a.effective_to
          FROM customer_membership_assignments a
          JOIN effective_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
          WHERE a.tenant_id=$1 AND a.status='ACTIVE' AND a.effective_from<=now()
            AND (a.effective_to IS NULL OR a.effective_to>now())
          ORDER BY a.customer_id,a.effective_from DESC,a.id DESC
        )
        SELECT
          (SELECT count(*)::int FROM customers c WHERE c.tenant_id=$1 AND c.status='ACTIVE') active_customer_count,
          (SELECT count(*)::int FROM current_assignments) active_membership_count,
          (SELECT count(*)::int FROM current_assignments WHERE effective_to IS NOT NULL AND effective_to<=now()+interval '30 days') expiring30d_count`,
        [auth.tenantId],
      ),
      this.db.query<any>(
        `WITH effective_tiers AS (${effectiveTiers})
         SELECT a.id assignment_id,a.customer_id,c.display_name,a.effective_to,t.name_json tier_name
         FROM customer_membership_assignments a
         JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id
         JOIN effective_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
         WHERE a.tenant_id=$1 AND a.status='ACTIVE' AND a.effective_from<=now()
           AND a.effective_to IS NOT NULL AND a.effective_to>now()
           AND a.effective_to<=now()+interval '30 days'
         ORDER BY a.effective_to ASC,a.id ASC LIMIT 5`,
        [auth.tenantId],
      ),
      this.db.query<any>(
        `WITH effective_tiers AS (${effectiveTiers}), current_assignments AS (
          SELECT DISTINCT ON (a.customer_id) a.customer_id,a.tier_id,a.assignment_source,a.effective_to,
            t.priority current_priority
          FROM customer_membership_assignments a
          JOIN effective_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
          WHERE a.tenant_id=$1 AND a.status='ACTIVE' AND a.effective_from<=now()
            AND (a.effective_to IS NULL OR a.effective_to>now())
          ORDER BY a.customer_id,a.effective_from DESC,a.id DESC
        ), metrics AS (
          SELECT m.customer_id,m.rolling_spend_minor,m.lifetime_spend_minor,m.visit_count,
            COALESCE(la.lifetime_earned_points,0)::bigint lifetime_earned_points
          FROM customer_membership_metrics m
          LEFT JOIN loyalty_accounts la ON la.tenant_id=m.tenant_id AND la.customer_id=m.customer_id
          WHERE m.tenant_id=$1
        ), candidates AS (
          SELECT c.id customer_id,c.display_name,ca.assignment_source,nt.id next_tier_id,nt.name_json next_tier_name,
            nt.qualification_type next_qualification_type,nt.qualification_threshold next_threshold,
            CASE
              WHEN nt.qualification_type='ROLLING_SPEND' THEN COALESCE(m.rolling_spend_minor,0)::numeric
              WHEN nt.qualification_type='LIFETIME_SPEND' THEN COALESCE(m.lifetime_spend_minor,0)::numeric
              WHEN nt.qualification_type='VISIT_COUNT' THEN COALESCE(m.visit_count,0)::numeric
              WHEN nt.qualification_type='POINTS_EARNED' THEN COALESCE(m.lifetime_earned_points,0)::numeric
              ELSE NULL
            END progress_value
          FROM customers c
          JOIN current_assignments ca ON ca.customer_id=c.id
          LEFT JOIN metrics m ON m.customer_id=c.id
          LEFT JOIN LATERAL (
            SELECT t.* FROM effective_tiers t
            WHERE t.priority>ca.current_priority
            ORDER BY t.priority ASC,t.qualification_threshold ASC,t.id ASC LIMIT 1
          ) nt ON true
          WHERE c.tenant_id=$1 AND ca.assignment_source='AUTOMATIC' AND nt.id IS NOT NULL
            AND nt.qualification_type<>'MANUAL'
        )
        SELECT * FROM candidates
        WHERE COALESCE(progress_value,0)*100>=next_threshold*90
        ORDER BY (COALESCE(progress_value,0)*100/NULLIF(next_threshold,0)) DESC,display_name ASC
        LIMIT 5`,
        [auth.tenantId],
      ),
    ]);
    const tiers = tiersResult.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: jsonValue(row.name),
      priority: Number(row.priority ?? 0),
      qualificationType: row.qualificationType,
      qualificationThreshold: String(row.qualificationThreshold ?? "0"),
      rollingWindowDays: row.rollingWindowDays == null ? null : Number(row.rollingWindowDays),
      benefits: jsonValue(row.benefits) ?? [],
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      status: "ACTIVE",
      version: row.version,
      activeCount: Number(row.activeCount ?? 0),
    }));
    const totals = totalsResult.rows[0] ?? {};
    const activeMembershipCount = Number(totals.active_membership_count ?? 0);
    const activeCustomerCount = Number(totals.active_customer_count ?? 0);
    const canSeeFinancial = await this.hasPermission(auth, "invoice.read");
    const financial = canSeeFinancial
      ? await this.db.query<any>(
          `WITH active_customers AS (
             SELECT DISTINCT a.customer_id
             FROM customer_membership_assignments a
             JOIN membership_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
             WHERE a.tenant_id=$1 AND a.status='ACTIVE' AND a.effective_from<=now()
               AND (a.effective_to IS NULL OR a.effective_to>now())
               AND t.status='ACTIVE' AND t.effective_from<=now() AND (t.effective_to IS NULL OR t.effective_to>now())
           )
           SELECT COALESCE(sum(GREATEST(i.total_minor-COALESCE((SELECT sum(r.service_refund_minor+r.tax_refund_minor) FROM refunds r WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0),0)),0)::bigint membership_revenue_minor
           FROM invoices i JOIN pos_orders o ON o.tenant_id=i.tenant_id AND o.id=i.pos_order_id
           JOIN active_customers ac ON ac.customer_id=o.customer_id
           WHERE i.tenant_id=$1 AND i.status='ISSUED'`,
          [auth.tenantId],
        )
      : null;
    return {
      totals: {
        activeMembershipCount,
        activeCustomerCount,
        membershipCoveragePercent: activeCustomerCount ? Number(((activeMembershipCount * 10000) / activeCustomerCount).toFixed(2)) / 100 : 0,
        expiring30dCount: Number(totals.expiring30d_count ?? 0),
      },
      tiers,
      distribution: tiers.map((item) => ({ tierId: item.id, activeCount: item.activeCount, activePercent: activeMembershipCount ? Number(((item.activeCount * 10000) / activeMembershipCount).toFixed(2)) / 100 : 0 })),
      expiring: {
        windowDays: 30,
        count: Number(totals.expiring30d_count ?? 0),
        customers: expiringResult.rows.map((row) => ({ assignmentId: row.assignment_id, customerId: row.customer_id, displayName: row.display_name, tierName: jsonValue(row.tier_name), effectiveTo: row.effective_to })),
      },
      upgradeOpportunities: opportunitiesResult.rows.map((row) => ({ customerId: row.customer_id, displayName: row.display_name, assignmentSource: row.assignment_source, nextTier: { id: row.next_tier_id, name: jsonValue(row.next_tier_name), qualificationType: row.next_qualification_type, threshold: String(row.next_threshold ?? "0") }, currentValue: String(row.progress_value ?? "0"), percentage: row.next_threshold && Number(row.next_threshold) > 0 ? Math.min(100, Number(row.progress_value ?? 0) * 100 / Number(row.next_threshold)) : null })),
      financial: canSeeFinancial ? { visible: true, membershipRevenueMinor: String(financial?.rows[0]?.membership_revenue_minor ?? "0") } : { visible: false, reason: "FINANCIAL_PERMISSION_REQUIRED" },
      generatedAt: new Date().toISOString(),
    };
  }

  async directory(auth: AccessClaims, input: unknown) {
    this.assertTenantScope(auth);
    const query = membershipHubDirectoryQuerySchema.parse(input);
    const canSeePii = await this.hasPermission(auth, "customer.read");
    const canSeeFinancial = await this.hasPermission(auth, "invoice.read");
    const params: unknown[] = [auth.tenantId, query.expiryWindowDays];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const filters: string[] = [];
    if (query.search) {
      const p = push(`%${query.search}%`);
       filters.push(`(e.customer_id::text ILIKE ${p} OR e.display_name ILIKE ${p} OR COALESCE(e.phone_normalized,'') ILIKE ${p} OR COALESCE(e.email_normalized,'') ILIKE ${p} OR COALESCE(e.current_tier_code,'') ILIKE ${p} OR COALESCE(e.current_tier_name::text,'') ILIKE ${p})`);
    }
    if (query.tierId) filters.push(`e.current_tier_id=${push(query.tierId)}`);
    if (query.assignmentState !== "ALL") filters.push(`e.assignment_state=${push(query.assignmentState)}`);
    if (query.assignmentSource !== "ALL") filters.push(`e.assignment_source=${push(query.assignmentSource)}`);
    if (query.progressBucket !== "ALL") filters.push(`e.progress_bucket=${push(query.progressBucket)}`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const sort = {
      CUSTOMER_NAME: "e.display_name ASC,e.customer_id ASC",
      POINTS_DESC: "COALESCE(e.lifetime_earned_points,0) DESC,e.display_name ASC,e.customer_id ASC",
      SPENDING_DESC: "COALESCE(e.customer_value_minor,0) DESC,e.display_name ASC,e.customer_id ASC",
      EXPIRY_ASC: "e.effective_to NULLS LAST,e.display_name ASC,e.customer_id ASC",
      PROGRESS_DESC: "e.progress_percent DESC NULLS LAST,e.display_name ASC,e.customer_id ASC",
    }[query.sort];
    const baseParams = params.slice();
    const limit = push(query.pageSize);
    const offset = push((query.page - 1) * query.pageSize);
    const filteredCte = `${directoryCte}, filtered AS (SELECT * FROM scored e ${where})`;
    const [itemsResult, countResult, summaryResult] = await Promise.all([
      this.db.query<any>(`${filteredCte} SELECT * FROM filtered e ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`, params),
      this.db.query<any>(`${filteredCte} SELECT count(*)::int total FROM filtered`, baseParams),
      this.db.query<any>(`${filteredCte} SELECT count(*)::int total, count(*) FILTER(WHERE assignment_state='ACTIVE')::int active, count(*) FILTER(WHERE assignment_state='EXPIRING')::int expiring, count(*) FILTER(WHERE progress_bucket='NEAR_UPGRADE')::int near_upgrade FROM filtered`, baseParams),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    return {
      items: itemsResult.rows.map((row) => rowToDirectory(row, canSeePii, canSeeFinancial)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      summary: {
        total,
        active: Number(summaryResult.rows[0]?.active ?? 0),
        expiring: Number(summaryResult.rows[0]?.expiring ?? 0),
        nearUpgrade: Number(summaryResult.rows[0]?.near_upgrade ?? 0),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async summary(auth: AccessClaims, customerId: string) {
    this.assertTenantScope(auth);
    const canSeePii = await this.hasPermission(auth, "customer.read");
    const canSeeFinancial = await this.hasPermission(auth, "invoice.read");
    const [customerResult, assignmentsResult, metricsResult, usageResult] = await Promise.all([
      this.db.query<any>("SELECT id,display_name,phone_normalized,email_normalized,status FROM customers WHERE tenant_id=$1 AND id=$2", [auth.tenantId, customerId]),
      this.db.query<any>(
        `SELECT a.*,t.id tier_id,t.code tier_code,t.name_json tier_name,t.priority,t.qualification_type,t.qualification_threshold,t.rolling_window_days,
          u.display_name assigned_by_name
         FROM customer_membership_assignments a
         JOIN membership_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
         LEFT JOIN users u ON u.id=a.assigned_by_user_id
         WHERE a.tenant_id=$1 AND a.customer_id=$2 ORDER BY a.effective_from DESC,a.id DESC`,
        [auth.tenantId, customerId],
      ),
      this.db.query<any>(
        `SELECT m.rolling_spend_minor,m.lifetime_spend_minor,m.visit_count,m.last_evaluated_at,
          COALESCE(la.lifetime_earned_points,0)::bigint lifetime_earned_points,
          la.available_points,la.pending_points,la.reserved_points
         FROM customer_membership_metrics m
         LEFT JOIN loyalty_accounts la ON la.tenant_id=m.tenant_id AND la.customer_id=m.customer_id
         WHERE m.tenant_id=$1 AND m.customer_id=$2`,
        [auth.tenantId, customerId],
      ),
      this.db.query<any>(
        `SELECT count(*)::int usage_count,COALESCE(sum(amount_minor),0)::bigint value_minor,max(updated_at) last_used_at
         FROM pos_order_benefit_applications
         WHERE tenant_id=$1 AND customer_id=$2 AND benefit_type='MEMBERSHIP' AND status='COMMITTED'`,
        [auth.tenantId, customerId],
      ),
    ]);
    const customer = customerResult.rows[0];
    if (!customer) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Customer was not found" });
    const assignments = assignmentsResult.rows.map((row) => ({
      id: row.id,
      tier: { id: row.tier_id, code: row.tier_code, name: jsonValue(row.tier_name), priority: Number(row.priority ?? 0), qualificationType: row.qualification_type, threshold: String(row.qualification_threshold ?? "0"), rollingWindowDays: row.rolling_window_days == null ? null : Number(row.rolling_window_days) },
      status: row.status,
      source: row.assignment_source,
      reasonCode: row.reason_code ?? null,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      graceUntil: row.grace_until,
      benefitSnapshot: jsonValue(row.benefit_snapshot_json),
      qualificationSnapshot: jsonValue(row.qualification_snapshot_json),
      assignedBy: row.assigned_by_user_id ? { id: row.assigned_by_user_id, displayName: row.assigned_by_name ?? null } : null,
      supersedesAssignmentId: row.supersedes_assignment_id,
    }));
    const current = assignments.find((row) => row.status === "ACTIVE" && new Date(row.effectiveFrom).getTime() <= Date.now() && (!row.effectiveTo || new Date(row.effectiveTo).getTime() > Date.now())) ?? null;
    const nextTierResult = current
      ? await this.db.query<any>(`SELECT id,code,name_json "name",priority,qualification_type "qualificationType",qualification_threshold "qualificationThreshold",rolling_window_days "rollingWindowDays",benefits_json benefits FROM membership_tiers WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) AND priority>$2 ORDER BY priority ASC,qualification_threshold ASC,id ASC LIMIT 1`, [auth.tenantId, current.tier.priority])
      : { rows: [] };
    const metrics = metricsResult.rows[0] ?? null;
    const progressValue = current && nextTierResult.rows[0] && metrics ? this.qualificationValue(nextTierResult.rows[0].qualificationType, metrics) : null;
    const target = nextTierResult.rows[0]?.qualificationThreshold == null ? null : String(nextTierResult.rows[0].qualificationThreshold);
    return {
      customer: { id: customer.id, displayName: customer.display_name, phone: canSeePii ? customer.phone_normalized ?? null : null, email: canSeePii ? customer.email_normalized ?? null : null, status: customer.status },
      currentAssignment: current,
      nextTier: nextTierResult.rows[0] ? { id: nextTierResult.rows[0].id, code: nextTierResult.rows[0].code, name: jsonValue(nextTierResult.rows[0].name), priority: Number(nextTierResult.rows[0].priority ?? 0), qualificationType: nextTierResult.rows[0].qualificationType, threshold: target, rollingWindowDays: nextTierResult.rows[0].rollingWindowDays == null ? null : Number(nextTierResult.rows[0].rollingWindowDays), benefits: jsonValue(nextTierResult.rows[0].benefits) ?? [] } : null,
      progress: { currentValue: progressValue == null ? null : String(progressValue), targetValue: target, percentage: progressValue == null || !target || Number(target) <= 0 ? null : Math.min(100, Number(progressValue) * 100 / Number(target)), lastEvaluatedAt: metrics?.last_evaluated_at ?? null },
      qualificationMetrics: metrics ? { rollingSpendMinor: String(metrics.rolling_spend_minor ?? "0"), lifetimeSpendMinor: String(metrics.lifetime_spend_minor ?? "0"), visitCount: String(metrics.visit_count ?? "0"), lifetimeEarnedPoints: String(metrics.lifetime_earned_points ?? "0") } : null,
      loyalty: metrics ? { availablePoints: String(metrics.available_points ?? "0"), pendingPoints: String(metrics.pending_points ?? "0"), reservedPoints: String(metrics.reserved_points ?? "0"), lifetimeEarnedPoints: String(metrics.lifetime_earned_points ?? "0") } : null,
      usage: { count: Number(usageResult.rows[0]?.usage_count ?? 0), valueMinor: String(usageResult.rows[0]?.value_minor ?? "0"), lastUsedAt: usageResult.rows[0]?.last_used_at ?? null },
      financial: canSeeFinancial ? { visible: true } : { visible: false, reason: "FINANCIAL_PERMISSION_REQUIRED" },
      history: assignments,
      generatedAt: new Date().toISOString(),
    };
  }

  private qualificationValue(type: string | null | undefined, metrics: any) {
    if (type === "ROLLING_SPEND") return metrics.rolling_spend_minor ?? 0;
    if (type === "LIFETIME_SPEND") return metrics.lifetime_spend_minor ?? 0;
    if (type === "VISIT_COUNT") return metrics.visit_count ?? 0;
    if (type === "POINTS_EARNED") return metrics.lifetime_earned_points ?? 0;
    return null;
  }

  private async hasPermission(auth: AccessClaims, permission: string) {
    if (auth.supportAccess) return auth.supportAccess.permissions.includes(permission);
    const result = await this.db.query("SELECT 1 FROM membership_roles mr JOIN role_permissions rp ON rp.role=mr.role WHERE mr.membership_id=$1 AND rp.permission_code=$2 LIMIT 1", [auth.membershipId, permission]);
    return result.rowCount === 1;
  }

  private assertTenantScope(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN") && !auth.supportAccess) {
      throw new ForbiddenException({ code: "PERMISSION_DENIED", message: "Platform support requires an explicit tenant access grant" });
    }
  }
}
