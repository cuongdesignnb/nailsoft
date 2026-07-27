/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import {
  BENEFIT_APPLICATION_ORDER,
  fixedOrPercentDiscount,
  loyaltyRedemptionMinor,
} from "./benefit-domain.js";

export interface EligibilityInput {
  tenantId: string;
  branchId: string;
  customerId: string;
  context: "BOOKING" | "POS" | "REFUND";
  appointmentId?: string;
  posOrderId?: string;
  serviceItems: Array<{
    serviceId: string;
    amountMinor: bigint;
    orderLineId?: string;
    appointmentItemId?: string;
  }>;
  localDateTime: string;
  currency: string;
}

@Injectable()
export class BenefitsEligibilityService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async forOrder(auth: AccessClaims, orderId: string) {
    const order = (
      await this.db.query<any>(
        `SELECT o.*,b.timezone FROM pos_orders o JOIN branches b ON b.tenant_id=o.tenant_id AND b.id=o.branch_id
       WHERE o.tenant_id=$1 AND o.id=$2`,
        [auth.tenantId, orderId],
      )
    ).rows[0];
    if (!order)
      throw new NotFoundException({
        code: "POS_ORDER_NOT_FOUND",
        message: "POS order not found",
      });
    if (!order.customer_id)
      throw new ConflictException({
        code: "BENEFIT_CUSTOMER_MISMATCH",
        message: "A customer is required for benefits",
      });
    const lines = (
      await this.db.query<any>(
        "SELECT id,service_id,gross_minor-discount_minor amount_minor FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' ORDER BY line_no",
        [auth.tenantId, orderId],
      )
    ).rows;
    return this.evaluate({
      tenantId: auth.tenantId,
      branchId: order.branch_id,
      customerId: order.customer_id,
      context: "POS",
      posOrderId: order.id,
      serviceItems: lines
        .filter((x: any) => x.service_id)
        .map((x: any) => ({
          serviceId: x.service_id,
          amountMinor: BigInt(x.amount_minor),
          orderLineId: x.id,
        })),
      localDateTime: new Date().toISOString(),
      currency: order.currency,
    });
  }

  async forAppointment(auth: AccessClaims, appointmentId: string) {
    const appointment = (
      await this.db.query<any>(
        "SELECT * FROM appointments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, appointmentId],
      )
    ).rows[0];
    if (!appointment)
      throw new NotFoundException({
        code: "APPOINTMENT_NOT_FOUND",
        message: "Appointment not found",
      });
    if (!appointment.customer_id)
      throw new ConflictException({
        code: "BENEFIT_CUSTOMER_MISMATCH",
        message: "A customer is required for benefits",
      });
    const items = (
      await this.db.query<any>(
        "SELECT id,service_id,COALESCE((price_snapshot_json->>'amountMinor')::bigint,0) amount_minor FROM appointment_items WHERE tenant_id=$1 AND appointment_id=$2 AND status<>'CANCELLED' ORDER BY sequence_no",
        [auth.tenantId, appointmentId],
      )
    ).rows;
    const currency = String(
      appointment.pricing_summary_json?.currency ?? "VND",
    );
    return this.evaluate({
      tenantId: auth.tenantId,
      branchId: appointment.branch_id,
      customerId: appointment.customer_id,
      context: "BOOKING",
      appointmentId,
      serviceItems: items.map((x: any) => ({
        serviceId: x.service_id,
        amountMinor: BigInt(x.amount_minor),
        appointmentItemId: x.id,
      })),
      localDateTime: appointment.start_at,
      currency,
    });
  }

  async evaluate(input: EligibilityInput) {
    const now = new Date(input.localDateTime);
    if (Number.isNaN(now.getTime()))
      throw new ConflictException({
        code: "BENEFIT_NOT_ELIGIBLE",
        message: "Invalid eligibility time",
      });
    const eligibleMinor = input.serviceItems.reduce(
      (sum, item) => sum + item.amountMinor,
      0n,
    );
    const serviceIds = input.serviceItems.map((item) => item.serviceId);
    const membership =
      (
        await this.db.query<any>(
          `SELECT a.id,a.tier_id,t.code,t.name_json,a.benefit_snapshot_json,a.effective_to
       FROM customer_membership_assignments a JOIN membership_tiers t ON t.tenant_id=a.tenant_id AND t.id=a.tier_id
       WHERE a.tenant_id=$1 AND a.customer_id=$2 AND a.status='ACTIVE' AND a.effective_from<=$3 AND (a.effective_to IS NULL OR a.effective_to>$3)
       ORDER BY t.priority DESC,a.effective_from DESC LIMIT 1`,
          [input.tenantId, input.customerId, input.localDateTime],
        )
      ).rows[0] ?? null;
    const codes = (
      await this.db.query<any>(
        `SELECT vc.id,vc.code_last4,vc.status code_status,vc.expires_at code_expires,c.*,
        NOT EXISTS(SELECT 1 FROM voucher_campaign_branches x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id) OR EXISTS(SELECT 1 FROM voucher_campaign_branches x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND x.branch_id=$3) branch_ok,
        NOT EXISTS(SELECT 1 FROM voucher_campaign_services x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id) OR EXISTS(SELECT 1 FROM voucher_campaign_services x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND x.service_id=ANY($4::uuid[])) service_ok,
        NOT EXISTS(SELECT 1 FROM voucher_campaign_customers x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id) OR EXISTS(SELECT 1 FROM voucher_campaign_customers x WHERE x.tenant_id=c.tenant_id AND x.campaign_id=c.id AND x.customer_id=$2) customer_ok,
        (SELECT count(*) FROM voucher_redemption_entries e WHERE e.tenant_id=c.tenant_id AND e.customer_id=$2 AND e.entry_type='COMMIT' AND e.voucher_code_id=vc.id) customer_uses
       FROM voucher_codes vc JOIN voucher_campaigns c ON c.tenant_id=vc.tenant_id AND c.id=vc.campaign_id
       WHERE vc.tenant_id=$1 AND (vc.customer_id IS NULL OR vc.customer_id=$2) AND c.status='ACTIVE' AND c.valid_from<=$5 AND c.valid_until>$5
       ORDER BY c.valid_until,vc.created_at`,
        [
          input.tenantId,
          input.customerId,
          input.branchId,
          serviceIds,
          input.localDateTime,
        ],
      )
    ).rows;
    const vouchers = codes.map((row: any) => {
      const reasons: string[] = [];
      if (!["AVAILABLE", "PARTIALLY_USED"].includes(row.code_status))
        reasons.push("VOUCHER_ALREADY_USED");
      if (row.code_expires && new Date(row.code_expires) <= now)
        reasons.push("VOUCHER_EXPIRED");
      if (!row.branch_ok) reasons.push("VOUCHER_BRANCH_NOT_ELIGIBLE");
      if (!row.service_ok) reasons.push("VOUCHER_SERVICE_NOT_ELIGIBLE");
      if (!row.customer_ok) reasons.push("BENEFIT_CUSTOMER_MISMATCH");
      if (eligibleMinor < BigInt(row.minimum_spend_minor))
        reasons.push("VOUCHER_MINIMUM_SPEND_NOT_MET");
      if (
        row.per_customer_use_limit &&
        Number(row.customer_uses) >= row.per_customer_use_limit
      )
        reasons.push("VOUCHER_USAGE_LIMIT_REACHED");
      if (
        row.membership_tier_ids?.length &&
        !row.membership_tier_ids.includes(membership?.tier_id)
      )
        reasons.push("MEMBERSHIP_NOT_ACTIVE");
      return {
        id: row.id,
        codeLast4: row.code_last4,
        campaignId: row.campaign_id,
        eligible: reasons.length === 0,
        reasonCodes: reasons,
        calculatedAmountMinor: Number(
          fixedOrPercentDiscount({
            type: row.discount_type,
            value: BigInt(row.discount_value),
            eligibleMinor,
            maximumMinor:
              row.maximum_discount_minor == null
                ? null
                : BigInt(row.maximum_discount_minor),
          }),
        ),
        expiresAt:
          row.code_expires &&
          new Date(row.code_expires) < new Date(row.valid_until)
            ? row.code_expires
            : row.valid_until,
        policySnapshot: {
          campaignId: row.campaign_id,
          campaignVersion: row.version,
          discountType: row.discount_type,
          discountValue: String(row.discount_value),
          refundPolicy: row.refund_policy,
          stackPolicy: row.stack_policy,
        },
      };
    });
    const program = (
      await this.db.query<any>(
        "SELECT * FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' AND effective_from<=$2 AND (effective_to IS NULL OR effective_to>$2) ORDER BY effective_from DESC LIMIT 1",
        [input.tenantId, input.localDateTime],
      )
    ).rows[0];
    const account = (
      await this.db.query<any>(
        "SELECT * FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2",
        [input.tenantId, input.customerId],
      )
    ).rows[0];
    const available = BigInt(account?.available_points ?? 0);
    const loyaltyReasons: string[] = [];
    if (!program || !account) loyaltyReasons.push("LOYALTY_ACCOUNT_NOT_FOUND");
    if (available < 0n) loyaltyReasons.push("LOYALTY_NEGATIVE_BALANCE");
    const remainingAfterDiscount = eligibleMinor;
    const byValue = program
      ? (remainingAfterDiscount * BigInt(program.redemption_points)) /
        BigInt(program.redemption_minor)
      : 0n;
    const maxPoints =
      available > 0n && program
        ? available < byValue
          ? available
          : byValue
        : 0n;
    const loyalty = {
      availablePoints: Number(available),
      maxRedeemablePoints: Number(maxPoints),
      maxRedeemableMinor: program
        ? Number(
            loyaltyRedemptionMinor(
              maxPoints,
              BigInt(program.redemption_points),
              BigInt(program.redemption_minor),
            ),
          )
        : 0,
      reasonCodes: loyaltyReasons,
    };
    const packagesRows = (
      await this.db.query<any>(
        `SELECT e.*,p.code,p.name_json,p.version product_version,i.service_id,i.category_id,i.branch_id eligible_branch_id,i.units_per_redemption,s.category_id service_category_id
       FROM customer_package_entitlements e JOIN service_package_products p ON p.tenant_id=e.tenant_id AND p.id=e.package_product_id
       JOIN service_package_eligibility_items i ON i.tenant_id=p.tenant_id AND i.package_product_id=p.id
       LEFT JOIN services s ON s.tenant_id=i.tenant_id AND s.id=ANY($3::uuid[])
       WHERE e.tenant_id=$1 AND e.customer_id=$2 AND e.status='ACTIVE' ORDER BY e.expires_at`,
        [input.tenantId, input.customerId, serviceIds],
      )
    ).rows;
    const packages = packagesRows.map((row: any) => {
      const service = input.serviceItems.find(
        (item) =>
          item.serviceId === row.service_id ||
          row.category_id === row.service_category_id,
      );
      const reasons: string[] = [];
      if (!service) reasons.push("PACKAGE_SERVICE_NOT_ELIGIBLE");
      if (row.eligible_branch_id && row.eligible_branch_id !== input.branchId)
        reasons.push("PACKAGE_BRANCH_NOT_ELIGIBLE");
      if (new Date(row.expires_at) <= now)
        reasons.push("PACKAGE_ENTITLEMENT_EXPIRED");
      if (Number(row.available_units) < Number(row.units_per_redemption))
        reasons.push("PACKAGE_INSUFFICIENT_BALANCE");
      return {
        id: row.id,
        packageProductId: row.package_product_id,
        serviceId: service?.serviceId,
        eligible: reasons.length === 0,
        reasonCodes: reasons,
        calculatedUnits: Number(row.units_per_redemption),
        calculatedAmountMinor: service ? Number(service.amountMinor) : 0,
        expiresAt: row.expires_at,
        policySnapshot: {
          productId: row.package_product_id,
          productVersion: row.product_version,
          refundPolicy:
            row.policy_snapshot_json?.refundPolicy ?? "RESTORE_UNIT",
          unitsPerRedemption: row.units_per_redemption,
        },
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      applicationOrder: BENEFIT_APPLICATION_ORDER,
      vouchers,
      loyalty,
      membership: {
        tierId: membership?.tier_id ?? null,
        assignmentId: membership?.id ?? null,
        benefits: membership?.benefit_snapshot_json ?? [],
      },
      packages,
    };
  }
}
