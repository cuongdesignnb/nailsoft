/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  benefitCustomerDirectoryQuerySchema,
  benefitExportSchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

@Injectable()
export class BenefitsReportingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async customerDirectory(auth: AccessClaims, input: unknown) {
    this.access(auth);
    const query = benefitCustomerDirectoryQuerySchema.parse(input);
    const search = query.search ? `%${query.search}%` : null;
    const membershipTierId = query.membershipTierId ?? null;
    const hasBalance = query.hasBalance ?? null;
    const activeBenefit = `(
      COALESCE(available_points, 0) > 0
      OR tier_id IS NOT NULL
      OR COALESCE(package_active_count, 0) > 0
      OR COALESCE(voucher_available_count, 0) > 0
      OR COALESCE(gift_card_minor, 0) > 0
      OR COALESCE(customer_credit_minor, 0) > 0
    )`;
    const hasWalletBalance = `(
      COALESCE(gift_card_minor, 0) > 0
      OR COALESCE(customer_credit_minor, 0) > 0
    )`;
    const baseCtes = `
      WITH customer_base AS (
        SELECT c.id,c.display_name,c.phone_normalized,c.email_normalized,c.status
        FROM customers c
        WHERE c.tenant_id=$1
          AND ($2::text IS NULL OR c.display_name ILIKE $2
            OR COALESCE(c.phone_normalized,'') ILIKE $2
            OR COALESCE(c.email_normalized,'') ILIKE $2
            OR c.id::text ILIKE $2)
      ), loyalty AS (
        SELECT customer_id,available_points,pending_points,reserved_points
        FROM loyalty_accounts WHERE tenant_id=$1
      ), membership_ranked AS (
        SELECT DISTINCT ON (a.customer_id) a.customer_id,a.tier_id,a.status,
          a.effective_to,t.name_json tier_name
        FROM customer_membership_assignments a
        JOIN membership_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
        WHERE a.tenant_id=$1 AND a.status='ACTIVE'
          AND a.effective_from<=now()
          AND (a.effective_to IS NULL OR a.effective_to>now())
          AND ($3::uuid IS NULL OR a.tier_id=$3)
        ORDER BY a.customer_id,a.effective_from DESC,a.id DESC
      ), packages AS (
        SELECT e.customer_id,
          count(*) FILTER(WHERE e.status='ACTIVE' AND e.available_units>0)::int active_count,
          COALESCE(sum(e.available_units) FILTER(WHERE e.status='ACTIVE' AND e.available_units>0),0)::bigint remaining_units,
          min(e.expires_at) FILTER(WHERE e.status='ACTIVE' AND e.available_units>0) nearest_expiry_at,
          (array_agg(p.name_json ORDER BY e.expires_at) FILTER(WHERE e.status='ACTIVE' AND e.available_units>0))[1] primary_package_name
        FROM customer_package_entitlements e
        JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id
        WHERE e.tenant_id=$1 GROUP BY e.customer_id
      ), vouchers AS (
        SELECT customer_id,
          count(*) FILTER(WHERE status IN('AVAILABLE','PARTIALLY_USED') AND (expires_at IS NULL OR expires_at>now()))::int available_count,
          min(expires_at) FILTER(WHERE status IN('AVAILABLE','PARTIALLY_USED') AND expires_at IS NOT NULL AND expires_at>now()) nearest_expiry_at
        FROM voucher_codes WHERE tenant_id=$1 AND customer_id IS NOT NULL GROUP BY customer_id
      ), expiry AS (
        SELECT customer_id,count(*)::int expiry_count,min(expires_at) nearest_expiry_at
        FROM (
          SELECT customer_id,expires_at FROM voucher_codes
          WHERE tenant_id=$1 AND expires_at BETWEEN now() AND now()+make_interval(days=>$4)
            AND status IN('AVAILABLE','PARTIALLY_USED')
          UNION ALL
          SELECT customer_id,expires_at FROM customer_package_entitlements
          WHERE tenant_id=$1 AND expires_at BETWEEN now() AND now()+make_interval(days=>$4)
            AND status='ACTIVE' AND available_units>0
        ) expiring_items GROUP BY customer_id
      ), wallet_rows AS (
        SELECT COALESCE(g.customer_id,a.customer_id) customer_id,a.currency,
          CASE WHEN a.account_type='GIFT_CARD' THEN a.available_minor ELSE 0 END::bigint gift_card_minor,
          CASE WHEN a.account_type='CUSTOMER_CREDIT' THEN a.available_minor ELSE 0 END::bigint customer_credit_minor,
          CASE WHEN a.account_type='GIFT_CARD' THEN 1 ELSE 0 END::int gift_card_count
        FROM stored_value_accounts a
        LEFT JOIN gift_cards g ON g.tenant_id=a.tenant_id AND g.id=a.gift_card_id
        WHERE a.tenant_id=$1 AND a.status='ACTIVE'
          AND ((a.account_type='CUSTOMER_CREDIT' AND a.customer_id IS NOT NULL)
            OR (a.account_type='GIFT_CARD' AND g.customer_id IS NOT NULL
              AND g.status NOT IN('CANCELLED','REPLACED','EXPIRED')))
      ), wallet AS (
        SELECT customer_id,
          sum(gift_card_minor)::bigint gift_card_minor,
          sum(customer_credit_minor)::bigint customer_credit_minor,
          sum(gift_card_count)::int gift_card_count,
          jsonb_agg(jsonb_build_object(
            'currency',currency,
            'giftCardMinor',gift_card_minor::text,
            'customerCreditMinor',customer_credit_minor::text,
            'totalMinor',(gift_card_minor+customer_credit_minor)::text
          ) ORDER BY currency) balances_by_currency
        FROM (
          SELECT customer_id,currency,sum(gift_card_minor)::bigint gift_card_minor,
            sum(customer_credit_minor)::bigint customer_credit_minor,sum(gift_card_count)::int gift_card_count
          FROM wallet_rows GROUP BY customer_id,currency
        ) wallet_currency GROUP BY customer_id
      ), base_metrics AS (
        SELECT c.id,c.display_name,c.phone_normalized,c.email_normalized,c.status,
          l.available_points,l.pending_points,l.reserved_points,
          m.tier_id,m.status membership_status,m.tier_name,
          COALESCE(p.active_count,0)::int package_active_count,
          COALESCE(p.remaining_units,0)::bigint package_remaining_units,
          p.primary_package_name,p.nearest_expiry_at package_nearest_expiry_at,
          COALESCE(v.available_count,0)::int voucher_available_count,
          v.nearest_expiry_at voucher_nearest_expiry_at,
          COALESCE(w.gift_card_minor,0)::bigint gift_card_minor,
          COALESCE(w.customer_credit_minor,0)::bigint customer_credit_minor,
          COALESCE(w.gift_card_count,0)::int gift_card_count,
          w.balances_by_currency,
          COALESCE(e.expiry_count,0)::int expiry_count,
          e.nearest_expiry_at expiry_nearest_expiry_at
        FROM customer_base c
        LEFT JOIN loyalty l ON l.customer_id=c.id
        LEFT JOIN membership_ranked m ON m.customer_id=c.id
        LEFT JOIN packages p ON p.customer_id=c.id
        LEFT JOIN vouchers v ON v.customer_id=c.id
        LEFT JOIN wallet w ON w.customer_id=c.id
        LEFT JOIN expiry e ON e.customer_id=c.id
      ), filtered AS (
        SELECT * FROM base_metrics
        WHERE ($5='ALL'
          OR ($5='LOYALTY' AND COALESCE(available_points,0)>0)
          OR ($5='MEMBERSHIP' AND tier_id IS NOT NULL)
          OR ($5='PACKAGE' AND package_active_count>0)
          OR ($5='VOUCHER' AND voucher_available_count>0)
          OR ($5='GIFT_CARD' AND gift_card_minor>0)
          OR ($5='CUSTOMER_CREDIT' AND customer_credit_minor>0))
          AND ($6='ALL'
            OR ($6='AVAILABLE' AND ${activeBenefit})
            OR ($6='EXPIRING' AND expiry_count>0)
            OR ($6='NO_ACTIVE_BENEFITS' AND NOT ${activeBenefit}))
          AND ($7::boolean IS NULL
            OR ($7::boolean=true AND ${hasWalletBalance})
            OR ($7::boolean=false AND NOT ${hasWalletBalance}))
      )`;
    const sort = {
      CUSTOMER_NAME: "display_name ASC,id ASC",
      BENEFIT_VALUE_DESC: "(COALESCE(available_points,0)+COALESCE(package_remaining_units,0)+COALESCE(voucher_available_count,0)+COALESCE(gift_card_minor,0)+COALESCE(customer_credit_minor,0)) DESC,display_name ASC,id ASC",
      EXPIRY_ASC: "expiry_nearest_expiry_at NULLS LAST,display_name ASC,id ASC",
      LOYALTY_DESC: "COALESCE(available_points,0) DESC,display_name ASC,id ASC",
    }[query.sort];
    const values = [
      auth.tenantId,
      search,
      membershipTierId,
      query.expiryWindowDays,
      query.category,
      query.state,
      hasBalance,
    ];
    const countResult = await this.db.query<{ total: string }>(
      `${baseCtes} SELECT count(*)::int total FROM filtered`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    const [itemsResult, summaryResult, walletSummaryResult] = await Promise.all([
      this.db.query<any>(
        `${baseCtes} SELECT * FROM filtered ORDER BY ${sort} LIMIT $8 OFFSET $9`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      ),
      this.db.query<any>(
        `${baseCtes}
         SELECT count(*) FILTER(WHERE status='ACTIVE')::int active_customer_count,
           count(*) FILTER(WHERE status='ACTIVE' AND ${activeBenefit})::int customers_with_benefits,
           count(*) FILTER(WHERE available_points IS NOT NULL)::int loyalty_account_count,
           COALESCE(sum(available_points),0)::bigint loyalty_available_points,
           count(*) FILTER(WHERE tier_id IS NOT NULL)::int active_membership_count,
           COALESCE(sum(voucher_available_count),0)::int available_voucher_count,
           count(*) FILTER(WHERE package_active_count>0)::int active_package_customer_count,
           COALESCE(sum(expiry_count),0)::int expiring_benefit_count,
           COALESCE(sum(gift_card_count),0)::int gift_card_count,
           count(*) FILTER(WHERE customer_credit_minor>0)::int customer_credit_customer_count
         FROM base_metrics`,
        values,
      ),
      this.db.query<any>(
        `WITH wallet_rows AS (
          SELECT COALESCE(g.customer_id,a.customer_id) customer_id,a.currency,
            CASE WHEN a.account_type='GIFT_CARD' THEN a.available_minor ELSE 0 END::bigint gift_card_minor,
            CASE WHEN a.account_type='CUSTOMER_CREDIT' THEN a.available_minor ELSE 0 END::bigint customer_credit_minor
          FROM stored_value_accounts a
          LEFT JOIN gift_cards g ON g.tenant_id=a.tenant_id AND g.id=a.gift_card_id
          WHERE a.tenant_id=$1 AND a.status='ACTIVE'
            AND ((a.account_type='CUSTOMER_CREDIT' AND a.customer_id IS NOT NULL)
              OR (a.account_type='GIFT_CARD' AND g.customer_id IS NOT NULL
                AND g.status NOT IN('CANCELLED','REPLACED','EXPIRED')))
        )
        SELECT currency,sum(gift_card_minor)::bigint gift_card_minor,
          sum(customer_credit_minor)::bigint customer_credit_minor,
          (sum(gift_card_minor)+sum(customer_credit_minor))::bigint total_minor
        FROM wallet_rows GROUP BY currency ORDER BY currency`,
        [auth.tenantId],
      ),
    ]);
    const summary = summaryResult.rows[0] ?? {};
    const items = itemsResult.rows.map((row) => this.directoryRow(row));
    const walletBalances = walletSummaryResult.rows.map((row) => ({
      currency: row.currency,
      giftCardMinor: String(row.gift_card_minor ?? "0"),
      customerCreditMinor: String(row.customer_credit_minor ?? "0"),
      totalMinor: String(row.total_minor ?? "0"),
    }));
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      summary: {
        activeCustomerCount: Number(summary.active_customer_count ?? 0),
        customersWithBenefits: Number(summary.customers_with_benefits ?? 0),
        loyaltyAccountCount: Number(summary.loyalty_account_count ?? 0),
        loyaltyAvailablePoints: String(summary.loyalty_available_points ?? "0"),
        activeMembershipCount: Number(summary.active_membership_count ?? 0),
        availableVoucherCount: Number(summary.available_voucher_count ?? 0),
        activePackageCustomerCount: Number(summary.active_package_customer_count ?? 0),
        expiringBenefitCount: Number(summary.expiring_benefit_count ?? 0),
        walletBalances,
      },
      categoryCounts: {
        ALL: Number(summary.active_customer_count ?? 0),
        LOYALTY: Number(summary.loyalty_account_count ?? 0),
        MEMBERSHIP: Number(summary.active_membership_count ?? 0),
        PACKAGE: Number(summary.active_package_customer_count ?? 0),
        VOUCHER: Number(summary.available_voucher_count ?? 0),
        GIFT_CARD: Number(summary.gift_card_count ?? 0),
        CUSTOMER_CREDIT: Number(summary.customer_credit_customer_count ?? 0),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async customerBenefitSummary(auth: AccessClaims, customerId: string) {
    this.access(auth);
    const result = await this.customerDirectory(auth, {
      search: customerId,
      page: 1,
      pageSize: 50,
    });
    const item = result.items.find((row: any) => row.customer.id === customerId);
    if (!item) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Customer not found" });
    return item;
  }

  private directoryRow(row: any) {
    const expiring = Number(row.expiry_count ?? 0) > 0;
    const hasBenefits =
      Number(row.available_points ?? 0) > 0 ||
      Boolean(row.tier_id) ||
      Number(row.package_active_count ?? 0) > 0 ||
      Number(row.voucher_available_count ?? 0) > 0 ||
      Number(row.gift_card_minor ?? 0) > 0 ||
      Number(row.customer_credit_minor ?? 0) > 0;
    return {
      customer: {
        id: row.id,
        displayName: row.display_name,
        status: row.status,
      },
      membership: {
        tierId: row.tier_id ?? undefined,
        tierName: row.tier_name ?? undefined,
        assignmentStatus: row.membership_status ?? undefined,
      },
      loyalty: {
        availablePoints: String(row.available_points ?? "0"),
        pendingPoints: String(row.pending_points ?? "0"),
        reservedPoints: String(row.reserved_points ?? "0"),
      },
      packages: {
        activeCount: Number(row.package_active_count ?? 0),
        remainingUnits: Number(row.package_remaining_units ?? 0),
        primaryPackageName: row.primary_package_name ?? undefined,
        nearestExpiryAt: row.package_nearest_expiry_at ?? undefined,
      },
      vouchers: {
        availableCount: Number(row.voucher_available_count ?? 0),
        nearestExpiryAt: row.voucher_nearest_expiry_at ?? undefined,
      },
      wallet: {
        balancesByCurrency: row.balances_by_currency ?? [],
      },
      expiry: {
        count: Number(row.expiry_count ?? 0),
        nearestExpiryAt: row.expiry_nearest_expiry_at ?? undefined,
      },
      derivedState: expiring
        ? "EXPIRING_SOON"
        : hasBenefits
          ? "ACTIVE_BENEFITS"
          : "NO_ACTIVE_BENEFITS",
    };
  }
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
        `WITH effective_tiers AS (
           SELECT * FROM membership_tiers
           WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=now()
             AND (effective_to IS NULL OR effective_to>now())
         ), current_assignments AS (
           SELECT DISTINCT ON (a.customer_id) a.customer_id,a.tier_id
           FROM customer_membership_assignments a
           JOIN effective_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
           WHERE a.tenant_id=$1 AND a.status='ACTIVE' AND a.effective_from<=now()
             AND (a.effective_to IS NULL OR a.effective_to>now())
           ORDER BY a.customer_id,a.effective_from DESC,a.id DESC
         )
         SELECT t.id,t.code,t.name_json "name",count(ca.customer_id)::int "activeCount"
         FROM effective_tiers t LEFT JOIN current_assignments ca ON ca.tier_id=t.id
         GROUP BY t.id ORDER BY t.priority ASC,t.id ASC`,
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
