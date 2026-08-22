/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  giftCardDirectoryQuerySchema,
  giftCardLedgerDirectoryQuerySchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

const giftCardBaseCte = `
  WITH funding_rollup AS (
    SELECT gift_card_id,
      COALESCE(SUM(allocated_minor) FILTER (WHERE funding_type='ACTIVATION'),0)::bigint activated_funding_minor,
      COALESCE(SUM(allocated_minor) FILTER (WHERE funding_type='RELOAD'),0)::bigint reload_committed_minor
    FROM stored_value_funding_allocations
    WHERE tenant_id=$1
    GROUP BY gift_card_id
  ), ledger_activity AS (
    SELECT account_id, MAX(occurred_at) last_activity_at
    FROM stored_value_ledger_entries
    WHERE tenant_id=$1
    GROUP BY account_id
  ), redemption_rollup AS (
    SELECT account_id,
      COALESCE(SUM(ABS(redeemed_delta_minor)) FILTER (WHERE entry_type='REDEEM' AND occurred_at>=date_trunc('month',now())),0)::bigint redeemed_this_period_minor,
      COUNT(*) FILTER (WHERE entry_type='REDEEM' AND occurred_at>=date_trunc('month',now()))::int redemption_transaction_count
    FROM stored_value_ledger_entries
    WHERE tenant_id=$1
    GROUP BY account_id
  ), raw AS (
    SELECT
      g.id,g.tenant_id,g.product_id,g.customer_id,g.card_reference,g.number_last4,g.form,g.status,g.currency,
      g.activated_at,g.expires_at,g.source_order_id,g.source_order_line_id,g.source_payment_id,g.policy_snapshot_json,
      g.issuance_branch_id,g.last_activity_branch_id,g.legal_policy_id,g.legal_policy_version,g.jurisdiction,g.expiration_mode,
      g.locked_until,g.created_at,g.version,
      a.id account_id,a.pending_minor,a.available_minor,a.reserved_minor,a.redeemed_minor,a.expired_minor,a.cancelled_minor,
      a.lifetime_issued_minor,a.lifetime_redeemed_minor,a.version account_version,
      p.product_code,p.name_json product_name,p.reloadable,p.assignment_policy,p.pin_required,p.card_form,
      customer.display_name customer_name,
      issuance_branch.name issuance_branch_name,
      activity_branch.name last_activity_branch_name,
      order_source.order_number source_order_number,
      source_invoice.id source_invoice_id,source_invoice.invoice_number source_invoice_number,
      source_payment.payment_reference source_payment_reference,source_payment.status source_payment_status,
      source_issuer.display_name source_issuer_name,
      COALESCE(ledger_activity.last_activity_at,g.activated_at,g.created_at) last_activity_at,
      COALESCE(redemption_rollup.redeemed_this_period_minor,0)::bigint redeemed_this_period_minor,
      COALESCE(redemption_rollup.redemption_transaction_count,0)::int redemption_transaction_count,
      COALESCE(funding_rollup.reload_committed_minor,0)::bigint reload_committed_minor,
      COALESCE(NULLIF(g.policy_snapshot_json->>'faceValueMinor','')::bigint,
        GREATEST(a.lifetime_issued_minor-COALESCE(funding_rollup.reload_committed_minor,0),0))::bigint initial_face_value_minor
    FROM gift_cards g
    JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id
    JOIN gift_card_products p ON p.tenant_id=g.tenant_id AND p.id=g.product_id
    LEFT JOIN customers customer ON customer.tenant_id=g.tenant_id AND customer.id=g.customer_id
    LEFT JOIN branches issuance_branch ON issuance_branch.tenant_id=g.tenant_id AND issuance_branch.id=g.issuance_branch_id
    LEFT JOIN branches activity_branch ON activity_branch.tenant_id=g.tenant_id AND activity_branch.id=COALESCE(g.last_activity_branch_id,g.issuance_branch_id)
    LEFT JOIN pos_orders order_source ON order_source.tenant_id=g.tenant_id AND order_source.id=g.source_order_id
    LEFT JOIN invoices source_invoice ON source_invoice.tenant_id=g.tenant_id AND source_invoice.pos_order_id=g.source_order_id
    LEFT JOIN payments source_payment ON source_payment.tenant_id=g.tenant_id AND source_payment.id=g.source_payment_id
    LEFT JOIN users source_issuer ON source_issuer.id=order_source.created_by_user_id
    LEFT JOIN ledger_activity ON ledger_activity.account_id=a.id
    LEFT JOIN redemption_rollup ON redemption_rollup.account_id=a.id
    LEFT JOIN funding_rollup ON funding_rollup.gift_card_id=g.id
    WHERE g.tenant_id=$1
      AND ($3::uuid[] IS NULL OR COALESCE(g.last_activity_branch_id,g.issuance_branch_id)=ANY($3::uuid[]))
      AND ($5::uuid IS NULL OR g.customer_id=$5)
  ), base AS (
    SELECT raw.*,
      CASE
        WHEN status='ACTIVE' AND expires_at IS NOT NULL AND expires_at>now()
          AND expires_at<=now()+make_interval(days=>$2) AND available_minor+reserved_minor>0 THEN 'EXPIRING'
        WHEN status='ACTIVE' AND redeemed_minor>0 AND available_minor>0 THEN 'PARTIALLY_USED'
        WHEN status='ACTIVE' AND redeemed_minor=0 AND available_minor>0 THEN 'UNUSED'
        WHEN status='ACTIVE' THEN 'ACTIVE'
        ELSE status
      END derived_state,
      (status='ACTIVE' AND available_minor>0
        AND last_activity_at<now()-make_interval(days=>$4)) is_dormant
    FROM raw
  )
`;

const ledgerBaseCte = `
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
  ), enriched AS (
    SELECT c.*,c.available_after_minor+c.reserved_after_minor liability_after_minor,
      o.order_number,inv.invoice_number,p.payment_reference,
      r.refund_reference,cn.credit_note_number,
      u.display_name actor_name,b.name branch_name
    FROM chronological c
    LEFT JOIN pos_orders o ON o.tenant_id=c.tenant_id AND o.id=c.order_id
    LEFT JOIN invoices inv ON inv.tenant_id=c.tenant_id AND (inv.id=c.invoice_id OR (c.invoice_id IS NULL AND inv.pos_order_id=c.order_id))
    LEFT JOIN payments p ON p.tenant_id=c.tenant_id AND p.id=c.payment_id
    LEFT JOIN refunds r ON r.tenant_id=c.tenant_id AND r.id=c.refund_id
    LEFT JOIN credit_notes cn ON cn.tenant_id=c.tenant_id AND cn.id=c.credit_note_id
    LEFT JOIN users u ON u.id=c.actor_user_id
    LEFT JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
  )
`;

const amount = (value: unknown) => (value == null ? null : String(value));

@Injectable()
export class GiftCardReportingService {
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
         FROM users u JOIN customers c ON c.tenant_id=$1
          AND ((u.phone_normalized IS NOT NULL AND c.phone_normalized=u.phone_normalized)
            OR (u.email IS NOT NULL AND lower(c.email_normalized)=lower(u.email)))
         WHERE u.id=$2 LIMIT 1`,
        [auth.tenantId, auth.userId],
      )
    ).rows[0];
    return row?.id ?? null;
  }

  private async permissions(auth: AccessClaims) {
    if (auth.supportAccess) return new Set(auth.supportAccess.permissions);
    const rows = (
      await this.db.query<any>(
        `SELECT DISTINCT rp.permission_code
         FROM membership_roles mr JOIN role_permissions rp ON rp.role=mr.role
         WHERE mr.membership_id=$1`,
        [auth.membershipId],
      )
    ).rows;
    return new Set<string>(rows.map((row) => row.permission_code));
  }

  private params(auth: AccessClaims, query: any, customerId: string | null) {
    return [
      auth.tenantId,
      query.expiryWindowDays,
      this.scopedBranches(auth),
      query.inactiveDays,
      customerId,
    ];
  }

  private filters(query: any, start = 6) {
    const where = ["TRUE"];
    const params: any[] = [];
    const add = (sql: string, value: unknown) => {
      const placeholder = `$${start + params.length}`;
      params.push(value);
      where.push(sql.replace("?", placeholder));
    };
    if (query.search) {
      const search = `%${query.search.toLowerCase()}%`;
      const first = start + params.length;
      params.push(search, search, search, search, search);
      where.push(`(lower(card_reference) LIKE $${first} OR number_last4 LIKE $${first + 1} OR lower(COALESCE(customer_name,'')) LIKE $${first + 2} OR lower(COALESCE(source_order_number,'')) LIKE $${first + 3} OR lower(COALESCE(product_code,'')) LIKE $${first + 4})`);
    }
    if (query.branchId) add("COALESCE(last_activity_branch_id,issuance_branch_id)=?::uuid", query.branchId);
    if (query.productId) add("product_id=?::uuid", query.productId);
    if (query.customerId) add("customer_id=?::uuid", query.customerId);
    if (query.ownership === "CUSTOMER_ASSIGNED") where.push("customer_id IS NOT NULL");
    if (query.ownership === "BEARER") where.push("customer_id IS NULL");
    if (query.lifecycle !== "ALL") add("status=?", query.lifecycle);
    if (query.derivedState === "DORMANT_WITH_BALANCE") where.push("is_dormant=true");
    else if (query.derivedState !== "ALL") add("derived_state=?", query.derivedState);
    if (query.balanceBucket === "GT_1000000") where.push("available_minor>(1000::bigint*1000)");
    if (query.balanceBucket === "500K_TO_1M") where.push("available_minor BETWEEN (500::bigint*1000) AND (1000::bigint*1000)");
    if (query.balanceBucket === "100K_TO_499K") where.push("available_minor BETWEEN (100::bigint*1000) AND (500::bigint*1000-1)");
    if (query.balanceBucket === "LT_100K") where.push("available_minor>0 AND available_minor<(100::bigint*1000)");
    if (query.balanceBucket === "ZERO") where.push("available_minor=0");
    if (query.issuedFrom) add("activated_at::date>=?::date", query.issuedFrom);
    if (query.issuedTo) add("activated_at::date<=?::date", query.issuedTo);
    return { where: where.join(" AND "), params };
  }

  private order(query: any) {
    switch (query.sort) {
      case "OLDEST": return "COALESCE(activated_at,created_at) ASC,id ASC";
      case "BALANCE_DESC": return "available_minor DESC,id DESC";
      case "BALANCE_ASC": return "available_minor ASC,id ASC";
      case "EXPIRY_ASC": return "expires_at ASC NULLS LAST,id ASC";
      case "LAST_ACTIVITY_ASC": return "last_activity_at ASC NULLS FIRST,id ASC";
      default: return "COALESCE(activated_at,created_at) DESC,id DESC";
    }
  }

  private json(value: unknown, fallback: any) {
    if (value == null) return fallback;
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  private item(row: any, canReadBalance: boolean) {
    return {
      id: row.id,
      cardReference: row.card_reference,
      maskedNumber: row.number_last4 ? `**** **** **** ${row.number_last4}` : "Đã ẩn số thẻ",
      form: row.form,
      status: row.status,
      derivedState: row.is_dormant ? "DORMANT_WITH_BALANCE" : row.derived_state,
      currency: row.currency,
      customer: row.customer_id && row.customer_name
        ? { id: row.customer_id, displayName: row.customer_name }
        : null,
      product: {
        id: row.product_id,
        productCode: row.product_code,
        name: row.product_name,
        reloadable: row.reloadable,
        assignmentPolicy: row.assignment_policy,
        pinRequired: row.pin_required,
      },
      initialFaceValueMinor: canReadBalance ? amount(row.initial_face_value_minor) : null,
      reloadCommittedMinor: canReadBalance ? amount(row.reload_committed_minor) : null,
      availableMinor: canReadBalance ? amount(row.available_minor) : null,
      reservedMinor: canReadBalance ? amount(row.reserved_minor) : null,
      netRedeemedMinor: canReadBalance ? amount(row.redeemed_minor) : null,
      liabilityMinor: canReadBalance ? amount(BigInt(row.available_minor ?? 0) + BigInt(row.reserved_minor ?? 0)) : null,
      activatedAt: row.activated_at,
      expiresAt: row.expires_at,
      issuanceBranchId: row.issuance_branch_id,
      issuanceBranchName: row.issuance_branch_name,
      lastActivityAt: row.last_activity_at,
      lastActivityBranchId: row.last_activity_branch_id,
      lastActivityBranchName: row.last_activity_branch_name,
      inactivityDays: row.last_activity_at ? Math.max(0, Math.floor((Date.now() - new Date(row.last_activity_at).getTime()) / 86400000)) : null,
      version: row.version,
      access: { balance: canReadBalance },
    };
  }

  private summaryRow(row: any) {
    return {
      activeCount: Number(row.active_count ?? 0),
      activeCustomerCount: Number(row.active_customer_count ?? 0),
      expiringCount: Number(row.expiring_count ?? 0),
      dormantWithBalanceCount: Number(row.dormant_count ?? 0),
      redeemedThisPeriodTransactionCount: Number(row.redemption_transaction_count ?? 0),
      activatedThisPeriodCount: Number(row.activated_count ?? 0),
      availableByCurrency: this.json(row.available_by_currency, []),
      redeemedThisPeriodByCurrency: this.json(row.redeemed_by_currency, []),
      activatedFaceValueByCurrency: this.json(row.activated_by_currency, []),
      dormantBalanceByCurrency: this.json(row.dormant_by_currency, []),
    };
  }

  private summarySql(filteredCte: string) {
    return `${filteredCte}, currency_summary AS (
      SELECT currency,
        COALESCE(SUM(available_minor),0)::text available_minor,
        COALESCE(SUM(redeemed_this_period_minor),0)::text redeemed_minor,
        COALESCE(SUM(initial_face_value_minor) FILTER (WHERE activated_at>=date_trunc('month',now())),0)::text activated_minor,
        COALESCE(SUM(available_minor+reserved_minor) FILTER (WHERE is_dormant),0)::text dormant_minor
      FROM filtered GROUP BY currency
    ), distribution AS (
      SELECT derived_state,COUNT(*)::int count FROM filtered GROUP BY derived_state
    )
    SELECT
      COUNT(*) FILTER (WHERE status='ACTIVE' AND (expires_at IS NULL OR expires_at>now()))::int active_count,
      COUNT(DISTINCT customer_id) FILTER (WHERE status='ACTIVE' AND (expires_at IS NULL OR expires_at>now()))::int active_customer_count,
      COUNT(*) FILTER (WHERE derived_state='EXPIRING')::int expiring_count,
      COUNT(*) FILTER (WHERE is_dormant)::int dormant_count,
      COALESCE(SUM(redemption_transaction_count),0)::int redemption_transaction_count,
      COUNT(*) FILTER (WHERE activated_at>=date_trunc('month',now()))::int activated_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('currency',currency,'amountMinor',available_minor) ORDER BY currency) FROM currency_summary),'[]'::jsonb) available_by_currency,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('currency',currency,'amountMinor',redeemed_minor) ORDER BY currency) FROM currency_summary),'[]'::jsonb) redeemed_by_currency,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('currency',currency,'amountMinor',activated_minor) ORDER BY currency) FROM currency_summary),'[]'::jsonb) activated_by_currency,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('currency',currency,'amountMinor',dormant_minor) ORDER BY currency) FROM currency_summary),'[]'::jsonb) dormant_by_currency,
      COALESCE((SELECT jsonb_object_agg(derived_state,count) FROM distribution),'{}'::jsonb) lifecycle_distribution
    FROM filtered`;
  }

  async directory(auth: AccessClaims, input: unknown) {
    this.access(auth);
    const query = giftCardDirectoryQuerySchema.parse(input ?? {});
    const customerScope = await this.ownCustomerId(auth);
    const permissions = await this.permissions(auth);
    const canReadBalance = permissions.has("gift_card.balance.read");
    const baseParams = this.params(auth, query, customerScope);
    const filter = this.filters(query);
    const filteredCte = `${giftCardBaseCte}, filtered AS (SELECT * FROM base WHERE ${filter.where})`;
    const count = (
      await this.db.query<any>(`${filteredCte} SELECT COUNT(*)::int total FROM filtered`, [...baseParams, ...filter.params])
    ).rows[0]?.total ?? 0;
    const limitPlaceholder = `$${baseParams.length + filter.params.length + 1}`;
    const offsetPlaceholder = `$${baseParams.length + filter.params.length + 2}`;
    const itemRows = (
      await this.db.query<any>(
        `${filteredCte} SELECT * FROM filtered ORDER BY ${this.order(query)} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        [...baseParams, ...filter.params, query.pageSize, (query.page - 1) * query.pageSize],
      )
    ).rows;
    const summaryRow = (
      await this.db.query<any>(this.summarySql(filteredCte), [...baseParams, ...filter.params])
    ).rows[0] ?? {};
    const lifecycleDistribution = this.json(summaryRow.lifecycle_distribution, {});
    return {
      items: itemRows.map((row) => this.item(row, canReadBalance)),
      pagination: { page: query.page, pageSize: query.pageSize, total: Number(count), totalPages: Math.ceil(Number(count) / query.pageSize) },
      summary: this.summaryRow(summaryRow),
      lifecycleDistribution,
      generatedAt: new Date().toISOString(),
      access: { balance: canReadBalance, issue: permissions.has("gift_card.issue"), ledger: permissions.has("gift_card.ledger.read") },
    };
  }

  async overview(auth: AccessClaims, input: unknown) {
    const directory = await this.directory(auth, input);
    return {
      summary: directory.summary,
      lifecycleDistribution: directory.lifecycleDistribution,
      generatedAt: directory.generatedAt,
      access: directory.access,
    };
  }

  private async cardRow(auth: AccessClaims, id: string) {
    const query = { expiryWindowDays: 30, inactiveDays: 90 };
    const customerScope = await this.ownCustomerId(auth);
    const rows = (
      await this.db.query<any>(`${giftCardBaseCte} SELECT * FROM base WHERE id=$6`, [
        ...this.params(auth, query, customerScope),
        id,
      ])
    ).rows;
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: "GIFT_CARD_NOT_FOUND", message: "Stored-value resource not found" });
    return row;
  }

  private policy(row: any) {
    const snapshot = this.json(row.policy_snapshot_json, {}) as any;
    return {
      expirationMode: row.expiration_mode,
      legalPolicyId: row.legal_policy_id,
      legalPolicyVersion: row.legal_policy_version,
      jurisdiction: row.jurisdiction,
      redemptionBranchIds: snapshot?.redemptionBranchIds ?? null,
      eligibleLineTypes: snapshot?.eligibleLineTypes ?? null,
      serviceIds: snapshot?.serviceIds ?? null,
      productIds: snapshot?.productIds ?? null,
      assignmentPolicy: row.assignment_policy,
      reloadable: row.reloadable,
      pinRequired: row.pin_required,
    };
  }

  async cardOverview(auth: AccessClaims, id: string) {
    this.access(auth);
    const [row, permissions] = await Promise.all([this.cardRow(auth, id), this.permissions(auth)]);
    const canReadBalance = permissions.has("gift_card.balance.read");
    const canReadLedger = permissions.has("gift_card.ledger.read");
    return {
      card: {
        id: row.id,
        cardReference: row.card_reference,
        maskedNumber: row.number_last4 ? `**** **** **** ${row.number_last4}` : "Masked card",
        customerId: row.customer_id,
        productId: row.product_id,
        form: row.form,
        status: row.status,
        currency: row.currency,
        activatedAt: row.activated_at,
        expiresAt: row.expires_at,
        issuanceBranchId: row.issuance_branch_id,
        lastActivityBranchId: row.last_activity_branch_id,
        lockedUntil: row.locked_until,
        version: row.version,
      },
      customer: row.customer_id && row.customer_name ? { id: row.customer_id, displayName: row.customer_name } : null,
      product: { id: row.product_id, productCode: row.product_code, name: row.product_name, reloadable: row.reloadable, assignmentPolicy: row.assignment_policy, pinRequired: row.pin_required, form: row.card_form },
      balance: canReadBalance ? {
        pendingMinor: amount(row.pending_minor),
        availableMinor: amount(row.available_minor),
        reservedMinor: amount(row.reserved_minor),
        redeemedMinor: amount(row.redeemed_minor),
        expiredMinor: amount(row.expired_minor),
        cancelledMinor: amount(row.cancelled_minor),
        liabilityMinor: amount(BigInt(row.available_minor ?? 0) + BigInt(row.reserved_minor ?? 0)),
        initialFaceValueMinor: amount(row.initial_face_value_minor),
        reloadCommittedMinor: amount(row.reload_committed_minor),
        netRedeemedMinor: amount(row.redeemed_minor),
        accountId: row.account_id,
        version: Number(row.account_version ?? 1),
      } : null,
      source: {
        sourceOrderId: row.source_order_id,
        sourceOrderNumber: row.source_order_number,
        sourceOrderLineId: row.source_order_line_id,
        invoiceId: row.source_invoice_id,
        invoiceNumber: row.source_invoice_number,
        paymentId: row.source_payment_id,
        paymentReference: row.source_payment_reference,
        paymentStatus: row.source_payment_status,
        issuanceBranchId: row.issuance_branch_id,
        issuanceBranchName: row.issuance_branch_name,
        lastActivityBranchId: row.last_activity_branch_id,
        lastActivityBranchName: row.last_activity_branch_name,
        issuedByDisplayName: row.source_issuer_name,
      },
      policy: this.policy(row),
      lastActivityAt: row.last_activity_at,
      inactivityDays: row.last_activity_at ? Math.max(0, Math.floor((Date.now() - new Date(row.last_activity_at).getTime()) / 86400000)) : null,
      recentLedger: canReadLedger ? await this.ledgerRows(auth.tenantId, row.account_id, 6) : [],
      access: {
        balance: canReadBalance,
        ledger: canReadLedger,
        actions: {
          suspend: permissions.has("gift_card.suspend") && row.status === "ACTIVE",
          reactivate: permissions.has("gift_card.activate") && row.status === "SUSPENDED",
          cancel: permissions.has("gift_card.cancel") && ["PENDING_ACTIVATION", "ACTIVE", "SUSPENDED"].includes(row.status),
          replace: permissions.has("gift_card.replace") && ["ACTIVE", "SUSPENDED"].includes(row.status),
          reload: permissions.has("gift_card.reload") && row.status === "ACTIVE" && row.reloadable,
        },
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private async ledgerRows(tenantId: string, accountId: string, limit: number) {
    const rows = (
      await this.db.query<any>(`${ledgerBaseCte} SELECT * FROM enriched ORDER BY occurred_at DESC,id DESC LIMIT $3`, [tenantId, accountId, limit])
    ).rows;
    return rows.map((row) => this.ledgerItem(row));
  }

  private ledgerItem(row: any) {
    return {
      id: row.id,
      entryType: row.entry_type,
      occurredAt: row.occurred_at,
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
      sourceEntryId: row.source_entry_id,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_name,
      branchId: row.branch_id,
      branchName: row.branch_name,
      generationKey: row.generation_key,
      policySnapshot: row.policy_snapshot_json,
    };
  }

  async ledgerDirectory(auth: AccessClaims, id: string, input: unknown) {
    this.access(auth);
    const query = giftCardLedgerDirectoryQuerySchema.parse(input ?? {});
    const row = await this.cardRow(auth, id);
    const permissions = await this.permissions(auth);
    if (!permissions.has("gift_card.ledger.read")) {
      return { items: [], pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 }, access: { ledger: false }, generatedAt: new Date().toISOString() };
    }
    const where = ["TRUE"];
    const params: any[] = [auth.tenantId, row.account_id];
    const add = (sql: string, value: unknown) => {
      const placeholder = `$${params.length + 1}`;
      params.push(value);
      where.push(sql.replace("?", placeholder));
    };
    if (query.from) add("occurred_at::date>=?::date", query.from);
    if (query.to) add("occurred_at::date<=?::date", query.to);
    if (query.entryType) add("entry_type=?", query.entryType);
    if (query.search) {
      const search = `%${query.search.toLowerCase()}%`;
      const first = params.length + 1;
      params.push(search, search, search, search, search, search);
      where.push(`(lower(COALESCE(order_number,'')) LIKE $${first} OR lower(COALESCE(invoice_number,'')) LIKE $${first + 1} OR lower(COALESCE(payment_reference,'')) LIKE $${first + 2} OR lower(COALESCE(refund_reference,'')) LIKE $${first + 3} OR lower(COALESCE(credit_note_number,'')) LIKE $${first + 4} OR lower(COALESCE(actor_name,'')) LIKE $${first + 5})`);
    }
    const filtered = `${ledgerBaseCte}, filtered AS (SELECT * FROM enriched WHERE ${where.join(" AND ")})`;
    const total = (
      await this.db.query<any>(`${filtered} SELECT COUNT(*)::int total FROM filtered`, params)
    ).rows[0]?.total ?? 0;
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;
    const entries = (
      await this.db.query<any>(`${filtered} SELECT * FROM filtered ORDER BY occurred_at ${query.sort === "OLDEST" ? "ASC" : "DESC"},id ${query.sort === "OLDEST" ? "ASC" : "DESC"} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`, [...params, query.pageSize, (query.page - 1) * query.pageSize])
    ).rows;
    return {
      items: entries.map((entry) => this.ledgerItem(entry)),
      pagination: { page: query.page, pageSize: query.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / query.pageSize) },
      access: { ledger: true },
      generatedAt: new Date().toISOString(),
    };
  }
}
