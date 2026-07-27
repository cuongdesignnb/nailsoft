/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { branchLocalDayRange } from "../operations/operational-time.js";
import { minorNumber } from "./pos-pricing.service.js";

@Injectable()
export class FinancialReportService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async daily(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branchId = String(query?.branchId ?? "");
    if (!branchId)
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "branchId is required",
      });
    this.assertBranch(auth, branchId);
    const branch = (
      await this.db.query<any>(
        "SELECT b.timezone,bs.currency FROM branches b JOIN branch_settings bs ON bs.tenant_id=b.tenant_id AND bs.branch_id=b.id WHERE b.tenant_id=$1 AND b.id=$2",
        [auth.tenantId, branchId],
      )
    ).rows[0];
    if (!branch)
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
    const businessDate = String(
      query?.businessDate ??
        DateTime.now().setZone(branch.timezone).toISODate(),
    );
    const { startUtc, endUtc } = branchLocalDayRange(
      businessDate,
      branch.timezone,
    );
    const registerId = query?.registerId ?? null;
    const cashierUserId = query?.cashierUserId ?? null;
    const [orders, payments, failed, sessions, partials, unissued] =
      await Promise.all([
        this.db.query<any>(
          `SELECT count(*) orders,COALESCE(sum(subtotal_minor),0) gross,COALESCE(sum(discount_minor),0) discounts,
                COALESCE(sum(tax_minor),0) tax,COALESCE(sum(tip_minor),0) tips,
                COALESCE(sum(total_minor),0) net_sales,COALESCE(sum(amount_paid_minor),0) collected
           FROM pos_orders WHERE tenant_id=$1 AND branch_id=$2 AND paid_at >= $3 AND paid_at < $4
             AND ($5::uuid IS NULL OR register_id=$5)`,
          [auth.tenantId, branchId, startUtc, endUtc, registerId],
        ),
        this.db.query<any>(
          `SELECT tender_type,COALESCE(sum(captured_minor),0) amount,count(*) count
           FROM payments WHERE tenant_id=$1 AND branch_id=$2 AND status='CAPTURED' AND captured_at >= $3 AND captured_at < $4
             AND ($5::uuid IS NULL OR cash_session_id IN (SELECT id FROM cash_sessions WHERE tenant_id=$1 AND register_id=$5))
             AND ($6::uuid IS NULL OR created_by_user_id=$6)
          GROUP BY tender_type`,
          [
            auth.tenantId,
            branchId,
            startUtc,
            endUtc,
            registerId,
            cashierUserId,
          ],
        ),
        this.db.query<any>(
          "SELECT count(*) count FROM payments WHERE tenant_id=$1 AND branch_id=$2 AND status='FAILED' AND created_at >= $3 AND created_at < $4",
          [auth.tenantId, branchId, startUtc, endUtc],
        ),
        this.db.query<any>(
          "SELECT count(*) sessions,COALESCE(sum(variance_minor),0) variance,count(*) FILTER(WHERE status IN ('OPEN','CLOSING')) open_sessions FROM cash_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND ($4::uuid IS NULL OR register_id=$4) AND ($5::uuid IS NULL OR cashier_user_id=$5)",
          [auth.tenantId, branchId, businessDate, registerId, cashierUserId],
        ),
        this.db.query<any>(
          "SELECT count(*) count,COALESCE(sum(amount_due_minor),0) due FROM pos_orders WHERE tenant_id=$1 AND branch_id=$2 AND status='PARTIALLY_PAID' AND created_at < $3 AND updated_at >= $4",
          [auth.tenantId, branchId, endUtc, startUtc],
        ),
        this.db.query<any>(
          "SELECT count(*) count FROM pos_orders o WHERE o.tenant_id=$1 AND o.branch_id=$2 AND o.status='PAID' AND o.paid_at >= $3 AND o.paid_at < $4 AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.tenant_id=o.tenant_id AND i.pos_order_id=o.id AND i.status='ISSUED')",
          [auth.tenantId, branchId, startUtc, endUtc],
        ),
      ]);
    const order = orders.rows[0],
      session = sessions.rows[0];
    const mix = Object.fromEntries(
      payments.rows.map((row) => [
        row.tender_type,
        { amountMinor: minorNumber(row.amount), count: Number(row.count) },
      ]),
    );
    return {
      branchId,
      businessDate,
      timezone: branch.timezone,
      currency: branch.currency,
      range: { startUtc, endUtc },
      orders: Number(order.orders),
      grossSalesMinor: minorNumber(order.gross),
      discountMinor: minorNumber(order.discounts),
      taxMinor: minorNumber(order.tax),
      tipMinor: minorNumber(order.tips),
      netSalesMinor: minorNumber(order.net_sales),
      netCollectedMinor: minorNumber(order.collected),
      paymentMix: {
        CASH: mix.CASH ?? { amountMinor: 0, count: 0 },
        CARD_EXTERNAL: mix.CARD_EXTERNAL ?? { amountMinor: 0, count: 0 },
        BANK_TRANSFER: mix.BANK_TRANSFER ?? { amountMinor: 0, count: 0 },
        OTHER_EXTERNAL: mix.OTHER_EXTERNAL ?? { amountMinor: 0, count: 0 },
      },
      failedPayments: Number(failed.rows[0].count),
      partialOrders: Number(partials.rows[0].count),
      partialAmountDueMinor: minorNumber(partials.rows[0].due),
      cashSessions: Number(session.sessions),
      openCashSessions: Number(session.open_sessions),
      cashVarianceMinor: Number(session.variance),
      unissuedInvoices: Number(unissued.rows[0].count),
      generatedAt: new Date().toISOString(),
    };
  }

  async summary(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branchRows = query?.branchId
      ? (this.assertBranch(auth, String(query.branchId)),
        (
          await this.db.query<any>(
            "SELECT id,timezone FROM branches WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, query.branchId],
          )
        ).rows)
      : (
          await this.db.query<any>(
            "SELECT id,timezone FROM branches WHERE tenant_id=$1 AND ($2 OR id=ANY($3::uuid[])) ORDER BY code",
            [auth.tenantId, auth.roles.includes("SALON_OWNER"), auth.branchIds],
          )
        ).rows;
    const branches = await Promise.all(
      branchRows.map((branch) =>
        this.daily(auth, {
          branchId: branch.id,
          businessDate:
            query?.businessDate ??
            DateTime.now().setZone(branch.timezone).toISODate(),
        }),
      ),
    );
    const total = (field: string) =>
      branches.reduce((sum, row: any) => sum + Number(row[field] ?? 0), 0);
    return {
      branches,
      totals: {
        paidOrders: total("orders"),
        todaySalesMinor: total("netSalesMinor"),
        tipsMinor: total("tipMinor"),
        openCashSessions: total("openCashSessions"),
        cashVarianceMinor: total("cashVarianceMinor"),
        partialOrders: total("partialOrders"),
        partialAmountDueMinor: total("partialAmountDueMinor"),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private assertTenant(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support Access Grant is required",
      });
  }
  private assertBranch(auth: AccessClaims, id: string) {
    if (!auth.roles.includes("SALON_OWNER") && !auth.branchIds.includes(id))
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
  }
}
