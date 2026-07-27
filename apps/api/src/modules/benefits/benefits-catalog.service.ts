/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  benefitDecisionSchema,
  loyaltyAdjustmentSchema,
  loyaltyProgramSchema,
  membershipAssignSchema,
  membershipTierSchema,
  packageAdjustmentSchema,
  packageIssueSchema,
  servicePackageSchema,
  voucherAssignSchema,
  voucherBatchSchema,
  voucherCampaignSchema,
  voucherCodeIssueSchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { voucherCodeHash, voucherLast4 } from "./benefit-domain.js";

@Injectable()
export class BenefitsCatalogService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
  ) {}

  campaigns(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        `SELECT id,name,description,status,discount_type "discountType",discount_value "discountValue",currency,minimum_spend_minor "minimumSpendMinor",maximum_discount_minor "maximumDiscountMinor",total_use_limit "totalUseLimit",reserved_count "reservedCount",used_count "usedCount",per_customer_use_limit "perCustomerUseLimit",valid_from "validFrom",valid_until "validUntil",version,created_at "createdAt" FROM voucher_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`,
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async campaign(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM voucher_campaigns WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("VOUCHER_NOT_FOUND");
    return row;
  }
  createCampaign(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = voucherCampaignSchema.parse(input);
    return this.command(auth, "voucher.campaign.create", key, b, async (c) => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO voucher_campaigns(id,tenant_id,name,description,discount_type,discount_value,currency,minimum_spend_minor,maximum_discount_minor,total_use_limit,per_customer_use_limit,code_use_limit,membership_tier_ids,eligibility_policy_json,refund_policy,valid_from,valid_until,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          id,
          auth.tenantId,
          b.name,
          b.description ?? null,
          b.discountType,
          b.discountValue,
          b.currency ?? null,
          b.minimumSpendMinor,
          b.maximumDiscountMinor ?? null,
          b.totalUseLimit ?? null,
          b.perCustomerUseLimit ?? null,
          b.codeUseLimit,
          b.membershipTierIds,
          b.eligibilityPolicy,
          b.refundPolicy,
          b.validFrom,
          b.validUntil,
          auth.userId,
        ],
      );
      for (const branchId of b.branchIds)
        await c.query(
          "INSERT INTO voucher_campaign_branches(tenant_id,campaign_id,branch_id) VALUES($1,$2,$3)",
          [auth.tenantId, id, branchId],
        );
      for (const serviceId of b.serviceIds)
        await c.query(
          "INSERT INTO voucher_campaign_services(tenant_id,campaign_id,service_id) VALUES($1,$2,$3)",
          [auth.tenantId, id, serviceId],
        );
      for (const customerId of b.customerIds)
        await c.query(
          "INSERT INTO voucher_campaign_customers(tenant_id,campaign_id,customer_id) VALUES($1,$2,$3)",
          [auth.tenantId, id, customerId],
        );
      await this.evidence(
        c,
        auth,
        "voucher.campaign_created",
        "voucher_campaign",
        id,
        requestId,
        { status: "DRAFT" },
      );
      return this.campaignTx(c, auth, id);
    });
  }
  campaignStatus(
    auth: AccessClaims,
    id: string,
    status: "ACTIVE" | "PAUSED" | "ENDED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitDecisionSchema.pick({ version: true }).parse(input);
    return this.command(
      auth,
      `voucher.campaign.${status.toLowerCase()}`,
      key,
      b,
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM voucher_campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("VOUCHER_NOT_FOUND");
        if (row.version !== b.version)
          this.conflict("BENEFIT_VERSION_CONFLICT");
        const allowed: Record<string, string[]> = {
          DRAFT: ["ACTIVE"],
          ACTIVE: ["PAUSED", "ENDED"],
          PAUSED: ["ACTIVE", "ENDED"],
        };
        if (!allowed[row.status]?.includes(status))
          this.conflict("VOUCHER_INVALID");
        const updated = (
          await c.query<any>(
            "UPDATE voucher_campaigns SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, status],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "voucher.updated",
          "voucher_campaign",
          id,
          requestId,
          { status },
        );
        return updated;
      },
    );
  }

  codes(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        `SELECT vc.id,vc.campaign_id "campaignId",vc.customer_id "customerId",vc.code_last4 "codeLast4",vc.status,vc.use_limit "useLimit",vc.reserved_count "reservedCount",vc.used_count "usedCount",vc.expires_at "expiresAt",vc.version,vc.created_at "createdAt",c.name "campaignName" FROM voucher_codes vc JOIN voucher_campaigns c ON c.tenant_id=vc.tenant_id AND c.id=vc.campaign_id WHERE vc.tenant_id=$1 ORDER BY vc.created_at DESC`,
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async code(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        `SELECT id,campaign_id "campaignId",customer_id "customerId",code_last4 "codeLast4",status,use_limit "useLimit",reserved_count "reservedCount",used_count "usedCount",expires_at "expiresAt",version,created_at "createdAt" FROM voucher_codes WHERE tenant_id=$1 AND id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("VOUCHER_NOT_FOUND");
    return row;
  }
  issueCode(
    auth: AccessClaims,
    campaignId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = voucherCodeIssueSchema.parse(input);
    return this.command(
      auth,
      "voucher.code.issue",
      key,
      { campaignId, ...b, code: "[REDACTED]" },
      async (c) => this.issueCodeTx(c, auth, campaignId, b, requestId, key),
    );
  }
  batchCodes(
    auth: AccessClaims,
    campaignId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = voucherBatchSchema.parse(input);
    return this.command(
      auth,
      "voucher.code.batch",
      key,
      { campaignId, count: b.codes.length },
      async (c) => {
        const rows = [];
        for (const code of b.codes)
          rows.push(
            await this.issueCodeTx(
              c,
              auth,
              campaignId,
              code,
              requestId,
              `${key}:${rows.length}`,
            ),
          );
        return rows;
      },
    );
  }
  assignCode(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = voucherAssignSchema.parse(input);
    return this.command(auth, "voucher.code.assign", key, b, async (c) => {
      const row = (
        await c.query<any>(
          "SELECT * FROM voucher_codes WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, id],
        )
      ).rows[0];
      if (!row) this.notFound("VOUCHER_NOT_FOUND");
      if (row.version !== b.version) this.conflict("BENEFIT_VERSION_CONFLICT");
      if (row.used_count || row.reserved_count)
        this.conflict("VOUCHER_RESERVATION_CONFLICT");
      const updated = (
        await c.query<any>(
          'UPDATE voucher_codes SET customer_id=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,customer_id "customerId",code_last4 "codeLast4",status,version',
          [auth.tenantId, id, b.customerId],
        )
      ).rows[0];
      await this.evidence(
        c,
        auth,
        "voucher.updated",
        "voucher_code",
        id,
        requestId,
        { assigned: true },
      );
      return updated;
    });
  }
  cancelCode(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitDecisionSchema.parse(input);
    return this.command(auth, "voucher.code.cancel", key, b, async (c) => {
      const row = (
        await c.query<any>(
          "SELECT * FROM voucher_codes WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, id],
        )
      ).rows[0];
      if (!row) this.notFound("VOUCHER_NOT_FOUND");
      if (row.version !== b.version) this.conflict("BENEFIT_VERSION_CONFLICT");
      if (row.reserved_count > 0) this.conflict("VOUCHER_RESERVATION_CONFLICT");
      const updated = (
        await c.query<any>(
          "UPDATE voucher_codes SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,code_last4 \"codeLast4\",status,version",
          [auth.tenantId, id],
        )
      ).rows[0];
      await this.evidence(
        c,
        auth,
        "voucher.updated",
        "voucher_code",
        id,
        requestId,
        { status: "CANCELLED", reason: b.reason },
      );
      return updated;
    });
  }
  customerVouchers(auth: AccessClaims, customerId: string) {
    this.access(auth);
    return this.db
      .query(
        `SELECT vc.id,vc.code_last4 "codeLast4",vc.status,vc.expires_at "expiresAt",c.name "campaignName",c.discount_type "discountType",c.discount_value "discountValue",c.currency FROM voucher_codes vc JOIN voucher_campaigns c ON c.tenant_id=vc.tenant_id AND c.id=vc.campaign_id WHERE vc.tenant_id=$1 AND (vc.customer_id=$2 OR vc.customer_id IS NULL) ORDER BY vc.expires_at NULLS LAST`,
        [auth.tenantId, customerId],
      )
      .then((r) => r.rows);
  }

  programs(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        "SELECT * FROM loyalty_programs WHERE tenant_id=$1 ORDER BY effective_from DESC",
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async program(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM loyalty_programs WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("LOYALTY_PROGRAM_NOT_FOUND");
    return row;
  }
  createProgram(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = loyaltyProgramSchema.parse(input);
    return this.command(auth, "loyalty.program.create", key, b, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${auth.tenantId}:loyalty-program`,
      ]);
      const overlap = await c.query(
        "SELECT 1 FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' AND tstzrange(effective_from,COALESCE(effective_to,'infinity'),'[)')&&tstzrange($2,COALESCE($3::timestamptz,'infinity'),'[)')",
        [auth.tenantId, b.effectiveFrom, b.effectiveTo ?? null],
      );
      if (overlap.rowCount) this.conflict("LOYALTY_PROGRAM_OVERLAP");
      const id = randomUUID();
      const row = (
        await c.query<any>(
          `INSERT INTO loyalty_programs(id,tenant_id,name,status,earn_basis,spend_minor_per_point,redemption_points,redemption_minor,settlement_delay_hours,points_valid_days,effective_from,effective_to,policy_json,created_by_user_id) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            id,
            auth.tenantId,
            b.name,
            b.earnBasis,
            b.spendMinorPerPoint,
            b.redemptionPoints,
            b.redemptionMinor,
            b.settlementDelayHours,
            b.pointsValidDays ?? null,
            b.effectiveFrom,
            b.effectiveTo ?? null,
            b.policy,
            auth.userId,
          ],
        )
      ).rows[0];
      await this.evidence(
        c,
        auth,
        "loyalty.updated",
        "loyalty_program",
        id,
        requestId,
        { status: "ACTIVE" },
      );
      return row;
    });
  }
  supersedeProgram(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = loyaltyProgramSchema.parse(input);
    return this.command(
      auth,
      "loyalty.program.supersede",
      key,
      b,
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM loyalty_programs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!old) this.notFound("LOYALTY_PROGRAM_NOT_FOUND");
        await c.query(
          "UPDATE loyalty_programs SET status='INACTIVE',effective_to=LEAST(COALESCE(effective_to,$3::timestamptz),$3::timestamptz),updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, b.effectiveFrom],
        );
        const next = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO loyalty_programs(id,tenant_id,name,status,earn_basis,spend_minor_per_point,redemption_points,redemption_minor,settlement_delay_hours,points_valid_days,effective_from,effective_to,policy_json,created_by_user_id,supersedes_program_id,version) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
            [
              next,
              auth.tenantId,
              b.name,
              b.earnBasis,
              b.spendMinorPerPoint,
              b.redemptionPoints,
              b.redemptionMinor,
              b.settlementDelayHours,
              b.pointsValidDays ?? null,
              b.effectiveFrom,
              b.effectiveTo ?? null,
              b.policy,
              auth.userId,
              id,
              old.version + 1,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "loyalty.updated",
          "loyalty_program",
          next,
          requestId,
          { supersedes: id },
        );
        return row;
      },
    );
  }
  deactivateProgram(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitDecisionSchema.parse(input);
    return this.command(
      auth,
      "loyalty.program.deactivate",
      key,
      b,
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM loyalty_programs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("LOYALTY_PROGRAM_NOT_FOUND");
        if (row.version !== b.version)
          this.conflict("BENEFIT_VERSION_CONFLICT");
        const updated = (
          await c.query<any>(
            "UPDATE loyalty_programs SET status='INACTIVE',effective_to=COALESCE(effective_to,now()),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "loyalty.updated",
          "loyalty_program",
          id,
          requestId,
          { status: "INACTIVE", reason: b.reason },
        );
        return updated;
      },
    );
  }
  async loyalty(auth: AccessClaims, customerId: string) {
    this.access(auth);
    const account = (
      await this.db.query<any>(
        'SELECT id,pending_points "pendingPoints",available_points "availablePoints",reserved_points "reservedPoints",lifetime_earned_points "lifetimeEarnedPoints",version FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2',
        [auth.tenantId, customerId],
      )
    ).rows[0];
    return (
      account ?? {
        customerId,
        pendingPoints: 0,
        availablePoints: 0,
        reservedPoints: 0,
        lifetimeEarnedPoints: 0,
        version: 0,
      }
    );
  }
  loyaltyLedger(auth: AccessClaims, customerId: string) {
    this.access(auth);
    return this.db
      .query(
        `SELECT id,entry_type "entryType",pending_delta "pendingDelta",available_delta "availableDelta",reserved_delta "reservedDelta",lifetime_delta "lifetimeDelta",expires_at "expiresAt",created_at "createdAt" FROM loyalty_ledger_entries WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at DESC,id DESC`,
        [auth.tenantId, customerId],
      )
      .then((r) => r.rows);
  }
  createAdjustment(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = loyaltyAdjustmentSchema.parse(input);
    return this.command(
      auth,
      "loyalty.adjustment.request",
      key,
      b,
      async (c) => {
        const account = await this.ensureAccount(c, auth, b.customerId);
        const id = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO loyalty_adjustment_requests(id,tenant_id,customer_id,account_id,points_delta,reason_code,note,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              id,
              auth.tenantId,
              b.customerId,
              account.id,
              b.pointsDelta,
              b.reasonCode,
              b.note,
              auth.userId,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "loyalty.adjustment_requested",
          "loyalty_adjustment",
          id,
          requestId,
          { pointsDelta: b.pointsDelta, reasonCode: b.reasonCode },
        );
        return row;
      },
    );
  }
  adjustmentDecision(
    auth: AccessClaims,
    id: string,
    action: "APPROVED" | "REJECTED" | "CANCELLED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitDecisionSchema.parse(input);
    return this.command(
      auth,
      `loyalty.adjustment.${action.toLowerCase()}`,
      key,
      b,
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM loyalty_adjustment_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("LOYALTY_ADJUSTMENT_NOT_FOUND");
        if (row.version !== b.version)
          this.conflict("BENEFIT_VERSION_CONFLICT");
        if (row.status !== "PENDING")
          this.conflict("LOYALTY_ADJUSTMENT_APPROVAL_REQUIRED");
        if (action === "APPROVED" && row.requested_by_user_id === auth.userId)
          throw new ForbiddenException({
            code: "LOYALTY_SELF_APPROVAL_DENIED",
            message: "Requester cannot approve own adjustment",
          });
        let ledgerId = null;
        if (action === "APPROVED") {
          ledgerId = randomUUID();
          await c.query(
            "INSERT INTO loyalty_ledger_entries(id,tenant_id,account_id,customer_id,entry_type,available_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,'MANUAL_ADJUSTMENT',$5,$6,$7,$8)",
            [
              ledgerId,
              auth.tenantId,
              row.account_id,
              row.customer_id,
              row.points_delta,
              JSON.stringify({ reasonCode: row.reason_code, note: row.note }),
              `loyalty-adjustment:${id}`,
              auth.userId,
            ],
          );
          await c.query(
            "UPDATE loyalty_accounts SET available_points=available_points+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, row.account_id, row.points_delta],
          );
          if (BigInt(row.points_delta) > 0n)
            await c.query(
              "INSERT INTO loyalty_point_lots(tenant_id,account_id,source_ledger_entry_id,original_points,available_points) VALUES($1,$2,$3,$4,$4)",
              [auth.tenantId, row.account_id, ledgerId, row.points_delta],
            );
        }
        const updated = (
          await c.query<any>(
            "UPDATE loyalty_adjustment_requests SET status=$3,decided_by_user_id=$4,decision_reason=$5,ledger_entry_id=$6,decided_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, action, auth.userId, b.reason, ledgerId],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          action === "APPROVED"
            ? "loyalty.adjustment_approved"
            : "loyalty.adjustment_updated",
          "loyalty_adjustment",
          id,
          requestId,
          { status: action },
        );
        return updated;
      },
    );
  }
  adjustments(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        "SELECT * FROM loyalty_adjustment_requests WHERE tenant_id=$1 ORDER BY created_at DESC",
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }

  tiers(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        "SELECT * FROM membership_tiers WHERE tenant_id=$1 ORDER BY priority DESC,effective_from DESC",
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async tier(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM membership_tiers WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("MEMBERSHIP_TIER_NOT_FOUND");
    return row;
  }
  createTier(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = membershipTierSchema.parse(input);
    return this.command(auth, "membership.tier.create", key, b, async (c) => {
      const id = randomUUID();
      const row = (
        await c.query<any>(
          `INSERT INTO membership_tiers(id,tenant_id,code,name_json,qualification_type,qualification_threshold,rolling_window_days,benefits_json,priority,effective_from,effective_to,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            id,
            auth.tenantId,
            b.code,
            b.name,
            b.qualificationType,
            b.qualificationThreshold,
            b.rollingWindowDays ?? null,
            b.benefits,
            b.priority,
            b.effectiveFrom,
            b.effectiveTo ?? null,
            auth.userId,
          ],
        )
      ).rows[0];
      await this.evidence(
        c,
        auth,
        "membership.updated",
        "membership_tier",
        id,
        requestId,
        { status: "ACTIVE" },
      );
      return row;
    });
  }
  supersedeTier(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = membershipTierSchema.parse(input);
    return this.command(
      auth,
      "membership.tier.supersede",
      key,
      b,
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM membership_tiers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!old) this.notFound("MEMBERSHIP_TIER_NOT_FOUND");
        await c.query(
          "UPDATE membership_tiers SET status='INACTIVE',effective_to=LEAST(COALESCE(effective_to,$3::timestamptz),$3::timestamptz),updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, b.effectiveFrom],
        );
        const next = randomUUID();
        const row = (
          await c.query<any>(
            `INSERT INTO membership_tiers(id,tenant_id,code,name_json,qualification_type,qualification_threshold,rolling_window_days,benefits_json,priority,effective_from,effective_to,created_by_user_id,supersedes_tier_id,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [
              next,
              auth.tenantId,
              b.code,
              b.name,
              b.qualificationType,
              b.qualificationThreshold,
              b.rollingWindowDays ?? null,
              b.benefits,
              b.priority,
              b.effectiveFrom,
              b.effectiveTo ?? null,
              auth.userId,
              id,
              old.version + 1,
            ],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "membership.updated",
          "membership_tier",
          next,
          requestId,
          { supersedes: id },
        );
        return row;
      },
    );
  }
  deactivateTier(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitDecisionSchema.parse(input);
    return this.command(
      auth,
      "membership.tier.deactivate",
      key,
      b,
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM membership_tiers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("MEMBERSHIP_TIER_NOT_FOUND");
        if (row.version !== b.version)
          this.conflict("BENEFIT_VERSION_CONFLICT");
        const updated = (
          await c.query<any>(
            "UPDATE membership_tiers SET status='INACTIVE',effective_to=COALESCE(effective_to,now()),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "membership.updated",
          "membership_tier",
          id,
          requestId,
          { status: "INACTIVE", reason: b.reason },
        );
        return updated;
      },
    );
  }
  async membership(auth: AccessClaims, customerId: string) {
    this.access(auth);
    return (
      await this.db.query<any>(
        `SELECT a.*,t.code,t.name_json "tierName" FROM customer_membership_assignments a JOIN membership_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id WHERE a.tenant_id=$1 AND a.customer_id=$2 ORDER BY a.effective_from DESC`,
        [auth.tenantId, customerId],
      )
    ).rows;
  }
  assignMembership(
    auth: AccessClaims,
    customerId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = membershipAssignSchema.parse(input);
    return this.command(
      auth,
      "membership.assignment.assign",
      key,
      b,
      async (c) =>
        this.assignMembershipTx(
          c,
          auth,
          customerId,
          b.tierId,
          b.effectiveFrom,
          b.effectiveTo ?? null,
          b.reasonCode,
          requestId,
        ),
    );
  }
  revokeMembership(
    auth: AccessClaims,
    customerId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitDecisionSchema.parse(input);
    return this.command(
      auth,
      "membership.assignment.revoke",
      key,
      b,
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM customer_membership_assignments WHERE tenant_id=$1 AND customer_id=$2 AND status='ACTIVE' ORDER BY effective_from DESC LIMIT 1 FOR UPDATE",
            [auth.tenantId, customerId],
          )
        ).rows[0];
        if (!row) this.conflict("MEMBERSHIP_NOT_ACTIVE");
        await c.query(
          "UPDATE customer_membership_assignments SET status='REVOKED',effective_to=COALESCE(effective_to,now()),reason_code=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.id, b.reason],
        );
        await this.evidence(
          c,
          auth,
          "membership.revoked",
          "membership_assignment",
          row.id,
          requestId,
          { customerId },
        );
        return { id: row.id, status: "REVOKED" };
      },
    );
  }
  evaluateMembership(
    auth: AccessClaims,
    customerId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    return this.command(auth, "membership.evaluate", key, input, async (c) => {
      const metrics = (
        await c.query<any>(
          "SELECT * FROM customer_membership_metrics WHERE tenant_id=$1 AND customer_id=$2 FOR UPDATE",
          [auth.tenantId, customerId],
        )
      ).rows[0] ?? { rolling_spend_minor: 0, visit_count: 0 };
      const tier = (
        await c.query<any>(
          `SELECT * FROM membership_tiers WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) AND ((qualification_type='ROLLING_SPEND' AND qualification_threshold<=$2) OR (qualification_type='VISIT_COUNT' AND qualification_threshold<=$3)) ORDER BY priority DESC LIMIT 1`,
          [auth.tenantId, metrics.rolling_spend_minor, metrics.visit_count],
        )
      ).rows[0];
      if (!tier)
        return {
          customerId,
          changed: false,
          reasonCodes: ["MEMBERSHIP_TIER_NOT_FOUND"],
        };
      const current = (
        await c.query<any>(
          "SELECT * FROM customer_membership_assignments WHERE tenant_id=$1 AND customer_id=$2 AND status='ACTIVE' ORDER BY effective_from DESC LIMIT 1 FOR UPDATE",
          [auth.tenantId, customerId],
        )
      ).rows[0];
      if (current?.tier_id === tier.id)
        return { customerId, changed: false, assignmentId: current.id };
      if (current)
        await c.query(
          "UPDATE customer_membership_assignments SET status='SUPERSEDED',effective_to=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, current.id],
        );
      const assignment = await this.assignMembershipTx(
        c,
        auth,
        customerId,
        tier.id,
        new Date().toISOString(),
        null,
        current ? "AUTOMATIC_UPGRADE" : "AUTOMATIC_ASSIGN",
        requestId,
        current?.id,
      );
      return { customerId, changed: true, assignment };
    });
  }

  packages(auth: AccessClaims) {
    this.access(auth);
    return this.db
      .query(
        "SELECT * FROM service_package_products WHERE tenant_id=$1 ORDER BY created_at DESC",
        [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async package(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM service_package_products WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("PACKAGE_NOT_FOUND");
    row.eligibility = (
      await this.db.query(
        "SELECT * FROM service_package_eligibility_items WHERE tenant_id=$1 AND package_product_id=$2",
        [auth.tenantId, id],
      )
    ).rows;
    return row;
  }
  createPackage(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = servicePackageSchema.parse(input);
    return this.command(auth, "package.catalog.create", key, b, async (c) => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO service_package_products(id,tenant_id,code,name_json,description_json,granted_units,units_per_redemption,price_minor,currency,validity_days,refund_policy,policy_json,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          auth.tenantId,
          b.code,
          b.name,
          b.description,
          b.grantedUnits,
          b.unitsPerRedemption,
          b.priceMinor,
          b.currency,
          b.validityDays,
          b.refundPolicy,
          b.policy,
          auth.userId,
        ],
      );
      for (const x of b.eligibility)
        await c.query(
          "INSERT INTO service_package_eligibility_items(tenant_id,package_product_id,service_id,category_id,branch_id,units_per_redemption) VALUES($1,$2,$3,$4,$5,$6)",
          [
            auth.tenantId,
            id,
            x.serviceId ?? null,
            x.categoryId ?? null,
            x.branchId ?? null,
            x.unitsPerRedemption,
          ],
        );
      await this.evidence(
        c,
        auth,
        "package.updated",
        "service_package",
        id,
        requestId,
        { status: "DRAFT" },
      );
      return this.packageTx(c, auth, id);
    });
  }
  supersedePackage(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = servicePackageSchema.parse(input);
    return this.command(
      auth,
      "package.catalog.supersede",
      key,
      b,
      async (c) => {
        const old = (
          await c.query<any>(
            "SELECT * FROM service_package_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!old) this.notFound("PACKAGE_NOT_FOUND");
        await c.query(
          "UPDATE service_package_products SET status='INACTIVE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id],
        );
        const next = randomUUID();
        await c.query(
          `INSERT INTO service_package_products(id,tenant_id,code,name_json,description_json,status,granted_units,units_per_redemption,price_minor,currency,validity_days,refund_policy,policy_json,created_by_user_id,supersedes_product_id,version) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            next,
            auth.tenantId,
            b.code,
            b.name,
            b.description,
            b.grantedUnits,
            b.unitsPerRedemption,
            b.priceMinor,
            b.currency,
            b.validityDays,
            b.refundPolicy,
            b.policy,
            auth.userId,
            id,
            old.version + 1,
          ],
        );
        for (const x of b.eligibility)
          await c.query(
            "INSERT INTO service_package_eligibility_items(tenant_id,package_product_id,service_id,category_id,branch_id,units_per_redemption) VALUES($1,$2,$3,$4,$5,$6)",
            [
              auth.tenantId,
              next,
              x.serviceId ?? null,
              x.categoryId ?? null,
              x.branchId ?? null,
              x.unitsPerRedemption,
            ],
          );
        await this.evidence(
          c,
          auth,
          "package.updated",
          "service_package",
          next,
          requestId,
          { supersedes: id },
        );
        return this.packageTx(c, auth, next);
      },
    );
  }
  packageStatus(
    auth: AccessClaims,
    id: string,
    status: "ACTIVE" | "INACTIVE",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitDecisionSchema.parse(input);
    return this.command(
      auth,
      `package.catalog.${status.toLowerCase()}`,
      key,
      b,
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM service_package_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("PACKAGE_NOT_FOUND");
        if (row.version !== b.version)
          this.conflict("BENEFIT_VERSION_CONFLICT");
        const updated = (
          await c.query<any>(
            "UPDATE service_package_products SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, status],
          )
        ).rows[0];
        await this.evidence(
          c,
          auth,
          "package.updated",
          "service_package",
          id,
          requestId,
          { status, reason: b.reason },
        );
        return updated;
      },
    );
  }
  issuePackage(
    auth: AccessClaims,
    customerId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = packageIssueSchema.parse(input);
    return this.command(
      auth,
      "package.entitlement.issue",
      key,
      b,
      async (c) => {
        const product = (
          await c.query<any>(
            "SELECT * FROM service_package_products WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE",
            [auth.tenantId, b.packageProductId],
          )
        ).rows[0];
        if (!product) this.notFound("PACKAGE_NOT_FOUND");
        const id = randomUUID(),
          expires =
            b.expiresAt ??
            new Date(
              Date.now() + product.validity_days * 86400000,
            ).toISOString(),
          generation = b.generationKey ?? `package-issue:${id}`;
        const unitValue = product.granted_units
          ? BigInt(product.price_minor) / BigInt(product.granted_units)
          : 0n;
        const policy = {
          productId: product.id,
          productVersion: product.version,
          refundPolicy: product.refund_policy,
          validityDays: product.validity_days,
        };
        const row = (
          await c.query<any>(
            `INSERT INTO customer_package_entitlements(id,tenant_id,customer_id,package_product_id,granted_units,available_units,allocated_unit_value_minor,currency,expires_at,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [
              id,
              auth.tenantId,
              customerId,
              product.id,
              product.granted_units,
              unitValue.toString(),
              product.currency,
              expires,
              JSON.stringify(policy),
              generation,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,entry_type,available_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,'ISSUE',$4,$5,$6,$7)",
          [
            auth.tenantId,
            id,
            customerId,
            product.granted_units,
            JSON.stringify(policy),
            `${generation}:ledger`,
            auth.userId,
          ],
        );
        await this.evidence(
          c,
          auth,
          "package.entitlement_issued",
          "package_entitlement",
          id,
          requestId,
          { customerId, units: product.granted_units },
        );
        return row;
      },
    );
  }
  customerPackages(auth: AccessClaims, customerId: string) {
    this.access(auth);
    return this.db
      .query(
        `SELECT e.id,e.package_product_id "packageProductId",p.code,p.name_json "name",e.status,e.available_units "availableUnits",e.reserved_units "reservedUnits",e.consumed_units "consumedUnits",e.expires_at "expiresAt",e.version FROM customer_package_entitlements e JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id WHERE e.tenant_id=$1 AND e.customer_id=$2 ORDER BY e.expires_at`,
        [auth.tenantId, customerId],
      )
      .then((r) => r.rows);
  }
  async entitlement(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM customer_package_entitlements WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("PACKAGE_ENTITLEMENT_NOT_FOUND");
    return row;
  }
  entitlementLedger(auth: AccessClaims, id: string) {
    this.access(auth);
    return this.db
      .query(
        "SELECT * FROM package_ledger_entries WHERE tenant_id=$1 AND entitlement_id=$2 ORDER BY created_at DESC,id DESC",
        [auth.tenantId, id],
      )
      .then((r) => r.rows);
  }
  adjustPackage(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = packageAdjustmentSchema.parse(input);
    return this.command(
      auth,
      "package.entitlement.adjust",
      key,
      b,
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM customer_package_entitlements WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("PACKAGE_ENTITLEMENT_NOT_FOUND");
        if (Number(row.available_units) + b.unitsDelta < 0)
          this.conflict("PACKAGE_INSUFFICIENT_BALANCE");
        await c.query(
          "UPDATE customer_package_entitlements SET adjustment_units=adjustment_units+$3,available_units=available_units+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, b.unitsDelta],
        );
        await c.query(
          "INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,entry_type,available_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,'MANUAL_ADJUSTMENT',$4,$5,$6,$7)",
          [
            auth.tenantId,
            id,
            row.customer_id,
            b.unitsDelta,
            JSON.stringify({ reasonCode: b.reasonCode, note: b.note }),
            `package-adjustment:${key}`,
            auth.userId,
          ],
        );
        await this.evidence(
          c,
          auth,
          "package.updated",
          "package_entitlement",
          id,
          requestId,
          { unitsDelta: b.unitsDelta, reasonCode: b.reasonCode },
        );
        return this.entitlementTx(c, auth, id);
      },
    );
  }

  async wallet(auth: AccessClaims, customerId: string) {
    this.access(auth);
    const [membership, vouchers, loyalty, packages, history] =
      await Promise.all([
        this.membership(auth, customerId),
        this.customerVouchers(auth, customerId),
        this.loyalty(auth, customerId),
        this.customerPackages(auth, customerId),
        this.db.query(
          `SELECT 'LOYALTY' type,entry_type status,created_at "createdAt" FROM loyalty_ledger_entries WHERE tenant_id=$1 AND customer_id=$2 UNION ALL SELECT 'PACKAGE',entry_type,created_at FROM package_ledger_entries WHERE tenant_id=$1 AND customer_id=$2 ORDER BY "createdAt" DESC LIMIT 100`,
          [auth.tenantId, customerId],
        ),
      ]);
    return {
      customerId,
      membership: membership[0] ?? null,
      vouchers,
      loyalty,
      packages,
      history: history.rows,
      expiringSoon: [
        ...vouchers.filter((x: any) => x.expiresAt),
        ...packages.filter((x: any) => x.expiresAt),
      ].filter(
        (x: any) =>
          new Date(x.expiresAt).getTime() < Date.now() + 30 * 86400000,
      ),
    };
  }
  async ownCustomer(auth: AccessClaims) {
    const row = (
      await this.db.query<any>(
        `SELECT c.id FROM users u JOIN customers c ON c.tenant_id=$1 AND ((u.phone_normalized IS NOT NULL AND c.phone_normalized=u.phone_normalized) OR (u.email IS NOT NULL AND lower(c.email_normalized)=lower(u.email))) WHERE u.id=$2 LIMIT 1`,
        [auth.tenantId, auth.userId],
      )
    ).rows[0];
    if (!row) this.notFound("CUSTOMER_NOT_FOUND");
    return row.id as string;
  }

  private async issueCodeTx(
    c: PoolClient,
    auth: AccessClaims,
    campaignId: string,
    b: any,
    requestId: string,
    generation: string,
  ) {
    const campaign = (
      await c.query<any>(
        "SELECT * FROM voucher_campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, campaignId],
      )
    ).rows[0];
    if (!campaign) this.notFound("VOUCHER_NOT_FOUND");
    const id = randomUUID(),
      hash = voucherCodeHash(b.code, auth.tenantId);
    try {
      await c.query(
        "INSERT INTO voucher_codes(id,tenant_id,campaign_id,customer_id,code_hash,code_last4,use_limit,generation_key,expires_at,issued_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          auth.tenantId,
          campaignId,
          b.customerId ?? null,
          hash,
          voucherLast4(b.code),
          b.useLimit,
          `voucher-code:${generation}`,
          b.expiresAt ?? campaign.valid_until,
          auth.userId,
        ],
      );
    } catch (error: any) {
      if (error?.code === "23505") this.conflict("VOUCHER_INVALID");
      throw error;
    }
    await this.evidence(
      c,
      auth,
      "voucher.code_issued",
      "voucher_code",
      id,
      requestId,
      { campaignId, codeLast4: voucherLast4(b.code) },
    );
    return {
      id,
      campaignId,
      customerId: b.customerId ?? null,
      codeLast4: voucherLast4(b.code),
      status: "AVAILABLE",
      expiresAt: b.expiresAt ?? campaign.valid_until,
      version: 1,
    };
  }
  private async assignMembershipTx(
    c: PoolClient,
    auth: AccessClaims,
    customerId: string,
    tierId: string,
    from: string,
    to: string | null,
    reason: string,
    requestId: string,
    supersedes?: string,
  ) {
    const tier = (
      await c.query<any>(
        "SELECT * FROM membership_tiers WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
        [auth.tenantId, tierId],
      )
    ).rows[0];
    if (!tier) this.notFound("MEMBERSHIP_TIER_NOT_FOUND");
    const id = randomUUID();
    try {
      const row = (
        await c.query<any>(
          `INSERT INTO customer_membership_assignments(id,tenant_id,customer_id,tier_id,status,effective_from,effective_to,benefit_snapshot_json,qualification_snapshot_json,supersedes_assignment_id,reason_code,assigned_by_user_id) VALUES($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            id,
            auth.tenantId,
            customerId,
            tierId,
            from,
            to,
            JSON.stringify(tier.benefits_json),
            JSON.stringify({
              qualificationType: tier.qualification_type,
              threshold: String(tier.qualification_threshold),
            }),
            supersedes ?? null,
            reason,
            auth.userId,
          ],
        )
      ).rows[0];
      await this.evidence(
        c,
        auth,
        supersedes ? "membership.upgraded" : "membership.assigned",
        "membership_assignment",
        id,
        requestId,
        { customerId, tierId },
      );
      return row;
    } catch (error: any) {
      if (error?.code === "23P01")
        this.conflict("MEMBERSHIP_ASSIGNMENT_CONFLICT");
      throw error;
    }
  }
  private async ensureAccount(
    c: PoolClient,
    auth: AccessClaims,
    customerId: string,
  ) {
    return (
      await c.query<any>(
        "INSERT INTO loyalty_accounts(tenant_id,customer_id) VALUES($1,$2) ON CONFLICT(tenant_id,customer_id) DO UPDATE SET updated_at=loyalty_accounts.updated_at RETURNING *",
        [auth.tenantId, customerId],
      )
    ).rows[0];
  }
  private campaignTx(c: PoolClient, auth: AccessClaims, id: string) {
    return c
      .query("SELECT * FROM voucher_campaigns WHERE tenant_id=$1 AND id=$2", [
        auth.tenantId,
        id,
      ])
      .then((r) => r.rows[0]);
  }
  private packageTx(c: PoolClient, auth: AccessClaims, id: string) {
    return c
      .query(
        "SELECT * FROM service_package_products WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
      .then((r) => r.rows[0]);
  }
  private entitlementTx(c: PoolClient, auth: AccessClaims, id: string) {
    return c
      .query(
        "SELECT * FROM customer_package_entitlements WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
      .then((r) => r.rows[0]);
  }
  private command<T>(
    auth: AccessClaims,
    name: string,
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
            command: name,
            key,
            request,
            work: () => work(c),
          })
        ).data,
    );
  }
  private access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((r) =>
        [
          "SALON_OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER",
          "ACCOUNTANT",
          "MARKETING",
          "CUSTOMER",
          "NAIL_TECHNICIAN",
        ].includes(r),
      )
    )
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Platform support requires an explicit tenant access grant",
      });
  }
  private notFound(code: string): never {
    throw new NotFoundException({
      code,
      message: "Benefit resource not found",
    });
  }
  private conflict(code: string): never {
    throw new ConflictException({
      code,
      message: "Benefit command conflicts with current state",
    });
  }
  private async evidence(
    c: PoolClient,
    auth: AccessClaims,
    event: string,
    type: string,
    id: string,
    requestId: string,
    payload: Record<string, unknown>,
  ) {
    await c.query(
      "INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        auth.tenantId,
        auth.userId,
        event,
        type,
        id,
        JSON.stringify(payload),
        requestId,
      ],
    );
    await c.query(
      "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        auth.tenantId,
        event,
        type,
        id,
        JSON.stringify({ aggregateId: id, refetch: true }),
        JSON.stringify({ type: "USER", id: auth.userId }),
        JSON.stringify({ schemaVersion: 1, pii: false }),
      ],
    );
  }
}
