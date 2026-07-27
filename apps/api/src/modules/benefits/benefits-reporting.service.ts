/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { benefitExportSchema } from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

@Injectable()
export class BenefitsReportingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  vouchers(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        `SELECT c.id,c.name,c.status,c.reserved_count "reservedCount",c.used_count "redeemedCount",count(vc.id)::int "issuedCount",COALESCE(sum(e.discount_minor) FILTER(WHERE e.entry_type='COMMIT'),0) "discountMinor" FROM voucher_campaigns c LEFT JOIN voucher_codes vc ON vc.tenant_id=c.tenant_id AND vc.campaign_id=c.id LEFT JOIN voucher_redemption_entries e ON e.tenant_id=vc.tenant_id AND e.voucher_code_id=vc.id WHERE c.tenant_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  loyalty(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        `SELECT COALESCE(sum(pending_points),0) "pendingPoints",COALESCE(sum(available_points),0) "availablePoints",COALESCE(sum(reserved_points),0) "reservedPoints",COALESCE(sum(lifetime_earned_points),0) "lifetimeEarnedPoints",count(*)::int accounts FROM loyalty_accounts WHERE tenant_id=$1`,
        [auth.tenantId],
      )
      .then((r) => r.rows[0]);
  }
  membership(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        `SELECT t.id,t.code,t.name_json "name",count(a.id) FILTER(WHERE a.status='ACTIVE')::int "activeCount" FROM membership_tiers t LEFT JOIN customer_membership_assignments a ON a.tenant_id=t.tenant_id AND a.tier_id=t.id WHERE t.tenant_id=$1 GROUP BY t.id ORDER BY t.priority DESC`,
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  packages(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        `SELECT p.id,p.code,p.name_json "name",count(e.id)::int entitlements,COALESCE(sum(e.available_units),0) "availableUnits",COALESCE(sum(e.reserved_units),0) "reservedUnits",COALESCE(sum(e.consumed_units),0) "consumedUnits",COALESCE(sum(e.available_units*e.allocated_unit_value_minor),0) "liabilityMinor",p.currency FROM service_package_products p LEFT JOIN customer_package_entitlements e ON e.tenant_id=p.tenant_id AND e.package_product_id=p.id WHERE p.tenant_id=$1 GROUP BY p.id ORDER BY p.created_at DESC`,
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async liability(auth: AccessClaims) {
    this.access(auth);
    const rows = (
      await this.db.query<any>(
        `WITH lp AS (SELECT redemption_points,redemption_minor FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY effective_from DESC LIMIT 1),l AS (SELECT COALESCE(sum(GREATEST(available_points,0)),0)::bigint points FROM loyalty_accounts WHERE tenant_id=$1),p AS (SELECT COALESCE(sum(available_units),0)::bigint units,COALESCE(sum(available_units*allocated_unit_value_minor),0)::bigint minor FROM customer_package_entitlements WHERE tenant_id=$1 AND status='ACTIVE') SELECT l.points "loyaltyAvailablePoints",CASE WHEN lp.redemption_points IS NULL THEN 0 ELSE (l.points/lp.redemption_points)*lp.redemption_minor END "loyaltyLiabilityMinor",p.units "packageRemainingUnits",p.minor "packageLiabilityMinor",(SELECT currency FROM tenants WHERE id=$1) currency FROM l CROSS JOIN p LEFT JOIN lp ON true`,
        [auth.tenantId],
      )
    ).rows[0];
    return { ...rows, note: "Voucher discounts are not cash liability" };
  }
  expiring(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        `SELECT 'VOUCHER' type,id,customer_id "customerId",expires_at "expiresAt",status FROM voucher_codes WHERE tenant_id=$1 AND expires_at BETWEEN now() AND now()+interval '30 days' AND status IN('AVAILABLE','PARTIALLY_USED') UNION ALL SELECT 'PACKAGE',id,customer_id,expires_at,status FROM customer_package_entitlements WHERE tenant_id=$1 AND expires_at BETWEEN now() AND now()+interval '30 days' AND status='ACTIVE' ORDER BY "expiresAt"`,
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async createExport(auth: AccessClaims, input: unknown) {
    this.access(auth);
    const b = benefitExportSchema.parse(input),
      id = randomUUID();
    const row = (
      await this.db.query<any>(
        `INSERT INTO benefit_exports(id,tenant_id,export_type,filters_json,status,requested_by_user_id) VALUES($1,$2,$3,$4,'PENDING',$5) RETURNING id,export_type "exportType",status,created_at "createdAt"`,
        [id, auth.tenantId, b.exportType, b.filters, auth.userId],
      )
    ).rows[0];
    return {
      ...row,
      delivery: {
        enabled: false,
        reason: "OBJECT_STORAGE_NOT_CONFIGURED",
        csvInjectionProtection: true,
      },
    };
  }
  async export(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        `SELECT id,export_type "exportType",status,storage_key "storageKey",checksum,expires_at "expiresAt",created_at "createdAt",ready_at "readyAt" FROM benefit_exports WHERE tenant_id=$1 AND id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "BENEFIT_EXPORT_NOT_FOUND",
        message: "Benefit export not found",
      });
    return row;
  }
  private access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((r) =>
        ["SALON_OWNER", "BRANCH_MANAGER", "ACCOUNTANT"].includes(r),
      )
    )
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Platform support requires an explicit tenant access grant",
      });
  }
}
