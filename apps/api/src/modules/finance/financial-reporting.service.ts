/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  creditNoteDeliverySchema,
  financialExportSchema,
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
      `SELECT i.branch_id,i.currency,COALESCE(sum(i.total_minor),0) gross_invoice_minor,
              COALESCE(sum(rs.completed_refund_minor),0) refund_minor,
              COALESCE(sum(i.total_minor-rs.completed_refund_minor),0) net_sales_minor
         FROM invoices i JOIN invoice_refund_summary rs ON rs.tenant_id=i.tenant_id AND rs.invoice_id=i.id
        WHERE i.tenant_id=$1 AND ($2::uuid IS NULL OR i.branch_id=$2) AND i.issued_at >= COALESCE($3::timestamptz,'-infinity')
          AND i.issued_at < COALESCE($4::timestamptz,'infinity') GROUP BY i.branch_id,i.currency ORDER BY i.branch_id,i.currency`,
    );
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
  async creditNote(auth: AccessClaims, id: string) {
    this.assert(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM credit_notes WHERE tenant_id=$1 AND id=$2",
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
    return { ...creditNoteView(row), lines };
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
