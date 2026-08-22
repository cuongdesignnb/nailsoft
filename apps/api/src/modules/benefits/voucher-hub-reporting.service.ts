/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  voucherDirectoryQuerySchema,
  voucherEligibilityPreviewSchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { BenefitsEligibilityService } from "./benefits-eligibility.service.js";

const voucherBaseCte = `
  WITH campaign_branches AS (
    SELECT c.id campaign_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code) ORDER BY b.name,b.id)
        FROM voucher_campaign_branches cb JOIN branches b ON b.tenant_id=cb.tenant_id AND b.id=cb.branch_id
        WHERE cb.tenant_id=c.tenant_id AND cb.campaign_id=c.id),'[]'::jsonb) branch_rules,
      COALESCE((SELECT array_agg(cb.branch_id) FROM voucher_campaign_branches cb WHERE cb.tenant_id=c.tenant_id AND cb.campaign_id=c.id),'{}'::uuid[]) branch_ids
    FROM voucher_campaigns c WHERE c.tenant_id=$1
  ), campaign_services AS (
    SELECT c.id campaign_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'name',s.name_json) ORDER BY s.code)
        FROM voucher_campaign_services cs JOIN services s ON s.tenant_id=cs.tenant_id AND s.id=cs.service_id
        WHERE cs.tenant_id=c.tenant_id AND cs.campaign_id=c.id),'[]'::jsonb) service_rules,
      COALESCE((SELECT array_agg(cs.service_id) FROM voucher_campaign_services cs WHERE cs.tenant_id=c.tenant_id AND cs.campaign_id=c.id),'{}'::uuid[]) service_ids
    FROM voucher_campaigns c WHERE c.tenant_id=$1
  ), campaign_tiers AS (
    SELECT c.id campaign_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'name',t.name_json) ORDER BY t.priority,t.code)
        FROM membership_tiers t WHERE t.tenant_id=c.tenant_id AND t.id=ANY(c.membership_tier_ids)),'[]'::jsonb) membership_tier_rules,
      COALESCE((SELECT count(*)::int FROM voucher_campaign_customers cc WHERE cc.tenant_id=c.tenant_id AND cc.campaign_id=c.id),0)::int campaign_customer_count
    FROM voucher_campaigns c WHERE c.tenant_id=$1
  ), usage_rollup AS (
    SELECT e.voucher_code_id,
      count(*) FILTER (WHERE e.entry_type='COMMIT')::int commit_count,
      count(*) FILTER (WHERE e.entry_type='COMMIT' AND e.created_at>=date_trunc('month',now()))::int commit_count_this_month,
      COALESCE(sum(e.discount_minor) FILTER (WHERE e.entry_type='COMMIT'),0)::bigint committed_discount_minor,
      max(e.created_at) FILTER (WHERE e.entry_type='COMMIT') last_used_at,
      max(e.created_at) last_activity_at
    FROM voucher_redemption_entries e WHERE e.tenant_id=$1 GROUP BY e.voucher_code_id
  ), reservation_rollup AS (
    SELECT r.voucher_code_id,
      count(*) FILTER (WHERE r.status='ACTIVE')::int active_reservation_count,
      max(r.created_at) last_reserved_at
    FROM voucher_reservations r WHERE r.tenant_id=$1 GROUP BY r.voucher_code_id
  ), base AS (
    SELECT vc.id voucher_id,vc.tenant_id,vc.campaign_id,vc.customer_id,vc.code_last4,vc.status persisted_status,
      vc.use_limit,vc.reserved_count,vc.used_count,vc.version,vc.expires_at code_expires_at,vc.created_at issued_at,
      c.name campaign_name,c.description campaign_description,c.status campaign_status,c.discount_type,c.discount_value,c.currency,
      c.minimum_spend_minor,c.maximum_discount_minor,c.total_use_limit,c.reserved_count campaign_reserved_count,c.used_count campaign_used_count,
      c.per_customer_use_limit,c.code_use_limit,c.membership_tier_ids,c.eligibility_policy_json,c.stack_policy,c.refund_policy,
      c.valid_from,c.valid_until,c.version campaign_version,
      CASE WHEN vc.expires_at IS NULL THEN c.valid_until ELSE LEAST(vc.expires_at,c.valid_until) END effective_expires_at,
      CASE WHEN c.status='ACTIVE' AND c.valid_from>now() THEN 'NOT_STARTED'
        WHEN c.status='ACTIVE' AND c.valid_until<=now() THEN 'ENDED'
        ELSE c.status END campaign_availability,
      GREATEST(vc.use_limit-vc.used_count-vc.reserved_count,0)::int remaining_capacity,
      CASE WHEN vc.status='CANCELLED' THEN 'CANCELLED'
        WHEN vc.status='USED' OR vc.used_count>=vc.use_limit THEN 'USED'
        WHEN vc.status='EXPIRED' OR (CASE WHEN vc.expires_at IS NULL THEN c.valid_until ELSE LEAST(vc.expires_at,c.valid_until) END)<=now() THEN 'EXPIRED'
        WHEN vc.status='PARTIALLY_USED' OR vc.used_count>0 THEN 'PARTIALLY_USED'
        WHEN (CASE WHEN vc.expires_at IS NULL THEN c.valid_until ELSE LEAST(vc.expires_at,c.valid_until) END)<=now()+make_interval(days=>$2)
          AND GREATEST(vc.use_limit-vc.used_count-vc.reserved_count,0)>0 THEN 'EXPIRING'
        ELSE 'USABLE' END derived_state,
      cb.branch_rules,cb.branch_ids,cs.service_rules,cs.service_ids,ct.membership_tier_rules,ct.campaign_customer_count,
      customer.display_name customer_name,customer.phone_normalized customer_phone,customer.email_normalized customer_email,
      customer.status customer_status,
      issuer.id issuer_id,issuer.display_name issuer_name,
      COALESCE(u.commit_count,0)::int commit_count,COALESCE(u.commit_count_this_month,0)::int commit_count_this_month,
      COALESCE(u.committed_discount_minor,0)::bigint committed_discount_minor,u.last_used_at,u.last_activity_at,
      COALESCE(rr.active_reservation_count,0)::int active_reservation_count,rr.last_reserved_at
    FROM voucher_codes vc
    JOIN voucher_campaigns c ON c.tenant_id=vc.tenant_id AND c.id=vc.campaign_id
    LEFT JOIN customers customer ON customer.tenant_id=vc.tenant_id AND customer.id=vc.customer_id
    LEFT JOIN users issuer ON issuer.id=vc.issued_by_user_id
    LEFT JOIN campaign_branches cb ON cb.campaign_id=c.id
    LEFT JOIN campaign_services cs ON cs.campaign_id=c.id
    LEFT JOIN campaign_tiers ct ON ct.campaign_id=c.id
    LEFT JOIN usage_rollup u ON u.voucher_code_id=vc.id
    LEFT JOIN reservation_rollup rr ON rr.voucher_code_id=vc.id
    WHERE vc.tenant_id=$1
  )`;

function jsonValue(value: unknown) {
  return value ?? null;
}

function money(value: unknown) {
  return String(value ?? "0");
}

function directoryRow(row: any, canSeePii: boolean) {
  return {
    id: row.voucher_id,
    codeLast4: row.code_last4,
    assignmentScope: row.customer_id ? "CUSTOMER_ASSIGNED" : "GENERAL",
    customer: row.customer_id
      ? {
          id: row.customer_id,
          displayName: row.customer_name,
          phone: canSeePii ? row.customer_phone ?? null : null,
          email: canSeePii ? row.customer_email ?? null : null,
          status: row.customer_status,
        }
      : null,
    campaign: {
      id: row.campaign_id,
      name: row.campaign_name,
      status: row.campaign_status,
      availability: row.campaign_availability,
      description: row.campaign_description,
      discountType: row.discount_type,
      discountValue: String(row.discount_value ?? "0"),
      currency: row.currency,
      minimumSpendMinor: money(row.minimum_spend_minor),
      maximumDiscountMinor: row.maximum_discount_minor == null ? null : money(row.maximum_discount_minor),
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      stackPolicy: row.stack_policy,
      refundPolicy: row.refund_policy,
    },
    status: row.persisted_status,
    derivedState: row.derived_state,
    campaignAvailability: row.campaign_availability,
    useLimit: Number(row.use_limit ?? 0),
    reservedCount: Number(row.reserved_count ?? 0),
    usedCount: Number(row.used_count ?? 0),
    remainingCapacity: Number(row.remaining_capacity ?? 0),
    issuedAt: row.issued_at,
    codeExpiresAt: row.code_expires_at,
    effectiveExpiresAt: row.effective_expires_at,
    version: Number(row.version ?? 1),
    issuedBy: row.issuer_id ? { id: row.issuer_id, displayName: row.issuer_name } : null,
    conditions: {
      branches: row.branch_rules ?? [],
      services: row.service_rules ?? [],
      membershipTiers: row.membership_tier_rules ?? [],
      campaignCustomerCount: Number(row.campaign_customer_count ?? 0),
      minimumSpendMinor: money(row.minimum_spend_minor),
      maximumDiscountMinor: row.maximum_discount_minor == null ? null : money(row.maximum_discount_minor),
    },
    usage: {
      committedCount: Number(row.commit_count ?? 0),
      committedThisMonth: Number(row.commit_count_this_month ?? 0),
      committedDiscountMinor: money(row.committed_discount_minor),
      lastUsedAt: row.last_used_at ?? null,
      lastActivityAt: row.last_activity_at ?? null,
      activeReservationCount: Number(row.active_reservation_count ?? 0),
    },
  };
}

@Injectable()
export class VoucherHubReportingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BenefitsEligibilityService)
    private readonly eligibility: BenefitsEligibilityService,
  ) {}

  async overview(auth: AccessClaims) {
    this.assertTenantScope(auth);
    const [totals, currencies, distribution, expiring, unused, activity, campaigns, branches, tiers, services] = await Promise.all([
      this.db.query<any>(`${voucherBaseCte} SELECT
        count(*) FILTER (WHERE derived_state='USABLE' AND campaign_availability='ACTIVE')::int usable_count,
        count(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL)::int assigned_customer_count,
        COALESCE(sum(commit_count_this_month),0)::int used_this_month,
        count(*) FILTER (WHERE derived_state='EXPIRING' AND remaining_capacity>0)::int expiring_count,
        count(*) FILTER (WHERE customer_id IS NOT NULL AND used_count=0 AND issued_at<=now()-interval '30 days' AND derived_state NOT IN ('EXPIRED','CANCELLED'))::int unused_older_than_30_count,
        count(*)::int total_count
        FROM base`, [auth.tenantId, 30]),
      this.db.query<any>(`SELECT COALESCE(r.currency,po.currency,c.currency,t.currency,'VND') currency,
        COALESCE(sum(e.discount_minor),0)::bigint amount_minor,count(*)::int redemption_count
        FROM voucher_redemption_entries e
        JOIN voucher_codes vc ON vc.tenant_id=e.tenant_id AND vc.id=e.voucher_code_id
        JOIN voucher_campaigns c ON c.tenant_id=vc.tenant_id AND c.id=vc.campaign_id
        JOIN tenants t ON t.id=e.tenant_id
        LEFT JOIN voucher_reservations r ON r.tenant_id=e.tenant_id AND r.id=e.reservation_id
        LEFT JOIN pos_orders po ON po.tenant_id=e.tenant_id AND po.id=r.pos_order_id
        WHERE e.tenant_id=$1 AND e.entry_type='COMMIT' AND e.created_at>=date_trunc('month',now())
        GROUP BY COALESCE(r.currency,po.currency,c.currency,t.currency,'VND') ORDER BY 1`, [auth.tenantId]),
      this.db.query<any>(`${voucherBaseCte} SELECT derived_state status,count(*)::int count FROM base GROUP BY derived_state ORDER BY derived_state`, [auth.tenantId, 30]),
      this.db.query<any>(`${voucherBaseCte} SELECT * FROM base WHERE derived_state='EXPIRING' AND remaining_capacity>0 ORDER BY effective_expires_at,voucher_id LIMIT 6`, [auth.tenantId, 30]),
      this.db.query<any>(`${voucherBaseCte} SELECT * FROM base WHERE customer_id IS NOT NULL AND used_count=0 AND issued_at<=now()-interval '30 days' AND derived_state NOT IN ('EXPIRED','CANCELLED') ORDER BY issued_at LIMIT 6`, [auth.tenantId, 30]),
      this.db.query<any>(`SELECT e.id,e.entry_type,e.discount_minor,e.use_delta,e.created_at,e.voucher_code_id,e.pos_order_id,e.refund_id,e.credit_note_id,
        c.display_name,vc.code_last4,ca.name campaign_name,po.order_number,r.refund_reference,cn.credit_note_number
        FROM voucher_redemption_entries e
        JOIN voucher_codes vc ON vc.tenant_id=e.tenant_id AND vc.id=e.voucher_code_id
        JOIN voucher_campaigns ca ON ca.tenant_id=vc.tenant_id AND ca.id=vc.campaign_id
        LEFT JOIN customers c ON c.tenant_id=e.tenant_id AND c.id=COALESCE((SELECT customer_id FROM voucher_reservations vr WHERE vr.tenant_id=e.tenant_id AND vr.id=e.reservation_id),NULL)
        LEFT JOIN pos_orders po ON po.tenant_id=e.tenant_id AND po.id=e.pos_order_id
        LEFT JOIN refunds r ON r.tenant_id=e.tenant_id AND r.id=e.refund_id
        LEFT JOIN credit_notes cn ON cn.tenant_id=e.tenant_id AND cn.id=e.credit_note_id
        WHERE e.tenant_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 8`, [auth.tenantId]),
      this.db.query<any>(`SELECT id,name,status,discount_type "discountType",discount_value "discountValue",currency,valid_from "validFrom",valid_until "validUntil" FROM voucher_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT 250`, [auth.tenantId]),
      this.db.query<any>(`SELECT id,name,code FROM branches WHERE tenant_id=$1 AND status<>'ARCHIVED' ORDER BY name,id`, [auth.tenantId]),
      this.db.query<any>(`SELECT id,code,name_json "name" FROM membership_tiers WHERE tenant_id=$1 AND status<>'ARCHIVED' ORDER BY priority,code`, [auth.tenantId]),
      this.db.query<any>(`SELECT id,code,name_json "name",base_price_minor "basePriceMinor",status FROM services WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY code LIMIT 500`, [auth.tenantId]),
    ]);
    const totalsRow = totals.rows[0] ?? {};
    return {
      kpis: {
        usableCount: Number(totalsRow.usable_count ?? 0),
        assignedCustomerCount: Number(totalsRow.assigned_customer_count ?? 0),
        usedThisMonth: Number(totalsRow.used_this_month ?? 0),
        expiringCount: Number(totalsRow.expiring_count ?? 0),
        unusedOlderThan30Count: Number(totalsRow.unused_older_than_30_count ?? 0),
        totalCount: Number(totalsRow.total_count ?? 0),
        appliedDiscountByCurrency: currencies.rows.map((row) => ({ currency: row.currency, amountMinor: money(row.amount_minor), redemptionCount: Number(row.redemption_count ?? 0) })),
      },
      statusDistribution: distribution.rows.map((row) => ({ status: row.status, count: Number(row.count ?? 0) })),
      expiring: expiring.rows.map((row) => directoryRow(row, false)),
      unusedOlderThan30: unused.rows.map((row) => directoryRow(row, false)),
      activity: activity.rows.map((row) => ({
        id: row.id, entryType: row.entry_type, codeLast4: row.code_last4, campaignName: row.campaign_name,
        customerName: row.display_name ?? "Voucher dùng chung", discountMinor: money(row.discount_minor), useDelta: String(row.use_delta ?? "0"),
        createdAt: row.created_at, voucherCodeId: row.voucher_code_id, posOrderId: row.pos_order_id ?? null,
        refundId: row.refund_id ?? null, creditNoteId: row.credit_note_id ?? null, orderNumber: row.order_number ?? null,
        refundReference: row.refund_reference ?? null, creditNoteNumber: row.credit_note_number ?? null,
      })),
      options: {
        campaigns: campaigns.rows,
        branches: branches.rows,
        membershipTiers: tiers.rows,
        services: services.rows,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async directory(auth: AccessClaims, input: unknown) {
    this.assertTenantScope(auth);
    const query = voucherDirectoryQuerySchema.parse(input);
    const canSeePii = await this.hasPermission(auth, "customer.read");
    const params: unknown[] = [auth.tenantId, query.expiryWindowDays];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const filters: string[] = [];
    if (query.search) {
      const search = push(`%${query.search}%`);
      filters.push(`(b.voucher_id::text ILIKE ${search} OR b.code_last4 ILIKE ${search} OR b.campaign_name ILIKE ${search} OR b.customer_name ILIKE ${search}${canSeePii ? ` OR COALESCE(b.customer_phone,'') ILIKE ${search}` : ""})`);
    }
    if (query.assignmentScope === "CUSTOMER_ASSIGNED") filters.push("b.customer_id IS NOT NULL");
    if (query.assignmentScope === "GENERAL") filters.push("b.customer_id IS NULL");
    if (query.customerId) filters.push(`b.customer_id=${push(query.customerId)}`);
    if (query.campaignId) filters.push(`b.campaign_id=${push(query.campaignId)}`);
    if (query.discountType) filters.push(`b.discount_type=${push(query.discountType)}`);
    if (query.branchId) {
      const branch = push(query.branchId);
      filters.push(`(cardinality(b.branch_ids)=0 OR ${branch}=ANY(b.branch_ids))`);
    }
    if (query.membershipTierId) {
      const tier = push(query.membershipTierId);
      filters.push(`(cardinality(b.membership_tier_ids)=0 OR ${tier}=ANY(b.membership_tier_ids))`);
    }
    if (query.lifecycleState !== "ALL") {
      const state = push(query.lifecycleState);
      filters.push(`b.derived_state=${state}`);
      if (query.lifecycleState === "USABLE") filters.push("b.campaign_availability='ACTIVE' AND b.remaining_capacity>0");
    }
    if (query.unusedOlderThanDays) filters.push(`b.customer_id IS NOT NULL AND b.used_count=0 AND b.issued_at<=now()-make_interval(days=>${push(query.unusedOlderThanDays)})`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const sort = {
      NEWEST: "b.issued_at DESC,b.voucher_id DESC",
      OLDEST: "b.issued_at ASC,b.voucher_id ASC",
      EXPIRY_ASC: "b.effective_expires_at ASC NULLS LAST,b.voucher_id ASC",
      USED_DESC: "b.used_count DESC,b.issued_at DESC,b.voucher_id DESC",
      CUSTOMER_NAME: "b.customer_name ASC NULLS LAST,b.issued_at DESC,b.voucher_id DESC",
    }[query.sort];
    const countParams = params.slice();
    const limit = push(query.pageSize);
    const offset = push((query.page - 1) * query.pageSize);
    const filteredCte = `${voucherBaseCte}, filtered AS (SELECT * FROM base b ${where})`;
    const [items, count] = await Promise.all([
      this.db.query<any>(`${filteredCte} SELECT * FROM filtered b ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`, params),
      this.db.query<any>(`${filteredCte} SELECT count(*)::int total FROM filtered`, countParams),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: items.rows.map((row) => directoryRow(row, canSeePii)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      appliedFilters: query,
      generatedAt: new Date().toISOString(),
    };
  }

  async overviewDetail(auth: AccessClaims, voucherId: string) {
    this.assertTenantScope(auth);
    const canSeePii = await this.hasPermission(auth, "customer.read");
    const rowResult = await this.db.query<any>(`${voucherBaseCte} SELECT * FROM base WHERE voucher_id=$3`, [auth.tenantId, 30, voucherId]);
    const row = rowResult.rows[0];
    if (!row) throw new NotFoundException({ code: "VOUCHER_NOT_FOUND", message: "Voucher code was not found" });
    const [redemptions, reservations, conflicts, audit, campaignCustomers] = await Promise.all([
      this.db.query<any>(`SELECT e.id,e.entry_type,e.use_delta,e.discount_minor,e.policy_snapshot_json,e.generation_key,e.created_at,e.pos_order_id,e.refund_id,e.credit_note_id,
        po.order_number,po.branch_id,b.name branch_name,i.id invoice_id,i.invoice_number,r.refund_reference,r.status refund_status,cn.credit_note_number
        FROM voucher_redemption_entries e
        LEFT JOIN voucher_reservations vr ON vr.tenant_id=e.tenant_id AND vr.id=e.reservation_id
        LEFT JOIN pos_orders po ON po.tenant_id=e.tenant_id AND po.id=COALESCE(e.pos_order_id,vr.pos_order_id)
        LEFT JOIN branches b ON b.tenant_id=po.tenant_id AND b.id=po.branch_id
        LEFT JOIN invoices i ON i.tenant_id=po.tenant_id AND i.pos_order_id=po.id
        LEFT JOIN refunds r ON r.tenant_id=e.tenant_id AND r.id=e.refund_id
        LEFT JOIN credit_notes cn ON cn.tenant_id=e.tenant_id AND cn.id=e.credit_note_id
        WHERE e.tenant_id=$1 AND e.voucher_code_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`, [auth.tenantId, voucherId]),
      this.db.query<any>(`SELECT vr.id,vr.status,vr.branch_id,b.name branch_name,vr.customer_id,vr.pos_order_id,po.order_number,vr.appointment_id,vr.discount_minor,vr.currency,vr.expires_at,vr.created_at,vr.committed_at,vr.released_at,vr.policy_snapshot_json
        FROM voucher_reservations vr LEFT JOIN branches b ON b.tenant_id=vr.tenant_id AND b.id=vr.branch_id LEFT JOIN pos_orders po ON po.tenant_id=vr.tenant_id AND po.id=vr.pos_order_id
        WHERE vr.tenant_id=$1 AND vr.voucher_code_id=$2 ORDER BY vr.created_at DESC,vr.id DESC LIMIT 50`, [auth.tenantId, voucherId]),
      this.db.query<any>(`SELECT id,refund_id,conflict_code,status,context_json,created_at,resolved_at FROM benefit_reversal_conflicts WHERE tenant_id=$1 AND source_entity_id=$2 AND benefit_type='VOUCHER' ORDER BY created_at DESC,id DESC`, [auth.tenantId, voucherId]),
      this.db.query<any>(`SELECT a.id,a.action,a.reason,a.before_json,a.after_json,a.created_at,a.actor_user_id,u.display_name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.tenant_id=$1 AND a.entity_type='voucher_code' AND a.entity_id=$2 ORDER BY a.created_at DESC,a.id DESC LIMIT 50`, [auth.tenantId, voucherId]),
      this.db.query<any>(`SELECT c.id,c.display_name,c.phone_normalized,c.email_normalized FROM voucher_campaign_customers cc JOIN customers c ON c.tenant_id=cc.tenant_id AND c.id=cc.customer_id WHERE cc.tenant_id=$1 AND cc.campaign_id=$2 ORDER BY c.display_name,c.id LIMIT 100`, [auth.tenantId, row.campaign_id]),
    ]);
    const item = directoryRow(row, canSeePii);
    return {
      voucher: item,
      source: {
        assignmentScope: item.assignmentScope,
        issuedAt: row.issued_at,
        issuedBy: item.issuedBy ?? { id: null, displayName: "Hệ thống" },
      },
      campaign: {
        ...item.campaign,
        conditions: {
          branches: row.branch_rules ?? [],
          services: row.service_rules ?? [],
          membershipTiers: row.membership_tier_rules ?? [],
          customers: campaignCustomers.rows.map((customer) => ({ id: customer.id, displayName: customer.display_name, phone: canSeePii ? customer.phone_normalized ?? null : null })),
          customerCount: Number(row.campaign_customer_count ?? 0),
          eligibilityPolicy: jsonValue(row.eligibility_policy_json) ?? {},
        },
        limits: {
          codeUseLimit: Number(row.use_limit ?? 0),
          perCustomerUseLimit: row.per_customer_use_limit == null ? null : Number(row.per_customer_use_limit),
          totalUseLimit: row.total_use_limit == null ? null : Number(row.total_use_limit),
          campaignUsedCount: Number(row.campaign_used_count ?? 0),
          campaignReservedCount: Number(row.campaign_reserved_count ?? 0),
        },
      },
      usage: {
        useLimit: Number(row.use_limit ?? 0),
        usedCount: Number(row.used_count ?? 0),
        reservedCount: Number(row.reserved_count ?? 0),
        remainingCapacity: Number(row.remaining_capacity ?? 0),
        committedDiscountMinor: money(row.committed_discount_minor),
        lastUsedAt: row.last_used_at ?? null,
        redemptions: redemptions.rows.map((entry) => ({
          id: entry.id, entryType: entry.entry_type, useDelta: String(entry.use_delta ?? "0"), discountMinor: money(entry.discount_minor),
          createdAt: entry.created_at, posOrderId: entry.pos_order_id ?? null, orderNumber: entry.order_number ?? null,
          invoiceId: entry.invoice_id ?? null, invoiceNumber: entry.invoice_number ?? null, refundId: entry.refund_id ?? null,
          refundReference: entry.refund_reference ?? null, refundStatus: entry.refund_status ?? null, creditNoteId: entry.credit_note_id ?? null,
          creditNoteNumber: entry.credit_note_number ?? null, branchId: entry.branch_id ?? null, branchName: entry.branch_name ?? null,
          policySnapshot: jsonValue(entry.policy_snapshot_json), generationKey: entry.generation_key,
        })),
        reservations: reservations.rows.map((entry) => ({
          id: entry.id, status: entry.status, branchId: entry.branch_id, branchName: entry.branch_name ?? null,
          customerId: entry.customer_id, posOrderId: entry.pos_order_id ?? null, orderNumber: entry.order_number ?? null,
          appointmentId: entry.appointment_id ?? null, discountMinor: money(entry.discount_minor), currency: entry.currency,
          expiresAt: entry.expires_at, createdAt: entry.created_at, committedAt: entry.committed_at, releasedAt: entry.released_at,
        })),
      },
      refundHistory: redemptions.rows.filter((entry) => entry.refund_id || entry.credit_note_id).map((entry) => ({
        id: entry.id, refundId: entry.refund_id ?? null, refundReference: entry.refund_reference ?? null,
        refundStatus: entry.refund_status ?? null, creditNoteId: entry.credit_note_id ?? null, creditNoteNumber: entry.credit_note_number ?? null,
        entryType: entry.entry_type, discountMinor: money(entry.discount_minor), createdAt: entry.created_at,
      })),
      reversalConflicts: conflicts.rows.map((entry) => ({ id: entry.id, refundId: entry.refund_id, conflictCode: entry.conflict_code, status: entry.status, context: jsonValue(entry.context_json), createdAt: entry.created_at, resolvedAt: entry.resolved_at })),
      audit: audit.rows.map((entry) => ({ id: entry.id, action: entry.action, reason: entry.reason, actorUserId: entry.actor_user_id ?? null, actorName: entry.actor_name ?? "Hệ thống", createdAt: entry.created_at, before: jsonValue(entry.before_json), after: jsonValue(entry.after_json) })),
      eligibilityPreview: { supported: true, sideEffects: false },
      generatedAt: new Date().toISOString(),
    };
  }

  async eligibilityPreview(auth: AccessClaims, voucherId: string, input: unknown) {
    this.assertTenantScope(auth);
    const body = voucherEligibilityPreviewSchema.parse(input);
    const code = (await this.db.query<any>(`SELECT vc.id,vc.customer_id,c.currency FROM voucher_codes vc JOIN voucher_campaigns c ON c.tenant_id=vc.tenant_id AND c.id=vc.campaign_id WHERE vc.tenant_id=$1 AND vc.id=$2`, [auth.tenantId, voucherId])).rows[0];
    if (!code) throw new NotFoundException({ code: "VOUCHER_NOT_FOUND", message: "Voucher code was not found" });
    const result = await this.eligibility.evaluate({
      tenantId: auth.tenantId,
      branchId: body.branchId,
      customerId: body.customerId,
      context: "POS",
      serviceItems: body.serviceItems.map((item) => ({ serviceId: item.serviceId, amountMinor: BigInt(String(item.amountMinor)) })),
      localDateTime: body.localDateTime,
      currency: body.currency ?? code.currency ?? "VND",
    });
    const voucher = result.vouchers.find((item: any) => item.id === voucherId);
    return {
      voucherId,
      codeLast4: voucher?.codeLast4 ?? null,
      eligible: Boolean(voucher?.eligible),
      reasonCodes: voucher?.reasonCodes ?? ["VOUCHER_NOT_ELIGIBLE"],
      calculatedAmountMinor: String(voucher?.calculatedAmountMinor ?? 0),
      expiresAt: voucher?.expiresAt ?? null,
      applicationOrder: result.applicationOrder,
      generatedAt: result.generatedAt,
      sideEffects: false,
    };
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
