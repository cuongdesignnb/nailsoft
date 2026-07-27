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
  loyaltyRedemptionMinor,
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
        `SELECT id,benefit_type "benefitType",source_entity_id "sourceEntityId",reservation_id "reservationId",status,sequence_no "sequenceNo",amount_minor "amountMinor",units,allocation_json "allocation",policy_snapshot_json "policySnapshot",expires_at "expiresAt",version FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 ORDER BY sequence_no`,
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
      currency: "VND",
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
            `SELECT vc.*,ca.* FROM voucher_codes vc JOIN voucher_campaigns ca ON ca.tenant_id=vc.tenant_id AND ca.id=vc.campaign_id WHERE vc.tenant_id=$1 AND vc.code_hash=$2 FOR UPDATE OF vc,ca`,
            [auth.tenantId, hash],
          )
        ).rows[0];
        if (!code) this.notFound("VOUCHER_NOT_FOUND");
        if (code.customer_id && code.customer_id !== order.customer_id)
          this.conflict("BENEFIT_CUSTOMER_MISMATCH");
        const candidate = (
          await this.eligibility.forOrder(auth, orderId)
        ).vouchers.find((x: any) => x.id === code.id);
        if (!candidate?.eligible)
          throw new ConflictException({
            code: candidate?.reasonCodes?.[0] ?? "BENEFIT_NOT_ELIGIBLE",
            message: "Voucher is not eligible",
            details: candidate?.reasonCodes,
          });
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
          `UPDATE voucher_codes SET reserved_count=reserved_count+1,status='RESERVED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND reserved_count+used_count<use_limit`,
          [auth.tenantId, code.id],
        );
        if (!codeUpdate.rowCount) this.conflict("VOUCHER_RESERVATION_CONFLICT");
        await c.query(
          `INSERT INTO voucher_reservations(id,tenant_id,voucher_code_id,campaign_id,customer_id,branch_id,pos_order_id,discount_minor,currency,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            reservationId,
            auth.tenantId,
            code.id,
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
            code.id,
            reservationId,
            candidate.calculatedAmountMinor,
            JSON.stringify(candidate.policySnapshot),
            `benefit-voucher:${key}`,
            ttl,
          ],
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
        if (
          BigInt(account.available_points) - BigInt(account.reserved_points) <
          BigInt(b.points)
        )
          this.conflict("LOYALTY_INSUFFICIENT_POINTS");
        const program = (
          await c.query<any>(
            "SELECT * FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) ORDER BY effective_from DESC LIMIT 1 FOR SHARE",
            [auth.tenantId],
          )
        ).rows[0];
        if (!program) this.notFound("LOYALTY_ACCOUNT_NOT_FOUND");
        let amount = loyaltyRedemptionMinor(
          BigInt(b.points),
          BigInt(program.redemption_points),
          BigInt(program.redemption_minor),
        );
        const currentDue =
          BigInt(order.total_minor) +
          BigInt(order.tip_minor) -
          BigInt(order.amount_paid_minor);
        if (amount > currentDue) amount = currentDue;
        if (amount <= 0n) this.conflict("LOYALTY_REDEMPTION_LIMIT");
        const reservationId = randomUUID(),
          applicationId = randomUUID(),
          ttl = new Date(Date.now() + 15 * 60000).toISOString(),
          policy = {
            programId: program.id,
            programVersion: program.version,
            redemptionPoints: String(program.redemption_points),
            redemptionMinor: String(program.redemption_minor),
          };
        await c.query(
          "UPDATE loyalty_accounts SET reserved_points=reserved_points+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, account.id, b.points],
        );
        await c.query(
          `INSERT INTO loyalty_reservations(id,tenant_id,account_id,customer_id,pos_order_id,points,amount_minor,currency,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            reservationId,
            auth.tenantId,
            account.id,
            order.customer_id,
            order.id,
            b.points,
            amount.toString(),
            order.currency,
            JSON.stringify(policy),
            `loyalty-reservation:${key}`,
            ttl,
          ],
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
            b.points,
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
          { orderId: order.id, points: b.points },
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
        const eligible =
          BigInt(order.subtotal_minor) - BigInt(order.discount_minor);
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
          `INSERT INTO pos_order_benefit_applications(id,tenant_id,pos_order_id,customer_id,benefit_type,source_entity_id,reservation_id,sequence_no,amount_minor,units,allocation_json,policy_snapshot_json,generation_key,expires_at) VALUES($1,$2,$3,$4,'PACKAGE',$5,$6,1,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            auth.tenantId,
            order.id,
            order.customer_id,
            b.entitlementId,
            reserved.id,
            amount.toString(),
            b.units,
            JSON.stringify([
              {
                orderLineId: line.id,
                amountMinor: amount.toString(),
                units: b.units,
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
          { orderId: order.id, units: b.units },
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
          { units: b.units },
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
          units: 1,
          expiresAt: a.end_at,
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
          units: 1,
          expiresAt: context.endAt,
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
      if (app.expires_at && new Date(app.expires_at) <= new Date())
        this.conflict("BENEFIT_RESERVATION_EXPIRED");
      if (app.reservation_id) {
        const table =
          app.benefit_type === "VOUCHER"
            ? "voucher_reservations"
            : app.benefit_type === "LOYALTY"
              ? "loyalty_reservations"
              : "package_reservations";
        const reservation = (
          await c.query<any>(
            `SELECT status,expires_at FROM ${table} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
            [auth.tenantId, app.reservation_id],
          )
        ).rows[0];
        if (
          !reservation ||
          reservation.status !== "ACTIVE" ||
          new Date(reservation.expires_at) <= new Date()
        )
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
    await c.query(
      `INSERT INTO customer_membership_metrics(tenant_id,customer_id,rolling_spend_minor,lifetime_spend_minor,visit_count,last_evaluated_at) VALUES($1,$2,$3,$3,1,now()) ON CONFLICT(tenant_id,customer_id) DO UPDATE SET rolling_spend_minor=customer_membership_metrics.rolling_spend_minor+$3,lifetime_spend_minor=customer_membership_metrics.lifetime_spend_minor+$3,visit_count=customer_membership_metrics.visit_count+1,version=customer_membership_metrics.version+1,last_evaluated_at=now()`,
      [auth.tenantId, order.customer_id, BigInt(order.total_minor).toString()],
    );
    await c.query(
      `INSERT INTO benefit_jobs(tenant_id,job_type,aggregate_id,generation_key,run_at,payload_json) VALUES($1,'MEMBERSHIP_EVALUATION',$2,$3,now(),$4) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
      [
        auth.tenantId,
        order.customer_id,
        `membership-evaluate:order:${order.id}`,
        JSON.stringify({ customerId: order.customer_id, orderId: order.id }),
      ],
    );
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
    const invoice = (
      await c.query<any>(
        "SELECT total_minor FROM invoices WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, refund.invoice_id],
      )
    ).rows[0];
    const full =
      invoice && BigInt(refund.completed_minor) >= BigInt(invoice.total_minor);
    const apps = (
      await c.query<any>(
        "SELECT * FROM pos_order_benefit_applications WHERE tenant_id=$1 AND pos_order_id=$2 AND status='COMMITTED' FOR UPDATE",
        [auth.tenantId, refund.pos_order_id],
      )
    ).rows;
    for (const app of apps) {
      const generation = `benefit-refund:${refund.id}:${app.id}`;
      if (app.benefit_type === "VOUCHER") {
        const policy =
          app.policy_snapshot_json?.refundPolicy ?? "DO_NOT_RESTORE";
        if (
          (policy === "RESTORE_USE" && full) ||
          policy === "PROPORTIONAL_RESTORE"
        ) {
          const reservation = (
            await c.query<any>(
              "SELECT * FROM voucher_reservations WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, app.reservation_id],
            )
          ).rows[0];
          const inserted = await c.query(
            `INSERT INTO voucher_redemption_entries(tenant_id,voucher_code_id,reservation_id,customer_id,pos_order_id,refund_id,credit_note_id,entry_type,use_delta,discount_minor,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,'REVERSAL',-1,$8,$9,$10) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
            [
              auth.tenantId,
              reservation.voucher_code_id,
              reservation.id,
              app.customer_id,
              refund.pos_order_id,
              refund.id,
              credit?.id ?? null,
              app.amount_minor,
              JSON.stringify(app.policy_snapshot_json),
              generation,
            ],
          );
          if (inserted.rowCount) {
            await c.query(
              "UPDATE voucher_codes SET used_count=GREATEST(used_count-1,0),status='AVAILABLE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, reservation.voucher_code_id],
            );
            await c.query(
              "UPDATE voucher_campaigns SET used_count=GREATEST(used_count-1,0),updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, reservation.campaign_id],
            );
          }
        }
      } else if (app.benefit_type === "LOYALTY") {
        const reservation = (
          await c.query<any>(
            "SELECT * FROM loyalty_reservations WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, app.reservation_id],
          )
        ).rows[0];
        if (full && reservation) {
          const inserted = await c.query(
            `INSERT INTO loyalty_ledger_entries(tenant_id,account_id,customer_id,reservation_id,pos_order_id,refund_id,credit_note_id,entry_type,available_delta,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,'REFUND_REVERSAL',$8,$9,$10) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
            [
              auth.tenantId,
              reservation.account_id,
              app.customer_id,
              reservation.id,
              refund.pos_order_id,
              refund.id,
              credit?.id ?? null,
              reservation.points,
              JSON.stringify(app.policy_snapshot_json),
              generation,
            ],
          );
          if (inserted.rowCount)
            await c.query(
              "UPDATE loyalty_accounts SET available_points=available_points+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, reservation.account_id, reservation.points],
            );
        }
      } else if (app.benefit_type === "PACKAGE") {
        const reservation = (
            await c.query<any>(
              "SELECT * FROM package_reservations WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, app.reservation_id],
            )
          ).rows[0],
          policy = app.policy_snapshot_json?.refundPolicy ?? "RESTORE_UNIT";
        if (full && policy === "RESTORE_UNIT" && reservation) {
          const inserted = await c.query(
            `INSERT INTO package_ledger_entries(tenant_id,entitlement_id,customer_id,reservation_id,pos_order_id,refund_id,credit_note_id,entry_type,available_delta,consumed_delta,policy_snapshot_json,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,'REFUND_REVERSAL',$8,$9,$10,$11) ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
            [
              auth.tenantId,
              reservation.entitlement_id,
              app.customer_id,
              reservation.id,
              refund.pos_order_id,
              refund.id,
              credit?.id ?? null,
              reservation.units,
              -reservation.units,
              JSON.stringify(app.policy_snapshot_json),
              generation,
            ],
          );
          if (inserted.rowCount)
            await c.query(
              "UPDATE customer_package_entitlements SET available_units=available_units+$3,consumed_units=consumed_units-$3,status='ACTIVE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, reservation.entitlement_id, reservation.units],
            );
        } else if (!full || policy === "MANUAL_REVIEW")
          await c.query(
            `INSERT INTO benefit_reversal_conflicts(tenant_id,refund_id,benefit_type,source_entity_id,conflict_code,context_json) VALUES($1,$2,'PACKAGE',$3,'BENEFIT_REVERSAL_CONFLICT',$4) ON CONFLICT DO NOTHING`,
            [
              auth.tenantId,
              refund.id,
              app.source_entity_id,
              JSON.stringify({ applicationId: app.id, policy }),
            ],
          );
      }
    }
    await this.reverseLoyaltyEarn(c, auth, refund, credit?.id ?? null, full);
    await this.evidence(
      c,
      auth,
      "benefits.refund_reversed",
      "refund",
      refund.id,
      requestId,
      { applications: apps.length, full },
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
    if (Number(entitlement.available_units) < input.units)
      this.conflict("PACKAGE_INSUFFICIENT_BALANCE");
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
            input.units,
            JSON.stringify(policy),
            input.generationKey,
            input.expiresAt,
          ],
        )
      ).rows[0];
      await c.query(
        "UPDATE customer_package_entitlements SET available_units=available_units-$3,reserved_units=reserved_units+$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, input.entitlementId, input.units],
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
          -input.units,
          input.units,
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
      }
    } else if (app.benefit_type === "LOYALTY") {
      const row = (
        await c.query<any>(
          "SELECT * FROM loyalty_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [auth.tenantId, app.reservation_id],
        )
      ).rows[0];
      if (row?.status === "ACTIVE") {
        await c.query(
          "UPDATE loyalty_reservations SET status='RELEASED',released_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.id],
        );
        await c.query(
          "UPDATE loyalty_accounts SET reserved_points=reserved_points-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, row.account_id, row.points],
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
    let remaining = BigInt(row.points);
    const lots = (
      await c.query<any>(
        "SELECT * FROM loyalty_point_lots WHERE tenant_id=$1 AND account_id=$2 AND status='AVAILABLE' AND available_points>0 ORDER BY expires_at NULLS LAST,created_at,id FOR UPDATE",
        [auth.tenantId, row.account_id],
      )
    ).rows;
    for (const lot of lots) {
      if (remaining === 0n) break;
      const available = BigInt(lot.available_points),
        used = available < remaining ? available : remaining;
      await c.query(
        "UPDATE loyalty_point_lots SET available_points=available_points-$3,status=CASE WHEN available_points-$3=0 THEN 'EXHAUSTED' ELSE status END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, lot.id, used.toString()],
      );
      await c.query(
        "INSERT INTO loyalty_redemption_lot_allocations(tenant_id,reservation_id,lot_id,points) VALUES($1,$2,$3,$4)",
        [auth.tenantId, row.id, lot.id, used.toString()],
      );
      remaining -= used;
    }
    if (remaining > 0n) this.conflict("LOYALTY_INSUFFICIENT_POINTS");
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
    let points = loyaltyEarnPoints(
      BigInt(order.total_minor),
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
    full: boolean,
  ) {
    if (!full) return;
    const entries = (
      await c.query<any>(
        "SELECT * FROM loyalty_ledger_entries WHERE tenant_id=$1 AND pos_order_id=$2 AND entry_type IN('EARN_PENDING','EARN_AVAILABLE') ORDER BY created_at",
        [auth.tenantId, refund.pos_order_id],
      )
    ).rows;
    for (const entry of entries) {
      const generation = `loyalty-earn-refund:${refund.id}:${entry.id}`,
        pending = -BigInt(entry.pending_delta),
        available = -BigInt(entry.available_delta),
        lifetime = -(BigInt(entry.lifetime_delta) > 0n
          ? BigInt(entry.lifetime_delta)
          : 0n);
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
          lifetime.toString(),
          JSON.stringify(entry.policy_snapshot_json),
          generation,
        ],
      );
      if (inserted.rowCount)
        await c.query(
          "UPDATE loyalty_accounts SET pending_points=pending_points+$3,available_points=available_points+$4,lifetime_earned_points=GREATEST(lifetime_earned_points+$5,0),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [
            auth.tenantId,
            entry.account_id,
            pending.toString(),
            available.toString(),
            lifetime.toString(),
          ],
        );
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
