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
  appointmentPackageReservationSchema,
  benefitOrderCommandSchema,
  loyaltyApplySchema,
  membershipApplySchema,
  packageApplySchema,
  packageReservationSchema,
  publicPackageReservationSchema,
  voucherApplySchema,
  voucherValidateSchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import { BookingTokenService } from "../booking/booking-token.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import {
  fixedOrPercentDiscount,
  loyaltyEarnPoints,
  loyaltyRedemptionPlan,
  voucherCodeHash,
} from "./benefit-domain.js";
import { BenefitsEligibilityService } from "./benefits-eligibility.service.js";

@Injectable()
export class BenefitsTransactionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(BookingTokenService) private readonly tokens: BookingTokenService,
    @Inject(BenefitsEligibilityService)
    private readonly eligibility: BenefitsEligibilityService,
  ) {}

  orderEligibility(auth: AccessClaims, id: string) {
    this.access(auth);
    return this.eligibility.forOrder(auth, id);
  }
  appointmentEligibility(auth: AccessClaims, id: string) {
    this.access(auth);
    return this.eligibility.forAppointment(auth, id);
  }
  async orderBenefits(auth: AccessClaims, id: string) {
    this.access(auth);
    await this.order(auth, id);
    return (
      await this.db.query<any>(
        `SELECT a.id,a.benefit_type "benefitType",a.source_entity_id "sourceEntityId",a.reservation_id "reservationId",a.covered_order_line_id "coveredOrderLineId",a.status,a.sequence_no "sequenceNo",a.amount_minor "amountMinor",a.units,a.allocation_json "allocation",a.policy_snapshot_json "policySnapshot",a.expires_at "expiresAt",a.version,
          lr.requested_points "requestedPoints",lr.accepted_points "acceptedPoints",lr.unused_points "unusedPoints"
         FROM pos_order_benefit_applications a
         LEFT JOIN loyalty_reservations lr ON lr.tenant_id=a.tenant_id AND lr.id=a.reservation_id AND a.benefit_type='LOYALTY'
         WHERE a.tenant_id=$1 AND a.pos_order_id=$2 ORDER BY a.sequence_no,a.created_at`,
        [auth.tenantId, id],
      )
    ).rows;
  }
  async appointmentBenefits(auth: AccessClaims, id: string) {
    this.access(auth);
    await this.appointment(auth, id);
    return (
      await this.db.query<any>(
        `SELECT r.id,'PACKAGE' "benefitType",r.entitlement_id "sourceEntityId",r.status,r.units,r.expires_at "expiresAt",r.version,r.appointment_item_id "appointmentItemId" FROM package_reservations r WHERE r.tenant_id=$1 AND r.appointment_id=$2 ORDER BY r.created_at`,
        [auth.tenantId, id],
      )
    ).rows;
  }

  async validateVoucher(auth: AccessClaims, input: unknown) {
    this.access(auth);
    const b = voucherValidateSchema.parse(input),
      hash = voucherCodeHash(b.code, auth.tenantId);
    const code = (
      await this.db.query<any>(
        "SELECT id FROM voucher_codes WHERE tenant_id=$1 AND code_hash=$2",
        [auth.tenantId, hash],
      )
    ).rows[0];
    if (!code) return { eligible: false, reasonCodes: ["VOUCHER_INVALID"] };
    const branch = (
      await this.db.query<any>(
        "SELECT currency FROM branch_settings WHERE tenant_id=$1 AND branch_id=$2",
        [auth.tenantId, b.branchId],
      )
    ).rows[0];
    if (!branch) this.notFound("BRANCH_NOT_FOUND");
    const result = await this.eligibility.evaluate({
      tenantId: auth.tenantId,
      branchId: b.branchId,
      customerId: b.customerId,
      context: "POS",
      serviceItems: b.serviceItems.map((x) => ({
        serviceId: x.serviceId,
        amountMinor: BigInt(x.amountMinor),
      })),
      localDateTime: b.localDateTime,
      currency: branch.currency,
    });
    return (
      result.vouchers.find((x: any) => x.id === code.id) ?? {
        eligible: false,
        reasonCodes: ["VOUCHER_NOT_ELIGIBLE"],
      }
    );
  }

  applyVoucher(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = voucherApplySchema.parse(input);
    return this.orderCommand(
      auth,
      orderId,
      "benefit.voucher.reserve",
      key,
      { ...b, code: "[REDACTED]" },
      requestId,
      async (c, order) => {
        this.assertDraftVersion(order, b.version);
        const hash = voucherCodeHash(b.code, auth.tenantId);
        const code = (
          await c.query<any>(
            `SELECT vc.id voucher_code_id,vc.campaign_id,vc.customer_id code_customer_id,vc.code_last4,
              vc.use_limit,vc.reserved_count code_reserved_count,vc.used_count code_used_count,vc.status code_status,
              ca.* FROM voucher_codes vc JOIN voucher_campaigns ca ON ca.tenant_id=vc.tenant_id AND ca.id=vc.campaign_id
             WHERE vc.tenant_id=$1 AND vc.code_hash=$2 FOR UPDATE OF vc,ca`,
            [auth.tenantId, hash],
          )
        ).rows[0];
        if (!code) this.notFound("VOUCHER_NOT_FOUND");
        if (
          code.code_customer_id &&
          code.code_customer_id !== order.customer_id
        )
          this.conflict("BENEFIT_CUSTOMER_MISMATCH");
        const candidate = (
          await this.eligibility.forOrder(auth, orderId)
        ).vouchers.find((x: any) => x.id === code.voucher_code_id);
        if (!candidate?.eligible)
          throw new ConflictException({
            code: candidate?.reasonCodes?.[0] ?? "BENEFIT_NOT_ELIGIBLE",
            message: "Voucher is not eligible",
            details: candidate?.reasonCodes,
          });
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `voucher-customer:${auth.tenantId}:${code.campaign_id}:${order.customer_id}`,
        ]);
        const usage = (
          await c.query<any>(
            `INSERT INTO voucher_customer_usage(tenant_id,campaign_id,customer_id)
             VALUES($1,$2,$3) ON CONFLICT(tenant_id,campaign_id,customer_id)
             DO UPDATE SET updated_at=voucher_customer_usage.updated_at RETURNING *`,
            [auth.tenantId, code.campaign_id, order.customer_id],
          )
        ).rows[0];
        if (
          code.per_customer_use_limit &&
          Number(usage.active_reservations) +
            Number(usage.net_committed_uses) >=
            Number(code.per_customer_use_limit)
        )
          this.conflict("VOUCHER_USAGE_LIMIT_REACHED");
        const ttl = new Date(Date.now() + 15 * 60000).toISOString(),
          reservationId = randomUUID(),
          applicationId = randomUUID();
        const campaignUpdate = await c.query(
          `UPDATE voucher_campaigns SET reserved_count=reserved_count+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND (total_use_limit IS NULL OR reserved_count+used_count<total_use_limit)`,
          [auth.tenantId, code.campaign_id],
        );
        if (!campaignUpdate.rowCount)
          this.conflict("VOUCHER_USAGE_LIMIT_REACHED");
        const codeUpdate = await c.query(
          `UPDATE voucher_codes SET reserved_count=reserved_count+1,
             status=CASE WHEN used_count=0 THEN 'AVAILABLE' ELSE 'PARTIALLY_USED' END,
             version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2 AND reserved_count+used_count<use_limit`,
          [auth.tenantId, code.voucher_code_id],
        );
        if (!codeUpdate.rowCount) this.conflict("VOUCHER_RESERVATION_CONFLICT");
        await c.query(
          `INSERT INTO voucher_reservations(id,tenant_id,voucher_code_id,campaign_id,customer_id,branch_id,pos_order_id,discount_minor,currency,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            reservationId,
            auth.tenantId,
            code.voucher_code_id,
            code.campaign_id,
            order.customer_id,
            order.branch_id,
            order.id,
            candidate.calculatedAmountMinor,
            order.currency,
            JSON.stringify(candidate.policySnapshot),
            `voucher-reservation:${key}`,
            ttl,
          ],
        );
        await c.query(
          `INSERT INTO pos_order_benefit_applications(id,tenant_id,pos_order_id,customer_id,benefit_type,source_entity_id,reservation_id,sequence_no,amount_minor,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,'VOUCHER',$5,$6,3,$7,$8,$9,$10)`,
          [
            applicationId,
            auth.tenantId,
            order.id,
            order.customer_id,
            code.voucher_code_id,
            reservationId,
            candidate.calculatedAmountMinor,
            JSON.stringify(candidate.policySnapshot),
            `benefit-voucher:${key}`,
            ttl,
          ],
        );
        await c.query(
          "UPDATE voucher_customer_usage SET active_reservations=active_reservations+1,version=version+1,updated_at=now() WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3",
          [auth.tenantId, code.campaign_id, order.customer_id],
        );
        await this.reprice(c, auth, order.id);
        await this.evidence(
          c,
          auth,
          "voucher.reserved",
          "voucher_reservation",
          reservationId,
          requestId,
          { orderId: order.id, codeLast4: code.code_last4 },
        );
        return this.orderView(c, auth, order.id);
      },
    );
  }

  applyLoyalty(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = loyaltyApplySchema.parse(input);
    return this.orderCommand(
      auth,
      orderId,
      "benefit.loyalty.reserve",
      key,
      b,
      requestId,
      async (c, order) => {
        this.assertDraftVersion(order, b.version);
        const account = (
          await c.query<any>(
            "SELECT * FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2 FOR UPDATE",
            [auth.tenantId, order.customer_id],
          )
        ).rows[0];
        if (!account) this.notFound("LOYALTY_ACCOUNT_NOT_FOUND");
        if (BigInt(account.available_points) < 0n)
          this.conflict("LOYALTY_NEGATIVE_BALANCE");
        const program = (
          await c.query<any>(
            "SELECT * FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY effective_from DESC LIMIT 1 FOR SHARE",
            [auth.tenantId],
          )
        ).rows[0];
        if (!program) this.notFound("LOYALTY_ACCOUNT_NOT_FOUND");
        const eligibleLineTotal = BigInt(
            (
              await c.query<any>(
                "SELECT COALESCE(sum(net_minor),0) amount FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' AND line_type<>'GIFT_CARD'",
                [auth.tenantId, order.id],
              )
            ).rows[0].amount,
          ),
          priorBenefits = BigInt(
            (
              await c.query<any>(
                "SELECT COALESCE(sum(amount_minor),0) amount FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='RESERVED'",
                [auth.tenantId, order.id],
              )
            ).rows[0].amount,
          ),
          redemptionPoints = BigInt(program.redemption_points),
          redemptionMinor = BigInt(program.redemption_minor),
          serviceDue =
            eligibleLineTotal > priorBenefits
              ? eligibleLineTotal - priorBenefits
              : 0n,
          plan = loyaltyRedemptionPlan({
            requestedPoints: BigInt(b.points),
            eligibleDueMinor: serviceDue,
            redemptionPoints,
            redemptionMinor,
          }),
          { requestedPoints, acceptedPoints, unusedPoints } = plan,
          amount = plan.appliedMinor;
        if (amount <= 0n) this.conflict("LOYALTY_REDEMPTION_LIMIT");
        if (
          BigInt(account.available_points) - BigInt(account.reserved_points) <
          acceptedPoints
        )
          this.conflict("LOYALTY_INSUFFICIENT_POINTS");
        const reservationId = randomUUID(),
          applicationId = randomUUID(),
          ttl = new Date(Date.now() + 15 * 60000).toISOString(),
          policy = {
            programId: program.id,
            programVersion: program.version,
            redemptionPoints: String(program.redemption_points),
            redemptionMinor: String(program.redemption_minor),
            requestedPoints: requestedPoints.toString(),
            acceptedPoints: acceptedPoints.toString(),
            appliedMinor: amount.toString(),
            unusedPoints: unusedPoints.toString(),
          };
        await c.query(
          "UPDATE loyalty_accounts SET reserved_points=reserved_points+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, account.id, acceptedPoints.toString()],
        );
        await c.query(
          `INSERT INTO loyalty_reservations(id,tenant_id,account_id,customer_id,pos_order_id,points,requested_points,accepted_points,unused_points,amount_minor,currency,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            reservationId,
            auth.tenantId,
            account.id,
            order.customer_id,
            order.id,
            acceptedPoints.toString(),
            requestedPoints.toString(),
            acceptedPoints.toString(),
            unusedPoints.toString(),
            amount.toString(),
            order.currency,
            JSON.stringify(policy),
            `loyalty-reservation:${key}`,
            ttl,
          ],
        );
        await this.allocateLoyaltyLots(
          c,
          auth.tenantId,
          account.id,
          reservationId,
          acceptedPoints,
        );
        await c.query(
          `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,program_id,reservation_id,pos_order_id,entry_type,reserved_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'REDEEM_RESERVE',$7,$8,$9,$10)`,
          [
            auth.tenantId,
            account.id,
            order.customer_id,
            program.id,
            reservationId,
            order.id,
            acceptedPoints.toString(),
            JSON.stringify(policy),
            `loyalty-reserve:${key}`,
            auth.userId,
          ],
        );
        await c.query(
          `INSERT INTO pos_order_benefit_applications(id,tenant_id,pos_order_id,customer_id,benefit_type,source_entity_id,reservation_id,sequence_no,amount_minor,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,'LOYALTY',$5,$6,4,$7,$8,$9,$10)`,
          [
            applicationId,
            auth.tenantId,
            order.id,
            order.customer_id,
            account.id,
            reservationId,
            amount.toString(),
            JSON.stringify(policy),
            `benefit-loyalty:${key}`,
            ttl,
          ],
        );
        await this.reprice(c, auth, order.id);
        await this.evidence(
          c,
          auth,
          "loyalty.points_reserved",
          "loyalty_reservation",
          reservationId,
          requestId,
          {
            orderId: order.id,
            requestedPoints: requestedPoints.toString(),
            acceptedPoints: acceptedPoints.toString(),
            appliedMinor: amount.toString(),
            unusedPoints: unusedPoints.toString(),
          },
        );
        return this.orderView(c, auth, order.id);
      },
    );
  }

  applyMembership(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = membershipApplySchema.parse(input);
    return this.orderCommand(
      auth,
      orderId,
      "benefit.membership.apply",
      key,
      b,
      requestId,
      async (c, order) => {
        this.assertDraftVersion(order, b.version);
        const assignment = (
          await c.query<any>(
            `SELECT a.*,t.benefits_json,t.version tier_version FROM customer_membership_assignments a JOIN membership_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id WHERE a.tenant_id=$1 AND a.customer_id=$2 AND a.status='ACTIVE' AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now()) ${b.assignmentId ? "AND a.id=$3" : ""} ORDER BY t.priority DESC LIMIT 1 FOR SHARE OF a,t`,
            b.assignmentId
              ? [auth.tenantId, order.customer_id, b.assignmentId]
              : [auth.tenantId, order.customer_id],
          )
        ).rows[0];
        if (!assignment) this.conflict("MEMBERSHIP_NOT_ACTIVE");
        const benefit = (assignment.benefits_json as any[]).find(
          (x) => x.type === "PERCENT_DISCOUNT" || x.type === "FIXED_DISCOUNT",
        );
        if (!benefit) this.conflict("BENEFIT_NOT_ELIGIBLE");
        const eligible = BigInt(
          (
            await c.query<any>(
              "SELECT COALESCE(sum(gross_minor-discount_minor),0) amount FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' AND line_type<>'GIFT_CARD'",
              [auth.tenantId, order.id],
            )
          ).rows[0].amount,
        );
        const amount = fixedOrPercentDiscount({
          type: benefit.type === "PERCENT_DISCOUNT" ? "PERCENT" : "FIXED",
          value: BigInt(benefit.value),
          eligibleMinor: eligible,
        });
        const policy = {
          assignmentId: assignment.id,
          tierId: assignment.tier_id,
          tierVersion: assignment.tier_version,
          benefit,
        };
        const id = randomUUID();
        await c.query(
          `INSERT INTO pos_order_benefit_applications(id,tenant_id,pos_order_id,customer_id,benefit_type,source_entity_id,status,sequence_no,amount_minor,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,'MEMBERSHIP',$5,'RESERVED',2,$6,$7,$8)`,
          [
            id,
            auth.tenantId,
            order.id,
            order.customer_id,
            assignment.id,
            amount.toString(),
            JSON.stringify(policy),
            `benefit-membership:${key}`,
          ],
        );
        await this.reprice(c, auth, order.id);
        await this.evidence(
          c,
          auth,
          "membership.benefit_applied",
          "membership_assignment",
          assignment.id,
          requestId,
          { orderId: order.id, amountMinor: amount.toString() },
        );
        return this.orderView(c, auth, order.id);
      },
    );
  }

  applyPackage(
    auth: AccessClaims,
    orderId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = packageApplySchema.parse(input);
    return this.orderCommand(
      auth,
      orderId,
      "benefit.package.reserve",
      key,
      b,
      requestId,
      async (c, order) => {
        this.assertDraftVersion(order, b.version);
        const line = (
          await c.query<any>(
            "SELECT * FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE",
            [auth.tenantId, order.id, b.orderLineId],
          )
        ).rows[0];
        if (!line?.service_id) this.conflict("PACKAGE_SERVICE_NOT_ELIGIBLE");
        const reserved = await this.reservePackageTx(c, auth, {
          entitlementId: b.entitlementId,
          customerId: order.customer_id,
          branchId: order.branch_id,
          posOrderId: order.id,
          serviceId: line.service_id,
          units: b.units,
          expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
          generationKey: `package-pos:${key}`,
          actorUserId: auth.userId,
          orderLineId: line.id,
        });
        const amount = BigInt(line.net_minor);
        const id = randomUUID();
        await c.query(
          `INSERT INTO pos_order_benefit_applications(id,tenant_id,pos_order_id,customer_id,benefit_type,source_entity_id,reservation_id,covered_order_line_id,sequence_no,amount_minor,units,allocation_json,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,'PACKAGE',$5,$6,$7,1,$8,$9,$10,$11,$12,$13)`,
          [
            id,
            auth.tenantId,
            order.id,
            order.customer_id,
            b.entitlementId,
            reserved.id,
            line.id,
            amount.toString(),
            reserved.units,
            JSON.stringify([
              {
                orderLineId: line.id,
                amountMinor: amount.toString(),
                units: reserved.units,
              },
            ]),
            JSON.stringify(reserved.policy_snapshot_json),
            `benefit-package:${key}`,
            reserved.expires_at,
          ],
        );
        await this.reprice(c, auth, order.id);
        await this.evidence(
          c,
          auth,
          "package.reserved",
          "package_reservation",
          reserved.id,
          requestId,
          { orderId: order.id, units: reserved.units },
        );
        return this.orderView(c, auth, order.id);
      },
    );
  }

  releaseApplication(
    auth: AccessClaims,
    orderId: string,
    applicationId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitOrderCommandSchema.parse(input);
    return this.orderCommand(
      auth,
      orderId,
      "benefit.release",
      key,
      { applicationId, ...b },
      requestId,
      async (c, order) => {
        this.assertDraftVersion(order, b.version);
        const app = (
          await c.query<any>(
            "SELECT * FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND id=$3 FOR UPDATE",
            [auth.tenantId, orderId, applicationId],
          )
        ).rows[0];
        if (!app) this.notFound("BENEFIT_NOT_FOUND");
        if (app.status !== "RESERVED")
          this.conflict("BENEFIT_RESERVATION_EXPIRED");
        await this.releaseApplicationTx(c, auth, app, requestId, key);
        await this.reprice(c, auth, order.id);
        return this.orderView(c, auth, order.id);
      },
    );
  }

  createEntitlementReservation(
    auth: AccessClaims,
    entitlementId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = packageReservationSchema.parse(input);
    return this.command(
      auth,
      "package.reserve",
      key,
      { entitlementId, ...b },
      async (c) => {
        const entitlement = (
          await c.query<any>(
            "SELECT customer_id FROM customer_package_entitlements WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, entitlementId],
          )
        ).rows[0];
        if (!entitlement) this.notFound("PACKAGE_ENTITLEMENT_NOT_FOUND");
        const row = await this.reservePackageTx(c, auth, {
          entitlementId,
          customerId: entitlement.customer_id,
          ...b,
          expiresAt:
            b.expiresAt ?? new Date(Date.now() + 15 * 60000).toISOString(),
          generationKey: `package-reservation:${key}`,
          actorUserId: auth.userId,
        });
        await this.evidence(
          c,
          auth,
          "package.reserved",
          "package_reservation",
          row.id,
          requestId,
          { units: row.units },
        );
        return row;
      },
    );
  }
  createAppointmentReservation(
    auth: AccessClaims,
    appointmentId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = appointmentPackageReservationSchema.parse(input);
    return this.command(
      auth,
      "appointment.package.reserve",
      key,
      { appointmentId, ...b },
      async (c) => {
        const a = (
          await c.query<any>(
            "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, appointmentId],
          )
        ).rows[0];
        if (!a) this.notFound("APPOINTMENT_NOT_FOUND");
        if (a.version !== b.version) this.conflict("BOOKING_VERSION_CONFLICT");
        const item = (
          await c.query<any>(
            "SELECT * FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2 AND id=$3 AND status<>'CANCELLED'",
            [auth.tenantId, appointmentId, b.appointmentItemId],
          )
        ).rows[0];
        if (!item) this.conflict("PACKAGE_SERVICE_NOT_ELIGIBLE");
        const entitlement = (
          await c.query<any>(
            "SELECT customer_id FROM customer_package_entitlements WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, b.entitlementId],
          )
        ).rows[0];
        if (!entitlement || entitlement.customer_id !== a.customer_id)
          this.conflict("BENEFIT_CUSTOMER_MISMATCH");
        const row = await this.reservePackageTx(c, auth, {
          entitlementId: b.entitlementId,
          customerId: a.customer_id,
          branchId: a.branch_id,
          appointmentId: a.id,
          appointmentItemId: item.id,
          serviceId: item.service_id,
          expiresAt: this.appointmentPackageExpiry(a.end_at),
          generationKey: `appointment-package:${key}`,
          actorUserId: auth.userId,
        });
        await this.evidence(
          c,
          auth,
          "package.reserved",
          "package_reservation",
          row.id,
          requestId,
          { appointmentId, itemId: item.id },
        );
        return row;
      },
    );
  }
  releasePackage(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = benefitOrderCommandSchema.parse(input);
    return this.command(
      auth,
      "package.release",
      key,
      { id, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM package_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.notFound("PACKAGE_RESERVATION_NOT_FOUND");
        if (row.version !== b.version)
          this.conflict("BENEFIT_VERSION_CONFLICT");
        if (row.status !== "ACTIVE") return row;
        await this.releasePackageTx(c, auth, row, key);
        await this.evidence(
          c,
          auth,
          "package.released",
          "package_reservation",
          id,
          requestId,
          { units: row.units },
        );
        return (
          await c.query<any>(
            "SELECT * FROM package_reservations WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, id],
          )
        ).rows[0];
      },
    );
  }
  async packageReservation(auth: AccessClaims, id: string) {
    this.access(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM package_reservations WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("PACKAGE_RESERVATION_NOT_FOUND");
    return row;
  }

  async publicPackages(slug: string, token: string) {
    const context = await this.publicContext(slug, token);
    return (
      await this.db.query<any>(
        `SELECT e.id,p.code,p.name_json "name",e.available_units "availableUnits",e.reserved_units "reservedUnits",e.expires_at "expiresAt" FROM customer_package_entitlements e JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id WHERE e.tenant_id=$1 AND e.customer_id=$2 AND e.status='ACTIVE' ORDER BY e.expires_at`,
        [context.tenantId, context.customerId],
      )
    ).rows;
  }
  async publicReserve(
    slug: string,
    token: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = publicPackageReservationSchema.parse(input),
      context = await this.publicContext(slug, token);
    const auth = this.publicAuth(context.tenantId);
    return this.command(
      auth,
      "public.package.reserve",
      key,
      { appointmentId: context.appointmentId, ...b },
      async (c) => {
        const item = (
          await c.query<any>(
            "SELECT * FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2 AND id=$3 AND status<>'CANCELLED'",
            [context.tenantId, context.appointmentId, b.appointmentItemId],
          )
        ).rows[0];
        if (!item) this.conflict("PACKAGE_SERVICE_NOT_ELIGIBLE");
        const row = await this.reservePackageTx(c, auth, {
          entitlementId: b.entitlementId,
          customerId: context.customerId,
          branchId: context.branchId,
          appointmentId: context.appointmentId,
          appointmentItemId: item.id,
          serviceId: item.service_id,
          expiresAt: this.appointmentPackageExpiry(context.endAt),
          generationKey: `public-package:${key}`,
          actorUserId: null,
        });
        await this.evidence(
          c,
          auth,
          "package.reserved",
          "package_reservation",
          row.id,
          requestId,
          { appointmentId: context.appointmentId },
        );
        return row;
      },
    );
  }

  async revalidateOrderBenefits(c: PoolClient, auth: AccessClaims, order: any) {
    const apps = (
      await c.query<any>(
        "SELECT * FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='RESERVED' ORDER BY sequence_no FOR UPDATE",
        [auth.tenantId, order.id],
      )
    ).rows;
    for (const app of apps) {
      if (app.customer_id !== order.customer_id)
        this.conflict("BENEFIT_CUSTOMER_MISMATCH");
      if (app.reservation_id) {
        const table =
          app.benefit_type === "VOUCHER"
            ? "voucher_reservations"
            : app.benefit_type === "LOYALTY"
              ? "loyalty_reservations"
              : "package_reservations";
        const reservation = (
          await c.query<any>(
            `SELECT status,expires_at${app.benefit_type === "PACKAGE" ? ",appointment_id" : ""} FROM ${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
            [auth.tenantId, app.reservation_id],
          )
        ).rows[0];
        let expired =
          !reservation || new Date(reservation.expires_at) <= new Date();
        if (
          expired &&
          app.benefit_type === "PACKAGE" &&
          reservation?.appointment_id
        ) {
          const appointment = (
            await c.query<any>(
              "SELECT status FROM appointments WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, reservation.appointment_id],
            )
          ).rows[0];
          if (
            appointment &&
            [
              "CHECKED_IN",
              "IN_SERVICE",
              "PARTIALLY_COMPLETED",
              "COMPLETED",
            ].includes(appointment.status)
          )
            expired = false;
        }
        if (!reservation || reservation.status !== "ACTIVE" || expired)
          this.conflict("BENEFIT_RESERVATION_EXPIRED");
      }
    }
    await this.reprice(c, auth, order.id);
  }
  async commitOrderBenefits(
    c: PoolClient,
    auth: AccessClaims,
    order: any,
    invoiceId: string | null,
    requestId: string,
  ) {
    const apps = (
      await c.query<any>(
        "SELECT * FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='RESERVED' ORDER BY sequence_no FOR UPDATE",
        [auth.tenantId, order.id],
      )
    ).rows;
    await this.createSettlementAllocations(
      c,
      auth.tenantId,
      order.id,
      invoiceId,
      apps,
    );
    for (const app of apps) {
      if (app.benefit_type === "VOUCHER")
        await this.commitVoucher(c, auth, app, requestId);
      else if (app.benefit_type === "LOYALTY")
        await this.commitLoyalty(c, auth, app, requestId);
      else if (app.benefit_type === "PACKAGE")
        await this.commitPackage(c, auth, app, requestId);
      await c.query(
        "UPDATE pos_order_benefit_applications SET status='COMMITTED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, app.id],
      );
    }
    await this.earnLoyalty(c, auth, order, invoiceId, requestId);
    if (order.customer_id) {
      await this.recomputeMembershipMetrics(
        c,
        auth.tenantId,
        order.customer_id,
      );
      await c.query(
        `INSERT INTO benefit_jobs(tenant_id,job_type,aggregate_id,generation_key,run_at,payload_json)
         VALUES($1,'MEMBERSHIP_EVALUATION',$2,$3,now(),$4)
         ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
        [
          auth.tenantId,
          order.customer_id,
          `membership-evaluate:order:${order.id}`,
          JSON.stringify({ customerId: order.customer_id, orderId: order.id }),
        ],
      );
    }
  }
  async releaseOrderBenefits(
    c: PoolClient,
    auth: AccessClaims,
    orderId: string,
    requestId: string,
    key: string,
  ) {
    const apps = (
      await c.query<any>(
        "SELECT * FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='RESERVED' FOR UPDATE",
        [auth.tenantId, orderId],
      )
    ).rows;
    for (const app of apps)
      await this.releaseApplicationTx(c, auth, app, requestId, key);
  }
  async reverseRefundBenefits(
    c: PoolClient,
    auth: AccessClaims,
    refund: any,
    requestId: string,
  ) {
    const credit = (
      await c.query<any>(
        "SELECT id FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2",
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    const allocations = (
      await c.query<any>(
        `SELECT ba.*,a.benefit_type,a.source_entity_id,a.reservation_id,a.amount_minor application_amount_minor,
          a.policy_snapshot_json,ri.id refund_item_id,ri.total_refund_minor,il.net_minor line_total_minor
         FROM benefit_application_allocations ba
         JOIN pos_order_benefit_applications a ON a.tenant_id=ba.tenant_id AND a.id=ba.benefit_application_id
         JOIN refund_items ri ON ri.tenant_id=ba.tenant_id AND ri.refund_id=$2 AND ri.invoice_line_id=ba.invoice_line_id
         JOIN invoice_lines il ON il.tenant_id=ba.tenant_id AND il.id=ba.invoice_line_id
         WHERE ba.tenant_id=$1 AND ba.pos_order_id=$3 AND a.status='COMMITTED'
         ORDER BY a.sequence_no,ba.created_at FOR UPDATE OF a`,
        [auth.tenantId, refund.id, refund.pos_order_id],
      )
    ).rows;
    if (!allocations.length && BigInt(refund.service_refund_minor ?? 0) > 0n) {
      const committed = await c.query(
        "SELECT 1 FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='COMMITTED' LIMIT 1",
        [auth.tenantId, refund.pos_order_id],
      );
      if (committed.rowCount) this.conflict("BENEFIT_ALLOCATION_MISSING");
    }
    for (const allocation of allocations) {
      await this.reverseBenefitAllocation(
        c,
        auth,
        refund,
        credit?.id ?? null,
        allocation,
      );
    }
    await this.reverseLoyaltyEarn(c, auth, refund, credit?.id ?? null);
    if (refund.customer_id) {
      await this.recomputeMembershipMetrics(
        c,
        auth.tenantId,
        refund.customer_id,
      );
      await c.query(
        `INSERT INTO benefit_jobs(tenant_id,job_type,aggregate_id,generation_key,run_at,payload_json)
         VALUES($1,'MEMBERSHIP_EVALUATION',$2,$3,now(),$4)
         ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
        [
          auth.tenantId,
          refund.customer_id,
          `membership-evaluate:refund:${refund.id}`,
          JSON.stringify({
            customerId: refund.customer_id,
            refundId: refund.id,
          }),
        ],
      );
    }
    await this.evidence(
      c,
      auth,
      "benefits.refund_reversed",
      "refund",
      refund.id,
      requestId,
      { allocations: allocations.length },
    );
  }

  private async reverseBenefitAllocation(
    c: PoolClient,
    auth: AccessClaims,
    refund: any,
    creditNoteId: string | null,
    allocation: any,
  ) {
    const prior = (
      await c.query<any>(
        `SELECT COALESCE(sum(refunded_line_minor),0) refunded,
          COALESCE(sum(reversed_benefit_minor),0) benefit,
          COALESCE(sum(restored_points),0) points,
          COALESCE(sum(restored_units),0) units,
          COALESCE(sum(restored_use),0) restored_use
         FROM benefit_refund_allocations
         WHERE tenant_id=$1 AND application_allocation_id=$2`,
        [auth.tenantId, allocation.id],
      )
    ).rows[0];
    const lineTotal = BigInt(allocation.line_total_minor),
      priorRefunded = BigInt(prior.refunded),
      remainingLine =
        lineTotal > priorRefunded ? lineTotal - priorRefunded : 0n,
      currentRefund =
        BigInt(allocation.total_refund_minor) < remainingLine
          ? BigInt(allocation.total_refund_minor)
          : remainingLine,
      cumulativeRefund = priorRefunded + currentRefund,
      desiredBenefit =
        lineTotal > 0n
          ? (BigInt(allocation.allocated_amount_minor) * cumulativeRefund) /
            lineTotal
          : 0n,
      reversedBenefit =
        desiredBenefit > BigInt(prior.benefit)
          ? desiredBenefit - BigInt(prior.benefit)
          : 0n,
      desiredPoints =
        lineTotal > 0n
          ? (BigInt(allocation.allocated_points) * cumulativeRefund) / lineTotal
          : 0n,
      restoredPoints =
        desiredPoints > BigInt(prior.points)
          ? desiredPoints - BigInt(prior.points)
          : 0n;
    let restoredUnits = 0;
    let restoredUseMicros = 0n;
    let outcome: "REVERSED" | "NO_ACTION" | "MANUAL_REVIEW" =
      reversedBenefit > 0n || restoredPoints > 0n ? "REVERSED" : "NO_ACTION";
    const generation = `benefit-refund:${refund.id}:${allocation.id}`;

    if (allocation.benefit_type === "LOYALTY" && restoredPoints > 0n) {
      const reservation = (
        await c.query<any>(
          "SELECT * FROM loyalty_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, allocation.reservation_id],
        )
      ).rows[0];
      const entry = (
        await c.query<any>(
          `INSERT INTO loyalty_ledger_entries(
             tenant_id,account_id,customer_id,reservation_id,pos_order_id,refund_id,credit_note_id,
             entry_type,available_delta,policy_snapshot_json,generation_key)
           VALUES($1,$2,$3,$4,$5,$6,$7,'REFUND_REVERSAL',$8,$9,$10)
           ON CONFLICT(tenant_id,generation_key) DO NOTHING RETURNING id`,
          [
            auth.tenantId,
            reservation.account_id,
            reservation.customer_id,
            reservation.id,
            refund.pos_order_id,
            refund.id,
            creditNoteId,
            restoredPoints.toString(),
            JSON.stringify({
              ...allocation.policy_snapshot_json,
              applicationAllocationId: allocation.id,
            }),
            generation,
          ],
        )
      ).rows[0];
      if (entry) {
        await c.query(
          "UPDATE loyalty_accounts SET available_points=available_points+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, reservation.account_id, restoredPoints.toString()],
        );
        await c.query(
          `INSERT INTO loyalty_point_lots(tenant_id,account_id,source_ledger_entry_id,original_points,available_points)
           VALUES($1,$2,$3,$4,$4)`,
          [
            auth.tenantId,
            reservation.account_id,
            entry.id,
            restoredPoints.toString(),
          ],
        );
      }
    } else if (allocation.benefit_type === "PACKAGE") {
      const policy =
        allocation.policy_snapshot_json?.refundPolicy ?? "RESTORE_UNIT";
      if (currentRefund > 0n && cumulativeRefund < lineTotal) {
        outcome = "MANUAL_REVIEW";
        await c.query(
          `INSERT INTO benefit_reversal_conflicts(tenant_id,refund_id,benefit_type,source_entity_id,conflict_code,context_json)
           VALUES($1,$2,'PACKAGE',$3,'BENEFIT_REVERSAL_CONFLICT',$4) ON CONFLICT DO NOTHING`,
          [
            auth.tenantId,
            refund.id,
            allocation.source_entity_id,
            JSON.stringify({
              applicationId: allocation.benefit_application_id,
              allocationId: allocation.id,
              policy,
              reason: "PARTIAL_PACKAGE_LINE_REFUND",
            }),
          ],
        );
      } else if (
        cumulativeRefund >= lineTotal &&
        policy === "RESTORE_UNIT" &&
        Number(prior.units) < Number(allocation.allocated_units)
      ) {
        restoredUnits =
          Number(allocation.allocated_units) - Number(prior.units);
        const reservation = (
          await c.query<any>(
            "SELECT * FROM package_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, allocation.reservation_id],
          )
        ).rows[0];
        const inserted = await c.query(
          `INSERT INTO package_ledger_entries(
             tenant_id,entitlement_id,customer_id,reservation_id,pos_order_id,refund_id,credit_note_id,
             entry_type,available_delta,consumed_delta,policy_snapshot_json,generation_key)
           VALUES($1,$2,$3,$4,$5,$6,$7,'REFUND_REVERSAL',$8,$9,$10,$11)
           ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
          [
            auth.tenantId,
            reservation.entitlement_id,
            reservation.customer_id,
            reservation.id,
            refund.pos_order_id,
            refund.id,
            creditNoteId,
            restoredUnits,
            -restoredUnits,
            JSON.stringify({
              ...allocation.policy_snapshot_json,
              applicationAllocationId: allocation.id,
            }),
            generation,
          ],
        );
        if (inserted.rowCount)
          await c.query(
            "UPDATE customer_package_entitlements SET available_units=available_units+$3,consumed_units=consumed_units-$3,status='ACTIVE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, reservation.entitlement_id, restoredUnits],
          );
        outcome = "REVERSED";
      } else if (policy === "MANUAL_REVIEW") outcome = "MANUAL_REVIEW";
    } else if (allocation.benefit_type === "VOUCHER") {
      const policy =
        allocation.policy_snapshot_json?.refundPolicy ?? "DO_NOT_RESTORE";
      const applicationPrior = (
        await c.query<any>(
          `SELECT COALESCE(sum(r.restored_use),0) restored_use,
             COALESCE(sum(r.reversed_benefit_minor),0) reversed_minor
           FROM benefit_refund_allocations r
           WHERE r.tenant_id=$1 AND r.benefit_application_id=$2`,
          [auth.tenantId, allocation.benefit_application_id],
        )
      ).rows[0];
      const appAmount = BigInt(allocation.application_amount_minor);
      if (policy === "PROPORTIONAL_RESTORE" && appAmount > 0n)
        restoredUseMicros = (reversedBenefit * 1_000_000n) / appAmount;
      else if (
        policy === "RESTORE_USE" &&
        BigInt(applicationPrior.reversed_minor) + reversedBenefit >= appAmount
      )
        restoredUseMicros =
          1_000_000n -
          BigInt(Math.round(Number(applicationPrior.restored_use) * 1_000_000));
      if (restoredUseMicros > 0n) {
        const reservation = (
          await c.query<any>(
            "SELECT * FROM voucher_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, allocation.reservation_id],
          )
        ).rows[0];
        const use = `${restoredUseMicros / 1_000_000n}.${String(
          restoredUseMicros % 1_000_000n,
        ).padStart(6, "0")}`;
        const inserted = await c.query(
          `INSERT INTO voucher_redemption_entries(
             tenant_id,voucher_code_id,reservation_id,customer_id,pos_order_id,refund_id,credit_note_id,
             entry_type,use_delta,discount_minor,policy_snapshot_json,generation_key)
           VALUES($1,$2,$3,$4,$5,$6,$7,'REVERSAL',-$8::numeric,$9,$10,$11)
           ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
          [
            auth.tenantId,
            reservation.voucher_code_id,
            reservation.id,
            reservation.customer_id,
            refund.pos_order_id,
            refund.id,
            creditNoteId,
            use,
            reversedBenefit.toString(),
            JSON.stringify({
              ...allocation.policy_snapshot_json,
              applicationAllocationId: allocation.id,
            }),
            generation,
          ],
        );
        if (inserted.rowCount) {
          await c.query(
            `UPDATE voucher_customer_usage SET net_committed_uses=GREATEST(net_committed_uses-$4::numeric,0),
               version=version+1,updated_at=now()
             WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3`,
            [
              auth.tenantId,
              reservation.campaign_id,
              reservation.customer_id,
              use,
            ],
          );
          if (Number(applicationPrior.restored_use) + Number(use) >= 0.999999) {
            await c.query(
              "UPDATE voucher_codes SET used_count=GREATEST(used_count-1,0),status=CASE WHEN used_count-1<=0 THEN 'AVAILABLE' ELSE 'PARTIALLY_USED' END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, reservation.voucher_code_id],
            );
            await c.query(
              "UPDATE voucher_campaigns SET used_count=GREATEST(used_count-1,0),updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, reservation.campaign_id],
            );
          }
        }
        outcome = "REVERSED";
      }
    }

    const use = `${restoredUseMicros / 1_000_000n}.${String(
      restoredUseMicros % 1_000_000n,
    ).padStart(6, "0")}`;
    await c.query(
      `INSERT INTO benefit_refund_allocations(
         tenant_id,refund_id,refund_item_id,benefit_application_id,application_allocation_id,
         refunded_line_minor,reversed_benefit_minor,restored_points,restored_units,restored_use,outcome,policy_snapshot_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(tenant_id,refund_id,application_allocation_id) DO NOTHING`,
      [
        auth.tenantId,
        refund.id,
        allocation.refund_item_id,
        allocation.benefit_application_id,
        allocation.id,
        currentRefund.toString(),
        reversedBenefit.toString(),
        restoredPoints.toString(),
        restoredUnits,
        use,
        outcome,
        JSON.stringify(allocation.policy_snapshot_json),
      ],
    );
  }

  private async reservePackageTx(
    c: PoolClient,
    auth: AccessClaims,
    input: any,
  ) {
    const entitlement = (
      await c.query<any>(
        `SELECT e.*,p.version product_version,p.refund_policy FROM customer_package_entitlements e JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e`,
        [auth.tenantId, input.entitlementId],
      )
    ).rows[0];
    if (!entitlement) this.notFound("PACKAGE_ENTITLEMENT_NOT_FOUND");
    if (entitlement.customer_id !== input.customerId)
      this.conflict("BENEFIT_CUSTOMER_MISMATCH");
    if (
      entitlement.status !== "ACTIVE" ||
      new Date(entitlement.expires_at) <= new Date()
    )
      this.conflict("PACKAGE_ENTITLEMENT_EXPIRED");
    const eligible = (
      await c.query<any>(
        `SELECT i.units_per_redemption FROM service_package_eligibility_items i LEFT JOIN services s ON s.tenant_id=i.tenant_id AND s.id=$4 WHERE i.tenant_id=$1 AND i.package_product_id=$2 AND (i.branch_id IS NULL OR i.branch_id=$3) AND (i.service_id=$4 OR i.category_id=s.category_id) ORDER BY i.service_id NULLS LAST LIMIT 1`,
        [
          auth.tenantId,
          entitlement.package_product_id,
          input.branchId,
          input.serviceId,
        ],
      )
    ).rows[0];
    if (!eligible) this.conflict("PACKAGE_SERVICE_NOT_ELIGIBLE");
    const requiredUnits = Number(eligible.units_per_redemption);
    if (input.units != null && Number(input.units) !== requiredUnits)
      this.conflict("PACKAGE_UNITS_MISMATCH");
    if (Number(entitlement.available_units) < requiredUnits)
      this.conflict("PACKAGE_INSUFFICIENT_BALANCE");
    const id = randomUUID(),
      policy = {
        productId: entitlement.package_product_id,
        productVersion: entitlement.product_version,
        refundPolicy: entitlement.refund_policy,
        unitsPerRedemption: eligible.units_per_redemption,
      };
    try {
      const row = (
        await c.query<any>(
          `INSERT INTO package_reservations(id,tenant_id,entitlement_id,customer_id,branch_id,appointment_id,appointment_item_id,pos_order_id,service_id,units,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            id,
            auth.tenantId,
            input.entitlementId,
            input.customerId,
            input.branchId,
            input.appointmentId ?? null,
            input.appointmentItemId ?? null,
            input.posOrderId ?? null,
            input.serviceId,
            requiredUnits,
            JSON.stringify(policy),
            input.generationKey,
            input.expiresAt,
          ],
        )
      ).rows[0];
      await c.query(
        "UPDATE customer_package_entitlements SET available_units=available_units-$3,reserved_units=reserved_units+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, input.entitlementId, requiredUnits],
      );
      await c.query(
        `INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,reservation_id,pos_order_id,appointment_id,entry_type,available_delta,reserved_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'RESERVE',$7,$8,$9,$10,$11)`,
        [
          auth.tenantId,
          input.entitlementId,
          input.customerId,
          id,
          input.posOrderId ?? null,
          input.appointmentId ?? null,
          -requiredUnits,
          requiredUnits,
          JSON.stringify(policy),
          `${input.generationKey}:ledger`,
          input.actorUserId,
        ],
      );
      return row;
    } catch (error: any) {
      if (error?.code === "23505")
        this.conflict("PACKAGE_RESERVATION_CONFLICT");
      throw error;
    }
  }

  private async createSettlementAllocations(
    c: PoolClient,
    tenantId: string,
    orderId: string,
    invoiceId: string | null,
    applications: any[],
  ) {
    if (!invoiceId && applications.length)
      this.conflict("BENEFIT_ALLOCATION_MISSING");
    if (!invoiceId) return;
    const lines = (
      await c.query<any>(
        `SELECT il.id invoice_line_id,il.source_order_line_id order_line_id,il.net_minor
         FROM invoice_lines il WHERE il.tenant_id=$1 AND il.invoice_id=$2
         ORDER BY il.line_no,il.id`,
        [tenantId, invoiceId],
      )
    ).rows;
    for (const application of applications) {
      const covered =
        application.benefit_type === "PACKAGE"
          ? lines.filter(
              (line: any) =>
                line.order_line_id === application.covered_order_line_id,
            )
          : lines.filter((line: any) => BigInt(line.net_minor) > 0n);
      if (!covered.length) this.conflict("BENEFIT_ALLOCATION_MISSING");
      const totalWeight = covered.reduce(
        (sum: bigint, line: any) => sum + BigInt(line.net_minor),
        0n,
      );
      let remainingAmount = BigInt(application.amount_minor);
      let remainingPoints =
        application.benefit_type === "LOYALTY"
          ? BigInt(
              (
                await c.query<any>(
                  "SELECT points FROM loyalty_reservations WHERE tenant_id=$1 AND id=$2",
                  [tenantId, application.reservation_id],
                )
              ).rows[0]?.points ?? 0,
            )
          : 0n;
      for (const [index, line] of covered.entries()) {
        const last = index === covered.length - 1;
        const amount = last
          ? remainingAmount
          : totalWeight > 0n
            ? (BigInt(application.amount_minor) * BigInt(line.net_minor)) /
              totalWeight
            : 0n;
        const points = last
          ? remainingPoints
          : BigInt(application.amount_minor) > 0n
            ? (remainingPoints * amount) / remainingAmount
            : 0n;
        await c.query(
          `INSERT INTO benefit_application_allocations(
             tenant_id,benefit_application_id,pos_order_id,order_line_id,invoice_line_id,
             allocated_amount_minor,allocated_points,allocated_units)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(tenant_id,benefit_application_id,order_line_id) DO NOTHING`,
          [
            tenantId,
            application.id,
            orderId,
            line.order_line_id,
            line.invoice_line_id,
            amount.toString(),
            points.toString(),
            application.benefit_type === "PACKAGE" ? application.units : 0,
          ],
        );
        remainingAmount -= amount;
        remainingPoints -= points;
      }
    }
  }

  private async recomputeMembershipMetrics(
    c: PoolClient,
    tenantId: string,
    customerId: string,
  ) {
    const windowDays = Number(
      (
        await c.query<any>(
          `SELECT COALESCE(max(rolling_window_days),365) days FROM membership_tiers
           WHERE tenant_id=$1 AND status='ACTIVE' AND rolling_window_days IS NOT NULL`,
          [tenantId],
        )
      ).rows[0].days,
    );
    const rolling = (
        await c.query<any>(
          "SELECT * FROM sprint8_membership_metrics($1,$2,now(),$3)",
          [tenantId, customerId, windowDays],
        )
      ).rows[0],
      lifetime = (
        await c.query<any>(
          "SELECT * FROM sprint8_membership_metrics($1,$2,now(),NULL)",
          [tenantId, customerId],
        )
      ).rows[0];
    const lifetimePoints = (
      await c.query<any>(
        "SELECT COALESCE(lifetime_earned_points,0)::bigint lifetime_earned_points FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2",
        [tenantId, customerId],
      )
    ).rows[0]?.lifetime_earned_points ?? 0;
    await c.query(
      `INSERT INTO customer_membership_metrics(
         tenant_id,customer_id,rolling_spend_minor,lifetime_spend_minor,visit_count,points_earned,window_started_at,last_evaluated_at)
       VALUES($1,$2,$3,$4,$5,$6,now()-make_interval(days=>$7),now())
       ON CONFLICT(tenant_id,customer_id) DO UPDATE SET
         rolling_spend_minor=EXCLUDED.rolling_spend_minor,
         lifetime_spend_minor=EXCLUDED.lifetime_spend_minor,
         visit_count=EXCLUDED.visit_count,points_earned=EXCLUDED.points_earned,window_started_at=EXCLUDED.window_started_at,
         last_evaluated_at=now(),version=customer_membership_metrics.version+1`,
      [
        tenantId,
        customerId,
        rolling.spend_minor,
        lifetime.spend_minor,
        rolling.visit_count,
        lifetimePoints,
        windowDays,
      ],
    );
  }

  private appointmentPackageExpiry(endAt: string) {
    return new Date(
      new Date(endAt).getTime() + 2 * 60 * 60 * 1000,
    ).toISOString();
  }

  private async allocateLoyaltyLots(
    c: PoolClient,
    tenantId: string,
    accountId: string,
    reservationId: string,
    points: bigint,
  ) {
    let remaining = points;
    const lots = (
      await c.query<any>(
        `SELECT * FROM loyalty_point_lots
         WHERE tenant_id=$1 AND account_id=$2 AND available_points>0
           AND (expires_at IS NULL OR expires_at>now())
         ORDER BY expires_at NULLS LAST,created_at,id FOR UPDATE`,
        [tenantId, accountId],
      )
    ).rows;
    for (const lot of lots) {
      if (remaining === 0n) break;
      const available = BigInt(lot.available_points);
      const used = available < remaining ? available : remaining;
      await c.query(
        `UPDATE loyalty_point_lots
         SET available_points=available_points-$3,reserved_points=reserved_points+$3,
             status=CASE WHEN available_points-$3=0 THEN 'RESERVED' ELSE 'AVAILABLE' END,updated_at=now()
         WHERE tenant_id=$1 AND id=$2`,
        [tenantId, lot.id, used.toString()],
      );
      await c.query(
        `INSERT INTO loyalty_redemption_lot_allocations(tenant_id,reservation_id,lot_id,points,status)
         VALUES($1,$2,$3,$4,'RESERVED')`,
        [tenantId, reservationId, lot.id, used.toString()],
      );
      remaining -= used;
    }
    if (remaining > 0n) this.conflict("LOYALTY_INSUFFICIENT_POINTS");
  }

  private async releaseLoyaltyLots(
    c: PoolClient,
    tenantId: string,
    reservationId: string,
  ) {
    const allocations = (
      await c.query<any>(
        `SELECT a.*,l.expires_at FROM loyalty_redemption_lot_allocations a
         JOIN loyalty_point_lots l ON l.tenant_id=a.tenant_id AND l.id=a.lot_id
         WHERE a.tenant_id=$1 AND a.reservation_id=$2 AND a.status='RESERVED'
         ORDER BY a.created_at,a.id FOR UPDATE OF a,l`,
        [tenantId, reservationId],
      )
    ).rows;
    let expired = 0n;
    for (const allocation of allocations) {
      const points = BigInt(allocation.points);
      const valid =
        !allocation.expires_at || new Date(allocation.expires_at) > new Date();
      await c.query(
        `UPDATE loyalty_point_lots
         SET reserved_points=reserved_points-$3,
             available_points=available_points+CASE WHEN $4 THEN $3 ELSE 0 END,
             status=CASE WHEN $4 THEN 'AVAILABLE' WHEN reserved_points-$3=0 THEN 'EXPIRED' ELSE 'RESERVED' END,
             updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenantId, allocation.lot_id, points.toString(), valid],
      );
      await c.query(
        `UPDATE loyalty_redemption_lot_allocations
         SET status=CASE WHEN $3 THEN 'RELEASED' ELSE 'EXPIRED' END,released_at=now()
         WHERE tenant_id=$1 AND id=$2`,
        [tenantId, allocation.id, valid],
      );
      if (!valid) expired += points;
    }
    return expired;
  }
  private async releasePackageTx(
    c: PoolClient,
    auth: AccessClaims,
    row: any,
    key: string,
  ) {
    await c.query(
      "UPDATE customer_package_entitlements SET available_units=available_units+$3,reserved_units=reserved_units-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.entitlement_id, row.units],
    );
    await c.query(
      "UPDATE package_reservations SET status='RELEASED',released_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.id],
    );
    await c.query(
      `INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,reservation_id,pos_order_id,appointment_id,entry_type,available_delta,reserved_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'RELEASE',$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
      [
        auth.tenantId,
        row.entitlement_id,
        row.customer_id,
        row.id,
        row.pos_order_id,
        row.appointment_id,
        row.units,
        -row.units,
        JSON.stringify(row.policy_snapshot_json),
        `package-release:${row.id}:${key}`,
        auth.userId || null,
      ],
    );
  }
  private async releaseApplicationTx(
    c: PoolClient,
    auth: AccessClaims,
    app: any,
    requestId: string,
    key: string,
  ) {
    if (app.benefit_type === "VOUCHER") {
      const row = (
        await c.query<any>(
          "SELECT * FROM voucher_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, app.reservation_id],
        )
      ).rows[0];
      if (row?.status === "ACTIVE") {
        await c.query(
          "UPDATE voucher_reservations SET status='RELEASED',released_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.id],
        );
        await c.query(
          "UPDATE voucher_codes SET reserved_count=reserved_count-1,status=CASE WHEN used_count=0 THEN 'AVAILABLE' ELSE 'PARTIALLY_USED' END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.voucher_code_id],
        );
        await c.query(
          "UPDATE voucher_campaigns SET reserved_count=reserved_count-1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.campaign_id],
        );
        await c.query(
          "UPDATE voucher_customer_usage SET active_reservations=GREATEST(active_reservations-1,0),version=version+1,updated_at=now() WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3",
          [auth.tenantId, row.campaign_id, row.customer_id],
        );
      }
    } else if (app.benefit_type === "LOYALTY") {
      const row = (
        await c.query<any>(
          "SELECT * FROM loyalty_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, app.reservation_id],
        )
      ).rows[0];
      if (row?.status === "ACTIVE") {
        const expiredPoints = await this.releaseLoyaltyLots(
          c,
          auth.tenantId,
          row.id,
        );
        await c.query(
          "UPDATE loyalty_reservations SET status='RELEASED',released_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.id],
        );
        await c.query(
          "UPDATE loyalty_accounts SET reserved_points=reserved_points-$3,available_points=available_points-$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.account_id, row.points, expiredPoints.toString()],
        );
        await c.query(
          `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,reservation_id,pos_order_id,entry_type,reserved_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,$5,'REDEEM_RELEASE',$6,$7,$8,$9) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
          [
            auth.tenantId,
            row.account_id,
            row.customer_id,
            row.id,
            row.pos_order_id,
            -Number(row.points),
            JSON.stringify(row.policy_snapshot_json),
            `loyalty-release:${row.id}:${key}`,
            auth.userId,
          ],
        );
      }
    } else if (app.benefit_type === "PACKAGE") {
      const row = (
        await c.query<any>(
          "SELECT * FROM package_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, app.reservation_id],
        )
      ).rows[0];
      if (row?.status === "ACTIVE")
        await this.releasePackageTx(c, auth, row, key);
    }
    await c.query(
      "UPDATE pos_order_benefit_applications SET status='RELEASED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, app.id],
    );
    await this.evidence(
      c,
      auth,
      "benefits.released",
      "benefit_application",
      app.id,
      requestId,
      { benefitType: app.benefit_type },
    );
  }
  private async commitVoucher(
    c: PoolClient,
    auth: AccessClaims,
    app: any,
    requestId: string,
  ) {
    const row = (
      await c.query<any>(
        "SELECT * FROM voucher_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, app.reservation_id],
      )
    ).rows[0];
    if (!row || row.status !== "ACTIVE")
      this.conflict("BENEFIT_RESERVATION_EXPIRED");
    await c.query(
      "UPDATE voucher_reservations SET status='COMMITTED',committed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.id],
    );
    await c.query(
      "UPDATE voucher_codes SET reserved_count=reserved_count-1,used_count=used_count+1,status=CASE WHEN used_count+1>=use_limit THEN 'USED' ELSE 'PARTIALLY_USED' END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.voucher_code_id],
    );
    await c.query(
      "UPDATE voucher_campaigns SET reserved_count=reserved_count-1,used_count=used_count+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.campaign_id],
    );
    await c.query(
      `UPDATE voucher_customer_usage
       SET active_reservations=GREATEST(active_reservations-1,0),net_committed_uses=net_committed_uses+1,
           version=version+1,updated_at=now()
       WHERE tenant_id=$1 AND campaign_id=$2 AND customer_id=$3`,
      [auth.tenantId, row.campaign_id, row.customer_id],
    );
    await c.query(
      `INSERT INTO voucher_redemption_entries(tenant_id,voucher_code_id,reservation_id,customer_id,pos_order_id,entry_type,use_delta,discount_minor,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,'COMMIT',1,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [
        auth.tenantId,
        row.voucher_code_id,
        row.id,
        row.customer_id,
        row.pos_order_id,
        row.discount_minor,
        JSON.stringify(row.policy_snapshot_json),
        `voucher-commit:${row.id}`,
      ],
    );
    await this.evidence(
      c,
      auth,
      "voucher.redeemed",
      "voucher_reservation",
      row.id,
      requestId,
      { orderId: row.pos_order_id },
    );
  }
  private async commitLoyalty(
    c: PoolClient,
    auth: AccessClaims,
    app: any,
    requestId: string,
  ) {
    const row = (
      await c.query<any>(
        "SELECT * FROM loyalty_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, app.reservation_id],
      )
    ).rows[0];
    if (!row || row.status !== "ACTIVE")
      this.conflict("BENEFIT_RESERVATION_EXPIRED");
    const allocations = (
      await c.query<any>(
        `SELECT a.*,l.reserved_points FROM loyalty_redemption_lot_allocations a
         JOIN loyalty_point_lots l ON l.tenant_id=a.tenant_id AND l.id=a.lot_id
         WHERE a.tenant_id=$1 AND a.reservation_id=$2 AND a.status='RESERVED'
         ORDER BY a.created_at,a.id FOR UPDATE OF a,l`,
        [auth.tenantId, row.id],
      )
    ).rows;
    if (
      allocations.reduce(
        (sum: bigint, allocation: any) => sum + BigInt(allocation.points),
        0n,
      ) !== BigInt(row.points)
    )
      this.conflict("LOYALTY_INSUFFICIENT_POINTS");
    for (const allocation of allocations) {
      await c.query(
        `UPDATE loyalty_point_lots SET reserved_points=reserved_points-$3,
          status=CASE WHEN available_points=0 AND reserved_points-$3=0 THEN 'EXHAUSTED' ELSE 'AVAILABLE' END,updated_at=now()
         WHERE tenant_id=$1 AND id=$2`,
        [auth.tenantId, allocation.lot_id, allocation.points],
      );
      await c.query(
        "UPDATE loyalty_redemption_lot_allocations SET status='COMMITTED',consumed_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, allocation.id],
      );
    }
    await c.query(
      "UPDATE loyalty_reservations SET status='COMMITTED',committed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.id],
    );
    await c.query(
      "UPDATE loyalty_accounts SET available_points=available_points-$3,reserved_points=reserved_points-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.account_id, row.points],
    );
    await c.query(
      `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,reservation_id,pos_order_id,entry_type,available_delta,reserved_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,$5,'REDEEM_COMMIT',$6,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [
        auth.tenantId,
        row.account_id,
        row.customer_id,
        row.id,
        row.pos_order_id,
        -Number(row.points),
        JSON.stringify(row.policy_snapshot_json),
        `loyalty-commit:${row.id}`,
        auth.userId,
      ],
    );
    await this.evidence(
      c,
      auth,
      "loyalty.points_redeemed",
      "loyalty_reservation",
      row.id,
      requestId,
      { points: row.points },
    );
  }
  private async commitPackage(
    c: PoolClient,
    auth: AccessClaims,
    app: any,
    requestId: string,
  ) {
    const row = (
      await c.query<any>(
        "SELECT * FROM package_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, app.reservation_id],
      )
    ).rows[0];
    if (!row || row.status !== "ACTIVE")
      this.conflict("BENEFIT_RESERVATION_EXPIRED");
    await c.query(
      "UPDATE package_reservations SET status='COMMITTED',committed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.id],
    );
    await c.query(
      "UPDATE customer_package_entitlements SET reserved_units=reserved_units-$3,consumed_units=consumed_units+$3,status=CASE WHEN available_units=0 AND reserved_units-$3=0 THEN 'EXHAUSTED' ELSE status END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, row.entitlement_id, row.units],
    );
    await c.query(
      `INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,reservation_id,pos_order_id,appointment_id,entry_type,reserved_delta,consumed_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'COMMIT',$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
      [
        auth.tenantId,
        row.entitlement_id,
        row.customer_id,
        row.id,
        row.pos_order_id,
        row.appointment_id,
        -Number(row.units),
        row.units,
        JSON.stringify(row.policy_snapshot_json),
        `package-commit:${row.id}`,
        auth.userId,
      ],
    );
    await this.evidence(
      c,
      auth,
      "package.redeemed",
      "package_reservation",
      row.id,
      requestId,
      { units: row.units },
    );
  }
  private async earnLoyalty(
    c: PoolClient,
    auth: AccessClaims,
    order: any,
    invoiceId: string | null,
    requestId: string,
  ) {
    if (!order.customer_id) return;
    const program = (
      await c.query<any>(
        "SELECT * FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=COALESCE($2::timestamptz,now()) AND (effective_to IS NULL OR effective_to>COALESCE($2::timestamptz,now())) ORDER BY effective_from DESC LIMIT 1",
        [auth.tenantId, order.paid_at],
      )
    ).rows[0];
    if (!program) return;
    const account = (
      await c.query<any>(
        "INSERT INTO loyalty_accounts(tenant_id,customer_id) VALUES($1,$2) ON CONFLICT(tenant_id,customer_id) DO UPDATE SET updated_at=loyalty_accounts.updated_at RETURNING *",
        [auth.tenantId, order.customer_id],
      )
    ).rows[0];
    const earnBase = BigInt(
      (
        await c.query<any>(
          `SELECT GREATEST(0,
      COALESCE((SELECT sum(net_minor) FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' AND line_type<>'GIFT_CARD'),0)
      -COALESCE((SELECT sum(amount_minor) FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='COMMITTED'),0)) amount`,
          [auth.tenantId, order.id],
        )
      ).rows[0].amount,
    );
    let points = loyaltyEarnPoints(
      earnBase,
      BigInt(program.spend_minor_per_point),
    );
    const membership = (
      await c.query<any>(
        "SELECT benefit_snapshot_json FROM customer_membership_assignments WHERE tenant_id=$1 AND customer_id=$2 AND status='ACTIVE' ORDER BY effective_from DESC LIMIT 1",
        [auth.tenantId, order.customer_id],
      )
    ).rows[0];
    const multiplier =
      (membership?.benefit_snapshot_json as any[] | undefined)?.find(
        (x) => x.type === "LOYALTY_MULTIPLIER",
      )?.value ?? 10000;
    points = (points * BigInt(multiplier)) / 10000n;
    if (points <= 0n) return;
    const generation = `loyalty-earn:${order.id}`;
    const inserted = await c.query(
      `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,program_id,pos_order_id,invoice_id,entry_type,pending_delta,lifetime_delta,expires_at,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$6,'EARN_PENDING',$7,$7,$8,$9,$10) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
      [
        auth.tenantId,
        account.id,
        order.customer_id,
        program.id,
        order.id,
        invoiceId,
        points.toString(),
        program.points_valid_days
          ? new Date(
              Date.now() + program.points_valid_days * 86400000,
            ).toISOString()
          : null,
        JSON.stringify({
          programId: program.id,
          programVersion: program.version,
          earnBasis: program.earn_basis,
          spendMinorPerPoint: String(program.spend_minor_per_point),
          multiplierBasisPoints: multiplier,
        }),
        generation,
      ],
    );
    if (inserted.rowCount) {
      await c.query(
        "UPDATE loyalty_accounts SET pending_points=pending_points+$3,lifetime_earned_points=lifetime_earned_points+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, account.id, points.toString()],
      );
      await c.query(
        `INSERT INTO benefit_jobs(tenant_id,job_type,aggregate_id,generation_key,run_at,payload_json) VALUES($1,'LOYALTY_SETTLEMENT',$2,$3,now()+($4||' hours')::interval,$5) ON CONFLICT DO NOTHING`,
        [
          auth.tenantId,
          order.id,
          `loyalty-settle:${order.id}`,
          program.settlement_delay_hours,
          JSON.stringify({
            orderId: order.id,
            accountId: account.id,
            points: points.toString(),
            earnGeneration: generation,
          }),
        ],
      );
      await this.evidence(
        c,
        auth,
        "loyalty.points_pending",
        "loyalty_account",
        account.id,
        requestId,
        { points: points.toString(), orderId: order.id },
      );
    }
  }
  private async reverseLoyaltyEarn(
    c: PoolClient,
    auth: AccessClaims,
    refund: any,
    creditNoteId: string | null,
  ) {
    const entries = (
      await c.query<any>(
        "SELECT * FROM loyalty_ledger_entries WHERE tenant_id=$1 AND pos_order_id=$2 AND entry_type='EARN_PENDING' ORDER BY created_at",
        [auth.tenantId, refund.pos_order_id],
      )
    ).rows;
    const basis = (
      await c.query<any>(
        `SELECT i.total_minor,
          COALESCE((SELECT sum(r.service_refund_minor+r.tax_refund_minor) FROM refunds r
            WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED'),0) refunded_minor
         FROM invoices i WHERE i.tenant_id=$1 AND i.id=$2`,
        [auth.tenantId, refund.invoice_id],
      )
    ).rows[0];
    if (!basis || BigInt(basis.total_minor) <= 0n) return;
    for (const entry of entries) {
      const original = BigInt(entry.pending_delta),
        cappedRefund =
          BigInt(basis.refunded_minor) < BigInt(basis.total_minor)
            ? BigInt(basis.refunded_minor)
            : BigInt(basis.total_minor),
        desired = (original * cappedRefund) / BigInt(basis.total_minor),
        prior = BigInt(
          (
            await c.query<any>(
              `SELECT COALESCE(-sum(lifetime_delta),0) points FROM loyalty_ledger_entries
               WHERE tenant_id=$1 AND entry_type='REFUND_REVERSAL'
                 AND policy_snapshot_json->>'sourceEarnLedgerEntryId'=$2`,
              [auth.tenantId, entry.id],
            )
          ).rows[0].points,
        ),
        delta = desired > prior ? desired - prior : 0n;
      if (delta === 0n) continue;
      const settled = Boolean(
          (
            await c.query(
              "SELECT 1 FROM loyalty_ledger_entries WHERE tenant_id=$1 AND pos_order_id=$2 AND entry_type='EARN_AVAILABLE' LIMIT 1",
              [auth.tenantId, refund.pos_order_id],
            )
          ).rowCount,
        ),
        pending = settled ? 0n : -delta,
        available = settled ? -delta : 0n,
        generation = `loyalty-earn-refund:${refund.id}:${entry.id}`;
      const inserted = await c.query(
        `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,program_id,pos_order_id,invoice_id,refund_id,credit_note_id,entry_type,pending_delta,available_delta,lifetime_delta,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'REFUND_REVERSAL',$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
        [
          auth.tenantId,
          entry.account_id,
          entry.customer_id,
          entry.program_id,
          entry.pos_order_id,
          entry.invoice_id,
          refund.id,
          creditNoteId,
          pending.toString(),
          available.toString(),
          (-delta).toString(),
          JSON.stringify({
            ...entry.policy_snapshot_json,
            sourceEarnLedgerEntryId: entry.id,
            originalEarnPoints: original.toString(),
            cumulativeEligibleRefundMinor: cappedRefund.toString(),
            originalEligibleMinor: String(basis.total_minor),
          }),
          generation,
        ],
      );
      if (inserted.rowCount) {
        if (settled) {
          let remaining = delta;
          const lots = (
            await c.query<any>(
              `SELECT * FROM loyalty_point_lots
               WHERE tenant_id=$1 AND account_id=$2 AND available_points>0
               ORDER BY expires_at NULLS LAST,created_at,id FOR UPDATE`,
              [auth.tenantId, entry.account_id],
            )
          ).rows;
          for (const lot of lots) {
            if (remaining === 0n) break;
            const availablePoints = BigInt(lot.available_points),
              consumed =
                availablePoints < remaining ? availablePoints : remaining;
            await c.query(
              `UPDATE loyalty_point_lots SET available_points=available_points-$3,
                 status=CASE WHEN available_points-$3=0 AND reserved_points=0 THEN 'EXHAUSTED' WHEN available_points-$3=0 THEN 'RESERVED' ELSE 'AVAILABLE' END,
                 updated_at=now() WHERE tenant_id=$1 AND id=$2`,
              [auth.tenantId, lot.id, consumed.toString()],
            );
            remaining -= consumed;
          }
        }
        await c.query(
          "UPDATE loyalty_accounts SET pending_points=pending_points+$3,available_points=available_points+$4,lifetime_earned_points=GREATEST(lifetime_earned_points+$5,0),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [
            auth.tenantId,
            entry.account_id,
            pending.toString(),
            available.toString(),
            (-delta).toString(),
          ],
        );
      }
    }
  }
  private async reprice(c: PoolClient, auth: AccessClaims, orderId: string) {
    const order = (
        await c.query<any>(
          "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, orderId],
        )
      ).rows[0],
      base = (
        await c.query<any>(
          `SELECT COALESCE(sum(gross_minor),0) subtotal,COALESCE(sum(discount_minor),0) manual_discount,COALESCE(sum(taxable_minor),0) taxable,COALESCE(sum(tax_minor),0) tax,COALESCE(sum(net_minor),0) total FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE'`,
          [auth.tenantId, orderId],
        )
      ).rows[0],
      apps = (
        await c.query<any>(
          "SELECT benefit_type,amount_minor FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='RESERVED'",
          [auth.tenantId, orderId],
        )
      ).rows;
    const amount = (type: string) =>
        apps
          .filter((x: any) => x.benefit_type === type)
          .reduce((s: bigint, x: any) => s + BigInt(x.amount_minor), 0n),
      packageAmount = amount("PACKAGE"),
      membership = amount("MEMBERSHIP"),
      voucher = amount("VOUCHER"),
      loyalty = amount("LOYALTY"),
      pre = packageAmount + membership + voucher,
      baseTaxable = BigInt(base.taxable),
      baseTax = BigInt(base.tax),
      taxReduction =
        baseTaxable > 0n
          ? (baseTax * (pre > baseTaxable ? baseTaxable : pre)) / baseTaxable
          : 0n,
      totalBefore = BigInt(base.total),
      afterPre =
        totalBefore > pre + taxReduction
          ? totalBefore - pre - taxReduction
          : 0n,
      total = afterPre > loyalty ? afterPre - loyalty : 0n,
      paid = BigInt(order.amount_paid_minor),
      due = total + BigInt(order.tip_minor) - paid;
    if (due < 0n) this.conflict("BENEFIT_AMOUNT_EXCEEDS_ELIGIBLE");
    const snapshot = {
      applicationOrder: ["PACKAGE", "MEMBERSHIP", "VOUCHER", "LOYALTY"],
      packageCoverageMinor: packageAmount.toString(),
      membershipDiscountMinor: membership.toString(),
      voucherDiscountMinor: voucher.toString(),
      loyaltySettlementMinor: loyalty.toString(),
      taxReductionMinor: taxReduction.toString(),
    };
    await c.query(
      "UPDATE pos_orders SET subtotal_minor=$3,discount_minor=$4,taxable_minor=$5,tax_minor=$6,total_minor=$7,amount_due_minor=$8,pricing_snapshot_json=pricing_snapshot_json||$9::jsonb,version=version+1,updated_by_user_id=$10,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [
        auth.tenantId,
        orderId,
        base.subtotal,
        (BigInt(base.manual_discount) + membership + voucher).toString(),
        (baseTaxable > (pre > baseTaxable ? baseTaxable : pre)
          ? baseTaxable - (pre > baseTaxable ? baseTaxable : pre)
          : 0n
        ).toString(),
        (baseTax - taxReduction).toString(),
        total.toString(),
        due.toString(),
        JSON.stringify({ benefits: snapshot }),
        auth.userId,
      ],
    );
  }
  private orderCommand<T>(
    auth: AccessClaims,
    orderId: string,
    name: string,
    key: string,
    request: unknown,
    requestId: string,
    work: (c: PoolClient, order: any) => Promise<T>,
  ) {
    return this.command(
      auth,
      name,
      key,
      { orderId, ...(request as any) },
      async (c) => {
        const order = (
          await c.query<any>(
            "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, orderId],
          )
        ).rows[0];
        if (!order) this.notFound("POS_ORDER_NOT_FOUND");
        this.branch(auth, order.branch_id);
        if (!order.customer_id) this.conflict("BENEFIT_CUSTOMER_MISMATCH");
        return work(c, order);
      },
    );
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
  private async order(auth: AccessClaims, id: string) {
    const row = (
      await this.db.query<any>(
        "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("POS_ORDER_NOT_FOUND");
    this.branch(auth, row.branch_id);
    return row;
  }
  private async appointment(auth: AccessClaims, id: string) {
    const row = (
      await this.db.query<any>(
        "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.notFound("APPOINTMENT_NOT_FOUND");
    this.branch(auth, row.branch_id);
    if (
      auth.roles.includes("NAIL_TECHNICIAN") &&
      !auth.roles.some((r) => ["SALON_OWNER", "BRANCH_MANAGER"].includes(r))
    ) {
      const own = await this.db.query(
        "SELECT 1 FROM appointment_items ai JOIN appointment_item_staff_assignments a ON a.tenant_id=ai.tenant_id AND a.appointment_item_id=ai.id WHERE ai.tenant_id=$1 AND ai.appointment_id=$2 AND a.staff_id=$3 AND a.status='ACTIVE' LIMIT 1",
        [auth.tenantId, id, auth.ownStaffId ?? null],
      );
      if (!own.rowCount)
        throw new ForbiddenException({
          code: "PERMISSION_DENIED",
          message: "Technician can only view own appointment package coverage",
        });
    }
    return row;
  }
  private async orderView(c: PoolClient, auth: AccessClaims, id: string) {
    const row = (
      await c.query<any>(
        `SELECT id,order_number "orderNumber",status,subtotal_minor "subtotalMinor",discount_minor "discountMinor",taxable_minor "taxableMinor",tax_minor "taxMinor",total_minor "totalMinor",tip_minor "tipMinor",amount_paid_minor "amountPaidMinor",amount_due_minor "amountDueMinor",pricing_snapshot_json "pricingSnapshot",version FROM pos_orders WHERE tenant_id=$1 AND id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    return {
      ...row,
      subtotalMinor: Number(row.subtotalMinor),
      discountMinor: Number(row.discountMinor),
      taxableMinor: Number(row.taxableMinor),
      taxMinor: Number(row.taxMinor),
      totalMinor: Number(row.totalMinor),
      tipMinor: Number(row.tipMinor),
      amountPaidMinor: Number(row.amountPaidMinor),
      amountDueMinor: Number(row.amountDueMinor),
      version: Number(row.version),
    };
  }
  private assertDraftVersion(order: any, version: number) {
    if (order.version !== version) this.conflict("BENEFIT_VERSION_CONFLICT");
    if (order.status !== "DRAFT") this.conflict("BENEFIT_ORDER_NOT_DRAFT");
    if (order.pricing_locked_at) this.conflict("BENEFIT_PRICING_LOCKED");
  }
  private async publicContext(slug: string, token: string) {
    const claims = await this.tokens.verifyManagement(token),
      tenant = (
        await this.db.query<any>("SELECT id FROM tenants WHERE slug=$1", [slug])
      ).rows[0];
    if (!tenant || tenant.id !== claims.tenantId)
      throw new ForbiddenException({
        code: "BOOKING_ACCESS_TOKEN_INVALID",
        message: "Customer capability is not valid for this salon",
      });
    const appointment = (
      await this.db.query<any>(
        "SELECT id,tenant_id,branch_id,customer_id,end_at,booking_reference,contact_verification_version FROM appointments WHERE tenant_id=$1 AND id=$2",
        [claims.tenantId, claims.appointmentId],
      )
    ).rows[0];
    if (
      !appointment ||
      appointment.booking_reference.toUpperCase() !== claims.bookingReference ||
      appointment.contact_verification_version !==
        claims.contactVerificationVersion ||
      !appointment.customer_id
    )
      throw new ForbiddenException({
        code: "BOOKING_ACCESS_TOKEN_INVALID",
        message: "Customer capability is stale",
      });
    return {
      tenantId: claims.tenantId,
      appointmentId: appointment.id,
      customerId: appointment.customer_id,
      branchId: appointment.branch_id,
      endAt: appointment.end_at,
    };
  }
  private publicAuth(tenantId: string): AccessClaims {
    return {
      tenantId,
      userId: "00000000-0000-0000-0000-000000000000",
      membershipId: "00000000-0000-0000-0000-000000000000",
      authorizationVersion: 1,
      sessionId: "public-benefit",
      roles: ["CUSTOMER"],
      branchIds: [],
    };
  }
  private branch(auth: AccessClaims, id: string) {
    if (
      !auth.roles.includes("SALON_OWNER") &&
      !auth.roles.includes("CUSTOMER") &&
      !auth.branchIds.includes(id)
    )
      throw new ForbiddenException({
        code: "BRANCH_ACCESS_DENIED",
        message: "Branch is outside membership scope",
      });
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
        auth.userId === "00000000-0000-0000-0000-000000000000"
          ? null
          : auth.userId,
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
        JSON.stringify({
          type: auth.roles.includes("CUSTOMER") ? "CUSTOMER" : "USER",
          id: auth.roles.includes("CUSTOMER") ? null : auth.userId,
        }),
        JSON.stringify({ schemaVersion: 1, pii: false }),
      ],
    );
  }
}
