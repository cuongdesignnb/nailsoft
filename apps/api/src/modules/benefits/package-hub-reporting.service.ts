/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { packageDirectoryQuerySchema } from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

const packageDirectoryCte = `
  WITH eligibility AS (
    SELECT i.package_product_id,
      count(*)::int eligibility_count,
      jsonb_agg(jsonb_build_object(
        'serviceId', i.service_id,
        'serviceName', s.name_json,
        'categoryId', i.category_id,
        'categoryName', sc.name_json,
        'branchId', i.branch_id,
        'branchName', b.name,
        'unitsPerRedemption', i.units_per_redemption
      ) ORDER BY i.id) eligibility_items
    FROM service_package_eligibility_items i
    LEFT JOIN services s ON s.tenant_id=i.tenant_id AND s.id=i.service_id
    LEFT JOIN service_categories sc ON sc.tenant_id=i.tenant_id AND sc.id=i.category_id
    LEFT JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
    WHERE i.tenant_id=$1
    GROUP BY i.package_product_id
  ), ledger_rollup AS (
    SELECT l.entitlement_id,
      max(l.created_at) last_activity_at,
      count(*)::int ledger_entry_count,
      COALESCE(sum(l.consumed_delta) FILTER (
        WHERE l.entry_type='COMMIT' AND l.created_at>=date_trunc('month',now())
      ),0)::int consumed_this_month,
      COALESCE(sum(-l.available_delta) FILTER (
        WHERE l.entry_type='EXPIRE' AND l.available_delta<0
      ),0)::int expired_unused_units,
      (array_agg(l.entry_type ORDER BY l.created_at DESC,l.id DESC))[1] last_entry_type,
      (array_agg(l.pos_order_id ORDER BY l.created_at DESC,l.id DESC) FILTER (WHERE l.pos_order_id IS NOT NULL))[1] pos_order_id,
      (array_agg(l.appointment_id ORDER BY l.created_at DESC,l.id DESC) FILTER (WHERE l.appointment_id IS NOT NULL))[1] appointment_id,
      count(*) FILTER (WHERE l.refund_id IS NOT NULL OR l.credit_note_id IS NOT NULL)::int refund_reversal_count,
      count(*) FILTER (WHERE l.entry_type='MANUAL_ADJUSTMENT')::int manual_adjustment_count
    FROM package_ledger_entries l
    WHERE l.tenant_id=$1
    GROUP BY l.entitlement_id
  ), base AS (
    SELECT e.id entitlement_id,e.tenant_id,e.customer_id,e.package_product_id,
      e.status persisted_status,e.granted_units,e.adjustment_units,
      (e.granted_units+e.adjustment_units)::int effective_granted_units,
      e.available_units,e.reserved_units,e.consumed_units,
      (e.available_units+e.reserved_units)::int remaining_unconsumed_units,
      e.allocated_unit_value_minor,e.currency,e.issued_at,e.expires_at,e.version,
      c.display_name,c.phone_normalized,c.email_normalized,c.status customer_status,
      p.code package_code,p.name_json package_name,p.description_json package_description,
      p.status package_status,p.granted_units product_granted_units,
      p.units_per_redemption,p.price_minor,p.validity_days,p.refund_policy,p.version product_version,
      COALESCE(el.eligibility_count,0)::int eligibility_count,
      COALESCE(el.eligibility_items,'[]'::jsonb) eligibility_items,
      lr.last_activity_at,COALESCE(lr.ledger_entry_count,0)::int ledger_entry_count,
      COALESCE(lr.consumed_this_month,0)::int consumed_this_month,
      COALESCE(lr.expired_unused_units,0)::int expired_unused_units,
      lr.last_entry_type,lr.pos_order_id,lr.appointment_id,
      COALESCE(lr.refund_reversal_count,0)::int refund_reversal_count,
      COALESCE(lr.manual_adjustment_count,0)::int manual_adjustment_count,
      CASE
        WHEN e.status='ACTIVE' AND e.expires_at<=now() THEN 'OVERDUE'
        WHEN e.status='ACTIVE' AND e.expires_at<=now()+make_interval(days=>$2) THEN 'EXPIRING'
        ELSE e.status
      END derived_status
    FROM customer_package_entitlements e
    JOIN customers c ON c.tenant_id=e.tenant_id AND c.id=e.customer_id
    JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id
    LEFT JOIN eligibility el ON el.package_product_id=p.id
    LEFT JOIN ledger_rollup lr ON lr.entitlement_id=e.id
    WHERE e.tenant_id=$1
  )`;

function jsonValue(value: unknown) {
  return value ?? null;
}

function byCurrency(rows: any[]) {
  return rows.map((row) => ({
    currency: row.currency,
    amountMinor: String(row.amount_minor ?? "0"),
  }));
}

function sourceType(row: any) {
  if (row.pos_order_id) return "POS";
  if (row.appointment_id) return "APPOINTMENT";
  return "ISSUED";
}

function directoryRow(row: any, canSeePii: boolean) {
  return {
    customer: {
      id: row.customer_id,
      displayName: row.display_name,
      phone: canSeePii ? row.phone_normalized ?? null : null,
      email: canSeePii ? row.email_normalized ?? null : null,
      status: row.customer_status,
    },
    entitlement: {
      id: row.entitlement_id,
      persistedStatus: row.persisted_status,
      status: row.derived_status,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      version: row.version,
      grantedUnits: Number(row.granted_units ?? 0),
      adjustmentUnits: Number(row.adjustment_units ?? 0),
      effectiveGrantedUnits: Number(row.effective_granted_units ?? 0),
      availableUnits: Number(row.available_units ?? 0),
      reservedUnits: Number(row.reserved_units ?? 0),
      consumedUnits: Number(row.consumed_units ?? 0),
      remainingUnconsumedUnits: Number(row.remaining_unconsumed_units ?? 0),
      expiredUnusedUnits: Number(row.expired_unused_units ?? 0),
      allocatedUnitValueMinor: String(row.allocated_unit_value_minor ?? "0"),
      remainingReferenceValueMinor: String(
        BigInt(row.remaining_unconsumed_units ?? 0) * BigInt(row.allocated_unit_value_minor ?? 0),
      ),
      currency: row.currency,
    },
    product: {
      id: row.package_product_id,
      code: row.package_code,
      name: jsonValue(row.package_name),
      status: row.package_status,
      description: jsonValue(row.package_description),
      grantedUnits: Number(row.product_granted_units ?? 0),
      unitsPerRedemption: Number(row.units_per_redemption ?? 1),
      priceMinor: String(row.price_minor ?? "0"),
      validityDays: Number(row.validity_days ?? 0),
      refundPolicy: row.refund_policy,
      version: row.product_version,
    },
    eligibility: {
      count: Number(row.eligibility_count ?? 0),
      items: jsonValue(row.eligibility_items) ?? [],
    },
    usage: {
      consumedThisMonth: Number(row.consumed_this_month ?? 0),
      lastActivityAt: row.last_activity_at ?? null,
      ledgerEntryCount: Number(row.ledger_entry_count ?? 0),
    },
    sourceEvidence: {
      type: sourceType(row),
      posOrderId: row.pos_order_id ?? null,
      appointmentId: row.appointment_id ?? null,
      refundReversalCount: Number(row.refund_reversal_count ?? 0),
      manualAdjustmentCount: Number(row.manual_adjustment_count ?? 0),
      lastEntryType: row.last_entry_type ?? null,
    },
  };
}

@Injectable()
export class PackageHubReportingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async overview(auth: AccessClaims) {
    this.assertTenantScope(auth);
    const [totalsResult, currencyResult, statusResult, productsResult, expiringResult, activityResult] = await Promise.all([
      this.db.query<any>(
        `${packageDirectoryCte}
         SELECT
           count(*) FILTER (WHERE derived_status IN ('ACTIVE','EXPIRING') AND remaining_unconsumed_units>0)::int active_entitlement_count,
           count(DISTINCT customer_id) FILTER (WHERE derived_status IN ('ACTIVE','EXPIRING') AND remaining_unconsumed_units>0)::int active_customer_count,
           COALESCE(sum(remaining_unconsumed_units) FILTER (WHERE derived_status IN ('ACTIVE','EXPIRING')),0)::bigint remaining_units,
           COALESCE(sum(reserved_units) FILTER (WHERE derived_status IN ('ACTIVE','EXPIRING')),0)::bigint reserved_units,
           COALESCE(sum(consumed_this_month),0)::bigint consumed_this_month,
           count(*) FILTER (WHERE derived_status='EXPIRING' AND remaining_unconsumed_units>0)::int expiring_count,
           count(*)::int total_entitlements
         FROM base`,
        [auth.tenantId, 30],
      ),
      this.db.query<any>(
        `${packageDirectoryCte}
         SELECT currency,
           COALESCE(sum(remaining_unconsumed_units * allocated_unit_value_minor) FILTER (WHERE derived_status IN ('ACTIVE','EXPIRING')),0)::bigint amount_minor
         FROM base
         GROUP BY currency ORDER BY currency`,
        [auth.tenantId, 30],
      ),
      this.db.query<any>(
        `${packageDirectoryCte}
         SELECT derived_status status,count(*)::int count,
           COALESCE(sum(remaining_unconsumed_units),0)::bigint remaining_units
         FROM base GROUP BY derived_status ORDER BY derived_status`,
        [auth.tenantId, 30],
      ),
      this.db.query<any>(
        `SELECT p.id,p.code,p.name_json "name",p.status,p.price_minor,p.currency,p.granted_units,p.validity_days,
           count(e.id)::int entitlement_count,
           count(e.id) FILTER (WHERE e.status='ACTIVE' AND e.expires_at>now() AND e.available_units+e.reserved_units>0)::int active_count,
           COALESCE(sum(e.available_units+e.reserved_units) FILTER (WHERE e.status='ACTIVE' AND e.expires_at>now()),0)::bigint remaining_units,
           COALESCE(sum(e.consumed_units),0)::bigint consumed_units,
           COALESCE(sum((e.available_units+e.reserved_units)*e.allocated_unit_value_minor) FILTER (WHERE e.status='ACTIVE' AND e.expires_at>now()),0)::bigint remaining_value_minor
         FROM service_package_products p
         LEFT JOIN customer_package_entitlements e ON e.tenant_id=p.tenant_id AND e.package_product_id=p.id
         WHERE p.tenant_id=$1
         GROUP BY p.id ORDER BY active_count DESC,p.created_at DESC,p.id`,
        [auth.tenantId],
      ),
      this.db.query<any>(
        `${packageDirectoryCte}
         SELECT * FROM base WHERE derived_status='EXPIRING' AND remaining_unconsumed_units>0
         ORDER BY expires_at ASC,entitlement_id ASC LIMIT 6`,
        [auth.tenantId, 30],
      ),
      this.db.query<any>(
        `SELECT l.id,l.entry_type,l.available_delta,l.reserved_delta,l.consumed_delta,l.created_at,
           l.entitlement_id,l.pos_order_id,l.appointment_id,c.display_name,p.code package_code
         FROM package_ledger_entries l
         JOIN customers c ON c.tenant_id=l.tenant_id AND c.id=l.customer_id
         JOIN customer_package_entitlements e ON e.tenant_id=l.tenant_id AND e.id=l.entitlement_id
         JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id
         WHERE l.tenant_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT 8`,
        [auth.tenantId],
      ),
    ]);
    const totals = totalsResult.rows[0] ?? {};
    return {
      totals: {
        activeEntitlementCount: Number(totals.active_entitlement_count ?? 0),
        activeCustomerCount: Number(totals.active_customer_count ?? 0),
        remainingUnits: Number(totals.remaining_units ?? 0),
        reservedUnits: Number(totals.reserved_units ?? 0),
        consumedThisMonth: Number(totals.consumed_this_month ?? 0),
        expiringCount: Number(totals.expiring_count ?? 0),
        totalEntitlements: Number(totals.total_entitlements ?? 0),
        referenceValueByCurrency: byCurrency(currencyResult.rows),
      },
      statusDistribution: statusResult.rows.map((row) => ({ status: row.status, count: Number(row.count ?? 0), remainingUnits: Number(row.remaining_units ?? 0) })),
      products: productsResult.rows.map((row) => ({
        id: row.id, code: row.code, name: jsonValue(row.name), status: row.status,
        priceMinor: String(row.price_minor ?? "0"), currency: row.currency,
        grantedUnits: Number(row.granted_units ?? 0), validityDays: Number(row.validity_days ?? 0),
        entitlementCount: Number(row.entitlement_count ?? 0), activeCount: Number(row.active_count ?? 0),
        remainingUnits: Number(row.remaining_units ?? 0), consumedUnits: Number(row.consumed_units ?? 0),
        remainingValueMinor: String(row.remaining_value_minor ?? "0"),
      })),
      expiring: {
        windowDays: 30,
        items: expiringResult.rows.map((row) => directoryRow(row, false)),
      },
      activity: activityResult.rows.map((row) => ({
        id: row.id, entryType: row.entry_type, availableDelta: Number(row.available_delta ?? 0),
        reservedDelta: Number(row.reserved_delta ?? 0), consumedDelta: Number(row.consumed_delta ?? 0),
        createdAt: row.created_at, entitlementId: row.entitlement_id, packageCode: row.package_code,
        customerName: row.display_name, posOrderId: row.pos_order_id ?? null, appointmentId: row.appointment_id ?? null,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async directory(auth: AccessClaims, input: unknown) {
    this.assertTenantScope(auth);
    const query = packageDirectoryQuerySchema.parse(input);
    const canSeePii = await this.hasPermission(auth, "customer.read");
    const params: unknown[] = [auth.tenantId, query.expiryWindowDays];
    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const filters: string[] = [];
    if (query.search) {
      const p = push(`%${query.search}%`);
      filters.push(`(e.customer_id::text ILIKE ${p} OR e.display_name ILIKE ${p} OR COALESCE(e.phone_normalized,'') ILIKE ${p} OR COALESCE(e.email_normalized,'') ILIKE ${p} OR e.package_code ILIKE ${p} OR COALESCE(e.package_name::text,'') ILIKE ${p} OR e.entitlement_id::text ILIKE ${p})`);
    }
    if (query.packageProductId) filters.push(`e.package_product_id=${push(query.packageProductId)}`);
    if (query.status !== "ALL") filters.push(`e.derived_status=${push(query.status)}`);
    if (query.issuedFrom) filters.push(`e.issued_at>=${push(query.issuedFrom)}::date`);
    if (query.issuedTo) filters.push(`e.issued_at<(${push(query.issuedTo)}::date+interval '1 day')`);
    if (query.remaining === "AVAILABLE") filters.push("e.available_units>0");
    if (query.remaining === "RESERVED") filters.push("e.reserved_units>0");
    if (query.remaining === "ONE_LEFT") filters.push("e.remaining_unconsumed_units=1");
    if (query.remaining === "MANY_LEFT") filters.push("e.remaining_unconsumed_units>1");
    if (query.remaining === "USED_UP") filters.push("e.remaining_unconsumed_units=0");
    if (query.remaining === "EXPIRED_UNUSED") filters.push("e.expired_unused_units>0");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const sort = {
      CUSTOMER_NAME: "e.display_name ASC,e.entitlement_id ASC",
      EXPIRY_ASC: "e.expires_at ASC,e.entitlement_id ASC",
      REMAINING_DESC: "e.remaining_unconsumed_units DESC,e.display_name ASC,e.entitlement_id ASC",
      CONSUMED_DESC: "e.consumed_units DESC,e.display_name ASC,e.entitlement_id ASC",
      VALUE_DESC: "e.remaining_unconsumed_units*e.allocated_unit_value_minor DESC,e.display_name ASC,e.entitlement_id ASC",
      ISSUED_DESC: "e.issued_at DESC,e.entitlement_id DESC",
    }[query.sort];
    const baseParams = params.slice();
    const limit = push(query.pageSize);
    const offset = push((query.page - 1) * query.pageSize);
    const filtered = `${packageDirectoryCte}, filtered AS (SELECT * FROM base e ${where})`;
    const [itemsResult, countResult, summaryResult] = await Promise.all([
      this.db.query<any>(`${filtered} SELECT * FROM filtered e ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`, params),
      this.db.query<any>(`${filtered} SELECT count(*)::int total FROM filtered`, baseParams),
      this.db.query<any>(`${filtered} SELECT count(*)::int total,count(*) FILTER (WHERE derived_status IN ('ACTIVE','EXPIRING'))::int active,count(*) FILTER (WHERE derived_status='EXPIRING')::int expiring,count(*) FILTER (WHERE remaining_unconsumed_units=0)::int used_up,count(*) FILTER (WHERE reserved_units>0)::int reserved FROM filtered`, baseParams),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    const summary = summaryResult.rows[0] ?? {};
    return {
      items: itemsResult.rows.map((row) => directoryRow(row, canSeePii)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      summary: { total, active: Number(summary.active ?? 0), expiring: Number(summary.expiring ?? 0), usedUp: Number(summary.used_up ?? 0), reserved: Number(summary.reserved ?? 0) },
      generatedAt: new Date().toISOString(),
    };
  }

  async entitlementOverview(auth: AccessClaims, entitlementId: string) {
    this.assertTenantScope(auth);
    const canSeePii = await this.hasPermission(auth, "customer.read");
    const result = await this.db.query<any>(
      `SELECT e.*,c.display_name,c.phone_normalized,c.email_normalized,c.status customer_status,
        p.id product_id,p.code product_code,p.name_json product_name,p.description_json product_description,p.status product_status,
        p.granted_units product_granted_units,p.units_per_redemption,p.price_minor,p.currency product_currency,p.validity_days,p.refund_policy,p.version product_version
       FROM customer_package_entitlements e
       JOIN customers c ON c.tenant_id=e.tenant_id AND c.id=e.customer_id
       JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id
       WHERE e.tenant_id=$1 AND e.id=$2`,
      [auth.tenantId, entitlementId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: "PACKAGE_ENTITLEMENT_NOT_FOUND", message: "Package entitlement was not found" });
    const [eligibilityResult, ledgerResult, reservationResult, conflictResult] = await Promise.all([
      this.db.query<any>(
        `SELECT i.id,i.service_id service_id,s.name_json service_name,i.category_id,sc.name_json category_name,i.branch_id,b.name branch_name,i.units_per_redemption
         FROM service_package_eligibility_items i
         LEFT JOIN services s ON s.tenant_id=i.tenant_id AND s.id=i.service_id
         LEFT JOIN service_categories sc ON sc.tenant_id=i.tenant_id AND sc.id=i.category_id
         LEFT JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
         WHERE i.tenant_id=$1 AND i.package_product_id=$2 ORDER BY i.id`,
        [auth.tenantId, row.package_product_id],
      ),
      this.db.query<any>(
        `SELECT id,entry_type,available_delta,reserved_delta,consumed_delta,pos_order_id,appointment_id,refund_id,credit_note_id,policy_snapshot_json,generation_key,created_at
         FROM package_ledger_entries WHERE tenant_id=$1 AND entitlement_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`,
        [auth.tenantId, entitlementId],
      ),
      this.db.query<any>(
        `SELECT r.id,r.status,r.units,r.service_id,s.name_json service_name,r.branch_id,r.appointment_id,r.appointment_item_id,r.pos_order_id,r.expires_at,r.created_at,r.committed_at,r.released_at
         FROM package_reservations r LEFT JOIN services s ON s.tenant_id=r.tenant_id AND s.id=r.service_id
         WHERE r.tenant_id=$1 AND r.entitlement_id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 50`,
        [auth.tenantId, entitlementId],
      ),
      this.db.query<any>(
        `SELECT id,refund_id,conflict_code,status,context_json,created_at,resolved_at
         FROM benefit_reversal_conflicts WHERE tenant_id=$1 AND source_entity_id=$2 ORDER BY created_at DESC,id DESC`,
        [auth.tenantId, entitlementId],
      ),
    ]);
    const remaining = Number(row.available_units ?? 0) + Number(row.reserved_units ?? 0);
    return {
      customer: { id: row.customer_id, displayName: row.display_name, phone: canSeePii ? row.phone_normalized ?? null : null, email: canSeePii ? row.email_normalized ?? null : null, status: row.customer_status },
      entitlement: {
        id: row.id, persistedStatus: row.status, status: row.status === "ACTIVE" && new Date(row.expires_at).getTime() <= Date.now() ? "OVERDUE" : row.status,
        issuedAt: row.issued_at, expiresAt: row.expires_at, version: row.version,
        grantedUnits: Number(row.granted_units ?? 0), adjustmentUnits: Number(row.adjustment_units ?? 0),
        effectiveGrantedUnits: Number(row.granted_units ?? 0) + Number(row.adjustment_units ?? 0),
        availableUnits: Number(row.available_units ?? 0), reservedUnits: Number(row.reserved_units ?? 0), consumedUnits: Number(row.consumed_units ?? 0),
        remainingUnconsumedUnits: remaining, expiredUnusedUnits: ledgerResult.rows.filter((entry) => entry.entry_type === "EXPIRE" && Number(entry.available_delta) < 0).reduce((sum, entry) => sum + Math.abs(Number(entry.available_delta)), 0),
        allocatedUnitValueMinor: String(row.allocated_unit_value_minor ?? "0"), remainingReferenceValueMinor: String(BigInt(remaining) * BigInt(row.allocated_unit_value_minor ?? 0)), currency: row.currency,
      },
      product: { id: row.product_id, code: row.product_code, name: jsonValue(row.product_name), description: jsonValue(row.product_description), status: row.product_status, grantedUnits: Number(row.product_granted_units ?? 0), unitsPerRedemption: Number(row.units_per_redemption ?? 1), priceMinor: String(row.price_minor ?? "0"), currency: row.product_currency, validityDays: Number(row.validity_days ?? 0), refundPolicy: row.refund_policy, version: row.product_version },
      eligibility: eligibilityResult.rows.map((entry) => ({ serviceId: entry.service_id, serviceName: jsonValue(entry.service_name), categoryId: entry.category_id, categoryName: jsonValue(entry.category_name), branchId: entry.branch_id, branchName: entry.branch_name, unitsPerRedemption: Number(entry.units_per_redemption ?? 1) })),
      sourceEvidence: {
        type: sourceType(ledgerResult.rows.find((entry) => entry.pos_order_id || entry.appointment_id) ?? {}),
        posOrderId: ledgerResult.rows.find((entry) => entry.pos_order_id)?.pos_order_id ?? null,
        appointmentId: ledgerResult.rows.find((entry) => entry.appointment_id)?.appointment_id ?? null,
        refundReversalCount: ledgerResult.rows.filter((entry) => entry.refund_id || entry.credit_note_id).length,
        manualAdjustmentCount: ledgerResult.rows.filter((entry) => entry.entry_type === "MANUAL_ADJUSTMENT").length,
        lastEntryType: ledgerResult.rows[0]?.entry_type ?? null,
      },
      ledger: ledgerResult.rows.map((entry) => ({ id: entry.id, entryType: entry.entry_type, availableDelta: Number(entry.available_delta ?? 0), reservedDelta: Number(entry.reserved_delta ?? 0), consumedDelta: Number(entry.consumed_delta ?? 0), posOrderId: entry.pos_order_id, appointmentId: entry.appointment_id, refundId: entry.refund_id, creditNoteId: entry.credit_note_id, policySnapshot: jsonValue(entry.policy_snapshot_json), generationKey: entry.generation_key, createdAt: entry.created_at })),
      reservations: reservationResult.rows.map((entry) => ({ id: entry.id, status: entry.status, units: Number(entry.units ?? 0), serviceId: entry.service_id, serviceName: jsonValue(entry.service_name), branchId: entry.branch_id, appointmentId: entry.appointment_id, appointmentItemId: entry.appointment_item_id, posOrderId: entry.pos_order_id, expiresAt: entry.expires_at, createdAt: entry.created_at, committedAt: entry.committed_at, releasedAt: entry.released_at })),
      refundContext: { conflicts: conflictResult.rows.map((entry) => ({ id: entry.id, refundId: entry.refund_id, conflictCode: entry.conflict_code, status: entry.status, context: jsonValue(entry.context_json), createdAt: entry.created_at, resolvedAt: entry.resolved_at })), hasOpenConflict: conflictResult.rows.some((entry) => entry.status === "OPEN") },
      generatedAt: new Date().toISOString(),
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
