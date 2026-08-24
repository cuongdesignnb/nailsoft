/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30;
const MODEL = "EXPLICIT_LAST_TOUCH" as const;
const TERMINAL_APPOINTMENT_STATUSES = [
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_SALON",
  "CANCELLED",
  "EXPIRED",
  "NO_SHOW",
  "NO_SHOW_CHARGED",
];

type AttributionResult = {
  status:
    | "NONE"
    | "ATTACHED"
    | "INVALID"
    | "EXPIRED"
    | "REPLAYED"
    | "CUSTOMER_MISMATCH"
    | "BRANCH_MISMATCH"
    | "BOOKING_ALREADY_ATTRIBUTED";
  attributionId?: string;
  campaignId?: string;
  contextId?: string;
  model?: typeof MODEL;
};

@Injectable()
export class MarketingAttributionService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async issueContext(
    auth: AccessClaims,
    campaignId: string,
    recipientId: string,
    key: string,
    requestId: string,
  ) {
    this.assertAccess(auth);
    if (!key || key.length < 16)
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key is required",
      });
    const actorScope = `user:${auth.userId}`;
    const command = "marketing.attribution.context.issue";
    const storedKey = this.hash(`${actorScope}:${command}:${key}`);
    const requestHash = this.hash(JSON.stringify({ campaignId, recipientId }));
    return this.db.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${auth.tenantId}:${storedKey}`],
      );
      const existing = (
        await client.query<any>(
          "SELECT request_hash,state,response_body_json FROM idempotency_keys WHERE tenant_id=$1 AND key=$2 FOR UPDATE",
          [auth.tenantId, storedKey],
        )
      ).rows[0];
      if (existing?.request_hash && existing.request_hash !== requestHash)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency key was already used for a different request",
        });
      if (existing?.state === "COMPLETED" && existing.response_body_json) {
        const replay = existing.response_body_json as { contextId: string };
        const tenant = (
          await client.query<{ slug: string }>(
            "SELECT slug FROM tenants WHERE id=$1",
            [auth.tenantId],
          )
        ).rows[0];
        return {
          ...replay,
          attributionReference: replay.contextId,
          bookingUrl: tenant
            ? `/book/${encodeURIComponent(tenant.slug)}?attribution=${encodeURIComponent(replay.contextId)}`
            : null,
          replayed: true,
        };
      }
      if (!existing)
        await client.query(
          "INSERT INTO idempotency_keys(tenant_id,key,request_hash,state,expires_at,actor_scope,command_type,idempotency_key_hash) VALUES($1,$2,$3,'PROCESSING',now()+interval '24 hours',$4,$5,$6)",
          [
            auth.tenantId,
            storedKey,
            requestHash,
            actorScope,
            command,
            this.hash(key),
          ],
        );

      const row = (
        await client.query<any>(
          `SELECT c.id,c.branch_id,c.status,c.audience_generation,
                  a.id recipient_id,a.customer_id,a.generation,a.status recipient_status,
                  a.snapshotted_at,t.slug tenant_slug
             FROM marketing_campaigns c
             JOIN marketing_campaign_audience a
               ON a.tenant_id=c.tenant_id AND a.campaign_id=c.id
             JOIN tenants t ON t.id=c.tenant_id
            WHERE c.tenant_id=$1 AND c.id=$2 AND a.id=$3
              AND a.generation=c.audience_generation
            FOR UPDATE OF c,a`,
          [auth.tenantId, campaignId, recipientId],
        )
      ).rows[0];
      if (!row) throw new NotFoundException({ code: "MARKETING_RECIPIENT_NOT_FOUND" });
      this.assertBranch(auth, row.branch_id);
      if (!["APPROVED", "SCHEDULED", "RUNNING", "PAUSED"].includes(row.status))
        throw new ConflictException({ code: "MARKETING_ATTRIBUTION_CONTEXT_CAMPAIGN_INVALID" });
      if (!["ELIGIBLE", "SENT"].includes(row.recipient_status))
        throw new ConflictException({ code: "MARKETING_ATTRIBUTION_RECIPIENT_NOT_ELIGIBLE" });

      const contextId = randomUUID();
      const expiresAt = new Date(
        Date.now() + DEFAULT_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );
      const context = (
        await client.query<any>(
          `INSERT INTO marketing_attribution_contexts(
             id,tenant_id,campaign_id,recipient_id,customer_id,generation,reference_hash,model,status,valid_from,expires_at,issued_by_user_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',now(),$9,$10)
           RETURNING id,expires_at,model`,
          [
            contextId,
            auth.tenantId,
            campaignId,
            recipientId,
            row.customer_id,
            row.generation,
            this.hash(contextId),
            MODEL,
            expiresAt,
            auth.userId,
          ],
        )
      ).rows[0];
      const safeResponse = {
        contextId: context.id,
        campaignId,
        recipientId,
        model: context.model,
        expiresAt: context.expires_at,
      };
      await client.query(
        "UPDATE idempotency_keys SET state='COMPLETED',response_status=200,response_body_json=$3 WHERE tenant_id=$1 AND key=$2",
        [auth.tenantId, storedKey, JSON.stringify(safeResponse)],
      );
      await this.audit(
        client,
        auth.tenantId,
        auth.userId,
        row.branch_id,
        "marketing.attribution_context_issued",
        "marketing_attribution_context",
        context.id,
        requestId,
        { campaignId, recipientId, customerId: row.customer_id, model: MODEL, expiresAt: context.expires_at },
      );
      return {
        ...safeResponse,
        attributionReference: context.id,
        bookingUrl: `/book/${encodeURIComponent(row.tenant_slug)}?attribution=${encodeURIComponent(context.id)}`,
        replayed: false,
      };
    });
  }

  async attach(
    client: PoolClient,
    input: {
      tenantId: string;
      attributionReference?: string | null;
      customerId: string;
      appointmentId: string;
      branchId: string;
      actorUserId?: string | null;
      requestId: string;
    },
  ): Promise<AttributionResult> {
    if (!input.attributionReference) return { status: "NONE" };
    const context = (
      await client.query<any>(
        `SELECT x.id,x.campaign_id,x.recipient_id,x.customer_id,x.generation,x.model,x.status,x.expires_at,
                c.status campaign_status,c.audience_generation,c.branch_id campaign_branch_id
           FROM marketing_attribution_contexts x
           JOIN marketing_campaigns c ON c.tenant_id=x.tenant_id AND c.id=x.campaign_id
          WHERE x.tenant_id=$1 AND x.reference_hash=$2
          FOR UPDATE OF x`,
        [input.tenantId, this.hash(input.attributionReference)],
      )
    ).rows[0];
    if (!context) return { status: "INVALID" };
    if (new Date(context.expires_at).getTime() <= Date.now() && context.status === "ACTIVE") {
      await client.query(
        "UPDATE marketing_attribution_contexts SET status='EXPIRED',version=version+1 WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
        [input.tenantId, context.id],
      );
      return { status: "EXPIRED", contextId: context.id, campaignId: context.campaign_id };
    }
    if (context.status !== "ACTIVE")
      return {
        status: context.status === "EXPIRED" ? "EXPIRED" : "REPLAYED",
        contextId: context.id,
        campaignId: context.campaign_id,
      };
    if (context.customer_id !== input.customerId)
      return {
        status: "CUSTOMER_MISMATCH",
        contextId: context.id,
        campaignId: context.campaign_id,
      };
    if (context.campaign_branch_id && context.campaign_branch_id !== input.branchId)
      return {
        status: "BRANCH_MISMATCH",
        contextId: context.id,
        campaignId: context.campaign_id,
      };
    if (
      context.generation !== context.audience_generation ||
      !["APPROVED", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED"].includes(context.campaign_status)
    )
      return { status: "INVALID", contextId: context.id, campaignId: context.campaign_id };

    const existing = (
      await client.query<any>(
        "SELECT id,attribution_context_id,campaign_id FROM marketing_booking_attributions WHERE tenant_id=$1 AND appointment_id=$2 FOR UPDATE",
        [input.tenantId, input.appointmentId],
      )
    ).rows[0];
    if (existing) {
      if (existing.attribution_context_id === context.id)
        return {
          status: "ATTACHED",
          attributionId: existing.id,
          contextId: context.id,
          campaignId: existing.campaign_id,
          model: MODEL,
        };
      return {
        status: "BOOKING_ALREADY_ATTRIBUTED",
        attributionId: existing.id,
        contextId: context.id,
        campaignId: existing.campaign_id,
        model: MODEL,
      };
    }
    const attributionId = randomUUID();
    await client.query(
      `INSERT INTO marketing_booking_attributions(
         id,tenant_id,campaign_id,recipient_id,customer_id,appointment_id,attribution_context_id,model,source
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'MARKETING_BOOKING_CONTEXT')`,
      [
        attributionId,
        input.tenantId,
        context.campaign_id,
        context.recipient_id,
        input.customerId,
        input.appointmentId,
        context.id,
        MODEL,
      ],
    );
    await client.query(
      `UPDATE marketing_attribution_contexts
          SET status='CONSUMED',consumed_at=now(),consumed_by_appointment_id=$3,version=version+1
        WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'`,
      [input.tenantId, context.id, input.appointmentId],
    );
    await this.audit(
      client,
      input.tenantId,
      input.actorUserId ?? null,
      input.branchId,
      "marketing.booking_attributed",
      "marketing_booking_attribution",
      attributionId,
      input.requestId,
      { campaignId: context.campaign_id, customerId: input.customerId, appointmentId: input.appointmentId, contextId: context.id, model: MODEL },
    );
    return {
      status: "ATTACHED",
      attributionId,
      contextId: context.id,
      campaignId: context.campaign_id,
      model: MODEL,
    };
  }

  async projectPaidOrder(
    client: PoolClient,
    tenantId: string,
    orderId: string,
    invoiceId: string | null,
    paymentId: string | null,
    requestId: string,
  ) {
    const row = (
      await client.query<any>(
        `SELECT ba.id attribution_id,ba.campaign_id,ba.customer_id,ba.appointment_id,ba.attributed_at,
                a.status appointment_status,a.branch_id,o.status order_status,o.customer_id order_customer_id,
                o.currency order_currency,o.id order_id,i.id invoice_id,i.status invoice_status,i.currency invoice_currency
           FROM marketing_booking_attributions ba
           JOIN appointments a ON a.tenant_id=ba.tenant_id AND a.id=ba.appointment_id
           JOIN pos_orders o ON o.tenant_id=ba.tenant_id AND o.id=$2 AND o.appointment_id=a.id
           JOIN invoices i ON i.tenant_id=o.tenant_id AND i.pos_order_id=o.id
            AND i.id=COALESCE($3::uuid,(SELECT i2.id FROM invoices i2 WHERE i2.tenant_id=o.tenant_id AND i2.pos_order_id=o.id ORDER BY i2.issued_at DESC NULLS LAST,i2.id DESC LIMIT 1))
          WHERE ba.tenant_id=$1`,
        [tenantId, orderId, invoiceId],
      )
    ).rows[0];
    if (!row) return { status: "NONE" as const };
    if (
      row.order_status !== "PAID" ||
      row.invoice_status !== "ISSUED" ||
      row.order_currency !== row.invoice_currency ||
      TERMINAL_APPOINTMENT_STATUSES.includes(row.appointment_status)
    )
      return { status: "INELIGIBLE" as const, attributionId: row.attribution_id };
    if (row.order_customer_id !== row.customer_id)
      return { status: "INELIGIBLE" as const, attributionId: row.attribution_id };
    if (paymentId) {
      const payment = (
        await client.query<any>(
          "SELECT id FROM payments WHERE tenant_id=$1 AND id=$2 AND pos_order_id=$3 AND status='CAPTURED'",
          [tenantId, paymentId, orderId],
        )
      ).rows[0];
      if (!payment) return { status: "INELIGIBLE" as const, attributionId: row.attribution_id };
    }
    const existing = (
      await client.query<any>(
        "SELECT id FROM marketing_attributed_financial_evidence WHERE tenant_id=$1 AND invoice_id=$2",
        [tenantId, row.invoice_id],
      )
    ).rows[0];
    if (existing) return { status: "POSTED" as const, evidenceId: existing.id, attributionId: row.attribution_id };
    const gross = (
      await client.query<any>(
        `SELECT COALESCE(sum(il.net_minor),0)::bigint gross_minor
           FROM invoice_lines il
           JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
          WHERE il.tenant_id=$1 AND il.invoice_id=$2 AND pol.line_type<>'GIFT_CARD'`,
        [tenantId, row.invoice_id],
      )
    ).rows[0]?.gross_minor ?? 0;
    const evidenceId = randomUUID();
    await client.query(
      `INSERT INTO marketing_attributed_financial_evidence(
         id,tenant_id,booking_attribution_id,campaign_id,customer_id,appointment_id,order_id,invoice_id,payment_id,currency,gross_eligible_revenue_minor,evidence_json
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        evidenceId,
        tenantId,
        row.attribution_id,
        row.campaign_id,
        row.customer_id,
        row.appointment_id,
        row.order_id,
        row.invoice_id,
        paymentId,
        row.invoice_currency,
        gross,
        JSON.stringify({ formulaVersion: "NET_SALES_V1", orderStatus: row.order_status, invoiceStatus: row.invoice_status, paymentId }),
      ],
    );
    await this.audit(
      client,
      tenantId,
      null,
      row.branch_id,
      "marketing.attributed_financial_evidence_posted",
      "marketing_attributed_financial_evidence",
      evidenceId,
      requestId,
      { attributionId: row.attribution_id, campaignId: row.campaign_id, orderId: row.order_id, invoiceId: row.invoice_id, currency: row.invoice_currency, grossEligibleRevenueMinor: String(gross) },
    );
    return { status: "POSTED" as const, evidenceId, attributionId: row.attribution_id, grossEligibleRevenueMinor: Number(gross) };
  }

  async projectRefundAdjustment(
    client: PoolClient,
    tenantId: string,
    refundId: string,
    requestId: string,
  ) {
    const refund = (
      await client.query<any>(
        "SELECT id,branch_id,invoice_id,status,currency FROM refunds WHERE tenant_id=$1 AND id=$2",
        [tenantId, refundId],
      )
    ).rows[0];
    if (!refund || refund.status !== "COMPLETED") return { status: "NONE" as const };
    const evidence = (
      await client.query<any>(
        "SELECT id,campaign_id,currency,invoice_id FROM marketing_attributed_financial_evidence WHERE tenant_id=$1 AND invoice_id=$2",
        [tenantId, refund.invoice_id],
      )
    ).rows[0];
    if (!evidence) return { status: "NONE" as const };
    const note = (
      await client.query<any>(
        "SELECT id FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2 AND status='ISSUED'",
        [tenantId, refund.id],
      )
    ).rows[0];
    if (!note) return { status: "PENDING_EVIDENCE" as const, evidenceId: evidence.id };
    const amount = (
      await client.query<any>(
        `SELECT COALESCE(sum(ri.total_refund_minor),0)::bigint amount_minor
           FROM refund_items ri
           JOIN invoice_lines il ON il.tenant_id=ri.tenant_id AND il.id=ri.invoice_line_id
           JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
          WHERE ri.tenant_id=$1 AND ri.refund_id=$2 AND ri.item_type='INVOICE_LINE' AND pol.line_type<>'GIFT_CARD'`,
        [tenantId, refund.id],
      )
    ).rows[0]?.amount_minor ?? 0;
    const existing = (
      await client.query<any>(
        "SELECT id FROM marketing_attribution_revenue_adjustments WHERE tenant_id=$1 AND refund_id=$2",
        [tenantId, refund.id],
      )
    ).rows[0];
    if (existing) return { status: "POSTED" as const, adjustmentId: existing.id, evidenceId: evidence.id };
    const adjustmentId = randomUUID();
    await client.query(
      `INSERT INTO marketing_attribution_revenue_adjustments(
         id,tenant_id,financial_evidence_id,campaign_id,refund_id,credit_note_id,currency,adjustment_type,amount_minor,evidence_json
       ) VALUES($1,$2,$3,$4,$5,$6,$7,'REFUND',$8,$9)`,
      [
        adjustmentId,
        tenantId,
        evidence.id,
        evidence.campaign_id,
        refund.id,
        note.id,
        evidence.currency,
        amount,
        JSON.stringify({ refundStatus: refund.status, creditNoteId: note.id, source: "REFUND_ITEMS_INVOICE_LINE" }),
      ],
    );
    await this.audit(
      client,
      tenantId,
      null,
      refund.branch_id,
      "marketing.attributed_revenue_refund_adjusted",
      "marketing_attribution_revenue_adjustment",
      adjustmentId,
      requestId,
      { evidenceId: evidence.id, campaignId: evidence.campaign_id, refundId: refund.id, creditNoteId: note.id, currency: evidence.currency, amountMinor: String(amount) },
    );
    return { status: "POSTED" as const, adjustmentId, evidenceId: evidence.id, amountMinor: Number(amount) };
  }

  async campaignSummary(auth: AccessClaims, campaignId: string) {
    this.assertAccess(auth);
    const campaign = (
      await this.db.query<any>(
        "SELECT id,branch_id FROM marketing_campaigns WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, campaignId],
      )
    ).rows[0];
    if (!campaign) throw new NotFoundException({ code: "CAMPAIGN_NOT_FOUND" });
    this.assertBranch(auth, campaign.branch_id);
    const rows = (
      await this.db.query<any>(
        `SELECT fe.currency,
                count(DISTINCT ba.id)::int attributed_bookings,
                count(DISTINCT ba.id) FILTER (WHERE a.status IN('COMPLETED','CHECKED_OUT','PAID'))::int completed_bookings,
                count(DISTINCT fe.order_id)::int attributed_paid_orders,
                COALESCE(sum(fe.gross_eligible_revenue_minor),0)::bigint gross_minor,
                COALESCE(sum(adj.refund_minor),0)::bigint refund_minor
           FROM marketing_booking_attributions ba
           JOIN appointments a ON a.tenant_id=ba.tenant_id AND a.id=ba.appointment_id
           LEFT JOIN marketing_attributed_financial_evidence fe ON fe.tenant_id=ba.tenant_id AND fe.booking_attribution_id=ba.id
           LEFT JOIN LATERAL (
             SELECT COALESCE(sum(ra.amount_minor),0)::bigint refund_minor
               FROM marketing_attribution_revenue_adjustments ra
              WHERE ra.tenant_id=fe.tenant_id AND ra.financial_evidence_id=fe.id
           ) adj ON true
          WHERE ba.tenant_id=$1 AND ba.campaign_id=$2
          GROUP BY fe.currency
          ORDER BY fe.currency NULLS LAST`,
        [auth.tenantId, campaignId],
      )
    ).rows;
    const bookingCounts = (
      await this.db.query<any>(
        `SELECT count(*)::int attributed_bookings,
                count(*) FILTER (WHERE a.status IN('COMPLETED','CHECKED_OUT','PAID'))::int completed_bookings,
                count(*) FILTER (WHERE fe.id IS NOT NULL)::int attributed_paid_orders
           FROM marketing_booking_attributions ba
           JOIN appointments a ON a.tenant_id=ba.tenant_id AND a.id=ba.appointment_id
           LEFT JOIN marketing_attributed_financial_evidence fe ON fe.tenant_id=ba.tenant_id AND fe.booking_attribution_id=ba.id
          WHERE ba.tenant_id=$1 AND ba.campaign_id=$2`,
        [auth.tenantId, campaignId],
      )
    ).rows[0] ?? {};
    const evidence = (
      await this.db.query<any>(
        `SELECT ba.id attribution_id,ba.source attribution_source,ba.customer_id,ba.appointment_id,
                a.booking_reference,a.start_at booking_at,a.status appointment_status,a.branch_id,
                b.name branch_name,
                fe.id evidence_id,fe.order_id,po.order_number,po.status order_status,
                fe.invoice_id,i.invoice_number,i.status invoice_status,fe.currency,
                payment.status payment_status,
                fe.gross_eligible_revenue_minor gross_minor,COALESCE(sum(ra.amount_minor),0)::bigint refund_minor,
                fe.recorded_at
           FROM marketing_booking_attributions ba
           JOIN appointments a ON a.tenant_id=ba.tenant_id AND a.id=ba.appointment_id
           LEFT JOIN branches b ON b.tenant_id=a.tenant_id AND b.id=a.branch_id
           LEFT JOIN marketing_attributed_financial_evidence fe ON fe.tenant_id=ba.tenant_id AND fe.booking_attribution_id=ba.id
           LEFT JOIN pos_orders po ON po.tenant_id=fe.tenant_id AND po.id=fe.order_id
           LEFT JOIN invoices i ON i.tenant_id=fe.tenant_id AND i.id=fe.invoice_id
           LEFT JOIN LATERAL (
             SELECT p.status
               FROM payments p
              WHERE p.tenant_id=fe.tenant_id AND p.pos_order_id=fe.order_id
              ORDER BY p.captured_at DESC NULLS LAST,p.created_at DESC,p.id DESC
              LIMIT 1
           ) payment ON true
           LEFT JOIN marketing_attribution_revenue_adjustments ra ON ra.tenant_id=fe.tenant_id AND ra.financial_evidence_id=fe.id
          WHERE ba.tenant_id=$1 AND ba.campaign_id=$2
          GROUP BY ba.id,ba.source,ba.customer_id,ba.appointment_id,a.booking_reference,a.start_at,a.status,a.branch_id,b.name,
                   fe.id,fe.order_id,po.order_number,po.status,fe.invoice_id,i.invoice_number,i.status,fe.currency,payment.status,
                   fe.gross_eligible_revenue_minor,fe.recorded_at
          ORDER BY ba.attributed_at DESC,ba.id DESC LIMIT 100`,
        [auth.tenantId, campaignId],
      )
    ).rows;
    const byCurrency = rows
      .filter((row) => row.currency)
      .map((row) => ({
        currency: row.currency,
        attributedBookings: Number(row.attributed_bookings ?? 0),
        completedAttributedBookings: Number(row.completed_bookings ?? 0),
        attributedPaidOrders: Number(row.attributed_paid_orders ?? 0),
        grossRevenueMinor: Number(row.gross_minor ?? 0),
        refundMinor: Number(row.refund_minor ?? 0),
        netRevenueMinor: Number(row.gross_minor ?? 0) - Number(row.refund_minor ?? 0),
      }));
    return {
      model: MODEL,
      attributionWindowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS,
      attributedBookings: Number(bookingCounts.attributed_bookings ?? 0),
      completedAttributedBookings: Number(bookingCounts.completed_bookings ?? 0),
      attributedPaidOrders: Number(bookingCounts.attributed_paid_orders ?? 0),
      byCurrency,
      evidence: evidence.map((row) => ({
        attributionId: row.attribution_id,
        attributionSource: row.attribution_source,
        customerId: row.customer_id,
        appointmentId: row.appointment_id,
        bookingReference: row.booking_reference,
        bookingAt: row.booking_at,
        appointmentStatus: row.appointment_status,
        branchId: row.branch_id,
        branchName: row.branch_name,
        financialEvidenceId: row.evidence_id,
        orderId: row.order_id,
        orderNumber: row.order_number,
        orderStatus: row.order_status,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        invoiceStatus: row.invoice_status,
        paymentStatus: row.payment_status,
        currency: row.currency,
        grossRevenueMinor: Number(row.gross_minor ?? 0),
        refundMinor: Number(row.refund_minor ?? 0),
        netRevenueMinor: Number(row.gross_minor ?? 0) - Number(row.refund_minor ?? 0),
        recordedAt: row.recorded_at,
      })),
      capabilities: { bookingAttribution: true, revenueAttribution: true, openTracking: false, clickTracking: false },
      generatedAt: new Date().toISOString(),
    };
  }

  async appointmentSummary(auth: AccessClaims, appointmentId: string) {
    this.assertAccess(auth);
    const row = (
      await this.db.query<any>(
        `SELECT ba.id attribution_id,ba.campaign_id,ba.customer_id,ba.appointment_id,ba.model,ba.attributed_at,
                a.booking_reference,a.status appointment_status,a.branch_id,
                c.name campaign_name,c.status campaign_status,
                fe.id evidence_id,fe.order_id,fe.invoice_id,fe.currency,fe.gross_eligible_revenue_minor gross_minor,
                COALESCE((SELECT sum(ra.amount_minor) FROM marketing_attribution_revenue_adjustments ra
                           WHERE ra.tenant_id=fe.tenant_id AND ra.financial_evidence_id=fe.id),0)::bigint refund_minor
           FROM marketing_booking_attributions ba
           JOIN appointments a ON a.tenant_id=ba.tenant_id AND a.id=ba.appointment_id
           JOIN marketing_campaigns c ON c.tenant_id=ba.tenant_id AND c.id=ba.campaign_id
           LEFT JOIN marketing_attributed_financial_evidence fe ON fe.tenant_id=ba.tenant_id AND fe.booking_attribution_id=ba.id
          WHERE ba.tenant_id=$1 AND ba.appointment_id=$2`,
        [auth.tenantId, appointmentId],
      )
    ).rows[0];
    if (!row) return { status: "NONE", generatedAt: new Date().toISOString() };
    this.assertBranch(auth, row.branch_id);
    return {
      status: "ATTRIBUTED",
      model: row.model,
      attributionId: row.attribution_id,
      campaignId: row.campaign_id,
      customerId: row.customer_id,
      appointmentId: row.appointment_id,
      bookingReference: row.booking_reference,
      appointmentStatus: row.appointment_status,
      campaign: { id: row.campaign_id, name: row.campaign_name, status: row.campaign_status },
      financial: row.evidence_id
        ? {
            evidenceId: row.evidence_id,
            orderId: row.order_id,
            invoiceId: row.invoice_id,
            currency: row.currency,
            grossRevenueMinor: Number(row.gross_minor ?? 0),
            refundMinor: Number(row.refund_minor ?? 0),
            netRevenueMinor: Number(row.gross_minor ?? 0) - Number(row.refund_minor ?? 0),
          }
        : null,
      generatedAt: new Date().toISOString(),
    };
  }

  async overview(auth: AccessClaims, from: string, to: string, branchId?: string) {
    this.assertAccess(auth);
    if (branchId) this.assertBranch(auth, branchId);
    const branches = this.branchScope(auth);
    const params = [auth.tenantId, branches, branchId ?? null, from, to];
    const totals = (
      await this.db.query<any>(
        `SELECT count(*)::int attributed_bookings,
                count(*) FILTER (WHERE a.status IN('COMPLETED','CHECKED_OUT','PAID'))::int completed_bookings
           FROM marketing_booking_attributions ba
           JOIN appointments a ON a.tenant_id=ba.tenant_id AND a.id=ba.appointment_id
           JOIN marketing_campaigns c ON c.tenant_id=ba.tenant_id AND c.id=ba.campaign_id
          WHERE ba.tenant_id=$1 AND ($2::uuid[] IS NULL OR c.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR c.branch_id=$3)
            AND ba.attributed_at >= $4::date AND ba.attributed_at < ($5::date + interval '1 day')`,
        params,
      )
    ).rows[0] ?? {};
    const rows = (
      await this.db.query<any>(
        `SELECT fe.currency,count(DISTINCT fe.order_id)::int attributed_paid_orders,
                COALESCE(sum(fe.gross_eligible_revenue_minor),0)::bigint gross_minor,
                COALESCE(sum(adj.refund_minor),0)::bigint refund_minor
           FROM marketing_attributed_financial_evidence fe
           JOIN marketing_booking_attributions ba ON ba.tenant_id=fe.tenant_id AND ba.id=fe.booking_attribution_id
           JOIN marketing_campaigns c ON c.tenant_id=ba.tenant_id AND c.id=ba.campaign_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(sum(ra.amount_minor),0)::bigint refund_minor
               FROM marketing_attribution_revenue_adjustments ra
              WHERE ra.tenant_id=fe.tenant_id AND ra.financial_evidence_id=fe.id
           ) adj ON true
          WHERE fe.tenant_id=$1 AND ($2::uuid[] IS NULL OR c.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR c.branch_id=$3)
            AND fe.recorded_at >= $4::date AND fe.recorded_at < ($5::date + interval '1 day')
          GROUP BY fe.currency ORDER BY fe.currency`,
        params,
      )
    ).rows;
    return {
      model: MODEL,
      attributionWindowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS,
      attributedBookings: Number(totals.attributed_bookings ?? 0),
      completedAttributedBookings: Number(totals.completed_bookings ?? 0),
      byCurrency: rows.map((row) => ({
        currency: row.currency,
        attributedPaidOrders: Number(row.attributed_paid_orders ?? 0),
        grossRevenueMinor: Number(row.gross_minor ?? 0),
        refundMinor: Number(row.refund_minor ?? 0),
        netRevenueMinor: Number(row.gross_minor ?? 0) - Number(row.refund_minor ?? 0),
      })),
      capabilities: { bookingAttribution: true, revenueAttribution: true, openTracking: false, clickTracking: false },
      generatedAt: new Date().toISOString(),
    };
  }

  private assertAccess(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN") && !auth.supportAccess)
      throw new ForbiddenException({ code: "PERMISSION_DENIED", message: "Support access grant required" });
  }

  private assertBranch(auth: AccessClaims, branchId: string | null) {
    this.assertAccess(auth);
    if (branchId && !auth.roles.includes("SALON_OWNER") && !this.branchScope(auth)?.includes(branchId))
      throw new ForbiddenException({ code: "BRANCH_ACCESS_DENIED", message: "Branch is outside membership scope" });
    if (!branchId && !auth.roles.includes("SALON_OWNER"))
      throw new ForbiddenException({ code: "TENANT_WIDE_MARKETING_OWNER_ONLY", message: "Tenant-wide campaign requires Salon Owner" });
  }

  private branchScope(auth: AccessClaims): string[] | null {
    if (auth.roles.includes("SALON_OWNER")) return null;
    return auth.supportAccess?.branchIds ?? auth.branchIds;
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private async audit(
    client: PoolClient,
    tenantId: string,
    actorUserId: string | null,
    branchId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    requestId: string,
    payload: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,request_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, branchId, actorUserId, action, entityType, entityId, JSON.stringify(payload), requestId],
    );
    await client.query(
      `INSERT INTO outbox_events(tenant_id,branch_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload_json,actor_json,metadata_json)
       VALUES($1,$2,$3,$4,$5,1,$6,$7,$8)`,
      [
        tenantId,
        branchId,
        action,
        entityType,
        entityId,
        JSON.stringify({ aggregateId: entityId, branchId, refetch: true }),
        JSON.stringify({ type: actorUserId ? "USER" : "SYSTEM", id: actorUserId }),
        JSON.stringify({ schemaVersion: 1, pii: false }),
      ],
    );
  }
}
