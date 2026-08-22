/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  creditNoteDirectoryQuerySchema,
  creditNoteDeliverySchema,
  financialExportSchema,
  netSalesOverviewQuerySchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "../pos/financial-evidence.service.js";

@Injectable()
export class FinancialReportingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
  ) {}

  refunds(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT branch_id,currency,count(*) FILTER(WHERE status='COMPLETED') completed_count,
              COALESCE(sum(completed_minor) FILTER(WHERE status='COMPLETED'),0) refunded_minor,
              COALESCE(sum(service_refund_minor) FILTER(WHERE status='COMPLETED'),0) service_refund_minor,
              COALESCE(sum(tax_refund_minor) FILTER(WHERE status='COMPLETED'),0) tax_refund_minor,
              COALESCE(sum(tip_refund_minor) FILTER(WHERE status='COMPLETED'),0) tip_refund_minor
         FROM refunds WHERE tenant_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND requested_at >= COALESCE($3::timestamptz,'-infinity')
          AND requested_at < COALESCE($4::timestamptz,'infinity') GROUP BY branch_id,currency ORDER BY branch_id,currency`,
    );
  }
  netSales(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT i.branch_id,i.currency,COALESCE(sum(revenue.invoice_minor),0) gross_invoice_minor,
              COALESCE(sum(refunded.refund_minor),0) refund_minor,
              COALESCE(sum(revenue.invoice_minor-refunded.refund_minor),0) net_sales_minor
         FROM invoices i
         JOIN LATERAL (
           SELECT COALESCE(sum(il.net_minor),0) invoice_minor
             FROM invoice_lines il JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE il.tenant_id=i.tenant_id AND il.invoice_id=i.id AND pol.line_type<>'GIFT_CARD'
         ) revenue ON true
         JOIN LATERAL (
           SELECT COALESCE(sum(ri.total_refund_minor),0) refund_minor
             FROM refund_items ri JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id
             JOIN invoice_lines il ON il.tenant_id=ri.tenant_id AND il.id=ri.invoice_line_id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE r.tenant_id=i.tenant_id AND r.invoice_id=i.id AND r.status='COMPLETED' AND pol.line_type<>'GIFT_CARD'
         ) refunded ON true
        WHERE i.tenant_id=$1 AND ($2::uuid IS NULL OR i.branch_id=$2) AND i.issued_at >= COALESCE($3::timestamptz,'-infinity')
          AND i.issued_at < COALESCE($4::timestamptz,'infinity') GROUP BY i.branch_id,i.currency ORDER BY i.branch_id,i.currency`,
    );
  }
  async netSalesOverview(auth: AccessClaims, input: unknown) {
    const query = netSalesOverviewQuerySchema.parse(input ?? {});
    this.assert(auth, query.branchId);
    const allowedBranches = auth.roles.includes("SALON_OWNER") ? null : (auth.supportAccess?.branchIds ?? auth.branchIds);
    const branches = (
      await this.db.query<any>(
        `SELECT b.id,b.name,b.code,b.timezone,t.currency
           FROM branches b JOIN tenants t ON t.id=b.tenant_id
          WHERE b.tenant_id=$1 AND b.status='ACTIVE'
            AND ($2::uuid IS NULL OR b.id=$2)
            AND ($3::uuid[] IS NULL OR b.id=ANY($3::uuid[]))
          ORDER BY b.name,b.id`,
        [auth.tenantId, query.branchId ?? null, allowedBranches],
      )
    ).rows;
    const currencies = [...new Set(branches.map((branch) => String(branch.currency)))] as string[];
    if (currencies.length > 1) {
      throw new ConflictException({
        code: "FINANCIAL_CURRENCY_SCOPE_REQUIRED",
        message: "Financial analytics cannot combine branches with different currencies",
      });
    }
    const branchIds = branches.map((branch) => branch.id as string);
    const comparisonRange = overviewComparisonRange(query);
    const [current, previous, daily, services, staff, paymentMix, creditNotes, previousServices, previousStaff] = await Promise.all([
      this.netSalesRange(auth, query, branchIds, query.from, query.to),
      comparisonRange ? this.netSalesRange(auth, query, branchIds, comparisonRange.from, comparisonRange.to) : Promise.resolve([]),
      this.netSalesDaily(auth, query, branchIds),
      this.netSalesServices(auth, query, branchIds, query.from, query.to),
      this.netSalesStaff(auth, query, branchIds, query.from, query.to),
      this.netSalesPaymentMix(auth, query, branchIds),
      this.netSalesCreditNotes(auth, query, branchIds),
      comparisonRange ? this.netSalesServices(auth, query, branchIds, comparisonRange.from, comparisonRange.to) : Promise.resolve([]),
      comparisonRange ? this.netSalesStaff(auth, query, branchIds, comparisonRange.from, comparisonRange.to) : Promise.resolve([]),
    ]);
    const totals = sumNetSalesRows(current);
    const previousTotals = sumNetSalesRows(previous);
    const netSalesComparison = comparisonRange
      ? overviewComparison(totals.netSalesMinor, previousTotals.netSalesMinor, query.comparisonMode)
      : overviewComparison(totals.netSalesMinor, 0, "NONE");
    const branchComparison = current.map((row) => {
      const prior = previous.find((item) => item.branchId === row.branchId && item.currency === row.currency);
      return {
        branchId: row.branchId,
        branchName: branches.find((branch) => branch.id === row.branchId)?.name ?? row.branchId,
        currency: row.currency,
        invoiceRevenueMinor: row.invoiceRevenueMinor,
        completedRefundMinor: row.completedRefundMinor,
        netSalesMinor: row.netSalesMinor,
        comparisonPercent: prior ? overviewPercentage(row.netSalesMinor, prior.netSalesMinor) : null,
      };
    });
    return {
      filters: {
        branchId: query.branchId ?? null,
        from: query.from,
        to: query.to,
        comparisonMode: query.comparisonMode,
        comparisonFrom: comparisonRange?.from ?? null,
        comparisonTo: comparisonRange?.to ?? null,
        staffId: query.staffId ?? null,
        serviceId: query.serviceId ?? null,
        granularity: query.granularity,
        paymentMethod: query.paymentMethod ?? null,
      },
      generatedAt: new Date().toISOString(),
      currency: currencies[0] ?? null,
      timezone: branches.length === 1 ? branches[0].timezone : null,
      formulaVersion: "NET_SALES_V1",
      formulaDescription: "Doanh thu hóa đơn đủ điều kiện theo invoice_lines.net_minor trừ các refund đã COMPLETED trên dòng dịch vụ; Credit Note chỉ là chứng từ, không trừ lần hai.",
      totals: { ...totals, creditNoteIssuedMinor: creditNotes.totalMinor, creditNoteIssuedCount: creditNotes.count },
      comparison: {
        ...netSalesComparison,
        previousFrom: comparisonRange?.from ?? null,
        previousTo: comparisonRange?.to ?? null,
      },
      quality: {
        refundRate: totals.invoiceRevenueMinor ? overviewPercentage(totals.completedRefundMinor, totals.invoiceRevenueMinor) : null,
        discountRate: totals.grossBeforeDiscountMinor ? overviewPercentage(totals.discountMinor, totals.grossBeforeDiscountMinor) : null,
        reconciledPaymentRate: null,
      },
      alerts: buildNetSalesAlerts(totals),
      daily,
      services: services.map((row) => {
        const prior = previousServices.find((item) => item.serviceId === row.serviceId && item.currency === row.currency);
        return { ...row, comparisonPercent: prior ? overviewPercentage(row.netSalesMinor, prior.netSalesMinor) : null, comparisonAvailable: Boolean(prior) };
      }),
      staff: staff.map((row) => {
        const prior = previousStaff.find((item) => item.staffId === row.staffId && item.currency === row.currency);
        return { ...row, comparisonPercent: prior ? overviewPercentage(row.attributedNetSalesMinor, prior.attributedNetSalesMinor) : null, comparisonAvailable: Boolean(prior) };
      }),
      branches: branchComparison,
      paymentMix,
      sources: {
        invoiceRevenue: "invoices → invoice_lines.net_minor; line_type GIFT_CARD bị loại theo policy hiện tại",
        completedRefund: "refunds.status=COMPLETED → refund_items.total_refund_minor của invoice line",
        creditNote: "credit_notes.status=ISSUED; chỉ hiển thị chứng từ, không deduction lần hai",
        tip: "invoices.tip_minor; theo dõi riêng, không cộng vào Net Sales",
        paymentMix: "payments.status=CAPTURED; số tiền đã thu theo tender, chưa prorate Net Sales theo split tender",
      },
    };
  }

  private async netSalesRange(auth: AccessClaims, query: any, branchIds: string[], from: string, to: string) {
    if (!branchIds.length) return [];
    const rows = (
      await this.db.query<any>(
        `WITH eligible_lines AS (
           SELECT i.id invoice_id,i.branch_id,i.currency,il.id invoice_line_id,
                  il.net_minor,il.discount_minor,il.tax_minor,pol.gross_minor,pol.id order_line_id
             FROM invoices i
             JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
             JOIN invoice_lines il ON il.tenant_id=i.tenant_id AND il.invoice_id=i.id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE i.tenant_id=$1 AND i.status='ISSUED'
              AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2::date AND $3::date
              AND i.branch_id=ANY($4::uuid[]) AND pol.line_type<>'GIFT_CARD'
              AND ($5::uuid IS NULL OR pol.service_id=$5)
              AND ($6::uuid IS NULL OR EXISTS(
                SELECT 1 FROM service_session_staff_segments seg
                 WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id AND seg.staff_id=$6
              ) OR (
                NOT EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id)
                AND EXISTS(SELECT 1 FROM appointment_item_staff_assignments asa WHERE asa.tenant_id=pol.tenant_id AND asa.appointment_item_id=pol.appointment_item_id AND asa.staff_id=$6 AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE')
              ))
         ), line_totals AS (
           SELECT branch_id,currency,COALESCE(sum(net_minor),0)::bigint invoice_revenue_minor,
                  COALESCE(sum(gross_minor),0)::bigint gross_before_discount_minor,
                  COALESCE(sum(discount_minor),0)::bigint discount_minor,
                  COALESCE(sum(tax_minor),0)::bigint tax_minor
             FROM eligible_lines GROUP BY branch_id,currency
         ), invoice_totals AS (
           SELECT i.branch_id,i.currency,count(DISTINCT i.id)::int paid_order_count,
                  COALESCE(sum(i.tip_minor),0)::bigint tip_minor
             FROM invoices i JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
            WHERE i.tenant_id=$1 AND i.status='ISSUED'
              AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2::date AND $3::date
              AND i.branch_id=ANY($4::uuid[])
              AND EXISTS(SELECT 1 FROM eligible_lines el WHERE el.invoice_id=i.id)
            GROUP BY i.branch_id,i.currency
         ), refund_totals AS (
           SELECT i.branch_id,i.currency,COALESCE(sum(ri.total_refund_minor),0)::bigint completed_refund_minor
             FROM refunds r
             JOIN refund_items ri ON ri.tenant_id=r.tenant_id AND ri.refund_id=r.id AND ri.item_type='INVOICE_LINE'
             JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
             JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
             JOIN invoice_lines il ON il.tenant_id=ri.tenant_id AND il.id=ri.invoice_line_id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE r.tenant_id=$1 AND r.status='COMPLETED'
              AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2::date AND $3::date
              AND i.branch_id=ANY($4::uuid[]) AND pol.line_type<>'GIFT_CARD'
              AND ($5::uuid IS NULL OR pol.service_id=$5)
              AND ($6::uuid IS NULL OR EXISTS(
                SELECT 1 FROM service_session_staff_segments seg
                 WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id AND seg.staff_id=$6
              ) OR (
                NOT EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id)
                AND EXISTS(SELECT 1 FROM appointment_item_staff_assignments asa WHERE asa.tenant_id=pol.tenant_id AND asa.appointment_item_id=pol.appointment_item_id AND asa.staff_id=$6 AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE')
              ))
            GROUP BY i.branch_id,i.currency
         )
         SELECT b.id branch_id,t.currency,
                COALESCE(lt.invoice_revenue_minor,0)::bigint invoice_revenue_minor,
                COALESCE(lt.gross_before_discount_minor,0)::bigint gross_before_discount_minor,
                COALESCE(lt.discount_minor,0)::bigint discount_minor,
                COALESCE(lt.tax_minor,0)::bigint tax_minor,
                COALESCE(it.tip_minor,0)::bigint tip_minor,
                COALESCE(it.paid_order_count,0)::int paid_order_count,
                COALESCE(rt.completed_refund_minor,0)::bigint completed_refund_minor
           FROM branches b JOIN tenants t ON t.id=b.tenant_id
           LEFT JOIN line_totals lt ON lt.branch_id=b.id
           LEFT JOIN invoice_totals it ON it.branch_id=b.id AND it.currency=t.currency
           LEFT JOIN refund_totals rt ON rt.branch_id=b.id AND rt.currency=t.currency
          WHERE b.tenant_id=$1 AND b.id=ANY($4::uuid[])
          ORDER BY b.name,b.id`,
        [auth.tenantId, from, to, branchIds, query.serviceId ?? null, query.staffId ?? null],
      )
    ).rows;
    return rows.map((row) => ({
      branchId: row.branch_id,
      currency: row.currency,
      invoiceRevenueMinor: Number(row.invoice_revenue_minor),
      grossBeforeDiscountMinor: Number(row.gross_before_discount_minor),
      discountMinor: Number(row.discount_minor),
      taxMinor: Number(row.tax_minor),
      tipMinor: Number(row.tip_minor),
      paidOrderCount: Number(row.paid_order_count),
      completedRefundMinor: Number(row.completed_refund_minor),
      netSalesMinor: Number(row.invoice_revenue_minor) - Number(row.completed_refund_minor),
    }));
  }

  private async netSalesDaily(auth: AccessClaims, query: any, branchIds: string[]) {
    if (!branchIds.length) return [];
    const bucketExpression = query.granularity === "MONTH"
      ? "date_trunc('month',(i.issued_at AT TIME ZONE b.timezone))::date"
      : query.granularity === "WEEK"
        ? "date_trunc('week',(i.issued_at AT TIME ZONE b.timezone))::date"
        : "(i.issued_at AT TIME ZONE b.timezone)::date";
    const refundBucketExpression = query.granularity === "MONTH"
      ? "date_trunc('month',(i.issued_at AT TIME ZONE b.timezone))::date"
      : query.granularity === "WEEK"
        ? "date_trunc('week',(i.issued_at AT TIME ZONE b.timezone))::date"
        : "(i.issued_at AT TIME ZONE b.timezone)::date";
    const bucketStart = query.granularity === "MONTH"
      ? "date_trunc('month',$2::date)::date"
      : query.granularity === "WEEK"
        ? "date_trunc('week',$2::date)::date"
        : "$2::date";
    const bucketEnd = query.granularity === "MONTH"
      ? "date_trunc('month',$3::date)::date"
      : query.granularity === "WEEK"
        ? "date_trunc('week',$3::date)::date"
        : "$3::date";
    const bucketStep = query.granularity === "MONTH" ? "1 month" : query.granularity === "WEEK" ? "1 week" : "1 day";
    const rows = (
      await this.db.query<any>(
        `WITH days AS (SELECT generate_series(${bucketStart},${bucketEnd},'${bucketStep}')::date business_date),
         lines AS (
           SELECT ${bucketExpression} business_date,
                  sum(il.net_minor)::bigint invoice_revenue_minor,sum(il.tax_minor)::bigint tax_minor,sum(il.discount_minor)::bigint discount_minor
             FROM invoices i JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
             JOIN invoice_lines il ON il.tenant_id=i.tenant_id AND il.invoice_id=i.id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE i.tenant_id=$1 AND i.status='ISSUED' AND i.branch_id=ANY($4::uuid[])
              AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2::date AND $3::date AND pol.line_type<>'GIFT_CARD'
              AND ($5::uuid IS NULL OR pol.service_id=$5)
              AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id AND seg.staff_id=$6) OR (NOT EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id) AND EXISTS(SELECT 1 FROM appointment_item_staff_assignments asa WHERE asa.tenant_id=pol.tenant_id AND asa.appointment_item_id=pol.appointment_item_id AND asa.staff_id=$6 AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE')))
            GROUP BY 1
         ), refunds AS (
           SELECT ${refundBucketExpression} business_date,sum(ri.total_refund_minor)::bigint completed_refund_minor
             FROM refunds r JOIN refund_items ri ON ri.tenant_id=r.tenant_id AND ri.refund_id=r.id AND ri.item_type='INVOICE_LINE'
             JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
             JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
             JOIN invoice_lines il ON il.tenant_id=ri.tenant_id AND il.id=ri.invoice_line_id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE r.tenant_id=$1 AND r.status='COMPLETED' AND i.branch_id=ANY($4::uuid[])
              AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2::date AND $3::date AND pol.line_type<>'GIFT_CARD'
              AND ($5::uuid IS NULL OR pol.service_id=$5)
              AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id AND seg.staff_id=$6) OR (NOT EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id) AND EXISTS(SELECT 1 FROM appointment_item_staff_assignments asa WHERE asa.tenant_id=pol.tenant_id AND asa.appointment_item_id=pol.appointment_item_id AND asa.staff_id=$6 AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE')))
            GROUP BY 1
         )
         SELECT d.business_date,COALESCE(l.invoice_revenue_minor,0)::bigint invoice_revenue_minor,
                COALESCE(l.discount_minor,0)::bigint discount_minor,COALESCE(l.tax_minor,0)::bigint tax_minor,
                COALESCE(r.completed_refund_minor,0)::bigint completed_refund_minor
           FROM days d LEFT JOIN lines l USING(business_date) LEFT JOIN refunds r USING(business_date)
          WHERE COALESCE(l.invoice_revenue_minor,0)<>0 OR COALESCE(r.completed_refund_minor,0)<>0
          ORDER BY d.business_date`,
        [auth.tenantId, query.from, query.to, branchIds, query.serviceId ?? null, query.staffId ?? null],
      )
    ).rows;
    return rows.map((row) => ({ businessDate: row.business_date, invoiceRevenueMinor: Number(row.invoice_revenue_minor), discountMinor: Number(row.discount_minor), taxMinor: Number(row.tax_minor), completedRefundMinor: Number(row.completed_refund_minor), netSalesMinor: Number(row.invoice_revenue_minor) - Number(row.completed_refund_minor) }));
  }

  private async netSalesServices(auth: AccessClaims, query: any, branchIds: string[], from: string, to: string) {
    if (!branchIds.length) return [];
    const rows = (
      await this.db.query<any>(
        `WITH lines AS (
           SELECT il.id invoice_line_id,il.net_minor,il.discount_minor,pol.service_id,
                  COALESCE(pol.description_snapshot_json->'name'->>'vi-VN',pol.description_snapshot_json->'name'->>'en-US',pol.description_snapshot_json->>'code',pol.service_id::text) service_name,
                  i.branch_id,i.currency,(i.issued_at AT TIME ZONE b.timezone)::date business_date
             FROM invoices i JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
             JOIN invoice_lines il ON il.tenant_id=i.tenant_id AND il.invoice_id=i.id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE i.tenant_id=$1 AND i.status='ISSUED' AND i.branch_id=ANY($4::uuid[])
              AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2::date AND $3::date AND pol.line_type<>'GIFT_CARD'
              AND ($5::uuid IS NULL OR pol.service_id=$5)
              AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id AND seg.staff_id=$6) OR (NOT EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id) AND EXISTS(SELECT 1 FROM appointment_item_staff_assignments asa WHERE asa.tenant_id=pol.tenant_id AND asa.appointment_item_id=pol.appointment_item_id AND asa.staff_id=$6 AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE')))
         ), refund_lines AS (
           SELECT ri.invoice_line_id,sum(ri.total_refund_minor)::bigint completed_refund_minor
             FROM refund_items ri JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id AND r.status='COMPLETED'
            WHERE ri.tenant_id=$1 AND ri.item_type='INVOICE_LINE' GROUP BY ri.invoice_line_id
         )
         SELECT service_id,service_name,currency,count(DISTINCT invoice_line_id)::int performed_count,
                sum(net_minor)::bigint invoice_revenue_minor,COALESCE(sum(rl.completed_refund_minor),0)::bigint completed_refund_minor,
                sum(net_minor-COALESCE(rl.completed_refund_minor,0))::bigint net_sales_minor
           FROM lines l LEFT JOIN refund_lines rl ON rl.invoice_line_id=l.invoice_line_id
          GROUP BY service_id,service_name,currency ORDER BY net_sales_minor DESC,service_name`,
        [auth.tenantId, from, to, branchIds, query.serviceId ?? null, query.staffId ?? null],
      )
    ).rows;
    return rows.map((row) => ({ serviceId: row.service_id, serviceName: row.service_name, currency: row.currency, performedCount: Number(row.performed_count), invoiceRevenueMinor: Number(row.invoice_revenue_minor), completedRefundMinor: Number(row.completed_refund_minor), netSalesMinor: Number(row.net_sales_minor) }));
  }

  private async netSalesStaff(auth: AccessClaims, query: any, branchIds: string[], from: string, to: string) {
    if (!branchIds.length) return [];
    const rows = (
      await this.db.query<any>(
        `WITH lines AS (
           SELECT il.id invoice_line_id,il.net_minor,pol.id order_line_id,pol.service_session_id,pol.appointment_item_id,i.currency
             FROM invoices i JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
             JOIN invoice_lines il ON il.tenant_id=i.tenant_id AND il.invoice_id=i.id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
            WHERE i.tenant_id=$1 AND i.status='ISSUED' AND i.branch_id=ANY($4::uuid[])
              AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2::date AND $3::date AND pol.line_type<>'GIFT_CARD'
              AND ($5::uuid IS NULL OR pol.service_id=$5)
         ), staff_weights AS (
           SELECT l.invoice_line_id,seg.staff_id,SUM(COALESCE(seg.contribution_weight,GREATEST(1,EXTRACT(EPOCH FROM (COALESCE(seg.ended_at,ss.actual_ended_at,ss.scheduled_end_at)-seg.started_at)))))::numeric weight
             FROM lines l JOIN service_session_staff_segments seg ON seg.tenant_id=$1 AND seg.service_session_id=l.service_session_id
             JOIN service_sessions ss ON ss.tenant_id=seg.tenant_id AND ss.id=seg.service_session_id
            GROUP BY l.invoice_line_id,seg.staff_id
           UNION ALL
           SELECT l.invoice_line_id,asa.staff_id,1::numeric
             FROM lines l JOIN appointment_item_staff_assignments asa ON asa.tenant_id=$1 AND asa.appointment_item_id=l.appointment_item_id AND asa.assignment_role='PRIMARY' AND asa.status='ACTIVE'
            WHERE NOT EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=$1 AND seg.service_session_id=l.service_session_id)
         ), weighted AS (
           SELECT sw.invoice_line_id,sw.staff_id,sw.weight,SUM(sw.weight) OVER(PARTITION BY sw.invoice_line_id) total_weight
             FROM staff_weights sw
         ), refund_lines AS (
           SELECT ri.invoice_line_id,SUM(ri.total_refund_minor)::bigint completed_refund_minor
             FROM refund_items ri JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id AND r.status='COMPLETED'
            WHERE ri.tenant_id=$1 AND ri.item_type='INVOICE_LINE' GROUP BY ri.invoice_line_id
         )
         SELECT w.staff_id,sp.display_name staff_name,l.currency,
                count(DISTINCT l.invoice_line_id)::int attributed_service_count,
                sum(round(l.net_minor*w.weight/NULLIF(w.total_weight,0)))::bigint attributed_revenue_minor,
                sum(round(COALESCE(rl.completed_refund_minor,0)*w.weight/NULLIF(w.total_weight,0)))::bigint attributed_refund_minor
           FROM weighted w JOIN lines l ON l.invoice_line_id=w.invoice_line_id
           LEFT JOIN refund_lines rl ON rl.invoice_line_id=l.invoice_line_id
           LEFT JOIN staff_profiles sp ON sp.tenant_id=$1 AND sp.id=w.staff_id
          WHERE ($6::uuid IS NULL OR w.staff_id=$6)
          GROUP BY w.staff_id,sp.display_name,l.currency ORDER BY attributed_revenue_minor DESC,sp.display_name`,
        [auth.tenantId, from, to, branchIds, query.serviceId ?? null, query.staffId ?? null],
      )
    ).rows;
    return rows.map((row) => ({ staffId: row.staff_id, staffName: row.staff_name ?? "Chưa phân bổ", currency: row.currency, attributedServiceCount: Number(row.attributed_service_count), attributedRevenueMinor: Number(row.attributed_revenue_minor), attributedRefundMinor: Number(row.attributed_refund_minor), attributedNetSalesMinor: Number(row.attributed_revenue_minor) - Number(row.attributed_refund_minor) }));
  }

  private async netSalesPaymentMix(auth: AccessClaims, query: any, branchIds: string[]) {
    if (!branchIds.length) return [];
    const rows = (
      await this.db.query<any>(
        `SELECT p.tender_type,SUM(p.captured_minor)::bigint captured_minor,COUNT(*)::int payment_count
           FROM payments p JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id
          WHERE p.tenant_id=$1 AND p.status='CAPTURED' AND p.branch_id=ANY($2::uuid[])
            AND (p.captured_at AT TIME ZONE b.timezone)::date BETWEEN $3::date AND $4::date
            AND ($5::text IS NULL OR p.tender_type=$5)
          GROUP BY p.tender_type ORDER BY captured_minor DESC`,
        [auth.tenantId, branchIds, query.from, query.to, query.paymentMethod ?? null],
      )
    ).rows;
    return rows.map((row) => ({ tenderType: row.tender_type, capturedMinor: Number(row.captured_minor), paymentCount: Number(row.payment_count) }));
  }

  private async netSalesCreditNotes(auth: AccessClaims, query: any, branchIds: string[]) {
    if (!branchIds.length) return { count: 0, totalMinor: 0 };
    const row = (
      await this.db.query<any>(
        `SELECT COUNT(*)::int count,COALESCE(SUM(c.total_minor),0)::bigint total_minor
           FROM credit_notes c JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
          WHERE c.tenant_id=$1 AND c.status='ISSUED' AND c.branch_id=ANY($2::uuid[])
            AND (c.issued_at AT TIME ZONE b.timezone)::date BETWEEN $3::date AND $4::date`,
        [auth.tenantId, branchIds, query.from, query.to],
      )
    ).rows[0];
    return { count: Number(row?.count ?? 0), totalMinor: Number(row?.total_minor ?? 0) };
  }
  taxAdjustments(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT branch_id,currency,count(*) credit_note_count,COALESCE(sum(tax_minor),0) tax_adjustment_minor
         FROM credit_notes WHERE tenant_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND issued_at >= COALESCE($3::timestamptz,'-infinity')
          AND issued_at < COALESCE($4::timestamptz,'infinity') AND status='ISSUED' GROUP BY branch_id,currency ORDER BY branch_id,currency`,
    );
  }
  tipSummary(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT s.staff_id,s.gross_tip_minor,s.refunded_tip_minor,s.net_tip_minor FROM staff_net_tip s
        WHERE s.tenant_id=$1 AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM staff_branch_assignments a WHERE a.tenant_id=s.tenant_id AND a.staff_id=s.staff_id AND a.branch_id=$2 AND a.status='ACTIVE'))
        ORDER BY s.staff_id`,
      false,
    );
  }
  commissionLiability(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT period_id,currency,status,COALESCE(sum(commission_minor),0) commission_liability_minor
         FROM commission_entries WHERE tenant_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND business_date>=COALESCE($3::date,'-infinity')
          AND business_date<=COALESCE($4::date,'infinity') GROUP BY period_id,currency,status ORDER BY period_id,currency,status`,
    );
  }
  commissionByStaff(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT e.staff_id,sp.display_name,e.currency,COALESCE(sum(e.commission_minor),0) commission_minor
         FROM commission_entries e JOIN staff_profiles sp ON sp.tenant_id=e.tenant_id AND sp.id=e.staff_id
        WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2) AND e.business_date>=COALESCE($3::date,'-infinity')
          AND e.business_date<=COALESCE($4::date,'infinity') GROUP BY e.staff_id,sp.display_name,e.currency ORDER BY sp.display_name,e.staff_id`,
    );
  }
  commissionByService(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT pol.service_id,e.currency,COALESCE(sum(e.commission_minor),0) commission_minor
         FROM commission_entries e LEFT JOIN invoice_lines il ON il.tenant_id=e.tenant_id AND il.id=e.invoice_line_id
         LEFT JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
        WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2) AND e.business_date>=COALESCE($3::date,'-infinity')
          AND e.business_date<=COALESCE($4::date,'infinity') GROUP BY pol.service_id,e.currency ORDER BY pol.service_id`,
    );
  }
  creditNoteReport(auth: AccessClaims, query: any) {
    return this.report(
      auth,
      query,
      `SELECT branch_id,currency,count(*) credit_note_count,COALESCE(sum(total_minor),0) total_minor
         FROM credit_notes WHERE tenant_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND issued_at>=COALESCE($3::timestamptz,'-infinity')
          AND issued_at<COALESCE($4::timestamptz,'infinity') GROUP BY branch_id,currency ORDER BY branch_id,currency`,
    );
  }

  async creditNotes(auth: AccessClaims, query: any) {
    this.assert(auth, query?.branchId);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    return (
      await this.db.query<any>(
        `SELECT c.*,r.refund_reference,i.invoice_number FROM credit_notes c JOIN refunds r ON r.tenant_id=c.tenant_id AND r.id=c.refund_id
       JOIN invoices i ON i.tenant_id=c.tenant_id AND i.id=c.original_invoice_id WHERE c.tenant_id=$1
       AND ($2::uuid[] IS NULL OR c.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR c.branch_id=$3) ORDER BY c.issued_at DESC,c.id LIMIT 200`,
        [auth.tenantId, branches, query?.branchId ?? null],
      )
    ).rows.map(creditNoteView);
  }
  async creditNoteDirectory(auth: AccessClaims, input: unknown) {
    const query = creditNoteDirectoryQuerySchema.parse(input ?? {});
    this.assert(auth, query.branchId);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches, query.branchId ?? null];
    const where = [
      "tenant_id=$1",
      "($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[]))",
      "($3::uuid IS NULL OR branch_id=$3)",
    ];
    const canSeeCustomerPhone =
      !auth.supportAccess && !auth.roles.includes("PLATFORM_SUPER_ADMIN");
    if (query.search) {
      values.push(`%${query.search.toLowerCase()}%`);
      const index = values.length;
      where.push(
        `(lower(COALESCE(credit_note_number,'')) LIKE $${index}
          OR lower(COALESCE(invoice_number,'')) LIKE $${index}
          OR lower(COALESCE(refund_reference,'')) LIKE $${index}
          OR lower(COALESCE(customer_display_name,'')) LIKE $${index}
          ${canSeeCustomerPhone ? `OR lower(COALESCE(customer_phone,'')) LIKE $${index}` : ""})`,
      );
    }
    if (query.status) {
      values.push(query.status);
      where.push(`status=$${values.length}`);
    }
    if (query.refundKind) {
      values.push(query.refundKind);
      where.push(`refund_kind=$${values.length}`);
    }
    if (query.issuedFrom) {
      values.push(query.issuedFrom);
      where.push(
        `(COALESCE(issued_at,created_at) AT TIME ZONE branch_timezone)::date >= $${values.length}::date`,
      );
    }
    if (query.issuedTo) {
      values.push(query.issuedTo);
      where.push(
        `(COALESCE(issued_at,created_at) AT TIME ZONE branch_timezone)::date <= $${values.length}::date`,
      );
    }
    const base = `
      WITH base AS (
        SELECT c.tenant_id,c.id,c.branch_id,c.refund_id,c.original_invoice_id,
               c.credit_note_number,c.status,c.currency,c.gross_minor,
               c.discount_reversal_minor,c.taxable_minor,c.tax_minor,c.tip_minor,
               c.total_minor,c.customer_snapshot_json,c.branch_snapshot_json,
               c.original_invoice_snapshot_json,c.issued_at,c.issued_by_user_id,
               c.created_at,c.version,r.refund_reference,r.status refund_status,
               r.requested_minor,r.completed_minor,r.service_refund_minor,
               r.tax_refund_minor,r.tip_refund_minor,i.invoice_number,
               i.status invoice_status,b.name branch_name,b.code branch_code,
               b.timezone branch_timezone,u.display_name issuer_display_name,
               COALESCE(NULLIF(c.customer_snapshot_json->>'displayName',''),
                        NULLIF(c.customer_snapshot_json->>'display_name',''),
                        'Khách vãng lai') customer_display_name,
               NULLIF(COALESCE(c.customer_snapshot_json->>'phone',
                               c.customer_snapshot_json->>'phoneNormalized'),'') customer_phone,
               COALESCE(NULLIF(c.original_invoice_snapshot_json->>'grandTotalMinor','')::bigint,
                        NULLIF(c.original_invoice_snapshot_json->>'grand_total_minor','')::bigint,
                        NULLIF(c.original_invoice_snapshot_json->>'totalMinor','')::bigint,
                        NULLIF(c.original_invoice_snapshot_json->>'total_minor','')::bigint,
                        (i.total_minor+i.tip_minor))::bigint original_invoice_grand_total_minor,
               CASE
                 WHEN r.tip_refund_minor > 0 AND r.service_refund_minor=0 AND r.tax_refund_minor=0 THEN 'TIP_ONLY'
                 WHEN r.tip_refund_minor > 0 THEN 'MIXED'
                 WHEN r.completed_minor >= (i.total_minor+i.tip_minor) THEN 'FULL'
                 ELSE 'PARTIAL'
               END refund_kind,
               COALESCE(adjustments.cumulative_adjustment_minor,0)::bigint cumulative_adjustment_minor,
               COALESCE(adjustments.adjustment_count,0)::int adjustment_count,
               delivery.latest_delivery_at,delivery.latest_delivery_channel
          FROM credit_notes c
          JOIN refunds r ON r.tenant_id=c.tenant_id AND r.id=c.refund_id
          JOIN invoices i ON i.tenant_id=c.tenant_id AND i.id=c.original_invoice_id
          JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
          LEFT JOIN users u ON u.id=c.issued_by_user_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(c2.total_minor),0)::bigint cumulative_adjustment_minor,
                   count(*)::int adjustment_count
              FROM credit_notes c2
             WHERE c2.tenant_id=c.tenant_id
               AND c2.original_invoice_id=c.original_invoice_id
               AND c2.status='ISSUED'
          ) adjustments ON true
          LEFT JOIN LATERAL (
            SELECT fe.occurred_at latest_delivery_at,
                   fe.payload_json->>'channel' latest_delivery_channel
              FROM financial_events fe
             WHERE fe.tenant_id=c.tenant_id
               AND fe.aggregate_type='credit_note'
               AND fe.aggregate_id=c.id
               AND fe.event_type='credit_note.delivery_requested'
             ORDER BY fe.occurred_at DESC,fe.id DESC
             LIMIT 1
          ) delivery ON true
      ), filtered AS (
        SELECT * FROM base WHERE ${where.join(" AND ")}
      )`;
    const countRow = (
      await this.db.query<any>(
        `${base}
         SELECT count(*)::int total,
                count(*) FILTER (WHERE status='ISSUED')::int issued,
                count(*) FILTER (WHERE status='DRAFT')::int drafts,
                count(DISTINCT original_invoice_id)::int adjusted_invoice_count,
                COALESCE(sum(total_minor),0)::bigint total_adjustment_minor,
                count(*) FILTER (WHERE latest_delivery_at IS NOT NULL)::int delivery_requested_count
           FROM filtered`,
        values,
      )
    ).rows[0] ?? {};
    const orderBy = {
      NEWEST: "COALESCE(issued_at,created_at) DESC,id DESC",
      OLDEST: "COALESCE(issued_at,created_at) ASC,id ASC",
      AMOUNT_DESC: "total_minor DESC,COALESCE(issued_at,created_at) DESC,id DESC",
      AMOUNT_ASC: "total_minor ASC,COALESCE(issued_at,created_at) ASC,id ASC",
    }[query.sort];
    const offset = (query.page - 1) * query.pageSize;
    const pageIndex = values.length + 1;
    const sizeIndex = values.length + 2;
    const rows = await this.db.query<any>(
      `${base}
       SELECT * FROM filtered ORDER BY ${orderBy} LIMIT $${pageIndex} OFFSET $${sizeIndex}`,
      [...values, query.pageSize, offset],
    );
    const total = Number(countRow.total ?? 0);
    const items = rows.rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      branchName: row.branch_name,
      branchCode: row.branch_code,
      branchTimezone: row.branch_timezone,
      refundId: row.refund_id,
      refundReference: row.refund_reference,
      refundStatus: row.refund_status,
      refundKind: row.refund_kind,
      originalInvoiceId: row.original_invoice_id,
      invoiceNumber: row.invoice_number,
      invoiceStatus: row.invoice_status,
      creditNoteNumber: row.credit_note_number,
      status: row.status,
      currency: row.currency,
      customerDisplayName: row.customer_display_name,
      customerPhone: canSeeCustomerPhone ? row.customer_phone : null,
      issuerDisplayName: row.issuer_display_name,
      grossMinor: Number(row.gross_minor ?? 0),
      discountReversalMinor: Number(row.discount_reversal_minor ?? 0),
      taxableMinor: Number(row.taxable_minor ?? 0),
      taxMinor: Number(row.tax_minor ?? 0),
      tipMinor: Number(row.tip_minor ?? 0),
      totalMinor: Number(row.total_minor ?? 0),
      originalInvoiceGrandTotalMinor: Number(row.original_invoice_grand_total_minor ?? 0),
      cumulativeAdjustmentMinor: Number(row.cumulative_adjustment_minor ?? 0),
      adjustedInvoiceValueMinor: Math.max(
        Number(row.original_invoice_grand_total_minor ?? 0) -
          Number(row.cumulative_adjustment_minor ?? 0),
        0,
      ),
      adjustmentCountForInvoice: Number(row.adjustment_count ?? 0),
      customerSnapshot: row.customer_snapshot_json,
      branchSnapshot: row.branch_snapshot_json,
      originalInvoiceSnapshot: row.original_invoice_snapshot_json,
      issuedAt: row.issued_at,
      createdAt: row.created_at,
      issuedByUserId: row.issued_by_user_id,
      version: Number(row.version ?? 1),
      deliveryStatusSupported: false,
      latestDeliveryState: row.latest_delivery_at ? "PENDING" : null,
      latestDeliveryChannel: row.latest_delivery_channel,
      latestDeliveryAt: row.latest_delivery_at,
    }));
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      counts: {
        total,
        issued: Number(countRow.issued ?? 0),
        drafts: Number(countRow.drafts ?? 0),
        adjustedInvoiceCount: Number(countRow.adjusted_invoice_count ?? 0),
        totalAdjustmentMinor: Number(countRow.total_adjustment_minor ?? 0),
        deliverySupported: false,
        deliveryRequestedCount: Number(countRow.delivery_requested_count ?? 0),
      },
    };
  }
  async creditNote(auth: AccessClaims, id: string) {
    this.assert(auth);
    const row = (
      await this.db.query<any>(
        `SELECT c.*,r.refund_reference,r.status refund_status,r.requested_minor,
                r.approved_minor,r.completed_minor,r.service_refund_minor,
                r.tax_refund_minor,r.tip_refund_minor,r.currency refund_currency,
                r.reason_code,r.reason_text,r.requested_at,r.approved_at,r.completed_at,
                i.invoice_number,i.status invoice_status,i.total_minor invoice_total_minor,
                i.tip_minor invoice_tip_minor,i.currency invoice_currency,
                b.name branch_name,b.code branch_code,b.timezone branch_timezone,
                u.display_name issuer_display_name
           FROM credit_notes c
           JOIN refunds r ON r.tenant_id=c.tenant_id AND r.id=c.refund_id
           JOIN invoices i ON i.tenant_id=c.tenant_id AND i.id=c.original_invoice_id
           JOIN branches b ON b.tenant_id=c.tenant_id AND b.id=c.branch_id
           LEFT JOIN users u ON u.id=c.issued_by_user_id
          WHERE c.tenant_id=$1 AND c.id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row || !this.branchAllowed(auth, row.branch_id))
      throw new NotFoundException({
        code: "CREDIT_NOTE_NOT_FOUND",
        message: "Credit note not found",
      });
    const lines = (
      await this.db.query<any>(
        "SELECT * FROM credit_note_lines WHERE tenant_id=$1 AND credit_note_id=$2 ORDER BY line_no",
        [auth.tenantId, id],
      )
    ).rows;
    const cumulative = (
      await this.db.query<any>(
        `SELECT COALESCE(sum(total_minor),0)::bigint cumulative_adjustment_minor,
                count(*)::int adjustment_count
           FROM credit_notes
          WHERE tenant_id=$1 AND original_invoice_id=$2 AND status='ISSUED'`,
        [auth.tenantId, row.original_invoice_id],
      )
    ).rows[0] ?? {};
    const history = (
      await this.db.query<any>(
        `SELECT fe.event_type,fe.occurred_at,fe.payload_json,fe.actor_user_id,
                u.display_name actor_display_name
           FROM financial_events fe
           LEFT JOIN users u ON u.id=fe.actor_user_id
          WHERE fe.tenant_id=$1 AND fe.aggregate_type='credit_note' AND fe.aggregate_id=$2
          ORDER BY fe.occurred_at ASC,fe.id ASC`,
        [auth.tenantId, id],
      )
    ).rows;
    const allocations = (
      await this.db.query<any>(
        `SELECT tender_type,planned_minor,completed_minor,status,provider,
                provider_refund_id,completed_at
           FROM refund_payment_allocations
          WHERE tenant_id=$1 AND refund_id=$2 ORDER BY created_at,id`,
        [auth.tenantId, row.refund_id],
      )
    ).rows;
    const originalTotal = Number(
      row.original_invoice_snapshot_json?.grandTotalMinor ??
        row.original_invoice_snapshot_json?.grand_total_minor ??
        row.original_invoice_snapshot_json?.totalMinor ??
        Number(row.invoice_total_minor ?? 0) + Number(row.invoice_tip_minor ?? 0),
    );
    const cumulativeMinor = Number(cumulative.cumulative_adjustment_minor ?? 0);
    const latestDelivery = [...history]
      .reverse()
      .find((event) => event.event_type === "credit_note.delivery_requested");
    return {
      ...creditNoteView(row),
      lines,
      context: {
        issuer: row.issuer_display_name
          ? { id: row.issued_by_user_id, displayName: row.issuer_display_name }
          : null,
        branch: {
          id: row.branch_id,
          name: row.branch_name,
          code: row.branch_code,
          timezone: row.branch_timezone,
        },
        customer: row.customer_snapshot_json,
        invoice: {
          id: row.original_invoice_id,
          number: row.invoice_number,
          status: row.invoice_status,
          currency: row.invoice_currency,
          snapshot: row.original_invoice_snapshot_json,
          originalGrandTotalMinor: originalTotal,
          cumulativeAdjustmentMinor: cumulativeMinor,
          adjustedInvoiceValueMinor: Math.max(originalTotal - cumulativeMinor, 0),
        },
        refund: {
          id: row.refund_id,
          reference: row.refund_reference,
          status: row.refund_status,
          requestedMinor: Number(row.requested_minor ?? 0),
          approvedMinor: Number(row.approved_minor ?? 0),
          completedMinor: Number(row.completed_minor ?? 0),
          serviceRefundMinor: Number(row.service_refund_minor ?? 0),
          taxRefundMinor: Number(row.tax_refund_minor ?? 0),
          tipRefundMinor: Number(row.tip_refund_minor ?? 0),
          reasonCode: row.reason_code,
          reasonText: row.reason_text,
          requestedAt: row.requested_at,
          approvedAt: row.approved_at,
          completedAt: row.completed_at,
          allocations: allocations.map((allocation) => ({
            tenderType: allocation.tender_type,
            plannedMinor: Number(allocation.planned_minor ?? 0),
            completedMinor: Number(allocation.completed_minor ?? 0),
            status: allocation.status,
            provider: allocation.provider,
            providerRefundId: allocation.provider_refund_id,
            completedAt: allocation.completed_at,
          })),
        },
        delivery: {
          supported: false,
          latestState: latestDelivery ? "PENDING" : null,
          latestChannel: latestDelivery?.payload_json?.channel ?? null,
          requestedAt: latestDelivery?.occurred_at ?? null,
          note: latestDelivery
            ? "Yêu cầu phân phối đã được ghi nhận; trạng thái gửi cuối cùng chưa được persist."
            : "Chưa có yêu cầu phân phối được ghi nhận.",
        },
        history: history.map((event) => ({
          event: event.event_type,
          occurredAt: event.occurred_at,
          actorUserId: event.actor_user_id,
          actorDisplayName: event.actor_display_name,
          payload: event.payload_json,
        })),
      },
    };
  }
  async print(auth: AccessClaims, id: string) {
    const note = await this.creditNote(auth, id);
    return {
      documentType: "CREDIT_NOTE",
      locale: "vi-VN",
      generatedAt: new Date().toISOString(),
      creditNote: note,
    };
  }
  async deliver(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = creditNoteDeliverySchema.parse(input);
    const note = await this.creditNote(auth, id);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "credit_note.deliver",
          key,
          request: { id, ...body },
          work: async () => {
            await this.evidence.record(client, {
              auth,
              branchId: note.branchId,
              event: "credit_note.delivery_requested",
              aggregateType: "credit_note",
              aggregateId: id,
              aggregateVersion: note.version,
              requestId,
              currency: note.currency,
              amountMinor: BigInt(note.totalMinor),
              idempotencyKey: key,
              payload: {
                channel: body.channel,
                destinationRedacted: body.destination
                  ? redact(body.destination)
                  : null,
              },
            });
            return {
              creditNoteId: id,
              channel: body.channel,
              status: body.channel === "PRINT" ? "READY" : "PENDING",
            };
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }

  async createExport(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = financialExportSchema.parse(input);
    this.assert(auth, body.branchId);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "financial.export",
          key,
          request: body,
          work: async () => {
            const row = (
              await client.query<any>(
                `INSERT INTO financial_export_jobs(tenant_id,branch_id,export_type,filters_json,requested_by_user_id,expires_at)
           VALUES($1,$2,$3,$4,$5,now()+interval '24 hours') RETURNING *`,
                [
                  auth.tenantId,
                  body.branchId ?? null,
                  body.exportType,
                  JSON.stringify(body.filters),
                  auth.userId,
                ],
              )
            ).rows[0];
            const branchId =
              body.branchId ??
              auth.branchIds[0] ??
              (
                await client.query<any>(
                  "SELECT id FROM branches WHERE tenant_id=$1 ORDER BY code,id LIMIT 1",
                  [auth.tenantId],
                )
              ).rows[0]?.id;
            if (!branchId)
              throw new NotFoundException({
                code: "BRANCH_NOT_FOUND",
                message: "Financial export requires a tenant branch",
              });
            await this.evidence.record(client, {
              auth,
              branchId,
              event: "financial.export_requested",
              aggregateType: "financial_export",
              aggregateId: row.id,
              aggregateVersion: 1,
              requestId,
              currency: "VND",
              idempotencyKey: key,
              payload: { exportType: body.exportType, status: row.status },
            });
            return exportView(row);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  async export(auth: AccessClaims, id: string) {
    this.assert(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM financial_export_jobs WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row || (row.branch_id && !this.branchAllowed(auth, row.branch_id)))
      throw new NotFoundException({
        code: "FINANCIAL_EXPORT_NOT_FOUND",
        message: "Export not found",
      });
    return exportView(row);
  }

  private async report(
    auth: AccessClaims,
    query: any,
    sql: string,
    includeDate = true,
  ) {
    this.assert(auth, query?.branchId);
    const rows = (
      await this.db.query<any>(sql, [
        auth.tenantId,
        query?.branchId ?? null,
        includeDate ? (query?.from ?? null) : null,
        includeDate ? (query?.to ?? null) : null,
      ])
    ).rows;
    return {
      filters: {
        branchId: query?.branchId ?? null,
        from: query?.from ?? null,
        to: query?.to ?? null,
      },
      rows: rows.map(moneyNumbers),
      generatedAt: new Date().toISOString(),
    };
  }
  private assert(auth: AccessClaims, branchId?: string) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support Access Grant is required",
      });
    if (branchId && !this.branchAllowed(auth, branchId))
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
  }
  private branchAllowed(auth: AccessClaims, id: string) {
    return auth.roles.includes("SALON_OWNER") || auth.branchIds.includes(id);
  }
}

function overviewComparisonRange(query: any): { from: string; to: string } | null {
  if (query.comparisonMode === "NONE") return null;
  if (query.comparisonMode === "CUSTOM") return { from: query.comparisonFrom, to: query.comparisonTo };
  if (query.comparisonMode === "PREVIOUS_YEAR") return { from: shiftIsoDateByYears(query.from, -1), to: shiftIsoDateByYears(query.to, -1) };
  const days = daysBetween(query.from, query.to);
  const to = shiftIsoDate(query.from, -1);
  return { from: shiftIsoDate(to, -(days - 1)), to };
}

function shiftIsoDate(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function shiftIsoDateByYears(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCFullYear(date.getUTCFullYear() + amount);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function sumNetSalesRows(rows: Array<Record<string, any>>) {
  const total = (key: string) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const invoiceRevenueMinor = total("invoiceRevenueMinor");
  const completedRefundMinor = total("completedRefundMinor");
  return {
    invoiceRevenueMinor,
    grossBeforeDiscountMinor: total("grossBeforeDiscountMinor"),
    discountMinor: total("discountMinor"),
    taxMinor: total("taxMinor"),
    completedRefundMinor,
    netSalesMinor: invoiceRevenueMinor - completedRefundMinor,
    tipMinor: total("tipMinor"),
    paidOrderCount: total("paidOrderCount"),
  };
}

function overviewPercentage(current: number, previous: number) {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
}

function overviewComparison(current: number, previous: number, mode: string) {
  return {
    currentNetSalesMinor: current,
    previousNetSalesMinor: mode === "NONE" ? null : previous,
    changeMinor: mode === "NONE" ? null : current - previous,
    changePercent: mode === "NONE" ? null : overviewPercentage(current, previous),
    comparisonMode: mode,
    comparisonState: mode === "NONE" ? "NOT_REQUESTED" : previous ? "CALCULATED" : "ZERO_BASELINE",
  };
}

function buildNetSalesAlerts(totals: { invoiceRevenueMinor: number; completedRefundMinor: number }) {
  if (totals.completedRefundMinor <= totals.invoiceRevenueMinor) return [];
  return [{
    code: "REFUND_EXCEEDS_INVOICE_REVENUE",
    severity: "WARNING",
    message: "Giá trị refund đã hoàn tất đang lớn hơn doanh thu hóa đơn trong kỳ; cần kiểm tra dữ liệu nguồn.",
  }];
}

const creditNoteView = (r: any) => ({
  id: r.id,
  branchId: r.branch_id,
  refundId: r.refund_id,
  originalInvoiceId: r.original_invoice_id,
  creditNoteNumber: r.credit_note_number,
  status: r.status,
  currency: r.currency,
  grossMinor: Number(r.gross_minor),
  discountReversalMinor: Number(r.discount_reversal_minor),
  taxableMinor: Number(r.taxable_minor),
  taxMinor: Number(r.tax_minor),
  tipMinor: Number(r.tip_minor),
  totalMinor: Number(r.total_minor),
  customerSnapshot: r.customer_snapshot_json,
  branchSnapshot: r.branch_snapshot_json,
  originalInvoiceSnapshot: r.original_invoice_snapshot_json,
  issuedAt: r.issued_at,
  createdAt: r.created_at,
  issuedByUserId: r.issued_by_user_id,
  version: Number(r.version),
});
const exportView = (r: any) => ({
  id: r.id,
  branchId: r.branch_id,
  exportType: r.export_type,
  filters: r.filters_json,
  status: r.status,
  downloadAvailable: r.status === "READY",
  completedAt: r.completed_at,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});
const redact = (value: string) =>
  value.length <= 4 ? "****" : `${value.slice(0, 2)}***${value.slice(-2)}`;
const moneyNumbers = (row: any) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      /_minor$/.test(key) ? Number(value) : value,
    ]),
  );
