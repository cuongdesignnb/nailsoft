/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  paymentReconciliationBulkConfirmSchema,
  paymentReconciliationDecisionSchema,
  paymentReconciliationNoteSchema,
  paymentReconciliationQuerySchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "../pos/financial-evidence.service.js";

const money = (value: unknown) => (value == null ? null : Number(value));
const idempotency = (value?: string) => value ?? "";

@Injectable()
export class PaymentReconciliationService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
  ) {}

  async directory(auth: AccessClaims, input: unknown) {
    const query = paymentReconciliationQuerySchema.parse(input ?? {});
    this.assertTenant(auth);
    this.assertBranch(auth, query.branchId);
    const values = this.directoryValues(auth, query);
    const cte = this.evaluationCte();
    const filtered = this.filteredSql();
    const aggregate = await this.db.query<any>(
      `${cte}
       SELECT count(*)::int total,
              count(*) FILTER (WHERE case_type='MATCH')::int matched,
              count(*) FILTER (WHERE case_type<>'MATCH')::int review_required,
              count(*) FILTER (WHERE case_type='PROVIDER_UNRESOLVED')::int unresolved,
              count(*) FILTER (WHERE case_type='MISSING_INVOICE')::int missing_document,
              COALESCE(sum(confirmed_minor) FILTER (WHERE case_type='MATCH'),0)::bigint matched_minor,
              COALESCE(sum(expected_minor) FILTER (WHERE case_type<>'MATCH'),0)::bigint unreconciled_minor,
              COALESCE(sum(variance_minor) FILTER (WHERE case_type<>'MATCH'),0)::bigint variance_minor
         FROM classified
        WHERE ${filtered.where}`,
      values,
    );
    const mix = await this.db.query<any>(
      `${cte}
       SELECT tender_type,count(*)::int transaction_count,
              COALESCE(sum(captured_minor) FILTER (WHERE payment_status='CAPTURED'),0)::bigint captured_minor
         FROM classified
        WHERE ${filtered.where}
        GROUP BY tender_type ORDER BY tender_type`,
      values,
    );
    const count = aggregate.rows[0] ?? {};
    const total = Number(count.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const offset = (query.page - 1) * query.pageSize;
    const pageValues = [...values, query.pageSize, offset];
    const rows = await this.db.query<any>(
      `${cte}
       SELECT * FROM classified
        WHERE ${filtered.where}
        ORDER BY ${this.orderBy(query.sort)}
        LIMIT $11 OFFSET $12`,
      pageValues,
    );
    const capturedMinor = money(count.matched_minor) ?? 0;
    const capturedCount = Number(count.matched ?? 0);
    const paymentMix = mix.rows.map((row: any) => {
      const amount = money(row.captured_minor) ?? 0;
      return {
        tenderType: row.tender_type,
        transactionCount: Number(row.transaction_count ?? 0),
        capturedMinor: amount,
        percentage: capturedMinor > 0 ? Math.round((amount / capturedMinor) * 1000) / 10 : 0,
      };
    });
    return {
      items: rows.rows.map((row) => this.rowView(row, auth)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages },
      counts: {
        total,
        matched: Number(count.matched ?? 0),
        reviewRequired: Number(count.review_required ?? 0),
        unresolved: Number(count.unresolved ?? 0),
        missingDocument: Number(count.missing_document ?? 0),
      },
      summary: {
        matchedMinor: capturedMinor,
        unreconciledMinor: money(count.unreconciled_minor) ?? 0,
        varianceMinor: money(count.variance_minor) ?? 0,
        matchedPercentage: total > 0 ? Math.round((capturedCount / total) * 1000) / 10 : 0,
        paymentMix,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async detail(auth: AccessClaims, paymentId: string, requestId: string) {
    this.assertTenant(auth);
    let row = await this.evaluateOne(this.db, auth, paymentId);
    if (!row) throw new NotFoundException({ code: "PAYMENT_RECONCILIATION_NOT_FOUND", message: "Payment reconciliation case not found" });
    if (!row.review_id) {
      await this.ensureReview(auth, row, requestId);
      row = await this.evaluateOne(this.db, auth, paymentId);
    }
    const history = await this.db.query<any>(
      `SELECT e.id,e.event_type,e.from_state,e.to_state,e.decision,e.reason_code,e.note,
              e.actor_user_id,u.display_name actor_display_name,e.request_id,e.created_at
         FROM payment_reconciliation_events e
         LEFT JOIN users u ON u.id=e.actor_user_id
        WHERE e.tenant_id=$1 AND e.payment_id=$2
        ORDER BY e.created_at,e.id`,
      [auth.tenantId, paymentId],
    );
    const baseline = row.captured_at ?? row.created_at;
    const timeline = [
      ...(baseline ? [{ eventType: row.payment_status === "CAPTURED" ? "PAYMENT_CAPTURED" : "PAYMENT_RECORDED", occurredAt: baseline, label: row.payment_status === "CAPTURED" ? "Payment đã được ghi nhận" : "Payment đã được tạo" }] : []),
      ...history.rows.map((event: any) => ({
        eventType: event.event_type,
        occurredAt: event.created_at,
        label: eventLabel(event.event_type),
        state: event.to_state,
        decision: event.decision,
        reasonCode: event.reason_code,
        note: event.note,
        actor: event.actor_display_name ?? "Hệ thống",
        requestId: event.request_id,
      })),
    ];
    const canReview = this.canReview(auth);
    return {
      payment: this.rowView(row, auth),
      review: {
        id: row.review_id,
        state: row.review_state_effective,
        decision: row.review_decision,
        reasonCode: row.review_reason_code,
        note: row.review_note,
        version: Number(row.review_version ?? 1),
        reviewedBy: row.reviewed_by_user_id ? { id: row.reviewed_by_user_id, displayName: row.reviewed_by_display_name } : null,
        reviewedAt: row.reviewed_at,
        resolvedBy: row.resolved_by_user_id ? { id: row.resolved_by_user_id, displayName: row.resolved_by_display_name } : null,
        resolvedAt: row.resolved_at,
      },
      systemEvidence: {
        expectedMinor: money(row.expected_minor),
        source: "payment.requestedMinor",
        capturedMinor: money(row.captured_minor),
        confirmedMinor: money(row.confirmed_minor),
        status: row.payment_status,
        capturedAt: row.captured_at,
        currency: row.currency,
      },
      providerEvidence: {
        available: Boolean(row.provider_evidence_available),
        source: row.provider_evidence_available ? "Payment capture evidence" : "Chưa có tích hợp xác nhận provider",
        provider: row.provider,
        transactionIdSafe: row.provider_transaction_id_safe,
        cardBrand: row.card_brand,
        cardLast4: row.card_last4,
        confirmedMinor: row.tender_type === "CASH" ? null : money(row.confirmed_minor),
      },
      cashEvidence: row.tender_type === "CASH" ? {
        available: Boolean(row.cash_session_id),
        cashSession: row.cash_session_id ? { id: row.cash_session_id, status: row.cash_session_status, businessDate: row.cash_business_date, registerId: row.cash_session_register_id } : null,
        movement: row.matched_movement_id ? { id: row.matched_movement_id, type: "CASH_SALE", amountMinor: money(row.cash_movement_amount), currency: row.cash_movement_currency, occurredAt: row.cash_movement_occurred_at } : null,
        matched: Boolean(row.matched_movement_id),
      } : { available: false, cashSession: null, movement: null, matched: null },
      relations: {
        pos: row.order_id ? { id: row.order_id, number: row.order_number, href: `/admin/pos/orders/${row.order_id}` } : null,
        invoice: row.invoice_id ? { id: row.invoice_id, number: row.invoice_number, status: row.invoice_status, href: `/admin/financial/invoices?branchId=${encodeURIComponent(row.branch_id)}&invoiceId=${encodeURIComponent(row.invoice_id)}` } : null,
        appointment: row.appointment_id ? { id: row.appointment_id, reference: row.booking_reference, status: row.appointment_status, href: `/admin/appointments/${row.appointment_id}/overview` } : null,
        cashSession: row.cash_session_id ? { id: row.cash_session_id, href: `/admin/pos/cash-sessions/${row.cash_session_id}` } : null,
      },
      attention: row.attention_code ? { required: true, severity: row.attention_severity, code: row.attention_code, message: row.attention_message } : null,
      history: timeline,
      capabilities: {
        canReview,
        canConfirmMatch: canReview && Boolean(row.bulk_confirm_eligible),
        canAcceptVariance: canReview && ["AMOUNT_MISMATCH", "PROVIDER_EVIDENCE_MISMATCH", "PARTIAL_OUTSTANDING"].includes(row.case_type),
        canEscalate: canReview && row.review_state_effective !== "RESOLVED",
        bulkConfirmEligible: Boolean(row.bulk_confirm_eligible),
      },
      sourceStatus: {
        pos: "AVAILABLE",
        invoice: row.invoice_id ? "AVAILABLE" : row.order_status === "PAID" ? "MISSING" : "NOT_REQUIRED",
        appointment: row.appointment_id ? "AVAILABLE" : "NOT_APPLICABLE",
        cashSession: row.tender_type === "CASH" ? (row.cash_session_id ? "AVAILABLE" : "MISSING") : "NOT_APPLICABLE",
        provider: row.provider_evidence_available ? "PAYMENT_CAPTURE_EVIDENCE" : "NOT_INTEGRATED",
      },
    };
  }

  async addNote(auth: AccessClaims, paymentId: string, input: unknown, key: string, requestId: string) {
    const body = paymentReconciliationNoteSchema.parse(input);
    return this.db.transaction((client) => this.idem.execute(client, {
      tenantId: auth.tenantId,
      actorScope: `user:${auth.userId}`,
      command: "payment.reconciliation.note",
      key: idempotency(key),
      request: { paymentId, ...body },
      work: async () => {
        this.assertTenant(auth);
        const current = await this.ensureReviewWithin(client, auth, paymentId, requestId);
        if (Number(current.version) !== body.version) this.versionConflict();
        const updated = await client.query<any>(
          `UPDATE payment_reconciliation_reviews
              SET note=$3,reviewed_by_user_id=$4,reviewed_at=now(),version=version+1,updated_at=now()
            WHERE tenant_id=$1 AND id=$2 AND version=$5 RETURNING *`,
          [auth.tenantId, current.id, body.note, auth.userId, body.version],
        );
        if (!updated.rows[0]) this.versionConflict();
        await this.appendEvent(client, auth, current, updated.rows[0], "NOTE_ADDED", requestId, undefined, undefined, body.note, key);
        await this.recordEvidence(client, auth, current, "payment.reconciliation_note_added", requestId, key, { noteAdded: true });
        return reviewView(updated.rows[0]);
      },
    })).then((result) => ({ ...result.data, idempotencyReplayed: result.replayed }));
  }

  async decide(auth: AccessClaims, paymentId: string, input: unknown, key: string, requestId: string) {
    const body = paymentReconciliationDecisionSchema.parse(input);
    return this.db.transaction((client) => this.idem.execute(client, {
      tenantId: auth.tenantId,
      actorScope: `user:${auth.userId}`,
      command: "payment.reconciliation.decision",
      key: idempotency(key),
      request: { paymentId, ...body },
      work: async () => {
        this.assertTenant(auth);
        const currentEvidence = await this.evaluateOne(client, auth, paymentId);
        if (!currentEvidence) throw new NotFoundException({ code: "PAYMENT_RECONCILIATION_NOT_FOUND", message: "Payment reconciliation case not found" });
        const review = await this.ensureReviewWithin(client, auth, paymentId, requestId, currentEvidence);
        if (Number(review.version) !== body.version) this.versionConflict();
        if (Number(review.expected_minor ?? -1) !== Number(currentEvidence.expected_minor ?? -1) || Number(review.confirmed_minor ?? -1) !== Number(currentEvidence.confirmed_minor ?? -1))
          throw new ConflictException({ code: "RECONCILIATION_EVIDENCE_CHANGED", message: "Evidence changed. Reload the latest reconciliation data before deciding." });
        if (body.decision === "CONFIRM_MATCH" && !currentEvidence.bulk_confirm_eligible)
          throw new ConflictException({ code: "RECONCILIATION_MATCH_NOT_ELIGIBLE", message: "Only an authoritative exact match can be confirmed." });
        if (body.decision === "ACCEPT_VARIANCE" && !["AMOUNT_MISMATCH", "PROVIDER_EVIDENCE_MISMATCH", "PARTIAL_OUTSTANDING"].includes(currentEvidence.case_type))
          throw new ConflictException({ code: "RECONCILIATION_VARIANCE_NOT_ELIGIBLE", message: "This case is not an accepted variance workflow." });
        if (body.decision === "ACCEPT_VARIANCE" && !body.reasonCode)
          throw new ConflictException({ code: "RECONCILIATION_REASON_REQUIRED", message: "A reason is required to accept a variance." });
        const nextState = body.decision === "ESCALATE" ? "ESCALATED" : body.decision === "KEEP_REVIEW" ? "UNDER_REVIEW" : "RESOLVED";
        const updated = await client.query<any>(
          `UPDATE payment_reconciliation_reviews
              SET state=$3::text,decision=$4::text,reason_code=COALESCE($5::text,reason_code),note=COALESCE($6::text,note),
                  reviewed_by_user_id=$7::uuid,reviewed_at=now(),
                  resolved_by_user_id=CASE WHEN $3::text='RESOLVED' THEN $7::uuid ELSE NULL::uuid END,
                  resolved_at=CASE WHEN $3='RESOLVED' THEN now() ELSE NULL END,
                  version=version+1,updated_at=now()
            WHERE tenant_id=$1 AND id=$2 AND version=$8 RETURNING *`,
          [auth.tenantId, review.id, nextState, body.decision, body.reasonCode ?? null, body.note ?? null, auth.userId, body.version],
        );
        if (!updated.rows[0]) this.versionConflict();
        const eventType = body.decision === "CONFIRM_MATCH" ? "MATCH_CONFIRMED" : body.decision === "ACCEPT_VARIANCE" ? "VARIANCE_ACCEPTED" : body.decision === "ESCALATE" ? "ESCALATED" : "DECISION_RECORDED";
        await this.appendEvent(client, auth, review, updated.rows[0], eventType, requestId, body.decision, body.reasonCode, body.note, key);
        const evidenceEvent = body.decision === "CONFIRM_MATCH" ? "payment.reconciliation_matched" : body.decision === "ACCEPT_VARIANCE" ? "payment.reconciliation_variance_accepted" : body.decision === "ESCALATE" ? "payment.reconciliation_escalated" : "payment.reconciliation_reviewed";
        await this.recordEvidence(client, auth, review, evidenceEvent, requestId, key, { decision: body.decision, reasonCode: body.reasonCode ?? null, state: nextState });
        return reviewView(updated.rows[0]);
      },
    })).then((result) => ({ ...result.data, idempotencyReplayed: result.replayed }));
  }

  async bulkConfirm(auth: AccessClaims, input: unknown, key: string, requestId: string) {
    const body = paymentReconciliationBulkConfirmSchema.parse(input);
    return this.db.transaction((client) => this.idem.execute(client, {
      tenantId: auth.tenantId,
      actorScope: `user:${auth.userId}`,
      command: "payment.reconciliation.bulk_confirm",
      key: idempotency(key),
      request: body,
      work: async () => {
        this.assertTenant(auth);
        const results: any[] = [];
        for (const [paymentId, version] of Object.entries(body.versionByPaymentId)) {
          const current = await this.evaluateOne(client, auth, paymentId);
          if (!current) {
            results.push({ paymentId, ok: false, code: "NOT_FOUND" });
            continue;
          }
          const review = await this.ensureReviewWithin(client, auth, paymentId, requestId, current);
          if (Number(review.version) !== Number(version)) {
            results.push({ paymentId, ok: false, code: "VERSION_CONFLICT" });
            continue;
          }
          if (!current.bulk_confirm_eligible) {
            results.push({ paymentId, ok: false, code: "NOT_EXACT_MATCH" });
            continue;
          }
          const updated = (await client.query<any>(
            `UPDATE payment_reconciliation_reviews
                SET state='RESOLVED',decision='CONFIRM_MATCH',reviewed_by_user_id=$3,reviewed_at=now(),resolved_by_user_id=$3,resolved_at=now(),version=version+1,updated_at=now()
              WHERE tenant_id=$1 AND id=$2 AND version=$4 RETURNING *`,
            [auth.tenantId, review.id, auth.userId, version],
          )).rows[0];
          if (!updated) {
            results.push({ paymentId, ok: false, code: "VERSION_CONFLICT" });
            continue;
          }
          await this.appendEvent(client, auth, review, updated, "MATCH_CONFIRMED", requestId, "CONFIRM_MATCH", undefined, undefined, key);
          await this.recordEvidence(client, auth, review, "payment.reconciliation_matched", requestId, key, { decision: "CONFIRM_MATCH", bulk: true });
          results.push({ paymentId, ok: true, state: "RESOLVED", version: Number(updated.version) });
        }
        return { results, resolvedCount: results.filter((item) => item.ok).length };
      },
    })).then((result) => ({ ...result.data, idempotencyReplayed: result.replayed }));
  }

  private async ensureReview(auth: AccessClaims, row: any, requestId: string) {
    return this.db.transaction((client) => this.ensureReviewWithin(client, auth, row.id, requestId, row));
  }

  private async ensureReviewWithin(client: PoolClient, auth: AccessClaims, paymentId: string, requestId: string, supplied?: any) {
    const found = (await client.query<any>(
      "SELECT * FROM payment_reconciliation_reviews WHERE tenant_id=$1 AND payment_id=$2 FOR UPDATE",
      [auth.tenantId, paymentId],
    )).rows[0];
    if (found) return found;
    const row = supplied ?? await this.evaluateOne(client, auth, paymentId);
    if (!row) throw new NotFoundException({ code: "PAYMENT_RECONCILIATION_NOT_FOUND", message: "Payment reconciliation case not found" });
    const created = (await client.query<any>(
      `INSERT INTO payment_reconciliation_reviews(
        tenant_id,branch_id,payment_id,state,case_type,expected_minor,confirmed_minor,variance_minor,currency,evidence_snapshot_json)
       VALUES($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9) RETURNING *`,
      [auth.tenantId, row.branch_id, row.id, row.case_type, row.expected_minor, row.confirmed_minor, row.variance_minor, row.currency, JSON.stringify(this.snapshot(row))],
    )).rows[0];
    await client.query(
      `INSERT INTO payment_reconciliation_events(tenant_id,branch_id,review_id,payment_id,event_type,from_state,to_state,actor_user_id,request_id,snapshot_json)
       VALUES($1,$2,$3,$4,'RECONCILIATION_OPENED',NULL,'OPEN',$5,$6,$7)`,
      [auth.tenantId, row.branch_id, created.id, row.id, auth.userId, requestId, JSON.stringify(this.snapshot(row))],
    );
    await this.recordEvidence(client, auth, created, "payment.reconciliation_opened", requestId, undefined, { caseType: row.case_type });
    return created;
  }

  private async appendEvent(client: PoolClient, auth: AccessClaims, before: any, after: any, eventType: string, requestId: string, decision?: string, reasonCode?: string, note?: string, key?: string) {
    await client.query(
      `INSERT INTO payment_reconciliation_events(tenant_id,branch_id,review_id,payment_id,event_type,from_state,to_state,decision,reason_code,note,actor_user_id,request_id,idempotency_key_hash,snapshot_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [auth.tenantId, after.branch_id, after.id, after.payment_id, eventType, before.state, after.state, decision ?? null, reasonCode ?? null, note ?? null, auth.userId, requestId, key ? this.idem.subject(key) : null, JSON.stringify({ state: after.state, decision: decision ?? null, reasonCode: reasonCode ?? null, version: after.version })],
    );
  }

  private async recordEvidence(client: PoolClient, auth: AccessClaims, review: any, event: string, requestId: string, key?: string, payload?: Record<string, unknown>) {
    await this.evidence.record(client, {
      auth,
      branchId: review.branch_id,
      event,
      aggregateType: "payment_reconciliation_review",
      aggregateId: review.id,
      aggregateVersion: Number(review.version ?? 1),
      requestId,
      currency: review.currency ?? "VND",
      amountMinor: review.confirmed_minor == null ? undefined : BigInt(review.confirmed_minor),
      idempotencyKey: key,
      payload: { paymentId: review.payment_id, state: review.state, ...payload },
    });
  }

  private async evaluateOne(client: any, auth: AccessClaims, paymentId: string) {
    const result = await client.query(
      `${this.evaluationCte()}
       SELECT * FROM classified
        WHERE id=$11
          AND $8::text IS NULL
          AND $9::text IS NULL
          AND $10::boolean = false`,
      [auth.tenantId, null, null, null, null, null, null, null, null, false, paymentId],
    );
    const row = result.rows[0];
    if (row && !this.branchAllowed(auth, row.branch_id)) throw new NotFoundException({ code: "PAYMENT_RECONCILIATION_NOT_FOUND", message: "Payment reconciliation case not found" });
    return row;
  }

  private evaluationCte() {
    return `WITH source AS (
      SELECT p.id,p.tenant_id,p.branch_id,p.pos_order_id order_id,p.payment_reference,p.tender_type,p.status payment_status,p.currency,
             p.requested_minor,p.captured_minor,p.cash_received_minor,p.change_due_minor,p.provider,p.provider_transaction_id,
             CASE WHEN p.provider_transaction_id IS NOT NULL OR p.external_evidence_json<>'{}'::jsonb THEN true ELSE false END provider_evidence_available,
             CASE WHEN p.provider_transaction_id IS NOT NULL THEN concat('••••',right(p.provider_transaction_id,8)) ELSE NULL END provider_transaction_id_safe,
             p.terminal_id,p.card_brand,p.card_last4,p.captured_at,p.created_at,
             o.order_number,o.source order_source,o.status order_status,o.amount_due_minor,o.appointment_id,o.customer_id,o.customer_snapshot_json,
             a.booking_reference,a.status appointment_status,
             b.name branch_name,b.code branch_code,b.timezone branch_timezone,
             r.id register_id,r.code register_code,r.name register_name,
             actor.id cashier_user_id,actor.display_name cashier_display_name,
             i.id invoice_id,i.invoice_number,i.status invoice_status,
             cs.id cash_session_id,cs.status cash_session_status,cs.business_date cash_business_date,cs.register_id cash_session_register_id,
             cm.id matched_movement_id,cm.amount_minor cash_movement_amount,cm.currency cash_movement_currency,cm.occurred_at cash_movement_occurred_at,
             COALESCE(unknown_attempt.count,0)::int unknown_attempt_count,
             COALESCE(refund_relation.relation_count,0)::int refund_relation_count,
             review.id review_id,review.state review_state,review.decision review_decision,review.reason_code review_reason_code,review.note review_note,
             review.version review_version,review.reviewed_by_user_id,review.reviewed_at,review.resolved_by_user_id,review.resolved_at,
             reviewed.display_name reviewed_by_display_name,resolved.display_name resolved_by_display_name
        FROM payments p
        JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
        JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id
        LEFT JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id
        LEFT JOIN invoices i ON i.tenant_id=o.tenant_id AND i.pos_order_id=o.id
        LEFT JOIN pos_registers r ON r.tenant_id=p.tenant_id AND r.id=p.register_id
        LEFT JOIN users actor ON actor.origin_tenant_id=p.tenant_id AND actor.id=p.created_by_user_id
        LEFT JOIN cash_sessions cs ON cs.tenant_id=p.tenant_id AND cs.id=p.cash_session_id
        LEFT JOIN cash_movements cm ON cm.tenant_id=p.tenant_id AND cm.id=(
          SELECT candidate.id FROM cash_movements candidate
           JOIN cash_sessions movement_session ON movement_session.tenant_id=candidate.tenant_id AND movement_session.id=candidate.cash_session_id
          WHERE candidate.tenant_id=p.tenant_id AND candidate.related_payment_id=p.id AND candidate.movement_type='CASH_SALE'
            AND candidate.amount_minor=p.captured_minor AND candidate.currency=p.currency
            AND p.status='CAPTURED' AND p.tender_type='CASH' AND p.cash_session_id IS NOT NULL
            AND candidate.cash_session_id=p.cash_session_id AND movement_session.register_id=p.register_id
          ORDER BY candidate.occurred_at DESC,candidate.id DESC LIMIT 1)
        LEFT JOIN LATERAL (SELECT count(*)::int count FROM payment_attempts pa WHERE pa.tenant_id=p.tenant_id AND pa.payment_id=p.id AND pa.result='UNKNOWN') unknown_attempt ON true
        LEFT JOIN LATERAL (SELECT count(*)::int relation_count FROM refund_payment_allocations rpa WHERE rpa.tenant_id=p.tenant_id AND rpa.original_payment_id=p.id) refund_relation ON true
        LEFT JOIN payment_reconciliation_reviews review ON review.tenant_id=p.tenant_id AND review.payment_id=p.id
        LEFT JOIN users reviewed ON reviewed.id=review.reviewed_by_user_id
        LEFT JOIN users resolved ON resolved.id=review.resolved_by_user_id
       WHERE p.tenant_id=$1
         AND ($2::uuid[] IS NULL OR p.branch_id=ANY($2))
         AND ($3::uuid IS NULL OR p.branch_id=$3)
         AND ($4::date IS NULL OR (COALESCE(p.captured_at,p.created_at) AT TIME ZONE b.timezone)::date >= $4::date)
         AND ($5::date IS NULL OR (COALESCE(p.captured_at,p.created_at) AT TIME ZONE b.timezone)::date <= $5::date)
         AND ($6::text IS NULL OR lower(concat_ws(' ',p.payment_reference,o.order_number,i.invoice_number,p.provider_transaction_id)) LIKE lower('%'||$6||'%'))
         AND ($7::text IS NULL OR p.tender_type=$7)
    ), evaluated AS (
      SELECT source.*,
        requested_minor expected_minor,
        CASE WHEN payment_status='CAPTURED' THEN captured_minor ELSE NULL END confirmed_minor,
        CASE
          WHEN unknown_attempt_count>0 THEN 'PROVIDER_UNRESOLVED'
          WHEN payment_status='CAPTURED' AND tender_type='CASH' AND cash_session_id IS NULL THEN 'MISSING_CASH_SESSION'
          WHEN payment_status='CAPTURED' AND tender_type='CASH' AND matched_movement_id IS NULL THEN 'MISSING_CASH_MOVEMENT'
          WHEN payment_status='CAPTURED' AND order_status='PAID' AND (invoice_id IS NULL OR invoice_status<>'ISSUED') THEN 'MISSING_INVOICE'
          WHEN payment_status='CAPTURED' AND captured_minor<requested_minor AND order_status='PARTIALLY_PAID' THEN 'PARTIAL_OUTSTANDING'
          WHEN payment_status='CAPTURED' AND captured_minor<>requested_minor THEN 'AMOUNT_MISMATCH'
          ELSE 'MATCH'
        END case_type
      FROM source
    ), classified AS (
      SELECT evaluated.*,
        CASE WHEN confirmed_minor IS NULL THEN NULL ELSE confirmed_minor-expected_minor END variance_minor,
        CASE WHEN payment_status='CAPTURED' AND case_type='MATCH' AND expected_minor=confirmed_minor
                  AND COALESCE(review_state,'OPEN') IN ('OPEN','UNDER_REVIEW')
             THEN true ELSE false END bulk_confirm_eligible,
        COALESCE(review_state,'OPEN') review_state_effective,
        CASE
          WHEN case_type='PROVIDER_UNRESOLVED' THEN 'PROVIDER_UNRESOLVED'
          WHEN case_type='AMOUNT_MISMATCH' THEN 'AMOUNT_MISMATCH'
          WHEN case_type='MISSING_INVOICE' THEN 'MISSING_INVOICE'
          WHEN case_type='MISSING_CASH_MOVEMENT' THEN 'MISSING_CASH_MOVEMENT'
          WHEN case_type='MISSING_CASH_SESSION' THEN 'MISSING_CASH_SESSION'
          WHEN case_type='PARTIAL_OUTSTANDING' THEN 'PARTIAL_OUTSTANDING'
          ELSE NULL
        END attention_code,
        CASE WHEN case_type='MATCH' THEN NULL ELSE 'WARNING' END attention_severity,
        CASE
          WHEN case_type='PROVIDER_UNRESOLVED' THEN 'Chưa có kết quả xác nhận provider.'
          WHEN case_type='AMOUNT_MISMATCH' THEN 'Số tiền xác nhận khác số tiền hệ thống.'
          WHEN case_type='MISSING_INVOICE' THEN 'Đơn POS đã PAID nhưng chưa có hóa đơn ISSUED.'
          WHEN case_type='MISSING_CASH_MOVEMENT' THEN 'Chưa tìm thấy CASH_SALE liên quan trong phiên thu ngân.'
          WHEN case_type='MISSING_CASH_SESSION' THEN 'Payment tiền mặt không có phiên thu ngân hợp lệ.'
          WHEN case_type='PARTIAL_OUTSTANDING' THEN 'Payment một phần còn số tiền phải thu.'
          ELSE NULL
        END attention_message
      FROM evaluated
    )`;
  }

  private filteredSql() {
    const where = ["($8::text IS NULL OR case_type=$8)", "($9::text IS NULL OR review_state_effective=$9)", "($10::boolean=false OR case_type<>'MATCH')"];
    return { where: where.join(" AND ") };
  }

  private directoryValues(auth: AccessClaims, query: any) {
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const dateFrom = query.businessDate ?? query.dateFrom ?? null;
    const dateTo = query.businessDate ?? query.dateTo ?? null;
    return [auth.tenantId, branches, query.branchId ?? null, dateFrom, dateTo, query.search || null, query.tenderType ?? null, query.caseType ?? null, query.reviewState ?? null, query.attentionOnly ?? false];
  }

  private orderBy(sort: string) {
    return ({
      NEWEST: "COALESCE(captured_at,created_at) DESC,id DESC",
      OLDEST: "COALESCE(captured_at,created_at) ASC,id ASC",
      AMOUNT_DESC: "COALESCE(confirmed_minor,expected_minor,0) DESC,COALESCE(captured_at,created_at) DESC,id DESC",
      AMOUNT_ASC: "COALESCE(confirmed_minor,expected_minor,0) ASC,COALESCE(captured_at,created_at) ASC,id ASC",
    } as Record<string, string>)[sort] ?? "COALESCE(captured_at,created_at) DESC,id DESC";
  }

  private rowView(row: any, auth: AccessClaims) {
    const canSeePhone = !auth.supportAccess && !auth.roles.includes("PLATFORM_SUPER_ADMIN");
    return {
      id: row.id,
      paymentReference: row.payment_reference,
      paymentStatus: row.payment_status,
      tenderType: row.tender_type,
      currency: row.currency,
      branchId: row.branch_id,
      branchName: row.branch_name,
      branchCode: row.branch_code,
      timezone: row.branch_timezone,
      orderId: row.order_id,
      orderNumber: row.order_number,
      orderSource: row.order_source,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      invoiceStatus: row.invoice_status,
      appointmentId: row.appointment_id,
      bookingReference: row.booking_reference,
      registerId: row.register_id,
      registerCode: row.register_code,
      registerName: row.register_name,
      cashSessionId: row.cash_session_id,
      cashSessionStatus: row.cash_session_status,
      cashBusinessDate: row.cash_business_date,
      cashierUserId: row.cashier_user_id,
      cashierDisplayName: row.cashier_display_name,
      customerId: row.customer_id,
      customerDisplayName: row.customer_snapshot_json?.displayName ?? row.customer_snapshot_json?.display_name ?? "Khách vãng lai",
      customerPhone: canSeePhone ? row.customer_snapshot_json?.phone ?? null : null,
      requestedMinor: money(row.requested_minor) ?? 0,
      capturedMinor: money(row.captured_minor) ?? 0,
      expectedMinor: money(row.expected_minor),
      confirmedMinor: money(row.confirmed_minor),
      varianceMinor: money(row.variance_minor),
      cashReceivedMinor: money(row.cash_received_minor),
      changeDueMinor: money(row.change_due_minor),
      provider: row.provider,
      providerTransactionIdSafe: row.provider_transaction_id_safe,
      cardBrand: row.card_brand,
      cardLast4: row.card_last4,
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      caseType: row.case_type,
      reviewState: row.review_state_effective,
      reviewDecision: row.review_decision,
      reviewVersion: Number(row.review_version ?? 1),
      reviewReasonCode: row.review_reason_code,
      reviewNote: row.review_note,
      bulkConfirmEligible: Boolean(row.bulk_confirm_eligible),
      reconciliationState: row.case_type === "MATCH" ? "MATCHED" : "NEEDS_ATTENTION",
      attention: row.attention_code ? { required: true, severity: row.attention_severity, code: row.attention_code, message: row.attention_message } : null,
      evidence: {
        providerAvailable: Boolean(row.provider_evidence_available),
        cashMovementId: row.matched_movement_id,
        cashMovementAmountMinor: money(row.cash_movement_amount),
        cashMovementCurrency: row.cash_movement_currency,
        reflectedInCashSession: row.tender_type === "CASH" && row.payment_status === "CAPTURED" ? Boolean(row.matched_movement_id) : null,
      },
    };
  }

  private snapshot(row: any) {
    return { paymentId: row.id, caseType: row.case_type, expectedMinor: money(row.expected_minor), confirmedMinor: money(row.confirmed_minor), varianceMinor: money(row.variance_minor), cashMovementId: row.matched_movement_id ?? null, invoiceId: row.invoice_id ?? null, orderId: row.order_id ?? null };
  }

  private canReview(auth: AccessClaims) {
    return Boolean(auth.supportAccess?.permissions.includes("financial.reconciliation.review") || auth.roles.some((role) => ["SALON_OWNER", "BRANCH_MANAGER", "ACCOUNTANT"].includes(role)));
  }

  private assertTenant(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN")) throw new ForbiddenException({ code: "PLATFORM_TENANT_ACCESS_DENIED", message: "Support Access Grant is required" });
  }

  private assertBranch(auth: AccessClaims, branchId?: string) {
    if (branchId && !this.branchAllowed(auth, branchId)) throw new NotFoundException({ code: "BRANCH_NOT_FOUND", message: "Branch not found" });
  }

  private branchAllowed(auth: AccessClaims, branchId: string) {
    return auth.roles.includes("SALON_OWNER") || auth.branchIds.includes(branchId);
  }

  private versionConflict(): never {
    throw new ConflictException({ code: "RECONCILIATION_VERSION_CONFLICT", message: "Mục đối soát vừa được cập nhật bởi người khác. Hãy tải lại dữ liệu mới nhất." });
  }
}

function reviewView(row: any) {
  return { id: row.id, paymentId: row.payment_id, branchId: row.branch_id, state: row.state, caseType: row.case_type, decision: row.decision, reasonCode: row.reason_code, note: row.note, expectedMinor: money(row.expected_minor), confirmedMinor: money(row.confirmed_minor), varianceMinor: money(row.variance_minor), currency: row.currency, version: Number(row.version), reviewedAt: row.reviewed_at, resolvedAt: row.resolved_at };
}

function eventLabel(eventType: string) {
  return ({
    RECONCILIATION_OPENED: "Mở case đối soát",
    REVIEW_STARTED: "Bắt đầu kiểm tra",
    NOTE_ADDED: "Đã thêm ghi chú",
    DECISION_RECORDED: "Đã ghi nhận quyết định",
    MATCH_CONFIRMED: "Đã xác nhận khớp",
    VARIANCE_ACCEPTED: "Đã chấp nhận chênh lệch",
    ESCALATED: "Đã chuyển quản lý",
  } as Record<string, string>)[eventType] ?? eventType;
}
