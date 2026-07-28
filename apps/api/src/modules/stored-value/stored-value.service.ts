/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  customerCreditAdjustmentSchema,
  giftCardLineSchema,
  giftCardProductSchema,
  giftCardReloadLineSchema,
  storedValueLookupSchema,
  storedValueReserveSchema,
  storedValueVersionSchema,
} from "@nailsoft/validation";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import {
  assertGiftCardTransition,
  cardHash,
  generateCardCredentials,
  lookupKeyHash,
  maskCard,
  minor,
  pinHash,
  storedValueRedemptionCap,
  storedValueLiability,
  verifyPin,
} from "./stored-value-domain.js";

@Injectable()
export class StoredValueService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
  ) {}

  private secret() {
    const value = process.env.STORED_VALUE_HMAC_SECRET;
    if (value) return value;
    if (process.env.NODE_ENV === "production")
      throw new Error("STORED_VALUE_HMAC_SECRET_REQUIRED");
    return "test-only-stored-value-secret-change-in-production";
  }
  private access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((r) => ["SALON_OWNER", "BRANCH_MANAGER"].includes(r))
    )
      throw new ForbiddenException({
        code: "STORED_VALUE_PERMISSION_DENIED",
        message: "Platform support requires an explicit tenant access grant",
      });
  }
  private branch(auth: AccessClaims, branchId: string) {
    this.access(auth);
    if (
      !auth.roles.includes("SALON_OWNER") &&
      !auth.branchIds.includes(branchId)
    )
      throw new ForbiddenException({ code: "BRANCH_ACCESS_DENIED" });
  }
  private async ownCustomerId(auth: AccessClaims) {
    const row = (
      await this.db.query<any>(
        `SELECT c.id FROM users u JOIN customers c ON c.tenant_id=$1 AND ((u.phone_normalized IS NOT NULL AND c.phone_normalized=u.phone_normalized) OR (u.email IS NOT NULL AND lower(c.email_normalized)=lower(u.email))) WHERE u.id=$2 LIMIT 1`,
        [auth.tenantId, auth.userId],
      )
    ).rows[0];
    if (!row) this.notFound("CUSTOMER_NOT_FOUND");
    return row.id as string;
  }
  private conflict(
    code: string,
    message = "Stored-value command conflicts with current state",
  ): never {
    throw new ConflictException({ code, message });
  }
  private notFound(code = "GIFT_CARD_NOT_FOUND"): never {
    throw new NotFoundException({
      code,
      message: "Stored-value resource not found",
    });
  }
  private command<T>(
    auth: AccessClaims,
    command: string,
    key: string,
    request: unknown,
    work: (c: PoolClient) => Promise<T>,
  ) {
    this.access(auth);
    return this.db.transaction(
      async (c) =>
        (
          await this.idem.execute(c, {
            tenantId: auth.tenantId,
            actorScope: `user:${auth.userId}`,
            command,
            key,
            request,
            work: () => work(c),
          })
        ).data,
    );
  }
  private async enabled(c: PoolClient, tenantId: string) {
    const row = (
      await c.query<any>(
        "SELECT feature_status FROM stored_value_settings WHERE tenant_id=$1",
        [tenantId],
      )
    ).rows[0];
    if (!row || row.feature_status !== "ENABLED")
      this.conflict("STORED_VALUE_FEATURE_DISABLED");
  }
  private manager(auth: AccessClaims) {
    return auth.roles.some((role) =>
      ["SALON_OWNER", "BRANCH_MANAGER"].includes(role),
    );
  }
  private scopedBranches(auth: AccessClaims) {
    return auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
  }
  private assertCardBranch(auth: AccessClaims, card: any) {
    const branchId = card.last_activity_branch_id ?? card.issuance_branch_id;
    if (!auth.roles.includes("CUSTOMER")) {
      if (!branchId) {
        if (!auth.roles.includes("SALON_OWNER")) this.notFound();
      } else this.branch(auth, branchId);
    }
    return branchId as string | null;
  }
  private policyArray(value: any, key: string): string[] {
    const result = value?.[key];
    return Array.isArray(result) ? result.map(String) : [];
  }
  private async consumeLookupAttempt(
    c: PoolClient,
    auth: AccessClaims,
    number: string,
  ) {
    const subject = lookupKeyHash(
      auth.tenantId,
      `${auth.userId}:${number.replace(/\s+/g, "").slice(-4)}`,
      this.secret(),
    );
    await c.query(
      `INSERT INTO stored_value_lookup_limits(tenant_id,lookup_key_hash,window_started_at,attempts) VALUES($1,$2,now(),1)
       ON CONFLICT(tenant_id,lookup_key_hash) DO UPDATE SET
         attempts=CASE WHEN stored_value_lookup_limits.window_started_at<now()-interval '15 minutes' THEN 1 ELSE stored_value_lookup_limits.attempts+1 END,
         window_started_at=CASE WHEN stored_value_lookup_limits.window_started_at<now()-interval '15 minutes' THEN now() ELSE stored_value_lookup_limits.window_started_at END,
         locked_until=CASE WHEN stored_value_lookup_limits.attempts>=9 THEN now()+interval '15 minutes' ELSE stored_value_lookup_limits.locked_until END,
         updated_at=now()`,
      [auth.tenantId, subject],
    );
    const limit = (
      await c.query<any>(
        "SELECT * FROM stored_value_lookup_limits WHERE tenant_id=$1 AND lookup_key_hash=$2 FOR UPDATE",
        [auth.tenantId, subject],
      )
    ).rows[0];
    if (limit?.locked_until && new Date(limit.locked_until) > new Date())
      this.conflict("GIFT_CARD_LOCKED");
  }
  private async enforceVelocity(
    c: PoolClient,
    auth: AccessClaims,
    input: {
      action: "ISSUE" | "REDEEM" | "RELOAD" | "LOOKUP" | "RESERVE";
      branchId: string;
      amount: bigint;
      customerId?: string | null;
      accountId?: string | null;
      giftCardId?: string | null | undefined;
      deviceId?: string | undefined;
      approvalReason?: string | undefined;
      requestId: string;
    },
  ) {
    const settings = (
      await c.query<any>(
        `SELECT s.*, (now() AT TIME ZONE b.timezone)::date local_date
           FROM stored_value_settings s JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=$2
          WHERE s.tenant_id=$1`,
        [auth.tenantId, input.branchId],
      )
    ).rows[0];
    if (!settings) this.conflict("STORED_VALUE_FEATURE_DISABLED");
    const limit = BigInt(
      input.action === "ISSUE"
        ? settings.daily_issue_limit_minor
        : input.action === "RELOAD"
          ? settings.daily_reload_limit_minor
          : settings.daily_redeem_limit_minor,
    );
    const deviceKey = input.deviceId
      ? lookupKeyHash(auth.tenantId, input.deviceId, this.secret())
      : "NO_DEVICE";
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `stored-value:${auth.tenantId}:${settings.local_date}:${input.action}:${input.branchId}`,
    ]);
    const totals = (
      await c.query<any>(
        `SELECT COALESCE(sum(amount_minor),0) branch_total,
                COALESCE(sum(amount_minor) FILTER(WHERE actor_user_id=$5),0) actor_total,
                COALESCE(sum(amount_minor) FILTER(WHERE device_key_hash=$6),0) device_total,
                COALESCE(sum(amount_minor) FILTER(WHERE customer_id IS NOT DISTINCT FROM $7::uuid),0) customer_total,
                COALESCE(sum(amount_minor) FILTER(WHERE account_id IS NOT DISTINCT FROM $8::uuid),0) account_total
           FROM stored_value_velocity_counters
          WHERE tenant_id=$1 AND local_date=$2 AND action=$3 AND branch_id=$4`,
        [
          auth.tenantId,
          settings.local_date,
          input.action,
          input.branchId,
          auth.userId,
          deviceKey,
          input.customerId ?? null,
          input.accountId ?? null,
        ],
      )
    ).rows[0];
    if (
      [
        totals.branch_total,
        totals.actor_total,
        totals.device_total,
        input.customerId ? totals.customer_total : 0,
        input.accountId ? totals.account_total : 0,
      ].some((value) => BigInt(value ?? 0) + input.amount > limit)
    )
      this.conflict("STORED_VALUE_DAILY_LIMIT_EXCEEDED");
    const high = BigInt(settings.high_value_approval_minor);
    if (high > 0n && input.amount >= high) {
      if (!this.manager(auth) || !input.approvalReason)
        this.conflict("STORED_VALUE_HIGH_VALUE_APPROVAL_REQUIRED");
      await c.query(
        `INSERT INTO stored_value_high_value_approvals(tenant_id,action,branch_id,account_id,gift_card_id,amount_minor,reason,approved_by_user_id,request_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,request_id,action) DO NOTHING`,
        [
          auth.tenantId,
          input.action,
          input.branchId,
          input.accountId ?? null,
          input.giftCardId ?? null,
          input.amount.toString(),
          input.approvalReason,
          auth.userId,
          input.requestId,
        ],
      );
    }
    await c.query(
      `INSERT INTO stored_value_velocity_counters(tenant_id,local_date,action,branch_id,actor_user_id,device_key_hash,customer_id,account_id,operation_count,amount_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
       ON CONFLICT ON CONSTRAINT stored_value_velocity_unique
       DO UPDATE SET operation_count=stored_value_velocity_counters.operation_count+1,
                     amount_minor=stored_value_velocity_counters.amount_minor+EXCLUDED.amount_minor,updated_at=now()`,
      [
        auth.tenantId,
        settings.local_date,
        input.action,
        input.branchId,
        auth.userId,
        deviceKey,
        input.customerId ?? null,
        input.accountId ?? null,
        input.amount.toString(),
      ],
    );
  }
  private lineEligible(line: any, policy: any) {
    if (line.line_type === "GIFT_CARD") return false;
    const allowedTypes = this.policyArray(policy, "eligibleLineTypes");
    if (allowedTypes.length && !allowedTypes.includes(line.line_type))
      return false;
    const serviceIds = this.policyArray(policy, "serviceIds");
    if (
      serviceIds.length &&
      (!line.service_id || !serviceIds.includes(line.service_id))
    )
      return false;
    const productIds = this.policyArray(policy, "productIds");
    if (
      productIds.length &&
      (!line.inventory_item_id || !productIds.includes(line.inventory_item_id))
    )
      return false;
    return true;
  }
  private async redemptionPlan(
    c: PoolClient,
    auth: AccessClaims,
    order: any,
    requested: bigint,
    available: bigint,
    policy: any,
  ) {
    const lines = (
      await c.query<any>(
        `SELECT * FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' ORDER BY line_no,id`,
        [auth.tenantId, order.id],
      )
    ).rows;
    const externalOrderPaid = BigInt(
      (
        await c.query<any>(
          `SELECT COALESCE(sum(pa.amount_minor),0) amount FROM payment_allocations pa
             JOIN payments p ON p.tenant_id=pa.tenant_id AND p.id=pa.payment_id
            WHERE pa.tenant_id=$1 AND pa.pos_order_id=$2 AND pa.allocation_type='ORDER_TOTAL' AND p.status='CAPTURED'`,
          [auth.tenantId, order.id],
        )
      ).rows[0].amount,
    );
    const tipPaid = BigInt(
      (
        await c.query<any>(
          `SELECT COALESCE(sum(pa.amount_minor),0) amount FROM payment_allocations pa
             JOIN payments p ON p.tenant_id=pa.tenant_id AND p.id=pa.payment_id
            WHERE pa.tenant_id=$1 AND pa.pos_order_id=$2 AND pa.allocation_type='TIP' AND p.status='CAPTURED'`,
          [auth.tenantId, order.id],
        )
      ).rows[0].amount,
    );
    let externalCursor = externalOrderPaid;
    const remaining = lines.map((line: any) => {
      const net = BigInt(line.net_minor);
      return { line, remaining: net, external: 0n };
    });
    // External tender funds liabilities that stored value can never cover first
    // (gift-card funding and policy-ineligible lines), then eligible lines.
    // This keeps a mixed order payable without ever assigning stored value to a
    // prohibited line.
    for (const target of [
      ...remaining.filter((item: any) => !this.lineEligible(item.line, policy)),
      ...remaining.filter((item: any) => this.lineEligible(item.line, policy)),
    ]) {
      if (externalCursor <= 0n) break;
      const covered =
        externalCursor < target.remaining ? externalCursor : target.remaining;
      target.remaining -= covered;
      target.external += covered;
      externalCursor -= covered;
    }
    const existingApps = (
      await c.query<any>(
        `SELECT accepted_minor,redemption_plan_json FROM pos_order_stored_value_applications
          WHERE tenant_id=$1 AND order_id=$2 AND status IN('RESERVED','COMMITTED') ORDER BY created_at,id`,
        [auth.tenantId, order.id],
      )
    ).rows;
    for (const app of existingApps) {
      const prior = Array.isArray(app.redemption_plan_json?.lineAllocations)
        ? app.redemption_plan_json.lineAllocations
        : [];
      if (prior.length) {
        for (const allocation of prior) {
          const target = remaining.find(
            (item: any) => item.line.id === allocation.orderLineId,
          );
          if (!target) continue;
          const used = BigInt(allocation.allocatedMinor);
          target.remaining =
            target.remaining > used ? target.remaining - used : 0n;
        }
      } else {
        let cursor = BigInt(app.accepted_minor);
        for (const target of remaining) {
          if (cursor <= 0n) break;
          const used = cursor < target.remaining ? cursor : target.remaining;
          target.remaining -= used;
          cursor -= used;
        }
      }
    }
    const eligibleTargets = remaining.filter((x: any) =>
      this.lineEligible(x.line, policy),
    );
    const eligibleLineMinor = eligibleTargets.reduce(
      (sum: bigint, item: any) => sum + BigInt(item.line.net_minor),
      0n,
    );
    const externalPaidAllocationMinor = eligibleTargets.reduce(
      (sum: bigint, item: any) => sum + item.external,
      0n,
    );
    const existingStoredValueMinor = existingApps.reduce(
      (sum: bigint, item: any) => sum + BigInt(item.accepted_minor),
      0n,
    );
    const remainingEligibleMinor = eligibleTargets.reduce(
      (sum: bigint, item: any) => sum + item.remaining,
      0n,
    );
    const currentOrderDueMinor = BigInt(order.amount_due_minor);
    const acceptedMinor = storedValueRedemptionCap({
      requested,
      available,
      remainingEligible: remainingEligibleMinor,
      currentOrderDue: currentOrderDueMinor,
    });
    let allocationCursor = acceptedMinor;
    const lineAllocations: Array<{
      orderLineId: string;
      allocatedMinor: string;
    }> = [];
    for (const target of eligibleTargets) {
      if (allocationCursor <= 0n) break;
      const value =
        allocationCursor < target.remaining
          ? allocationCursor
          : target.remaining;
      if (value > 0n)
        lineAllocations.push({
          orderLineId: target.line.id,
          allocatedMinor: value.toString(),
        });
      allocationCursor -= value;
    }
    return {
      eligibleLineMinor,
      externalPaidAllocationMinor,
      existingStoredValueMinor,
      remainingEligibleMinor,
      currentOrderDueMinor,
      tipDueMinor:
        BigInt(order.tip_minor) > tipPaid
          ? BigInt(order.tip_minor) - tipPaid
          : 0n,
      requestedMinor: requested,
      acceptedMinor,
      unusedMinor: requested - acceptedMinor,
      lineAllocations,
    };
  }
  private async evidence(
    c: PoolClient,
    auth: AccessClaims,
    event: string,
    type: string,
    id: string,
    requestId: string,
    after: Record<string, unknown> = {},
    branchId?: string,
  ) {
    await c.query(
      "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        branchId ?? null,
        auth.userId,
        event,
        type,
        id,
        JSON.stringify(after),
        requestId,
      ],
    );
    await c.query(
      "INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        branchId ?? null,
        event,
        type,
        id,
        JSON.stringify({
          aggregateId: id,
          branchId: branchId ?? null,
          refetch: true,
        }),
        JSON.stringify({ type: "USER", id: auth.userId }),
        JSON.stringify({ schemaVersion: 1, pii: false }),
      ],
    );
  }

  private async post(
    c: PoolClient,
    auth: AccessClaims,
    input: {
      accountId: string;
      entryType: string;
      generationKey: string;
      currency: string;
      pending?: bigint;
      available?: bigint;
      reserved?: bigint;
      redeemed?: bigint;
      expired?: bigint;
      cancelled?: bigint;
      orderId?: string | null;
      invoiceId?: string | null;
      paymentId?: string | null;
      refundId?: string | null;
      creditNoteId?: string | null;
      reservationId?: string | null;
      adjustmentId?: string | null;
      sourceEntryId?: string | null;
      policy?: unknown;
      issued?: bigint;
      lifetimeRedeemed?: bigint;
      branchId?: string | null;
    },
  ) {
    const existing = (
      await c.query<any>(
        "SELECT id FROM stored_value_ledger_entries WHERE tenant_id=$1 AND account_id=$2 AND generation_key=$3",
        [auth.tenantId, input.accountId, input.generationKey],
      )
    ).rows[0];
    if (existing) return existing.id as string;
    const account = (
      await c.query<any>(
        "SELECT * FROM stored_value_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, input.accountId],
      )
    ).rows[0];
    if (!account) this.notFound("STORED_VALUE_ACCOUNT_NOT_FOUND");
    if (account.currency !== input.currency)
      this.conflict("STORED_VALUE_CURRENCY_MISMATCH");
    const deltas = {
      pending: input.pending ?? 0n,
      available: input.available ?? 0n,
      reserved: input.reserved ?? 0n,
      redeemed: input.redeemed ?? 0n,
      expired: input.expired ?? 0n,
      cancelled: input.cancelled ?? 0n,
    };
    const next = {
      pending: BigInt(account.pending_minor) + deltas.pending,
      available: BigInt(account.available_minor) + deltas.available,
      reserved: BigInt(account.reserved_minor) + deltas.reserved,
      redeemed: BigInt(account.redeemed_minor) + deltas.redeemed,
      expired: BigInt(account.expired_minor) + deltas.expired,
      cancelled: BigInt(account.cancelled_minor) + deltas.cancelled,
    };
    if (Object.values(next).some((value) => value < 0n))
      this.conflict("STORED_VALUE_INSUFFICIENT_BALANCE");
    const id = randomUUID();
    let branchId = input.branchId ?? null;
    if (!branchId && input.orderId)
      branchId =
        (
          await c.query<any>(
            "SELECT branch_id FROM pos_orders WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, input.orderId],
          )
        ).rows[0]?.branch_id ?? null;
    if (!branchId && input.refundId)
      branchId =
        (
          await c.query<any>(
            "SELECT branch_id FROM refunds WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, input.refundId],
          )
        ).rows[0]?.branch_id ?? null;
    await c.query(
      `INSERT INTO stored_value_ledger_entries(id,tenant_id,account_id,entry_type,pending_delta_minor,available_delta_minor,reserved_delta_minor,redeemed_delta_minor,expired_delta_minor,cancelled_delta_minor,currency,source_entry_id,order_id,invoice_id,payment_id,refund_id,credit_note_id,reservation_id,adjustment_request_id,policy_snapshot_json,generation_key,actor_user_id,branch_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        id,
        auth.tenantId,
        input.accountId,
        input.entryType,
        deltas.pending.toString(),
        deltas.available.toString(),
        deltas.reserved.toString(),
        deltas.redeemed.toString(),
        deltas.expired.toString(),
        deltas.cancelled.toString(),
        input.currency,
        input.sourceEntryId ?? null,
        input.orderId ?? null,
        input.invoiceId ?? null,
        input.paymentId ?? null,
        input.refundId ?? null,
        input.creditNoteId ?? null,
        input.reservationId ?? null,
        input.adjustmentId ?? null,
        JSON.stringify(input.policy ?? {}),
        input.generationKey,
        auth.userId,
        branchId,
      ],
    );
    await c.query("SELECT set_config('app.stored_value_posting','on',true)");
    await c.query(
      `UPDATE stored_value_accounts SET pending_minor=$3,available_minor=$4,reserved_minor=$5,redeemed_minor=$6,expired_minor=$7,cancelled_minor=$8,
       lifetime_issued_minor=lifetime_issued_minor+$9,lifetime_redeemed_minor=lifetime_redeemed_minor+$10,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [
        auth.tenantId,
        input.accountId,
        next.pending.toString(),
        next.available.toString(),
        next.reserved.toString(),
        next.redeemed.toString(),
        next.expired.toString(),
        next.cancelled.toString(),
        (input.issued ?? 0n).toString(),
        (input.lifetimeRedeemed ?? 0n).toString(),
      ],
    );
    await c.query("SELECT set_config('app.stored_value_posting','off',true)");
    return id;
  }

  async products(auth: AccessClaims) {
    this.access(auth);
    return (
      await this.db.query<any>(
        'SELECT id,product_code "productCode",version_no "versionNo",name_json name,status,amount_mode "amountMode",card_form "cardForm",currency,minimum_amount_minor::text "minimumAmountMinor",maximum_amount_minor::text "maximumAmountMinor",fixed_denominations_minor::text[] "fixedDenominationsMinor",maximum_balance_minor::text "maximumBalanceMinor",reloadable,assignment_policy "assignmentPolicy",pin_required "pinRequired",version FROM gift_card_products WHERE tenant_id=$1 ORDER BY product_code,version_no DESC',
        [auth.tenantId],
      )
    ).rows;
  }
  async legalPolicies(auth: AccessClaims) {
    this.access(auth);
    return (
      await this.db.query<any>(
        `SELECT id,jurisdiction,policy_version "policyVersion",status,expiration_mode "expirationMode",expiration_days "expirationDays",fixed_expiry_date "fixedExpiryDate",grace_days "graceDays",breakage_mode "breakageMode",legal_review_status "legalReviewStatus",effective_from "effectiveFrom",effective_to "effectiveTo",created_by_user_id "createdByUserId",approved_by_user_id "approvedByUserId",approved_at "approvedAt",version FROM stored_value_legal_policies WHERE tenant_id=$1 ORDER BY jurisdiction,policy_version DESC`,
        [auth.tenantId],
      )
    ).rows;
  }
  createLegalPolicy(
    auth: AccessClaims,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.command(
      auth,
      "stored-value.legal-policy.create",
      key,
      input,
      async (c) => {
        const jurisdiction = String(
          input?.jurisdiction ?? "UNSPECIFIED",
        ).trim();
        const expirationMode = String(input?.expirationMode ?? "NO_EXPIRATION");
        if (
          !jurisdiction ||
          ![
            "NO_EXPIRATION",
            "FIXED_DATE",
            "DAYS_AFTER_ACTIVATION",
            "DAYS_AFTER_LAST_ACTIVITY",
          ].includes(expirationMode)
        )
          throw new BadRequestException({
            code: "STORED_VALUE_LEGAL_POLICY_REQUIRED",
          });
        const next = Number(
          (
            await c.query<any>(
              "SELECT COALESCE(max(policy_version),0)+1 n FROM stored_value_legal_policies WHERE tenant_id=$1 AND jurisdiction=$2",
              [auth.tenantId, jurisdiction],
            )
          ).rows[0].n,
        );
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO stored_value_legal_policies(id,tenant_id,jurisdiction,policy_version,expiration_mode,expiration_days,fixed_expiry_date,grace_days,notice_requirements_json,dormancy_policy_json,breakage_mode,effective_from,effective_to,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [
              id,
              auth.tenantId,
              jurisdiction,
              next,
              expirationMode,
              input?.expirationDays ?? null,
              input?.fixedExpiryDate ?? null,
              input?.graceDays ?? 0,
              JSON.stringify(input?.noticeRequirements ?? {}),
              JSON.stringify(input?.dormancyPolicy ?? {}),
              input?.breakageMode ?? "NONE",
              input?.effectiveFrom ?? new Date().toISOString(),
              input?.effectiveTo ?? null,
              auth.userId,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "stored_value.legal_policy_created",
          "stored_value_legal_policy",
          id,
          requestId,
          { jurisdiction, policyVersion: next },
        );
        return row;
      },
    );
  }
  approveLegalPolicy(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueVersionSchema.parse(input);
    return this.command(
      auth,
      "stored-value.legal-policy.approve",
      key,
      { id, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM stored_value_legal_policies WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("STORED_VALUE_LEGAL_POLICY_REQUIRED");
        if (row.version !== body.version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        if (row.status !== "DRAFT" || row.created_by_user_id === auth.userId)
          this.conflict("STORED_VALUE_LEGAL_POLICY_REQUIRED");
        await c.query(
          "UPDATE stored_value_legal_policies SET status='SUPERSEDED',version=version+1 WHERE tenant_id=$1 AND jurisdiction=$2 AND status='APPROVED'",
          [auth.tenantId, row.jurisdiction],
        );
        const updated = (
          await c.query<any>(
            "UPDATE stored_value_legal_policies SET status='APPROVED',legal_review_status='APPROVED',approved_by_user_id=$3,approved_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, auth.userId],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "stored_value.legal_policy_approved",
          "stored_value_legal_policy",
          id,
          requestId,
          { jurisdiction: row.jurisdiction, policyVersion: row.policy_version },
        );
        return updated;
      },
    );
  }
  async product(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM gift_card_products WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("GIFT_CARD_PRODUCT_NOT_FOUND");
    return row;
  }
  createProduct(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = giftCardProductSchema.parse(input);
    return this.command(
      auth,
      "gift-card.product.create",
      key,
      body,
      async (c) => {
        const min = minor(body.minimumAmountMinor),
          max = minor(body.maximumAmountMinor),
          maxBalance = minor(body.maximumBalanceMinor);
        if (max < min || maxBalance < max)
          this.conflict("GIFT_CARD_AMOUNT_INVALID");
        if (
          body.amountMode === "FIXED" &&
          (!body.fixedDenominationsMinor.length ||
            body.fixedDenominationsMinor.some(
              (x) => minor(x) < min || minor(x) > max,
            ))
        )
          this.conflict("GIFT_CARD_AMOUNT_INVALID");
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO gift_card_products(id,tenant_id,product_code,name_json,amount_mode,card_form,currency,minimum_amount_minor,maximum_amount_minor,fixed_denominations_minor,maximum_balance_minor,reloadable,assignment_policy,pin_required,legal_policy_id,branch_scope_json,eligibility_policy_json,refund_policy_json,replacement_policy_json,limits_policy_json,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::bigint[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
            [
              id,
              auth.tenantId,
              body.productCode,
              JSON.stringify(body.name),
              body.amountMode,
              body.cardForm,
              body.currency,
              min.toString(),
              max.toString(),
              body.fixedDenominationsMinor,
              maxBalance.toString(),
              body.reloadable,
              body.assignmentPolicy,
              body.pinRequired,
              body.legalPolicyId ?? null,
              JSON.stringify(body.branchScope),
              JSON.stringify(body.eligibilityPolicy),
              JSON.stringify(body.refundPolicy),
              JSON.stringify(body.replacementPolicy),
              JSON.stringify(body.limitsPolicy),
              auth.userId,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "gift_card.product_created",
          "gift_card_product",
          id,
          requestId,
          { status: "DRAFT" },
        );
        return row;
      },
    );
  }
  productStatus(
    auth: AccessClaims,
    id: string,
    target: "ACTIVE" | "INACTIVE" | "ARCHIVED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueVersionSchema.parse(input);
    return this.command(
      auth,
      `gift-card.product.${target.toLowerCase()}`,
      key,
      { id, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM gift_card_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("GIFT_CARD_PRODUCT_NOT_FOUND");
        if (row.version !== body.version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        const updated = (
          await c.query<any>(
            "UPDATE gift_card_products SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, target],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          `gift_card.product_${target.toLowerCase()}`,
          "gift_card_product",
          id,
          requestId,
          { status: target },
        );
        return updated;
      },
    );
  }
  supersedeProduct(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = giftCardProductSchema.parse(input);
    return this.command(
      auth,
      "gift-card.product.supersede",
      key,
      { id, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM gift_card_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!old) this.notFound("GIFT_CARD_PRODUCT_NOT_FOUND");
        const nextId = randomUUID();
        const next = (
          await c.query<any>(
            `INSERT INTO gift_card_products(id,tenant_id,product_code,version_no,supersedes_product_id,name_json,status,amount_mode,card_form,currency,minimum_amount_minor,maximum_amount_minor,fixed_denominations_minor,maximum_balance_minor,reloadable,assignment_policy,pin_required,legal_policy_id,branch_scope_json,eligibility_policy_json,refund_policy_json,replacement_policy_json,limits_policy_json,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12::bigint[],$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
            [
              nextId,
              auth.tenantId,
              old.product_code,
              old.version_no + 1,
              id,
              JSON.stringify(body.name),
              body.amountMode,
              body.cardForm,
              body.currency,
              body.minimumAmountMinor,
              body.maximumAmountMinor,
              body.fixedDenominationsMinor,
              body.maximumBalanceMinor,
              body.reloadable,
              body.assignmentPolicy,
              body.pinRequired,
              body.legalPolicyId ?? null,
              JSON.stringify(body.branchScope),
              JSON.stringify(body.eligibilityPolicy),
              JSON.stringify(body.refundPolicy),
              JSON.stringify(body.replacementPolicy),
              JSON.stringify(body.limitsPolicy),
              auth.userId,
            ],
          )
        ).rows[0];
        await c.query(
          "UPDATE gift_card_products SET status='ARCHIVED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id],
        );
        await this.evidence(
          c,
          auth,
          "gift_card.product_created",
          "gift_card_product",
          nextId,
          requestId,
          { supersedes: id },
        );
        return next;
      },
    );
  }

  async giftCards(auth: AccessClaims) {
    this.access(auth);
    const customerId = auth.roles.includes("CUSTOMER")
      ? await this.ownCustomerId(auth)
      : null;
    const branches = this.scopedBranches(auth);
    return (
      await this.db.query<any>(
        `SELECT g.id,g.card_reference "cardReference",g.number_last4 "numberLast4",g.customer_id "customerId",g.form,g.status,g.currency,g.activated_at "activatedAt",g.expires_at "expiresAt",g.version,
      a.id "accountId",a.pending_minor::text "pendingMinor",a.available_minor::text "availableMinor",a.reserved_minor::text "reservedMinor",a.redeemed_minor::text "redeemedMinor",a.version "accountVersion"
      FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id
      WHERE g.tenant_id=$1 AND ($2::uuid IS NULL OR g.customer_id=$2)
        AND ($3::uuid[] IS NULL OR COALESCE(g.last_activity_branch_id,g.issuance_branch_id)=ANY($3::uuid[]))
      ORDER BY g.created_at DESC`,
        [auth.tenantId, customerId, branches],
      )
    ).rows.map((r) => this.cardView(r));
  }
  async giftCard(auth: AccessClaims, id: string) {
    this.access(auth);
    const customerId = auth.roles.includes("CUSTOMER")
      ? await this.ownCustomerId(auth)
      : null;
    const branches = this.scopedBranches(auth);
    const row = (
      await this.db.query<any>(
        `SELECT g.*,a.id "accountId",a.pending_minor::text "pendingMinor",a.available_minor::text "availableMinor",a.reserved_minor::text "reservedMinor",a.redeemed_minor::text "redeemedMinor",a.expired_minor::text "expiredMinor",a.cancelled_minor::text "cancelledMinor",a.version "accountVersion" FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1 AND g.id=$2 AND ($3::uuid IS NULL OR g.customer_id=$3) AND ($4::uuid[] IS NULL OR COALESCE(g.last_activity_branch_id,g.issuance_branch_id)=ANY($4::uuid[]))`,
        [auth.tenantId, id, customerId, branches],
      )
    ).rows[0];
    if (!row) this.notFound();
    return this.cardView(row);
  }
  private cardView(row: any) {
    return {
      id: row.id,
      cardReference: row.cardReference ?? row.card_reference,
      maskedNumber: maskCard(row.numberLast4 ?? row.number_last4),
      customerId: row.customerId ?? row.customer_id ?? undefined,
      form: row.form,
      status: row.status,
      currency: row.currency,
      activatedAt: row.activatedAt ?? row.activated_at ?? undefined,
      expiresAt: row.expiresAt ?? row.expires_at ?? undefined,
      version: row.version,
      balance: {
        accountId: row.accountId,
        accountType: "GIFT_CARD",
        currency: row.currency,
        pendingMinor: row.pendingMinor ?? "0",
        availableMinor: row.availableMinor ?? "0",
        reservedMinor: row.reservedMinor ?? "0",
        redeemedMinor: row.redeemedMinor ?? "0",
        liabilityMinor: storedValueLiability(
          BigInt(row.availableMinor ?? 0),
          BigInt(row.reservedMinor ?? 0),
        ).toString(),
        version: Number(row.accountVersion ?? 1),
      },
    };
  }

  async lookup(auth: AccessClaims, input: unknown, _requestId: string) {
    void _requestId;
    this.access(auth);
    const body = storedValueLookupSchema.parse(input),
      secret = this.secret();
    const subject = lookupKeyHash(
      auth.tenantId,
      `${auth.userId}:${body.number.slice(-4)}`,
      secret,
    );
    const result = await this.db.transaction(async (c) => {
      await c.query(
        `INSERT INTO stored_value_lookup_limits(tenant_id,lookup_key_hash,window_started_at,attempts) VALUES($1,$2,now(),1)
        ON CONFLICT(tenant_id,lookup_key_hash) DO UPDATE SET attempts=CASE WHEN stored_value_lookup_limits.window_started_at<now()-interval '15 minutes' THEN 1 ELSE stored_value_lookup_limits.attempts+1 END,window_started_at=CASE WHEN stored_value_lookup_limits.window_started_at<now()-interval '15 minutes' THEN now() ELSE stored_value_lookup_limits.window_started_at END,locked_until=CASE WHEN stored_value_lookup_limits.attempts>=9 THEN now()+interval '15 minutes' ELSE stored_value_lookup_limits.locked_until END,updated_at=now()`,
        [auth.tenantId, subject],
      );
      const limit = (
        await c.query<any>(
          "SELECT * FROM stored_value_lookup_limits WHERE tenant_id=$1 AND lookup_key_hash=$2",
          [auth.tenantId, subject],
        )
      ).rows[0];
      if (limit?.locked_until && new Date(limit.locked_until) > new Date())
        return { error: "GIFT_CARD_LOCKED" as const };
      const row = (
        await c.query<any>(
          "SELECT g.*,a.id account_id,a.available_minor,a.reserved_minor,a.pending_minor,a.redeemed_minor,a.version account_version FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1 AND g.number_hash=$2 FOR UPDATE OF g",
          [auth.tenantId, cardHash(auth.tenantId, body.number, secret)],
        )
      ).rows[0];
      if (!row) return { error: "GIFT_CARD_INVALID" as const };
      if (row.locked_until && new Date(row.locked_until) > new Date())
        return { error: "GIFT_CARD_LOCKED" as const };
      if (
        !verifyPin(body.pin ?? "", row.pin_hash, auth.tenantId, row.id, secret)
      ) {
        await c.query(
          "UPDATE gift_cards SET failed_pin_attempts=failed_pin_attempts+1,locked_until=CASE WHEN failed_pin_attempts>=4 THEN now()+interval '15 minutes' ELSE locked_until END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.id],
        );
        return { error: "GIFT_CARD_INVALID" as const };
      }
      await c.query(
        "UPDATE gift_cards SET failed_pin_attempts=0,locked_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, row.id],
      );
      return {
        value: this.cardView({
          ...row,
          accountId: row.account_id,
          pendingMinor: String(row.pending_minor),
          availableMinor: String(row.available_minor),
          reservedMinor: String(row.reserved_minor),
          redeemedMinor: String(row.redeemed_minor),
          accountVersion: row.account_version,
        }),
      };
    });
    if ("error" in result)
      this.conflict(
        result.error,
        result.error === "GIFT_CARD_INVALID"
          ? "Card number or PIN is invalid"
          : undefined,
      );
    return result.value;
  }

  addGiftCardLine(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = giftCardLineSchema.parse(input);
    return this.command(
      auth,
      "gift-card.line.add",
      key,
      { orderId, ...body },
      async (c) => {
        await this.enabled(c, auth.tenantId);
        const order = (
          await c.query<any>(
            "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, orderId],
          )
        ).rows[0];
        if (!order) this.notFound("POS_ORDER_NOT_FOUND");
        this.branch(auth, order.branch_id);
        if (order.status !== "DRAFT") this.conflict("POS_ORDER_STATUS_INVALID");
        const product = (
          await c.query<any>(
            "SELECT * FROM gift_card_products WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
            [auth.tenantId, body.productId],
          )
        ).rows[0];
        if (!product) this.notFound("GIFT_CARD_PRODUCT_NOT_FOUND");
        const purchaseBranches = [
          ...this.policyArray(product.branch_scope_json, "purchaseBranchIds"),
          ...this.policyArray(product.branch_scope_json, "branchIds"),
        ];
        if (
          purchaseBranches.length &&
          !purchaseBranches.includes(order.branch_id)
        )
          this.conflict("GIFT_CARD_PURCHASE_BRANCH_NOT_ALLOWED");
        if (product.currency !== order.currency)
          this.conflict("GIFT_CARD_CURRENCY_MISMATCH");
        const amount = minor(body.amountMinor);
        if (
          amount < BigInt(product.minimum_amount_minor) ||
          amount > BigInt(product.maximum_amount_minor)
        )
          this.conflict("GIFT_CARD_AMOUNT_LIMIT_EXCEEDED");
        if (
          product.amount_mode === "FIXED" &&
          !(product.fixed_denominations_minor as string[])
            .map(BigInt)
            .includes(amount)
        )
          this.conflict("GIFT_CARD_AMOUNT_INVALID");
        if (
          product.assignment_policy === "CUSTOMER_REQUIRED" &&
          !body.customerId
        )
          this.conflict("STORED_VALUE_CUSTOMER_MISMATCH");
        if (body.customerId) {
          const customer = await c.query(
            "SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, body.customerId],
          );
          if (!customer.rowCount) this.notFound("CUSTOMER_NOT_FOUND");
        }
        let legal: any = null;
        if (product.legal_policy_id) {
          legal = (
            await c.query<any>(
              `SELECT * FROM stored_value_legal_policies
                WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'
                  AND legal_review_status='APPROVED' AND effective_from<=now()
                  AND (effective_to IS NULL OR effective_to>now())`,
              [auth.tenantId, product.legal_policy_id],
            )
          ).rows[0];
          if (!legal) this.conflict("STORED_VALUE_LEGAL_POLICY_NOT_APPROVED");
        }
        await this.enforceVelocity(c, auth, {
          action: "ISSUE",
          branchId: order.branch_id,
          amount,
          customerId: body.customerId ?? order.customer_id,
          deviceId: body.deviceId,
          approvalReason: body.approvalReason,
          requestId,
        });
        const cardId = randomUUID(),
          accountId = randomUUID(),
          lineId = randomUUID(),
          credentials = generateCardCredentials();
        const cardReference = `GC-${credentials.last4}-${cardId.slice(0, 8).toUpperCase()}`;
        const policy = {
          productId: product.id,
          productVersion: product.version_no,
          faceValueMinor: amount.toString(),
          currency: product.currency,
          noDiscount: true,
          noLoyaltyEarn: true,
          noGiftCardPayment: true,
          assignedCustomerId: body.customerId ?? null,
          assignmentPolicy: product.assignment_policy,
          bearerRedemptionAllowed:
            product.assignment_policy !== "CUSTOMER_REQUIRED",
          purchaseBranchIds: purchaseBranches,
          redemptionBranchIds: this.policyArray(
            product.branch_scope_json,
            "redemptionBranchIds",
          ),
          eligibleLineTypes: this.policyArray(
            product.eligibility_policy_json,
            "eligibleLineTypes",
          ),
          serviceIds: this.policyArray(
            product.eligibility_policy_json,
            "serviceIds",
          ),
          productIds: this.policyArray(
            product.eligibility_policy_json,
            "productIds",
          ),
          tipAllowed: false,
          giftCardFundingAllowed: false,
          legalPolicyId: legal?.id ?? null,
          legalPolicyVersion: legal?.policy_version ?? null,
          jurisdiction: legal?.jurisdiction ?? "UNSPECIFIED",
          expirationMode: legal?.expiration_mode ?? "NO_EXPIRATION",
          expirationDays: legal?.expiration_days ?? null,
          fixedExpiryDate: legal?.fixed_expiry_date ?? null,
          graceDays: legal?.grace_days ?? 0,
        };
        await c.query(
          `INSERT INTO gift_cards(id,tenant_id,product_id,customer_id,card_reference,number_hash,number_last4,pin_hash,pin_version,form,currency,source_order_id,source_order_line_id,policy_snapshot_json,issuance_branch_id,last_activity_branch_id,legal_policy_id,legal_policy_version,jurisdiction,expiration_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,NULL,$12,$13,$13,$14,$15,$16,$17)`,
          [
            cardId,
            auth.tenantId,
            product.id,
            body.customerId ?? null,
            cardReference,
            cardHash(auth.tenantId, credentials.number, this.secret()),
            credentials.last4,
            product.pin_required
              ? pinHash(credentials.pin, auth.tenantId, cardId, this.secret())
              : null,
            body.form,
            product.currency,
            orderId,
            JSON.stringify(policy),
            order.branch_id,
            legal?.id ?? null,
            legal?.policy_version ?? null,
            legal?.jurisdiction ?? "UNSPECIFIED",
            legal?.expiration_mode ?? "NO_EXPIRATION",
          ],
        );
        await c.query(
          "INSERT INTO stored_value_accounts(id,tenant_id,account_type,gift_card_id,customer_id,currency) VALUES($1,$2,'GIFT_CARD',$3,$4,$5)",
          [
            accountId,
            auth.tenantId,
            cardId,
            body.customerId ?? null,
            product.currency,
          ],
        );
        await this.post(c, auth, {
          accountId,
          entryType: "ISSUE_PENDING",
          generationKey: `issue:${cardId}`,
          currency: product.currency,
          pending: amount,
          orderId,
          policy,
          branchId: order.branch_id,
        });
        const nextLine = Number(
          (
            await c.query<any>(
              "SELECT COALESCE(max(line_no),0)+1 n FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2",
              [auth.tenantId, orderId],
            )
          ).rows[0].n,
        );
        await c.query(
          `INSERT INTO pos_order_lines(id,tenant_id,pos_order_id,line_no,line_type,description_snapshot_json,quantity,unit_price_minor,gross_minor,taxable_minor,tax_minor,net_minor,tax_profile_snapshot_json,source_snapshot_json,gift_card_product_id,gift_card_id)
        VALUES($1,$2,$3,$4,'GIFT_CARD',$5,1,$6,$6,0,0,$6,'{}',$7,$8,$9)`,
          [
            lineId,
            auth.tenantId,
            orderId,
            nextLine,
            JSON.stringify({
              name: product.name_json,
              cardForm: body.form,
              liabilityClassification: "STORED_VALUE_FUNDING",
            }),
            amount.toString(),
            JSON.stringify(policy),
            product.id,
            cardId,
          ],
        );
        await c.query(
          "UPDATE gift_cards SET source_order_line_id=$3 WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, cardId, lineId],
        );
        await c.query(
          "UPDATE pos_orders SET subtotal_minor=subtotal_minor+$3,total_minor=total_minor+$3,amount_due_minor=amount_due_minor+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, orderId, amount.toString()],
        );
        if (body.deliveryChannel !== "NONE")
          await c.query(
            "INSERT INTO gift_card_delivery_requests(tenant_id,gift_card_id,channel,status,generation_key) VALUES($1,$2,$3,'PENDING',$4)",
            [auth.tenantId, cardId, body.deliveryChannel, `delivery:${cardId}`],
          );
        await this.evidence(
          c,
          auth,
          "gift_card.issuance_pending",
          "gift_card",
          cardId,
          requestId,
          {
            orderId,
            lineId,
            amountMinor: amount.toString(),
            currency: product.currency,
          },
          order.branch_id,
        );
        return {
          lineId,
          giftCardId: cardId,
          cardReference,
          status: "PENDING_ACTIVATION",
          amountMinor: amount.toString(),
          currency: product.currency,
          fulfillment: {
            number: credentials.number,
            pin: product.pin_required ? credentials.pin : null,
            displayOnce: true,
          },
        };
      },
    );
  }

  updateGiftCardLine(
    auth: AccessClaims,
    orderId: string,
    lineId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const amount = minor(input?.amountMinor ?? "0"),
      version = Number(input?.version);
    if (!Number.isInteger(version) || version < 1)
      throw new BadRequestException({ code: "STORED_VALUE_VERSION_CONFLICT" });
    return this.command(
      auth,
      "gift-card.line.update",
      key,
      { orderId, lineId, amountMinor: amount.toString(), version },
      async (c) => {
        const row = (
          await c.query<any>(
            `SELECT l.*,o.branch_id,o.status order_status,g.status card_status,g.id card_id,a.id account_id,a.pending_minor,p.minimum_amount_minor,p.maximum_amount_minor,p.fixed_denominations_minor,p.amount_mode
        FROM pos_order_lines l JOIN pos_orders o ON o.tenant_id=l.tenant_id AND o.id=l.pos_order_id JOIN gift_cards g ON g.tenant_id=l.tenant_id AND g.id=l.gift_card_id JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id JOIN gift_card_products p ON p.tenant_id=g.tenant_id AND p.id=g.product_id
        WHERE l.tenant_id=$1 AND l.pos_order_id=$2 AND l.id=$3 FOR UPDATE OF l,o,g,a`,
            [auth.tenantId, orderId, lineId],
          )
        ).rows[0];
        if (!row) this.notFound("GIFT_CARD_NOT_FOUND");
        this.branch(auth, row.branch_id);
        if (row.version !== version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        if (
          row.order_status !== "DRAFT" ||
          row.status !== "ACTIVE" ||
          row.card_status !== "PENDING_ACTIVATION"
        )
          this.conflict("GIFT_CARD_NOT_ACTIVE");
        if (
          amount < BigInt(row.minimum_amount_minor) ||
          amount > BigInt(row.maximum_amount_minor)
        )
          this.conflict("GIFT_CARD_AMOUNT_LIMIT_EXCEEDED");
        if (
          row.amount_mode === "FIXED" &&
          !(row.fixed_denominations_minor as string[])
            .map(BigInt)
            .includes(amount)
        )
          this.conflict("GIFT_CARD_AMOUNT_INVALID");
        const previous = BigInt(row.gross_minor),
          delta = amount - previous;
        if (delta !== 0n)
          await this.post(c, auth, {
            accountId: row.account_id,
            entryType: "CORRECTION",
            generationKey: `line-update:${lineId}:${key}`,
            currency: row.currency ?? "VND",
            pending: delta,
            orderId,
          });
        await c.query(
          "UPDATE pos_order_lines SET unit_price_minor=$4,gross_minor=$4,taxable_minor=$4,net_minor=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND pos_order_id=$2 AND id=$3",
          [auth.tenantId, orderId, lineId, amount.toString()],
        );
        await c.query(
          "UPDATE pos_orders SET subtotal_minor=subtotal_minor+$3,total_minor=total_minor+$3,amount_due_minor=amount_due_minor+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, orderId, delta.toString()],
        );
        await this.evidence(
          c,
          auth,
          "gift_card.updated",
          "gift_card",
          row.card_id,
          requestId,
          {
            orderId,
            lineId,
            previousMinor: previous.toString(),
            amountMinor: amount.toString(),
          },
          row.branch_id,
        );
        return {
          lineId,
          giftCardId: row.card_id,
          amountMinor: amount.toString(),
          version: version + 1,
        };
      },
    );
  }

  removeGiftCardLine(
    auth: AccessClaims,
    orderId: string,
    lineId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueVersionSchema.parse(input);
    return this.command(
      auth,
      "gift-card.line.remove",
      key,
      { orderId, lineId, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            `SELECT l.*,o.branch_id,o.status order_status,g.id card_id,g.status card_status,a.id account_id,a.pending_minor,g.currency
        FROM pos_order_lines l JOIN pos_orders o ON o.tenant_id=l.tenant_id AND o.id=l.pos_order_id JOIN gift_cards g ON g.tenant_id=l.tenant_id AND g.id=l.gift_card_id JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id
        WHERE l.tenant_id=$1 AND l.pos_order_id=$2 AND l.id=$3 FOR UPDATE OF l,o,g,a`,
            [auth.tenantId, orderId, lineId],
          )
        ).rows[0];
        if (!row) this.notFound("GIFT_CARD_NOT_FOUND");
        this.branch(auth, row.branch_id);
        if (row.version !== body.version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        if (
          row.order_status !== "DRAFT" ||
          row.status !== "ACTIVE" ||
          row.card_status !== "PENDING_ACTIVATION"
        )
          this.conflict("GIFT_CARD_NOT_ACTIVE");
        const amount = BigInt(row.pending_minor);
        await this.post(c, auth, {
          accountId: row.account_id,
          entryType: "PURCHASE_CANCELLATION",
          generationKey: `line-remove:${lineId}`,
          currency: row.currency,
          pending: -amount,
          cancelled: amount,
          orderId,
        });
        await c.query(
          "UPDATE pos_order_lines SET status='VOIDED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, lineId],
        );
        await c.query(
          "UPDATE gift_cards SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.card_id],
        );
        await c.query(
          "UPDATE pos_orders SET subtotal_minor=subtotal_minor-$3,total_minor=total_minor-$3,amount_due_minor=amount_due_minor-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, orderId, amount.toString()],
        );
        await this.evidence(
          c,
          auth,
          "gift_card.cancelled",
          "gift_card",
          row.card_id,
          requestId,
          { orderId, lineId, reason: body.reason },
          row.branch_id,
        );
        return { lineId, giftCardId: row.card_id, status: "CANCELLED" };
      },
    );
  }

  async eligibility(auth: AccessClaims, orderId: string) {
    this.access(auth);
    return this.db.transaction(async (c) => {
      const order = (
        await c.query<any>(
          "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, orderId],
        )
      ).rows[0];
      if (!order) this.notFound("POS_ORDER_NOT_FOUND");
      this.branch(auth, order.branch_id);
      const plan = await this.redemptionPlan(
        c,
        auth,
        order,
        BigInt(order.amount_due_minor),
        BigInt(order.amount_due_minor),
        {},
      );
      return {
        orderId,
        currency: order.currency,
        eligibleLineMinor: plan.eligibleLineMinor.toString(),
        externalPaidAllocationMinor:
          plan.externalPaidAllocationMinor.toString(),
        alreadyAppliedMinor: plan.existingStoredValueMinor.toString(),
        remainingEligibleMinor: plan.remainingEligibleMinor.toString(),
        currentOrderDueMinor: plan.currentOrderDueMinor.toString(),
        tipDueMinor: plan.tipDueMinor.toString(),
        maxStoredValueMinor: plan.acceptedMinor.toString(),
        prohibited: { giftCardLines: true, tip: true, cashOut: true },
        allocationOrder: "EXTERNAL_PAYMENT_FIRST",
        onlineRequired: true,
      };
    });
  }

  async reserveGiftCard(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueReserveSchema.parse(input);
    const result = await this.command(
      auth,
      "stored-value.gift-card.reserve",
      key,
      {
        orderId,
        ...body,
        pin: body.pin ? "[REDACTED]" : undefined,
        number: body.number ? `***${body.number.slice(-4)}` : undefined,
      },
      async (c) => {
        await this.enabled(c, auth.tenantId);
        const order = (
          await c.query<any>(
            "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, orderId],
          )
        ).rows[0];
        if (!order) this.notFound("POS_ORDER_NOT_FOUND");
        this.branch(auth, order.branch_id);
        if (!body.number)
          throw new BadRequestException({ code: "GIFT_CARD_INVALID" });
        await this.consumeLookupAttempt(c, auth, body.number);
        const card = (
          await c.query<any>(
            "SELECT g.*,a.id account_id,a.available_minor,a.version account_version FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1 AND g.number_hash=$2 FOR UPDATE OF g,a",
            [
              auth.tenantId,
              cardHash(auth.tenantId, body.number, this.secret()),
            ],
          )
        ).rows[0];
        if (!card) return { error: "GIFT_CARD_INVALID" as const };
        if (card.locked_until && new Date(card.locked_until) > new Date())
          return { error: "GIFT_CARD_LOCKED" as const };
        if (
          !verifyPin(
            body.pin ?? "",
            card.pin_hash,
            auth.tenantId,
            card.id,
            this.secret(),
          )
        ) {
          await c.query(
            "UPDATE gift_cards SET failed_pin_attempts=failed_pin_attempts+1,locked_until=CASE WHEN failed_pin_attempts>=4 THEN now()+interval '15 minutes' ELSE locked_until END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, card.id],
          );
          return { error: "GIFT_CARD_INVALID" as const };
        }
        if (card.status !== "ACTIVE")
          this.conflict(
            card.status === "SUSPENDED"
              ? "GIFT_CARD_SUSPENDED"
              : "GIFT_CARD_NOT_ACTIVE",
          );
        if (card.expires_at && new Date(card.expires_at) <= new Date())
          this.conflict("GIFT_CARD_EXPIRED");
        if (card.customer_id && card.customer_id !== order.customer_id)
          this.conflict("STORED_VALUE_CUSTOMER_MISMATCH");
        const policy = card.policy_snapshot_json ?? {};
        const redemptionBranches = this.policyArray(
          policy,
          "redemptionBranchIds",
        );
        if (
          redemptionBranches.length &&
          !redemptionBranches.includes(order.branch_id)
        )
          this.conflict("GIFT_CARD_REDEMPTION_BRANCH_NOT_ALLOWED");
        return this.reserve(
          c,
          auth,
          order,
          card.account_id,
          "GIFT_CARD",
          minor(body.requestedMinor),
          body.version,
          key,
          requestId,
          policy,
          {
            giftCardId: card.id,
            deviceId: body.deviceId,
            approvalReason: body.approvalReason,
          },
        );
      },
    );
    if ("error" in result)
      this.conflict(
        result.error,
        result.error === "GIFT_CARD_INVALID"
          ? "Card number or PIN is invalid"
          : "Gift card is temporarily locked",
      );
    return result;
  }
  reserveCustomerCredit(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueReserveSchema
      .omit({ number: true, pin: true })
      .parse(input);
    return this.command(
      auth,
      "stored-value.customer-credit.reserve",
      key,
      { orderId, ...body },
      async (c) => {
        await this.enabled(c, auth.tenantId);
        const order = (
          await c.query<any>(
            "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, orderId],
          )
        ).rows[0];
        if (!order) this.notFound("POS_ORDER_NOT_FOUND");
        this.branch(auth, order.branch_id);
        if (!order.customer_id) this.conflict("STORED_VALUE_CUSTOMER_MISMATCH");
        const account = (
          await c.query<any>(
            "SELECT * FROM stored_value_accounts WHERE tenant_id=$1 AND account_type='CUSTOMER_CREDIT' AND customer_id=$2 AND currency=$3 FOR UPDATE",
            [auth.tenantId, order.customer_id, order.currency],
          )
        ).rows[0];
        if (!account) this.notFound("CUSTOMER_CREDIT_NOT_FOUND");
        return this.reserve(
          c,
          auth,
          order,
          account.id,
          "CUSTOMER_CREDIT",
          minor(body.requestedMinor),
          body.version,
          key,
          requestId,
          {},
          {
            deviceId: body.deviceId,
            approvalReason: body.approvalReason,
          },
        );
      },
    );
  }
  private async reserve(
    c: PoolClient,
    auth: AccessClaims,
    order: any,
    accountId: string,
    type: string,
    requested: bigint,
    version: number,
    key: string,
    requestId: string,
    policy: any,
    options: {
      giftCardId?: string | undefined;
      deviceId?: string | undefined;
      approvalReason?: string | undefined;
    },
  ) {
    if (
      !["DRAFT", "READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(order.status)
    )
      this.conflict("STORED_VALUE_RESERVATION_CONFLICT");
    const account = (
      await c.query<any>(
        "SELECT * FROM stored_value_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, accountId],
      )
    ).rows[0];
    if (Number(account.version) !== version)
      this.conflict("STORED_VALUE_VERSION_CONFLICT");
    if (account.currency !== order.currency)
      this.conflict("STORED_VALUE_CURRENCY_MISMATCH");
    const plan = await this.redemptionPlan(
      c,
      auth,
      order,
      requested,
      BigInt(account.available_minor),
      policy,
    );
    const accepted = plan.acceptedMinor;
    if (accepted <= 0n) this.conflict("STORED_VALUE_INSUFFICIENT_BALANCE");
    const reserveLimit = Number(
      (
        await c.query<any>(
          "SELECT reserve_attempt_limit FROM stored_value_settings WHERE tenant_id=$1",
          [auth.tenantId],
        )
      ).rows[0]?.reserve_attempt_limit ?? 10,
    );
    const recentReserves = Number(
      (
        await c.query<any>(
          `SELECT count(*) count FROM stored_value_reservations
            WHERE tenant_id=$1 AND created_by_user_id=$2 AND branch_id=$3
              AND created_at>now()-interval '15 minutes'`,
          [auth.tenantId, auth.userId, order.branch_id],
        )
      ).rows[0].count,
    );
    if (recentReserves >= reserveLimit)
      this.conflict("STORED_VALUE_RESERVE_RATE_LIMITED");
    await this.enforceVelocity(c, auth, {
      action: "REDEEM",
      branchId: order.branch_id,
      amount: accepted,
      customerId: order.customer_id,
      accountId,
      giftCardId: options.giftCardId,
      deviceId: options.deviceId,
      approvalReason: options.approvalReason,
      requestId,
    });
    const reservationId = randomUUID(),
      applicationId = randomUUID();
    const ttl = Number(
      (
        await c.query<any>(
          "SELECT reservation_ttl_seconds FROM stored_value_settings WHERE tenant_id=$1",
          [auth.tenantId],
        )
      ).rows[0]?.reservation_ttl_seconds ?? 900,
    );
    await c.query(
      `INSERT INTO stored_value_reservations(id,tenant_id,account_id,order_id,customer_id,currency,requested_minor,accepted_minor,expires_at,generation_key,created_by_user_id,branch_id,eligibility_snapshot_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(secs=>$9),$10,$11,$12,$13)`,
      [
        reservationId,
        auth.tenantId,
        accountId,
        order.id,
        order.customer_id,
        order.currency,
        requested.toString(),
        accepted.toString(),
        ttl,
        `reserve:${order.id}:${accountId}:${key}`,
        auth.userId,
        order.branch_id,
        JSON.stringify(policy ?? {}),
      ],
    );
    await this.post(c, auth, {
      accountId,
      entryType: "RESERVE",
      generationKey: `reserve:${reservationId}`,
      currency: order.currency,
      available: -accepted,
      reserved: accepted,
      orderId: order.id,
      reservationId,
      branchId: order.branch_id,
    });
    await c.query(
      "INSERT INTO pos_order_stored_value_applications(id,tenant_id,order_id,account_id,reservation_id,application_type,requested_minor,accepted_minor,currency,redemption_plan_json,eligibility_snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        applicationId,
        auth.tenantId,
        order.id,
        accountId,
        reservationId,
        type,
        requested.toString(),
        accepted.toString(),
        order.currency,
        JSON.stringify({
          allocationOrder: "EXTERNAL_PAYMENT_FIRST",
          eligibleLineMinor: plan.eligibleLineMinor.toString(),
          externalPaidAllocationMinor:
            plan.externalPaidAllocationMinor.toString(),
          currentOrderDueMinor: plan.currentOrderDueMinor.toString(),
          acceptedMinor: accepted.toString(),
          unusedMinor: plan.unusedMinor.toString(),
          lineAllocations: plan.lineAllocations,
        }),
        JSON.stringify(policy ?? {}),
      ],
    );
    const nextDue = BigInt(order.amount_due_minor) - accepted;
    await c.query(
      "UPDATE pos_orders SET amount_paid_minor=amount_paid_minor+$3::bigint,amount_due_minor=$4::bigint,status=CASE WHEN $4::bigint=0 THEN 'READY_FOR_PAYMENT' ELSE 'PARTIALLY_PAID' END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, order.id, accepted.toString(), nextDue.toString()],
    );
    await this.evidence(
      c,
      auth,
      "stored_value.reserved",
      "stored_value_reservation",
      reservationId,
      requestId,
      {
        orderId: order.id,
        applicationId,
        acceptedMinor: accepted.toString(),
        currency: order.currency,
      },
      order.branch_id,
    );
    return {
      applicationId,
      reservationId,
      requestedMinor: requested.toString(),
      acceptedMinor: accepted.toString(),
      unusedMinor: plan.unusedMinor.toString(),
      lineAllocations: plan.lineAllocations,
      currency: order.currency,
      status: "RESERVED",
      expiresInSeconds: ttl,
      offlineAllowed: false,
    };
  }

  releaseApplication(
    auth: AccessClaims,
    orderId: string,
    applicationId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueVersionSchema.parse(input);
    return this.command(
      auth,
      "stored-value.release",
      key,
      { orderId, applicationId, ...body },
      (c) =>
        this.releaseApplicationTx(
          c,
          auth,
          orderId,
          applicationId,
          body.version,
          requestId,
        ),
    );
  }
  private async releaseApplicationTx(
    c: PoolClient,
    auth: AccessClaims,
    orderId: string,
    applicationId: string,
    version: number,
    requestId: string,
  ) {
    const order = (
      await c.query<any>(
        "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, orderId],
      )
    ).rows[0];
    const app = (
      await c.query<any>(
        `SELECT a.*,r.status reservation_status FROM pos_order_stored_value_applications a JOIN stored_value_reservations r ON r.tenant_id=a.tenant_id AND r.id=a.reservation_id WHERE a.tenant_id=$1 AND a.id=$2 AND a.order_id=$3 FOR UPDATE OF a,r`,
        [auth.tenantId, applicationId, orderId],
      )
    ).rows[0];
    if (!order || !app) this.notFound("STORED_VALUE_ACCOUNT_NOT_FOUND");
    if (app.version !== version) this.conflict("STORED_VALUE_VERSION_CONFLICT");
    if (app.status !== "RESERVED")
      this.conflict("STORED_VALUE_RESERVATION_CONFLICT");
    const amount = BigInt(app.accepted_minor);
    await this.post(c, auth, {
      accountId: app.account_id,
      entryType: "RELEASE",
      generationKey: `release:${app.reservation_id}`,
      currency: app.currency,
      available: amount,
      reserved: -amount,
      orderId,
      reservationId: app.reservation_id,
    });
    await c.query(
      "UPDATE stored_value_reservations SET status='RELEASED',released_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, app.reservation_id],
    );
    await c.query(
      "UPDATE pos_order_stored_value_applications SET status='RELEASED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, applicationId],
    );
    await c.query(
      "UPDATE pos_orders SET amount_paid_minor=amount_paid_minor-$3,amount_due_minor=amount_due_minor+$3,status=CASE WHEN amount_paid_minor-$3=0 THEN 'DRAFT' ELSE 'PARTIALLY_PAID' END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, orderId, amount.toString()],
    );
    await this.evidence(
      c,
      auth,
      "stored_value.released",
      "stored_value_reservation",
      app.reservation_id,
      requestId,
      { orderId, applicationId, amountMinor: amount.toString() },
      order.branch_id,
    );
    return {
      applicationId,
      status: "RELEASED",
      releasedMinor: amount.toString(),
    };
  }

  async commitOrderApplications(
    c: PoolClient,
    auth: AccessClaims,
    order: any,
    invoiceId: string | null,
    requestId: string,
  ) {
    const apps = (
      await c.query<any>(
        "SELECT * FROM pos_order_stored_value_applications WHERE tenant_id=$1 AND order_id=$2 AND status='RESERVED' ORDER BY id FOR UPDATE",
        [auth.tenantId, order.id],
      )
    ).rows;
    for (const app of apps) {
      const amount = BigInt(app.accepted_minor);
      const ledgerId = await this.post(c, auth, {
        accountId: app.account_id,
        entryType: "REDEEM",
        generationKey: `redeem:${app.reservation_id}`,
        currency: app.currency,
        reserved: -amount,
        redeemed: amount,
        orderId: order.id,
        invoiceId,
        reservationId: app.reservation_id,
        lifetimeRedeemed: amount,
      });
      await c.query(
        "UPDATE stored_value_reservations SET status='COMMITTED',committed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
        [auth.tenantId, app.reservation_id],
      );
      await c.query(
        "UPDATE pos_order_stored_value_applications SET status='COMMITTED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, app.id],
      );
      const settlement = (
        await c.query<any>(
          "INSERT INTO stored_value_settlement_allocations(tenant_id,application_id,account_id,order_id,invoice_id,amount_minor,currency,ledger_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,application_id) DO UPDATE SET application_id=EXCLUDED.application_id RETURNING id",
          [
            auth.tenantId,
            app.id,
            app.account_id,
            order.id,
            invoiceId,
            amount.toString(),
            app.currency,
            ledgerId,
          ],
        )
      ).rows[0];
      const lineAllocations = Array.isArray(
        app.redemption_plan_json?.lineAllocations,
      )
        ? app.redemption_plan_json.lineAllocations
        : [];
      for (const allocation of lineAllocations) {
        const invoiceLine = (
          await c.query<any>(
            "SELECT id FROM invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 AND source_order_line_id=$3",
            [auth.tenantId, invoiceId, allocation.orderLineId],
          )
        ).rows[0];
        if (!invoiceLine)
          this.conflict("STORED_VALUE_SETTLEMENT_LINE_NOT_FOUND");
        await c.query(
          `INSERT INTO stored_value_settlement_line_allocations(
             tenant_id,application_id,settlement_allocation_id,order_line_id,invoice_line_id,
             allocated_minor,currency,eligibility_snapshot_json)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(tenant_id,settlement_allocation_id,invoice_line_id) DO NOTHING`,
          [
            auth.tenantId,
            app.id,
            settlement.id,
            allocation.orderLineId,
            invoiceLine.id,
            allocation.allocatedMinor,
            app.currency,
            JSON.stringify(app.eligibility_snapshot_json ?? {}),
          ],
        );
      }
      await this.evidence(
        c,
        auth,
        "stored_value.redeemed",
        "stored_value_application",
        app.id,
        requestId,
        { orderId: order.id, amountMinor: amount.toString() },
        order.branch_id,
      );
      const account = (
        await c.query<any>(
          "SELECT gift_card_id,available_minor,reserved_minor FROM stored_value_accounts WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, app.account_id],
        )
      ).rows[0];
      if (
        account?.gift_card_id &&
        BigInt(account.available_minor) === 0n &&
        BigInt(account.reserved_minor) === 0n
      )
        await c.query(
          "UPDATE gift_cards SET status='DEPLETED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
          [auth.tenantId, account.gift_card_id],
        );
    }
  }
  async revalidateOrderApplications(
    c: PoolClient,
    auth: AccessClaims,
    order: any,
  ) {
    const applications = (
      await c.query<any>(
        `SELECT a.*,r.expires_at,r.status reservation_status FROM pos_order_stored_value_applications a JOIN stored_value_reservations r ON r.tenant_id=a.tenant_id AND r.id=a.reservation_id WHERE a.tenant_id=$1 AND a.order_id=$2 AND a.status='RESERVED' ORDER BY a.id FOR UPDATE OF a,r`,
        [auth.tenantId, order.id],
      )
    ).rows;
    if (!applications.length) return;
    if (
      applications.some(
        (item) =>
          item.reservation_status !== "ACTIVE" ||
          new Date(item.expires_at) <= new Date(),
      )
    )
      this.conflict("STORED_VALUE_RESERVATION_EXPIRED");
    const lines = (
      await c.query<any>(
        "SELECT * FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' ORDER BY line_no,id",
        [auth.tenantId, order.id],
      )
    ).rows;
    let external = BigInt(
      (
        await c.query<any>(
          `SELECT COALESCE(sum(pa.amount_minor),0) amount FROM payment_allocations pa
             JOIN payments p ON p.tenant_id=pa.tenant_id AND p.id=pa.payment_id
            WHERE pa.tenant_id=$1 AND pa.pos_order_id=$2 AND pa.allocation_type='ORDER_TOTAL' AND p.status='CAPTURED'`,
          [auth.tenantId, order.id],
        )
      ).rows[0].amount,
    );
    const remaining = new Map<string, bigint>(
      lines.map((line: any) => [line.id, BigInt(line.net_minor)]),
    );
    const policies = applications.map(
      (app: any) => app.eligibility_snapshot_json ?? {},
    );
    for (const line of [
      ...lines.filter((item: any) =>
        policies.every((policy: any) => !this.lineEligible(item, policy)),
      ),
      ...lines.filter((item: any) =>
        policies.some((policy: any) => this.lineEligible(item, policy)),
      ),
    ]) {
      if (external <= 0n) break;
      const net = remaining.get(line.id) ?? 0n;
      const covered = external < net ? external : net;
      external -= covered;
      remaining.set(line.id, net - covered);
    }
    for (const app of applications) {
      const allocations = Array.isArray(
        app.redemption_plan_json?.lineAllocations,
      )
        ? app.redemption_plan_json.lineAllocations
        : [];
      const planned = allocations.reduce(
        (sum: bigint, allocation: any) =>
          sum + BigInt(allocation.allocatedMinor),
        0n,
      );
      if (planned !== BigInt(app.accepted_minor))
        this.conflict("STORED_VALUE_RESERVATION_CONFLICT");
      for (const allocation of allocations) {
        const line = lines.find(
          (item: any) => item.id === allocation.orderLineId,
        );
        const amount = BigInt(allocation.allocatedMinor);
        const available = remaining.get(allocation.orderLineId) ?? 0n;
        if (
          !line ||
          !this.lineEligible(line, app.eligibility_snapshot_json ?? {}) ||
          amount <= 0n ||
          amount > available
        )
          this.conflict("STORED_VALUE_RESERVATION_CONFLICT");
        remaining.set(allocation.orderLineId, available - amount);
      }
    }
    const reserved = applications.reduce(
      (sum, item) => sum + BigInt(item.accepted_minor),
      0n,
    );
    if (reserved > BigInt(order.amount_paid_minor))
      this.conflict("STORED_VALUE_RESERVATION_CONFLICT");
  }
  async releaseOrderApplications(
    c: PoolClient,
    auth: AccessClaims,
    orderId: string,
    requestId: string,
  ) {
    const apps = (
      await c.query<any>(
        "SELECT id,version FROM pos_order_stored_value_applications WHERE tenant_id=$1 AND order_id=$2 AND status='RESERVED' ORDER BY id",
        [auth.tenantId, orderId],
      )
    ).rows;
    for (const app of apps)
      await this.releaseApplicationTx(
        c,
        auth,
        orderId,
        app.id,
        app.version,
        requestId,
      );
  }
  async activateFundedGiftCards(
    c: PoolClient,
    auth: AccessClaims,
    order: any,
    _paymentId: string,
    requestId: string,
  ) {
    const cards = (
      await c.query<any>(
        `SELECT g.*,a.id account_id,a.pending_minor,l.line_no,l.net_minor
           FROM gift_cards g
           JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id
           JOIN pos_order_lines l ON l.tenant_id=g.tenant_id AND l.id=g.source_order_line_id
          WHERE g.tenant_id=$1 AND g.source_order_id=$2 AND g.status='PENDING_ACTIVATION'
          ORDER BY l.line_no,g.id FOR UPDATE OF g,a`,
        [auth.tenantId, order.id],
      )
    ).rows;
    if (!cards.length) return;
    const lines = (
      await c.query<any>(
        "SELECT id,line_no,line_type,net_minor,gift_card_id FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' ORDER BY line_no,id",
        [auth.tenantId, order.id],
      )
    ).rows;
    const payments = (
      await c.query<any>(
        `SELECT p.id,p.currency,p.captured_at,
                LEAST(p.captured_minor,COALESCE((SELECT sum(pa.amount_minor) FROM payment_allocations pa
                  WHERE pa.tenant_id=p.tenant_id AND pa.payment_id=p.id AND pa.allocation_type='ORDER_TOTAL'),0)) funded_minor
           FROM payments p
          WHERE p.tenant_id=$1 AND p.pos_order_id=$2 AND p.status='CAPTURED'
          ORDER BY p.captured_at,p.id FOR UPDATE OF p`,
        [auth.tenantId, order.id],
      )
    ).rows;
    let paymentIndex = 0;
    let paymentRemaining = payments.length
      ? BigInt(payments[0].funded_minor)
      : 0n;
    const fundingByCard = new Map<
      string,
      Array<{ paymentId: string; lineId: string; amount: bigint }>
    >();
    for (const line of [
      ...lines.filter((item: any) => item.line_type === "GIFT_CARD"),
      ...lines.filter((item: any) => item.line_type !== "GIFT_CARD"),
    ]) {
      let lineRemaining = BigInt(line.net_minor);
      while (lineRemaining > 0n && paymentIndex < payments.length) {
        if (paymentRemaining === 0n) {
          paymentIndex += 1;
          paymentRemaining =
            paymentIndex < payments.length
              ? BigInt(payments[paymentIndex].funded_minor)
              : 0n;
          continue;
        }
        const amount =
          lineRemaining < paymentRemaining ? lineRemaining : paymentRemaining;
        if (line.line_type === "GIFT_CARD" && line.gift_card_id) {
          const allocations = fundingByCard.get(line.gift_card_id) ?? [];
          allocations.push({
            paymentId: payments[paymentIndex].id,
            lineId: line.id,
            amount,
          });
          fundingByCard.set(line.gift_card_id, allocations);
        }
        lineRemaining -= amount;
        paymentRemaining -= amount;
      }
    }
    for (const card of cards) {
      const amount = BigInt(card.pending_minor);
      const allocations = fundingByCard.get(card.id) ?? [];
      if (allocations.reduce((sum, item) => sum + item.amount, 0n) !== amount)
        this.conflict("GIFT_CARD_FUNDING_NOT_CAPTURED");
      for (const allocation of allocations)
        await c.query(
          `INSERT INTO stored_value_funding_allocations(
             tenant_id,payment_id,order_id,order_line_id,gift_card_id,branch_id,
             funding_type,allocated_minor,currency,generation_key)
           VALUES($1,$2,$3,$4,$5,$6,'ACTIVATION',$7,$8,$9)
           ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
          [
            auth.tenantId,
            allocation.paymentId,
            order.id,
            allocation.lineId,
            card.id,
            order.branch_id,
            allocation.amount.toString(),
            card.currency,
            `activate:${card.id}:${allocation.paymentId}:${allocation.lineId}`,
          ],
        );
      const paymentIds = [
        ...new Set(allocations.map((item) => item.paymentId)),
      ];
      const evidencePaymentId = paymentIds[0];
      await c.query(
        "INSERT INTO gift_card_activation_requests(tenant_id,gift_card_id,funding_payment_id,status,generation_key) VALUES($1,$2,$3,'COMMITTED',$4) ON CONFLICT(tenant_id,generation_key) DO NOTHING",
        [auth.tenantId, card.id, evidencePaymentId, `activate:${card.id}`],
      );
      await this.post(c, auth, {
        accountId: card.account_id,
        entryType: "ACTIVATE",
        generationKey: `activate:${card.id}`,
        currency: card.currency,
        pending: -amount,
        available: amount,
        orderId: order.id,
        paymentId: paymentIds.length === 1 ? (evidencePaymentId ?? null) : null,
        policy: card.policy_snapshot_json,
        issued: amount,
        branchId: order.branch_id,
      });
      await c.query(
        `UPDATE gift_cards SET status='ACTIVE',activated_at=now(),
           source_payment_id=$3,last_activity_branch_id=$4,
           expires_at=CASE expiration_mode
             WHEN 'FIXED_DATE' THEN (($5::jsonb->>'fixedExpiryDate')::date + COALESCE(($5::jsonb->>'graceDays')::int,0))::timestamptz
             WHEN 'DAYS_AFTER_ACTIVATION' THEN now()+make_interval(days=>COALESCE(($5::jsonb->>'expirationDays')::int,0)+COALESCE(($5::jsonb->>'graceDays')::int,0))
             WHEN 'DAYS_AFTER_LAST_ACTIVITY' THEN now()+make_interval(days=>COALESCE(($5::jsonb->>'expirationDays')::int,0)+COALESCE(($5::jsonb->>'graceDays')::int,0))
             ELSE NULL END,
           version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          auth.tenantId,
          card.id,
          paymentIds.length === 1 ? evidencePaymentId : null,
          order.branch_id,
          JSON.stringify(card.policy_snapshot_json ?? {}),
        ],
      );
      await this.evidence(
        c,
        auth,
        "gift_card.activated",
        "gift_card",
        card.id,
        requestId,
        {
          orderId: order.id,
          amountMinor: amount.toString(),
          currency: card.currency,
          fundingAllocations: allocations.map((item) => ({
            paymentId: item.paymentId,
            amountMinor: item.amount.toString(),
          })),
        },
        order.branch_id,
      );
    }
  }
  async cancelPendingOrderCards(
    c: PoolClient,
    auth: AccessClaims,
    orderId: string,
    requestId: string,
  ) {
    const cards = (
      await c.query<any>(
        `SELECT g.*,a.id account_id,a.pending_minor FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1 AND g.source_order_id=$2 AND g.status='PENDING_ACTIVATION' ORDER BY g.id FOR UPDATE OF g,a`,
        [auth.tenantId, orderId],
      )
    ).rows;
    for (const card of cards) {
      const amount = BigInt(card.pending_minor);
      await this.post(c, auth, {
        accountId: card.account_id,
        entryType: "PURCHASE_CANCELLATION",
        generationKey: `purchase-cancel:${card.id}`,
        currency: card.currency,
        pending: -amount,
        cancelled: amount,
        orderId,
      });
      await c.query(
        "UPDATE gift_cards SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, card.id],
      );
      await this.evidence(
        c,
        auth,
        "gift_card.cancelled",
        "gift_card",
        card.id,
        requestId,
        { orderId },
      );
    }
  }

  cardCommand(
    auth: AccessClaims,
    id: string,
    target: "SUSPENDED" | "ACTIVE" | "CANCELLED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueVersionSchema.parse(input);
    return this.command(
      auth,
      `gift-card.${target.toLowerCase()}`,
      key,
      { id, ...body },
      async (c) => {
        const card = (
          await c.query<any>(
            "SELECT g.*,a.id account_id,a.available_minor,a.reserved_minor,a.lifetime_redeemed_minor FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1 AND g.id=$2 FOR UPDATE OF g,a",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!card) this.notFound();
        const branchId = this.assertCardBranch(auth, card);
        if (card.version !== body.version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        try {
          assertGiftCardTransition(card.status, target);
        } catch {
          this.conflict("GIFT_CARD_PRODUCT_STATUS_INVALID");
        }
        if (target === "CANCELLED" && BigInt(card.reserved_minor) > 0n)
          this.conflict("STORED_VALUE_RESERVATION_CONFLICT");
        if (target === "CANCELLED" && BigInt(card.lifetime_redeemed_minor) > 0n)
          this.conflict("GIFT_CARD_PARTIAL_USE_MANUAL_REVIEW");
        if (target === "CANCELLED" && BigInt(card.available_minor) > 0n)
          this.conflict("GIFT_CARD_CANCELLATION_EVIDENCE_REQUIRED");
        const updated = (
          await c.query<any>(
            "UPDATE gift_cards SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, target],
          )
        ).rows[0];
        const event =
          target === "SUSPENDED"
            ? "gift_card.suspended"
            : target === "ACTIVE"
              ? "gift_card.reactivated"
              : "gift_card.cancelled";
        await this.evidence(
          c,
          auth,
          event,
          "gift_card",
          id,
          requestId,
          { reason: body.reason ?? null },
          branchId ?? undefined,
        );
        return updated;
      },
    );
  }

  replaceCard(
    auth: AccessClaims,
    id: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const body = storedValueVersionSchema.parse(input),
      secret = this.secret();
    return this.command(
      auth,
      "gift-card.replace",
      key,
      { id, ...body },
      async (c) => {
        const old = (
          await c.query<any>(
            `SELECT g.*,a.id account_id,a.available_minor,a.reserved_minor,a.version account_version FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1 AND g.id=$2 FOR UPDATE OF g,a`,
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!old) this.notFound();
        const branchId = this.assertCardBranch(auth, old);
        if (old.version !== body.version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        if (!body.reason || !["ACTIVE", "SUSPENDED"].includes(old.status))
          this.conflict("GIFT_CARD_REPLACEMENT_NOT_ALLOWED");
        if (BigInt(old.reserved_minor) !== 0n)
          this.conflict("STORED_VALUE_RESERVATION_CONFLICT");
        const credentials = generateCardCredentials(),
          nextId = randomUUID(),
          accountId = randomUUID();
        const reference = `GC-${credentials.last4}-${nextId.slice(0, 8).toUpperCase()}`;
        await c.query(
          `INSERT INTO gift_cards(
             id,tenant_id,product_id,customer_id,card_reference,number_hash,number_last4,pin_hash,pin_version,
             form,status,currency,activated_at,expires_at,policy_snapshot_json,source_order_id,source_order_line_id,
             source_payment_id,issuance_branch_id,last_activity_branch_id,replaces_gift_card_id,replacement_reason,
             replacement_authorization_json,legal_policy_id,legal_policy_version,jurisdiction,expiration_mode)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
          [
            nextId,
            auth.tenantId,
            old.product_id,
            old.customer_id,
            reference,
            cardHash(auth.tenantId, credentials.number, secret),
            credentials.last4,
            old.pin_hash
              ? pinHash(credentials.pin, auth.tenantId, nextId, secret)
              : null,
            old.pin_hash ? 1 : null,
            old.form,
            old.currency,
            old.activated_at,
            old.expires_at,
            JSON.stringify(old.policy_snapshot_json),
            old.source_order_id,
            old.source_order_line_id,
            old.source_payment_id,
            old.issuance_branch_id,
            branchId,
            id,
            body.reason,
            JSON.stringify({
              actorUserId: auth.userId,
              actorRoles: auth.roles,
              requestId,
            }),
            old.legal_policy_id,
            old.legal_policy_version,
            old.jurisdiction,
            old.expiration_mode,
          ],
        );
        await c.query(
          "INSERT INTO stored_value_accounts(id,tenant_id,account_type,gift_card_id,customer_id,currency) VALUES($1,$2,'GIFT_CARD',$3,$4,$5)",
          [accountId, auth.tenantId, nextId, old.customer_id, old.currency],
        );
        const amount = BigInt(old.available_minor);
        if (amount > 0n) {
          await this.post(c, auth, {
            accountId: old.account_id,
            entryType: "REPLACEMENT_OUT",
            generationKey: `replace-out:${id}`,
            currency: old.currency,
            available: -amount,
            branchId,
          });
          await this.post(c, auth, {
            accountId,
            entryType: "REPLACEMENT_IN",
            generationKey: `replace-in:${id}`,
            currency: old.currency,
            available: amount,
            branchId,
          });
        }
        await c.query(
          "UPDATE gift_cards SET status='REPLACED',replaced_by_gift_card_id=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, nextId],
        );
        await this.evidence(
          c,
          auth,
          "gift_card.replaced",
          "gift_card",
          id,
          requestId,
          { replacementGiftCardId: nextId, reason: body.reason },
          branchId ?? undefined,
        );
        return {
          replacedGiftCardId: id,
          giftCardId: nextId,
          cardReference: reference,
          status: "ACTIVE",
          balanceMinor: amount.toString(),
          currency: old.currency,
          fulfillment: {
            number: credentials.number,
            pin: old.pin_hash ? credentials.pin : null,
            displayOnce: true,
          },
        };
      },
    );
  }

  addGiftCardReloadLine(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = giftCardReloadLineSchema.parse(input);
    return this.command(
      auth,
      "gift-card.reload-line.add",
      key,
      { orderId, ...body },
      async (c) => {
        await this.enabled(c, auth.tenantId);
        const order = (
          await c.query<any>(
            "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, orderId],
          )
        ).rows[0];
        if (!order) this.notFound("POS_ORDER_NOT_FOUND");
        this.branch(auth, order.branch_id);
        if (order.status !== "DRAFT") this.conflict("POS_ORDER_STATUS_INVALID");
        const lineState = (
          await c.query<any>(
            `SELECT count(*) FILTER (WHERE status='ACTIVE') active_count,
                    COALESCE(max(line_no),0)+1 next_line_no
               FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2`,
            [auth.tenantId, orderId],
          )
        ).rows[0];
        const existingLines = Number(lineState.active_count);
        const nextLineNo = Number(lineState.next_line_no);
        if (existingLines)
          this.conflict("GIFT_CARD_RELOAD_DEDICATED_ORDER_REQUIRED");
        const card = (
          await c.query<any>(
            `SELECT g.*,p.reloadable,p.maximum_balance_minor,p.branch_scope_json,
                    a.id account_id,a.available_minor,a.reserved_minor
               FROM gift_cards g
               JOIN gift_card_products p ON p.tenant_id=g.tenant_id AND p.id=g.product_id
               JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id
              WHERE g.tenant_id=$1 AND g.id=$2 FOR UPDATE OF g,a`,
            [auth.tenantId, body.giftCardId],
          )
        ).rows[0];
        if (!card) this.notFound();
        this.assertCardBranch(auth, card);
        if (card.version !== body.version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        if (card.status !== "ACTIVE" || !card.reloadable)
          this.conflict("GIFT_CARD_RELOAD_NOT_ALLOWED");
        if (card.currency !== order.currency)
          this.conflict("STORED_VALUE_CURRENCY_MISMATCH");
        if (card.customer_id && card.customer_id !== order.customer_id)
          this.conflict("STORED_VALUE_CUSTOMER_MISMATCH");
        const branches = [
          ...this.policyArray(card.branch_scope_json, "purchaseBranchIds"),
          ...this.policyArray(card.branch_scope_json, "branchIds"),
        ];
        if (branches.length && !branches.includes(order.branch_id))
          this.conflict("GIFT_CARD_RELOAD_BRANCH_NOT_ALLOWED");
        const amount = minor(body.amountMinor);
        if (
          BigInt(card.available_minor) + BigInt(card.reserved_minor) + amount >
          BigInt(card.maximum_balance_minor)
        )
          this.conflict("GIFT_CARD_AMOUNT_LIMIT_EXCEEDED");
        const lineId = randomUUID();
        const snapshot = {
          fundingType: "RELOAD",
          giftCardId: card.id,
          cardReference: card.card_reference,
          assignedCustomerId: card.customer_id,
          branchId: order.branch_id,
          dedicatedFundingOrder: true,
        };
        await c.query(
          `INSERT INTO pos_order_lines(
             id,tenant_id,pos_order_id,line_no,line_type,description_snapshot_json,quantity,
             unit_price_minor,gross_minor,taxable_minor,tax_minor,net_minor,tax_profile_snapshot_json,
             source_snapshot_json,gift_card_product_id,gift_card_id)
           VALUES($1,$2,$3,$4,'GIFT_CARD',$5,1,$6,$6,0,0,$6,'{}',$7,$8,$9)`,
          [
            lineId,
            auth.tenantId,
            orderId,
            nextLineNo,
            JSON.stringify({
              name: "Gift card reload",
              cardReference: card.card_reference,
              liabilityClassification: "STORED_VALUE_RELOAD_FUNDING",
            }),
            amount.toString(),
            JSON.stringify(snapshot),
            card.product_id,
            card.id,
          ],
        );
        await c.query(
          `UPDATE pos_orders SET subtotal_minor=subtotal_minor+$3,total_minor=total_minor+$3,
             amount_due_minor=amount_due_minor+$3,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2`,
          [auth.tenantId, orderId, amount.toString()],
        );
        await this.evidence(
          c,
          auth,
          "gift_card.reload_funding_created",
          "gift_card",
          card.id,
          requestId,
          { orderId, lineId, amountMinor: amount.toString() },
          order.branch_id,
        );
        return {
          giftCardId: card.id,
          orderId,
          lineId,
          amountMinor: amount.toString(),
          currency: card.currency,
          fundingType: "RELOAD",
        };
      },
    );
  }

  reloadCard(
    auth: AccessClaims,
    id: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const amount = minor(input?.amountMinor ?? "0"),
      version = Number(input?.version),
      paymentId = String(input?.paymentId ?? "");
    if (amount <= 0n || !paymentId || !Number.isInteger(version))
      throw new BadRequestException({ code: "GIFT_CARD_AMOUNT_INVALID" });
    return this.command(
      auth,
      "gift-card.reload",
      key,
      { id, amountMinor: amount.toString(), version, paymentId },
      async (c) => {
        const card = (
          await c.query<any>(
            `SELECT g.*,p.reloadable,p.maximum_balance_minor,a.id account_id,a.available_minor,a.reserved_minor FROM gift_cards g JOIN gift_card_products p ON p.tenant_id=g.tenant_id AND p.id=g.product_id JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1 AND g.id=$2 FOR UPDATE OF g,a`,
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!card) this.notFound();
        this.assertCardBranch(auth, card);
        if (card.version !== version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        if (card.status !== "ACTIVE" || !card.reloadable)
          this.conflict("GIFT_CARD_RELOAD_NOT_ALLOWED");
        if (
          BigInt(card.available_minor) + BigInt(card.reserved_minor) + amount >
          BigInt(card.maximum_balance_minor)
        )
          this.conflict("GIFT_CARD_AMOUNT_LIMIT_EXCEEDED");
        const funding = (
          await c.query<any>(
            `SELECT p.*,l.id order_line_id,l.net_minor,l.source_snapshot_json,o.branch_id order_branch_id,
                    COALESCE((SELECT sum(pa.amount_minor) FROM payment_allocations pa
                      WHERE pa.tenant_id=p.tenant_id AND pa.payment_id=p.id
                        AND pa.pos_order_id=p.pos_order_id AND pa.allocation_type='ORDER_TOTAL'),0) order_funded_minor,
                    (SELECT count(*) FROM pos_order_lines x WHERE x.tenant_id=p.tenant_id
                      AND x.pos_order_id=p.pos_order_id AND x.status='ACTIVE') active_line_count
               FROM payments p
               JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
               JOIN pos_order_lines l ON l.tenant_id=p.tenant_id AND l.pos_order_id=p.pos_order_id
                AND l.status='ACTIVE' AND l.line_type='GIFT_CARD' AND l.gift_card_id=$3
              WHERE p.tenant_id=$1 AND p.id=$2 AND p.status='CAPTURED'
              FOR UPDATE OF p`,
            [auth.tenantId, paymentId, id],
          )
        ).rows[0];
        if (
          !funding ||
          funding.currency !== card.currency ||
          funding.branch_id !== funding.order_branch_id ||
          funding.source_snapshot_json?.fundingType !== "RELOAD" ||
          Number(funding.active_line_count) !== 1 ||
          BigInt(funding.net_minor) !== amount ||
          BigInt(funding.order_funded_minor) !== amount ||
          BigInt(funding.captured_minor) < amount
        )
          this.conflict("GIFT_CARD_FUNDING_NOT_CAPTURED");
        this.branch(auth, funding.branch_id);
        await this.enforceVelocity(c, auth, {
          action: "RELOAD",
          branchId: funding.branch_id,
          amount,
          customerId: card.customer_id,
          accountId: card.account_id,
          giftCardId: id,
          deviceId: input?.deviceId,
          approvalReason: input?.approvalReason,
          requestId,
        });
        try {
          await c.query(
            `INSERT INTO stored_value_funding_allocations(
             tenant_id,payment_id,order_id,order_line_id,gift_card_id,branch_id,
             funding_type,allocated_minor,currency,generation_key)
           VALUES($1,$2,$3,$4,$5,$6,'RELOAD',$7,$8,$9)`,
            [
              auth.tenantId,
              paymentId,
              funding.pos_order_id,
              funding.order_line_id,
              id,
              funding.branch_id,
              amount.toString(),
              card.currency,
              `reload:${id}:${paymentId}:${funding.order_line_id}`,
            ],
          );
        } catch (error: any) {
          if (["23505", "23514"].includes(error?.code))
            this.conflict("GIFT_CARD_FUNDING_ALREADY_ALLOCATED");
          throw error;
        }
        await c.query(
          "INSERT INTO gift_card_reload_requests(tenant_id,gift_card_id,funding_payment_id,amount_minor,currency,status,generation_key) VALUES($1,$2,$3,$4,$5,'COMMITTED',$6)",
          [
            auth.tenantId,
            id,
            paymentId,
            amount.toString(),
            card.currency,
            `reload:${id}:${paymentId}`,
          ],
        );
        await this.post(c, auth, {
          accountId: card.account_id,
          entryType: "RELOAD_COMMIT",
          generationKey: `reload:${paymentId}`,
          currency: card.currency,
          available: amount,
          paymentId,
          issued: amount,
          orderId: funding.pos_order_id,
          branchId: funding.branch_id,
        });
        const updated = (
          await c.query<any>(
            `UPDATE gift_cards SET last_activity_branch_id=$3,
               expires_at=CASE WHEN expiration_mode='DAYS_AFTER_LAST_ACTIVITY'
                 THEN now()+make_interval(days=>COALESCE((policy_snapshot_json->>'expirationDays')::int,0)+COALESCE((policy_snapshot_json->>'graceDays')::int,0))
                 ELSE expires_at END,
               version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING version`,
            [auth.tenantId, id, funding.branch_id],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "gift_card.reloaded",
          "gift_card",
          id,
          requestId,
          {
            paymentId,
            amountMinor: amount.toString(),
            currency: card.currency,
          },
          funding.branch_id,
        );
        return {
          giftCardId: id,
          amountMinor: amount.toString(),
          currency: card.currency,
          status: "ACTIVE",
          version: updated.version,
        };
      },
    );
  }

  async balance(auth: AccessClaims, id: string) {
    return (await this.giftCard(auth, id)).balance;
  }
  async ledger(auth: AccessClaims, id: string) {
    this.access(auth);
    await this.giftCard(auth, id);
    const customerId = auth.roles.includes("CUSTOMER")
      ? await this.ownCustomerId(auth)
      : null;
    const account = (
      await this.db.query<any>(
        "SELECT id FROM stored_value_accounts WHERE tenant_id=$1 AND gift_card_id=$2 AND ($3::uuid IS NULL OR customer_id=$3)",
        [auth.tenantId, id, customerId],
      )
    ).rows[0];
    if (!account) this.notFound();
    return (
      await this.db.query<any>(
        'SELECT id,entry_type "entryType",pending_delta_minor::text "pendingDeltaMinor",available_delta_minor::text "availableDeltaMinor",reserved_delta_minor::text "reservedDeltaMinor",redeemed_delta_minor::text "redeemedDeltaMinor",expired_delta_minor::text "expiredDeltaMinor",cancelled_delta_minor::text "cancelledDeltaMinor",currency,occurred_at "occurredAt",generation_key "generationKey" FROM stored_value_ledger_entries WHERE tenant_id=$1 AND account_id=$2 ORDER BY occurred_at DESC,id',
        [auth.tenantId, account.id],
      )
    ).rows;
  }
  async orderApplications(auth: AccessClaims, orderId: string) {
    this.access(auth);
    const order = (
      await this.db.query<any>(
        "SELECT branch_id FROM pos_orders WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, orderId],
      )
    ).rows[0];
    if (!order) this.notFound("POS_ORDER_NOT_FOUND");
    this.branch(auth, order.branch_id);
    return (
      await this.db.query<any>(
        'SELECT id,application_type "applicationType",status,requested_minor::text "requestedMinor",accepted_minor::text "acceptedMinor",currency,version,created_at "createdAt" FROM pos_order_stored_value_applications WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at,id',
        [auth.tenantId, orderId],
      )
    ).rows;
  }

  async customerCredit(auth: AccessClaims, customerId: string) {
    this.access(auth);
    if (
      auth.roles.includes("CUSTOMER") &&
      customerId !== (await this.ownCustomerId(auth))
    )
      this.notFound("CUSTOMER_CREDIT_NOT_FOUND");
    const branches = this.scopedBranches(auth);
    return (
      await this.db.query<any>(
        `SELECT id,customer_id "customerId",currency,status,available_minor::text "availableMinor",reserved_minor::text "reservedMinor",redeemed_minor::text "redeemedMinor",version
           FROM stored_value_accounts a WHERE tenant_id=$1 AND account_type='CUSTOMER_CREDIT' AND customer_id=$2
            AND ($3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM stored_value_ledger_entries l
              WHERE l.tenant_id=a.tenant_id AND l.account_id=a.id AND l.branch_id=ANY($3::uuid[])))
          ORDER BY currency`,
        [auth.tenantId, customerId, branches],
      )
    ).rows;
  }
  async customerCredits(auth: AccessClaims) {
    this.access(auth);
    const customerId = auth.roles.includes("CUSTOMER")
      ? await this.ownCustomerId(auth)
      : null;
    const branches = this.scopedBranches(auth);
    return (
      await this.db.query<any>(
        `SELECT a.id,a.customer_id "customerId",c.display_name "customerName",a.currency,a.status,a.available_minor::text "availableMinor",a.reserved_minor::text "reservedMinor",a.redeemed_minor::text "redeemedMinor",a.version FROM stored_value_accounts a JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id WHERE a.tenant_id=$1 AND a.account_type='CUSTOMER_CREDIT' AND ($2::uuid IS NULL OR a.customer_id=$2)
          AND ($3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM stored_value_ledger_entries l WHERE l.tenant_id=a.tenant_id AND l.account_id=a.id AND l.branch_id=ANY($3::uuid[])))
          ORDER BY c.display_name,a.currency`,
        [auth.tenantId, customerId, branches],
      )
    ).rows;
  }
  async customerCreditLedger(auth: AccessClaims, customerId: string) {
    this.access(auth);
    if (
      auth.roles.includes("CUSTOMER") &&
      customerId !== (await this.ownCustomerId(auth))
    )
      this.notFound("CUSTOMER_CREDIT_NOT_FOUND");
    const branches = this.scopedBranches(auth);
    return (
      await this.db.query<any>(
        `SELECT l.id,l.entry_type "entryType",l.available_delta_minor::text "availableDeltaMinor",l.reserved_delta_minor::text "reservedDeltaMinor",l.redeemed_delta_minor::text "redeemedDeltaMinor",l.currency,l.occurred_at "occurredAt"
      FROM stored_value_ledger_entries l JOIN stored_value_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id WHERE l.tenant_id=$1 AND a.account_type='CUSTOMER_CREDIT' AND a.customer_id=$2 AND ($3::uuid[] IS NULL OR l.branch_id=ANY($3::uuid[])) ORDER BY l.occurred_at DESC,l.id`,
        [auth.tenantId, customerId, branches],
      )
    ).rows;
  }
  async ownGiftCards(auth: AccessClaims) {
    return this.giftCards(auth);
  }
  async ownCustomerCredit(auth: AccessClaims) {
    return this.customerCredit(auth, await this.ownCustomerId(auth));
  }
  async ownStoredValueHistory(auth: AccessClaims) {
    const customerId = await this.ownCustomerId(auth);
    return (
      await this.db.query<any>(
        `SELECT l.id,l.entry_type "entryType",a.account_type "accountType",l.available_delta_minor::text "availableDeltaMinor",l.reserved_delta_minor::text "reservedDeltaMinor",l.redeemed_delta_minor::text "redeemedDeltaMinor",l.currency,l.occurred_at "occurredAt" FROM stored_value_ledger_entries l JOIN stored_value_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id WHERE l.tenant_id=$1 AND a.customer_id=$2 ORDER BY l.occurred_at DESC,l.id`,
        [auth.tenantId, customerId],
      )
    ).rows;
  }
  adjustments(auth: AccessClaims) {
    this.access(auth);
    const branches = this.scopedBranches(auth);
    return this.db
      .query<any>(
        'SELECT id,branch_id "branchId",customer_id "customerId",currency,adjustment_type "adjustmentType",amount_minor::text "amountMinor",reason_code "reasonCode",note,status,requested_by_user_id "requestedByUserId",decided_by_user_id "decidedByUserId",version,created_at "createdAt" FROM stored_value_adjustment_requests WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[])) ORDER BY created_at DESC',
        [auth.tenantId, branches],
      )
      .then((x) => x.rows);
  }
  createAdjustment(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = customerCreditAdjustmentSchema.parse(input);
    return this.command(
      auth,
      "customer-credit.adjustment.request",
      key,
      body,
      async (c) => {
        this.branch(auth, body.branchId);
        const customer = await c.query(
          "SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, body.customerId],
        );
        if (!customer.rowCount) this.notFound("CUSTOMER_NOT_FOUND");
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO stored_value_adjustment_requests(id,tenant_id,customer_id,currency,adjustment_type,amount_minor,reason_code,note,requested_by_user_id,branch_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [
              id,
              auth.tenantId,
              body.customerId,
              body.currency,
              body.adjustmentType,
              body.amountMinor,
              body.reasonCode,
              body.note,
              auth.userId,
              body.branchId,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "customer_credit.adjustment_requested",
          "stored_value_adjustment",
          id,
          requestId,
          { amountMinor: body.amountMinor, currency: body.currency },
          body.branchId,
        );
        return row;
      },
    );
  }
  adjustmentDecision(
    auth: AccessClaims,
    id: string,
    decision: "APPROVED" | "REJECTED" | "CANCELLED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = storedValueVersionSchema.parse(input);
    return this.command(
      auth,
      `customer-credit.adjustment.${decision.toLowerCase()}`,
      key,
      { id, ...body },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM stored_value_adjustment_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("CUSTOMER_CREDIT_NOT_FOUND");
        if (!row.branch_id) {
          if (!auth.roles.includes("SALON_OWNER"))
            this.notFound("CUSTOMER_CREDIT_NOT_FOUND");
        } else this.branch(auth, row.branch_id);
        if (row.version !== body.version)
          this.conflict("STORED_VALUE_VERSION_CONFLICT");
        if (row.status !== "PENDING")
          this.conflict("CUSTOMER_CREDIT_ADJUSTMENT_APPROVAL_REQUIRED");
        if (decision === "APPROVED" && row.requested_by_user_id === auth.userId)
          this.conflict("CUSTOMER_CREDIT_SELF_APPROVAL_DENIED");
        let ledgerId: string | null = null,
          accountId = row.account_id;
        if (decision === "APPROVED") {
          accountId = await this.ensureCustomerCredit(
            c,
            auth,
            row.customer_id,
            row.currency,
          );
          const amount = BigInt(row.amount_minor),
            debit = row.adjustment_type === "MANUAL_DEBIT";
          ledgerId = await this.post(c, auth, {
            accountId,
            entryType: row.adjustment_type,
            generationKey: `adjustment:${id}`,
            currency: row.currency,
            available: debit ? -amount : amount,
            adjustmentId: id,
            issued: debit ? 0n : amount,
            branchId: row.branch_id,
          });
        }
        const updated = (
          await c.query<any>(
            "UPDATE stored_value_adjustment_requests SET status=$3,account_id=$4,ledger_entry_id=$5,decided_by_user_id=CASE WHEN $3='CANCELLED' THEN NULL ELSE $6::uuid END,decision_reason=$7,decided_at=CASE WHEN $3='CANCELLED' THEN NULL ELSE now() END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [
              auth.tenantId,
              id,
              decision,
              accountId,
              ledgerId,
              auth.userId,
              body.reason ?? null,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          decision === "APPROVED"
            ? "customer_credit.adjustment_approved"
            : `customer_credit.adjustment_${decision.toLowerCase()}`,
          "stored_value_adjustment",
          id,
          requestId,
          { decision, ledgerId },
          row.branch_id ?? undefined,
        );
        return updated;
      },
    );
  }
  private async ensureCustomerCredit(
    c: PoolClient,
    auth: AccessClaims,
    customerId: string,
    currency: string,
  ) {
    await c.query(
      "INSERT INTO stored_value_accounts(tenant_id,account_type,customer_id,currency) VALUES($1,'CUSTOMER_CREDIT',$2,$3) ON CONFLICT DO NOTHING",
      [auth.tenantId, customerId, currency],
    );
    return (
      await c.query<any>(
        "SELECT id FROM stored_value_accounts WHERE tenant_id=$1 AND account_type='CUSTOMER_CREDIT' AND customer_id=$2 AND currency=$3 FOR UPDATE",
        [auth.tenantId, customerId, currency],
      )
    ).rows[0].id as string;
  }

  async refundPlan(auth: AccessClaims, refundId: string) {
    this.access(auth);
    const refund = (
      await this.db.query<any>(
        "SELECT * FROM refunds WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, refundId],
      )
    ).rows[0];
    if (!refund) this.notFound("REFUND_NOT_FOUND");
    this.branch(auth, refund.branch_id);
    const allocations = (
      await this.db.query<any>(
        `SELECT s.id "settlementAllocationId",s.account_id "accountId",s.amount_minor::text "originalRedeemedMinor",s.currency,
      COALESCE((SELECT sum(r.amount_minor) FROM stored_value_refund_allocations r WHERE r.tenant_id=s.tenant_id AND r.settlement_allocation_id=s.id),0)::text "restoredMinor",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'settlementLineAllocationId',sl.id,'invoiceLineId',sl.invoice_line_id,
        'allocatedMinor',sl.allocated_minor::text,'restoredMinor',COALESCE((SELECT sum(ra.amount_minor)
          FROM stored_value_refund_allocations ra WHERE ra.tenant_id=sl.tenant_id
            AND ra.settlement_line_allocation_id=sl.id),0)::text) ORDER BY sl.created_at,sl.id)
        FROM stored_value_settlement_line_allocations sl
        WHERE sl.tenant_id=s.tenant_id AND sl.settlement_allocation_id=s.id),'[]'::jsonb) "lineAllocations"
      FROM stored_value_settlement_allocations s WHERE s.tenant_id=$1 AND s.order_id=$2`,
        [auth.tenantId, refund.pos_order_id],
      )
    ).rows;
    const plans = (
      await this.db.query<any>(
        `SELECT id,settlement_allocation_id "settlementAllocationId",
                settlement_line_allocation_id "settlementLineAllocationId",
                account_id "accountId",planned_minor::text "plannedMinor",
                completed_minor::text "completedMinor",currency,status,version
           FROM refund_stored_value_line_plans
          WHERE tenant_id=$1 AND refund_id=$2 ORDER BY created_at,id`,
        [auth.tenantId, refundId],
      )
    ).rows;
    return {
      refundId,
      status: refund.status,
      customerId: refund.customer_id,
      currency: refund.currency,
      completedMinor: String(refund.completed_minor),
      originalStoredValueAllocations: allocations,
      plans,
      customerCreditAllowed: Boolean(
        refund.customer_id && refund.status === "COMPLETED",
      ),
    };
  }

  async cancelGiftCardPurchaseRefundsTx(
    c: PoolClient,
    auth: AccessClaims,
    refund: any,
    requestId: string,
  ) {
    const plans = (
      await c.query<any>(
        `SELECT * FROM gift_card_purchase_refund_plans
          WHERE tenant_id=$1 AND refund_id=$2 AND status='PENDING'
          ORDER BY created_at,id FOR UPDATE`,
        [auth.tenantId, refund.id],
      )
    ).rows;
    if (!plans.length) return 0;
    if (refund.refund_destination !== "ORIGINAL_TENDER")
      this.conflict("GIFT_CARD_PURCHASE_REFUND_NOT_ALLOWED");
    const creditNote = (
      await c.query<any>(
        "SELECT id FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2 AND status='ISSUED'",
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    if (!creditNote) this.conflict("GIFT_CARD_PURCHASE_REFUND_NOT_ALLOWED");
    for (const plan of plans) {
      const row = (
        await c.query<any>(
          `SELECT g.status,a.available_minor,a.reserved_minor,a.redeemed_minor
             FROM gift_cards g
             JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id
            WHERE g.tenant_id=$1 AND g.id=$2 AND a.id=$3
            FOR UPDATE OF g,a`,
          [auth.tenantId, plan.gift_card_id, plan.account_id],
        )
      ).rows[0];
      const amount = BigInt(plan.planned_minor);
      if (
        !row ||
        row.status !== "ACTIVE" ||
        BigInt(row.available_minor) !== amount ||
        BigInt(row.reserved_minor) !== 0n ||
        BigInt(row.redeemed_minor) !== 0n
      )
        this.conflict(
          BigInt(row?.redeemed_minor ?? 0) > 0n
            ? "GIFT_CARD_PARTIAL_USE_MANUAL_REVIEW"
            : "GIFT_CARD_PURCHASE_REFUND_NOT_ALLOWED",
        );
      const ledgerId = await this.post(c, auth, {
        accountId: plan.account_id,
        entryType: "PURCHASE_CANCELLATION",
        generationKey: `gift-card-purchase-refund:${plan.id}`,
        currency: plan.currency,
        available: -amount,
        cancelled: amount,
        refundId: refund.id,
        creditNoteId: creditNote.id,
      });
      await c.query(
        `UPDATE gift_cards SET status='CANCELLED',version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [auth.tenantId, plan.gift_card_id],
      );
      await c.query(
        `UPDATE gift_card_purchase_refund_plans
            SET status='COMPLETED',completed_minor=planned_minor,ledger_entry_id=$3,
                completed_at=now(),version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [auth.tenantId, plan.id, ledgerId],
      );
      await this.evidence(
        c,
        auth,
        "gift_card.purchase_cancelled",
        "gift_card",
        plan.gift_card_id,
        requestId,
        {
          refundId: refund.id,
          amountMinor: amount.toString(),
          currency: plan.currency,
        },
        refund.branch_id,
      );
    }
    return plans.length;
  }

  async restoreRefundAllocations(
    c: PoolClient,
    auth: AccessClaims,
    refund: any,
    requestId: string,
  ) {
    const plans = (
      await c.query<any>(
        "SELECT * FROM refund_stored_value_line_plans WHERE tenant_id=$1 AND refund_id=$2 AND status='PENDING' ORDER BY created_at,id FOR UPDATE",
        [auth.tenantId, refund.id],
      )
    ).rows;
    for (const plan of plans) {
      const amount = BigInt(plan.planned_minor);
      const account = (
        await c.query<any>(
          "SELECT * FROM stored_value_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, plan.account_id],
        )
      ).rows[0];
      if (
        !account ||
        account.currency !== plan.currency ||
        BigInt(account.redeemed_minor) < amount
      )
        this.conflict("STORED_VALUE_REFUND_ALLOCATION_CONFLICT");
      const creditNote = (
        await c.query<any>(
          "SELECT id FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2 AND status='ISSUED'",
          [auth.tenantId, refund.id],
        )
      ).rows[0];
      if (!creditNote) this.conflict("STORED_VALUE_REFUND_ALLOCATION_CONFLICT");
      const ledgerId = await this.post(c, auth, {
        accountId: plan.account_id,
        entryType: "REFUND_RESTORE",
        generationKey: `refund-restore:${plan.id}`,
        currency: plan.currency,
        available: amount,
        redeemed: -amount,
        refundId: refund.id,
        creditNoteId: creditNote.id,
        sourceEntryId: null,
      });
      const allocationId = randomUUID();
      await c.query(
        "INSERT INTO stored_value_refund_allocations(id,tenant_id,refund_id,settlement_allocation_id,settlement_line_allocation_id,account_id,destination,amount_minor,currency,ledger_entry_id,generation_key) VALUES($1,$2,$3,$4,$5,$6,'ORIGINAL_STORED_VALUE',$7,$8,$9,$10)",
        [
          allocationId,
          auth.tenantId,
          refund.id,
          plan.settlement_allocation_id,
          plan.settlement_line_allocation_id,
          plan.account_id,
          amount.toString(),
          plan.currency,
          ledgerId,
          `refund-restore:${plan.id}`,
        ],
      );
      await c.query(
        "UPDATE refund_stored_value_line_plans SET status='COMPLETED',completed_minor=planned_minor,ledger_entry_id=$3,completed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, plan.id, ledgerId],
      );
      if (account.gift_card_id)
        await c.query(
          "UPDATE gift_cards SET status=CASE WHEN status='DEPLETED' THEN 'ACTIVE' ELSE status END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, account.gift_card_id],
        );
      await this.evidence(
        c,
        auth,
        "stored_value.refund_restored",
        "stored_value_refund_allocation",
        allocationId,
        requestId,
        {
          refundId: refund.id,
          settlementAllocationId: plan.settlement_allocation_id,
          settlementLineAllocationId: plan.settlement_line_allocation_id,
          amountMinor: amount.toString(),
          currency: plan.currency,
        },
        refund.branch_id,
      );
    }
    return plans.length;
  }
  async issueRefundCustomerCreditTx(
    c: PoolClient,
    auth: AccessClaims,
    refund: any,
    requestId: string,
  ) {
    if (
      refund.refund_destination !== "CUSTOMER_CREDIT" ||
      !refund.customer_id ||
      !["APPROVED", "PROCESSING", "COMPLETED"].includes(refund.status)
    )
      this.conflict("CUSTOMER_CREDIT_REFUND_CONFLICT");
    const existing = (
      await c.query<any>(
        `SELECT id "allocationId",account_id "accountId",amount_minor::text "amountMinor",currency
           FROM stored_value_refund_allocations
          WHERE tenant_id=$1 AND refund_id=$2 AND destination='CUSTOMER_CREDIT'`,
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    if (existing) return { ...existing, status: "COMPLETED" };
    const conflictingDestinations = (
      await c.query<any>(
        `SELECT
           EXISTS(SELECT 1 FROM refund_payment_allocations WHERE tenant_id=$1 AND refund_id=$2) OR
           EXISTS(SELECT 1 FROM refund_stored_value_line_plans WHERE tenant_id=$1 AND refund_id=$2) OR
           EXISTS(SELECT 1 FROM stored_value_refund_allocations WHERE tenant_id=$1 AND refund_id=$2) AS conflict`,
        [auth.tenantId, refund.id],
      )
    ).rows[0]?.conflict;
    if (conflictingDestinations)
      this.conflict("CUSTOMER_CREDIT_REFUND_CONFLICT");
    const creditNote = (
      await c.query<any>(
        "SELECT id FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2 AND status='ISSUED'",
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    if (!creditNote) this.conflict("CUSTOMER_CREDIT_REFUND_CONFLICT");
    const amount = BigInt(refund.requested_minor);
    if (amount <= 0n || BigInt(refund.tip_refund_minor) !== 0n)
      this.conflict("CUSTOMER_CREDIT_REFUND_CONFLICT");
    const accountId = await this.ensureCustomerCredit(
      c,
      auth,
      refund.customer_id,
      refund.currency,
    );
    const generationKey = `refund-credit:${refund.id}`;
    const ledgerId = await this.post(c, auth, {
      accountId,
      entryType: "REFUND_RESTORE",
      generationKey,
      currency: refund.currency,
      available: amount,
      refundId: refund.id,
      creditNoteId: creditNote.id,
      issued: amount,
    });
    const allocationId = randomUUID();
    await c.query(
      "INSERT INTO stored_value_refund_allocations(id,tenant_id,refund_id,account_id,destination,amount_minor,currency,ledger_entry_id,generation_key) VALUES($1,$2,$3,$4,'CUSTOMER_CREDIT',$5,$6,$7,$8)",
      [
        allocationId,
        auth.tenantId,
        refund.id,
        accountId,
        amount.toString(),
        refund.currency,
        ledgerId,
        generationKey,
      ],
    );
    await this.evidence(
      c,
      auth,
      "customer_credit.issued_from_refund",
      "stored_value_refund_allocation",
      allocationId,
      requestId,
      {
        refundId: refund.id,
        amountMinor: amount.toString(),
        currency: refund.currency,
      },
      refund.branch_id,
    );
    return {
      allocationId,
      accountId,
      amountMinor: amount.toString(),
      currency: refund.currency,
      status: "COMPLETED",
    };
  }

  issueRefundCustomerCredit(
    auth: AccessClaims,
    refundId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const amount = minor(input?.amountMinor ?? "0");
    return this.command(
      auth,
      "customer-credit.issue-from-refund",
      key,
      { refundId, amountMinor: amount.toString() },
      async (c) => {
        const refund = (
          await c.query<any>(
            "SELECT * FROM refunds WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, refundId],
          )
        ).rows[0];
        if (
          !refund ||
          refund.status !== "COMPLETED" ||
          amount !== BigInt(refund.requested_minor)
        )
          this.conflict("CUSTOMER_CREDIT_REFUND_CONFLICT");
        return this.issueRefundCustomerCreditTx(c, auth, refund, requestId);
      },
    );
  }

  async report(auth: AccessClaims, kind: string) {
    this.access(auth);
    const branches = this.scopedBranches(auth);
    if (kind === "exceptions")
      return (
        await this.db.query<any>(
          `SELECT e.id,e.account_id "accountId",e.exception_type "exceptionType",e.currency,e.expected_minor::text "expectedMinor",e.actual_minor::text "actualMinor",e.details_json details,e.status,e.created_at "createdAt",e.resolved_at "resolvedAt"
             FROM stored_value_reconciliation_exceptions e
            WHERE e.tenant_id=$1 AND ($2::uuid[] IS NULL OR EXISTS(SELECT 1 FROM stored_value_ledger_entries l
              WHERE l.tenant_id=e.tenant_id AND l.account_id=e.account_id AND l.branch_id=ANY($2::uuid[])))
            ORDER BY e.created_at DESC,e.id`,
          [auth.tenantId, branches],
        )
      ).rows;
    if (kind === "customer-credit")
      return (
        await this.db.query<any>(
          `SELECT currency,count(*)::int accounts,sum(available_minor)::text "availableMinor",sum(reserved_minor)::text "reservedMinor",sum(available_minor+reserved_minor)::text "liabilityMinor" FROM stored_value_accounts a WHERE tenant_id=$1 AND account_type='CUSTOMER_CREDIT'
            AND ($2::uuid[] IS NULL OR EXISTS(SELECT 1 FROM stored_value_ledger_entries l WHERE l.tenant_id=a.tenant_id AND l.account_id=a.id AND l.branch_id=ANY($2::uuid[])))
            GROUP BY currency ORDER BY currency`,
          [auth.tenantId, branches],
        )
      ).rows;
    if (kind === "aging")
      return (
        await this.db.query<any>(
          `SELECT g.currency,date_trunc('month',COALESCE(g.activated_at,g.created_at)) "cohortMonth",count(*)::int cards,sum(a.available_minor+a.reserved_minor)::text "liabilityMinor" FROM gift_cards g JOIN stored_value_accounts a ON a.tenant_id=g.tenant_id AND a.gift_card_id=g.id WHERE g.tenant_id=$1
            AND ($2::uuid[] IS NULL OR COALESCE(g.last_activity_branch_id,g.issuance_branch_id)=ANY($2::uuid[]))
            GROUP BY g.currency,date_trunc('month',COALESCE(g.activated_at,g.created_at)) ORDER BY "cohortMonth"`,
          [auth.tenantId, branches],
        )
      ).rows;
    if (kind === "liability" || kind === "reconciliation") {
      const rows = (
        await this.db.query<any>(
          `SELECT a.currency,a.account_type "accountType",sum(a.available_minor)::text "availableMinor",sum(a.reserved_minor)::text "reservedMinor",sum(a.available_minor+a.reserved_minor)::text "liabilityMinor" FROM stored_value_accounts a WHERE a.tenant_id=$1
            AND ($2::uuid[] IS NULL OR EXISTS(SELECT 1 FROM stored_value_ledger_entries l WHERE l.tenant_id=a.tenant_id AND l.account_id=a.id AND l.branch_id=ANY($2::uuid[])))
            GROUP BY a.currency,a.account_type ORDER BY a.currency,a.account_type`,
          [auth.tenantId, branches],
        )
      ).rows;
      const mismatches =
        kind === "reconciliation"
          ? (
              await this.db.query<any>(
                `SELECT a.id "accountId",a.currency,(a.pending_minor+a.available_minor+a.reserved_minor+a.redeemed_minor+a.expired_minor+a.cancelled_minor)::text projection,(SELECT COALESCE(sum(pending_delta_minor+available_delta_minor+reserved_delta_minor+redeemed_delta_minor+expired_delta_minor+cancelled_delta_minor),0)::text FROM stored_value_ledger_entries l WHERE l.tenant_id=a.tenant_id AND l.account_id=a.id) ledger FROM stored_value_accounts a WHERE a.tenant_id=$1
                  AND ($2::uuid[] IS NULL OR EXISTS(SELECT 1 FROM stored_value_ledger_entries l WHERE l.tenant_id=a.tenant_id AND l.account_id=a.id AND l.branch_id=ANY($2::uuid[])))`,
                [auth.tenantId, branches],
              )
            ).rows.filter((x) => x.projection !== x.ledger)
          : [];
      return { kind, rows, mismatches, generatedAt: new Date().toISOString() };
    }
    const filter =
      kind === "issuance"
        ? [
            "ISSUE_PENDING",
            "ACTIVATE",
            "RELOAD_COMMIT",
            "MANUAL_CREDIT",
            "SERVICE_RECOVERY_CREDIT",
          ]
        : kind === "redemption"
          ? ["RESERVE", "REDEEM", "RELEASE", "REFUND_RESTORE"]
          : null;
    return (
      await this.db.query<any>(
        'SELECT entry_type "entryType",currency,count(*)::int count,sum(abs(pending_delta_minor)+abs(available_delta_minor)+abs(reserved_delta_minor)+abs(redeemed_delta_minor))::text "amountMinor" FROM stored_value_ledger_entries WHERE tenant_id=$1 AND ($2::text[] IS NULL OR entry_type=ANY($2)) AND ($3::uuid[] IS NULL OR branch_id=ANY($3::uuid[])) GROUP BY entry_type,currency ORDER BY entry_type,currency',
        [auth.tenantId, filter, branches],
      )
    ).rows;
  }
  createExport(auth: AccessClaims, input: any, key: string, requestId: string) {
    return this.command(auth, "stored-value.export", key, input, async (c) => {
      const id = randomUUID();
      await c.query(
        "INSERT INTO stored_value_export_jobs(id,tenant_id,export_type,filters_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          auth.tenantId,
          input?.exportType ?? "LIABILITY",
          JSON.stringify(input?.filters ?? {}),
          `export:${key}`,
          auth.userId,
        ],
      );
      await this.evidence(
        c,
        auth,
        "stored_value.export_requested",
        "stored_value_export",
        id,
        requestId,
      );
      return { id, status: "PENDING" };
    });
  }
  async exportJob(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        'SELECT id,export_type "exportType",status,result_storage_key "resultStorageKey",safe_error_json "safeError",created_at "createdAt" FROM stored_value_export_jobs WHERE tenant_id=$1 AND id=$2',
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("STORED_VALUE_EXPORT_NOT_FOUND");
    return row;
  }
}
