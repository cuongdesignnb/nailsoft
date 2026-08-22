/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  cashRefundExecutionSchema,
  externalRefundExecutionSchema,
  refundCreateSchema,
  refundDirectoryQuerySchema,
  refundDecisionSchema,
  refundPlanSchema,
  refundVersionSchema,
} from "@nailsoft/validation";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import { BenefitsTransactionService } from "../benefits/benefits-transaction.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "../pos/financial-evidence.service.js";
import { RegisterDeviceAuthorizationService } from "../pos/register-device-authorization.service.js";
import { StoredValueService } from "../stored-value/stored-value.service.js";
import { cumulativeProportionalRestore } from "../stored-value/stored-value-domain.js";
import {
  assertRefundTransition,
  prorateMinor,
  type RefundStatus,
} from "./refund-state-machine.js";
import { branchFiscalYear, refundWindowEvidence } from "./financial-time.js";

@Injectable()
export class RefundService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(BenefitsTransactionService)
    private readonly benefits: BenefitsTransactionService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
    @Inject(RegisterDeviceAuthorizationService)
    private readonly registerDevice: RegisterDeviceAuthorizationService,
    @Inject(StoredValueService)
    private readonly storedValue: StoredValueService,
  ) {}

  async plan(auth: AccessClaims, invoiceId: string, input: unknown) {
    this.assertTenant(auth);
    const body = refundPlanSchema.parse(input);
    return this.db.transaction((client) =>
      this.buildPlan(client, auth, invoiceId, body, false),
    );
  }

  async create(
    auth: AccessClaims,
    invoiceId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.assertTenant(auth);
    const body = refundCreateSchema.parse(input);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "refund.create",
          key,
          request: { invoiceId, ...body },
          work: async () => {
            const plan = await this.buildPlan(
              client,
              auth,
              invoiceId,
              body,
              true,
            );
            const fiscalYear = branchFiscalYear(
              new Date(),
              plan.branchTimezone,
            );
            const counter = (
              await client.query<any>(
                `INSERT INTO refund_counters(tenant_id,branch_id,fiscal_year,last_number) VALUES($1,$2,$3,1)
           ON CONFLICT(tenant_id,branch_id,fiscal_year) DO UPDATE SET last_number=refund_counters.last_number+1,updated_at=now()
           RETURNING last_number`,
                [auth.tenantId, plan.branchId, fiscalYear],
              )
            ).rows[0];
            const reference = `RF-${plan.branchCode}-${fiscalYear}-${String(counter.last_number).padStart(6, "0")}`;
            const refund = (
              await client.query<any>(
                `INSERT INTO refunds(tenant_id,branch_id,invoice_id,pos_order_id,customer_id,refund_reference,currency,requested_minor,
             service_refund_minor,tax_refund_minor,tip_refund_minor,reason_code,reason_text,policy_snapshot_json,requested_by_user_id,refund_destination)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
                [
                  auth.tenantId,
                  plan.branchId,
                  invoiceId,
                  plan.posOrderId,
                  plan.customerId,
                  reference,
                  plan.currency,
                  plan.requestedMinor,
                  plan.serviceRefundMinor,
                  plan.taxRefundMinor,
                  plan.tipRefundMinor,
                  body.reasonCode,
                  body.reasonText,
                  JSON.stringify(plan.policy),
                  auth.userId,
                  body.refundDestination,
                ],
              )
            ).rows[0];
            for (const item of plan.items)
              await client.query(
                `INSERT INTO refund_items(tenant_id,refund_id,item_type,invoice_line_id,quantity,gross_refund_minor,discount_reversal_minor,
             taxable_refund_minor,tax_refund_minor,tip_refund_minor,total_refund_minor,source_snapshot_json)
           VALUES($1,$2,'INVOICE_LINE',$3,$4,$5,$6,$7,$8,0,$9,$10)`,
                [
                  auth.tenantId,
                  refund.id,
                  item.invoiceLineId,
                  item.quantity,
                  item.grossRefundMinor,
                  item.discountReversalMinor,
                  item.taxableRefundMinor,
                  item.taxRefundMinor,
                  item.totalRefundMinor,
                  JSON.stringify(item.sourceSnapshot),
                ],
              );
            if (plan.tipRefundMinor > 0)
              await client.query(
                `INSERT INTO refund_items(tenant_id,refund_id,item_type,gross_refund_minor,taxable_refund_minor,tax_refund_minor,tip_refund_minor,total_refund_minor,source_snapshot_json)
           VALUES($1,$2,'TIP',0,0,0,$3,$3,$4)`,
                [
                  auth.tenantId,
                  refund.id,
                  plan.tipRefundMinor,
                  JSON.stringify({ originalTipMinor: plan.originalTipMinor }),
                ],
              );
            for (const allocation of plan.paymentAllocations)
              await client.query(
                `INSERT INTO refund_payment_allocations(tenant_id,refund_id,original_payment_id,tender_type,planned_minor,refund_register_id,cash_session_id,original_register_id,original_cash_session_id,provider)
           VALUES($1,$2,$3,$4,$5,$6,$7,$6,$7,$8)`,
                [
                  auth.tenantId,
                  refund.id,
                  allocation.paymentId,
                  allocation.tenderType,
                  allocation.plannedMinor,
                  allocation.registerId,
                  allocation.cashSessionId,
                  allocation.provider,
                ],
              );
            for (const allocation of plan.storedValueAllocations)
              await client.query(
                `INSERT INTO refund_stored_value_line_plans(
                   tenant_id,refund_id,settlement_allocation_id,settlement_line_allocation_id,
                   account_id,planned_minor,currency)
                 VALUES($1,$2,$3,$4,$5,$6,$7)`,
                [
                  auth.tenantId,
                  refund.id,
                  allocation.settlementAllocationId,
                  allocation.settlementLineAllocationId,
                  allocation.accountId,
                  allocation.plannedMinor,
                  allocation.currency,
                ],
              );
            for (const allocation of plan.giftCardPurchaseAllocations)
              await client.query(
                `INSERT INTO gift_card_purchase_refund_plans(tenant_id,refund_id,gift_card_id,account_id,planned_minor,currency)
                 VALUES($1,$2,$3,$4,$5,$6)`,
                [
                  auth.tenantId,
                  refund.id,
                  allocation.giftCardId,
                  allocation.accountId,
                  allocation.plannedMinor,
                  allocation.currency,
                ],
              );
            await this.history(
              client,
              auth,
              refund.id,
              null,
              "DRAFT",
              body.reasonCode,
              requestId,
              body.reasonText,
            );
            await this.record(
              client,
              auth,
              refund,
              "refund.created",
              requestId,
              key,
            );
            return this.detailTx(client, auth, refund.id);
          },
        }),
      )
      .then((result) => ({
        ...result.data,
        idempotencyReplayed: result.replayed,
      }));
  }

  async list(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const rows = await this.db.query<any>(
      `SELECT r.*,i.invoice_number FROM refunds r JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
       WHERE r.tenant_id=$1 AND ($2::uuid[] IS NULL OR r.branch_id=ANY($2::uuid[]))
         AND ($3::uuid IS NULL OR r.branch_id=$3) AND ($4::text IS NULL OR r.status=$4)
       ORDER BY r.requested_at DESC,r.id LIMIT 200`,
      [auth.tenantId, branches, query?.branchId ?? null, query?.status ?? null],
    );
    if (query?.branchId) this.assertBranch(auth, query.branchId);
    return rows.rows.map(refundView);
  }

  async directory(auth: AccessClaims, input: unknown) {
    this.assertTenant(auth);
    const query = refundDirectoryQuerySchema.parse(input ?? {});
    if (query.branchId) this.assertBranch(auth, query.branchId);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const orderBy = {
      NEWEST: "requested_at DESC, id DESC",
      OLDEST: "requested_at ASC, id ASC",
      AMOUNT_DESC: "requested_minor DESC, requested_at DESC, id DESC",
      AMOUNT_ASC: "requested_minor ASC, requested_at DESC, id DESC",
    }[query.sort];
    const values = [
      auth.tenantId,
      branches,
      query.branchId ?? null,
      query.search || null,
      query.status ?? null,
      query.refundKind ?? null,
      query.tenderType ?? null,
      query.requestedFrom ?? null,
      query.requestedTo ?? null,
      query.customerId ?? null,
    ];
    const from = `
      FROM refunds r
      JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
      JOIN pos_orders o ON o.tenant_id=r.tenant_id AND o.id=r.pos_order_id
      JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id
      LEFT JOIN users requester ON requester.id=r.requested_by_user_id
      LEFT JOIN users approver ON approver.id=r.approved_by_user_id
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN r.tip_refund_minor>0 AND r.service_refund_minor+r.tax_refund_minor=0 THEN 'TIP_ONLY'
            WHEN r.tip_refund_minor>0 THEN 'MIXED'
            WHEN r.requested_minor >= i.total_minor+i.tip_minor THEN 'FULL'
            ELSE 'PARTIAL'
          END refund_kind,
          count(*)::int item_count
        FROM refund_items ri
        WHERE ri.tenant_id=r.tenant_id AND ri.refund_id=r.id
      ) item_meta ON true
      LEFT JOIN LATERAL (
        SELECT
          array_agg(DISTINCT a.tender_type ORDER BY a.tender_type) tender_types,
          COALESCE(sum(a.planned_minor),0)::bigint planned_minor,
          COALESCE(sum(a.completed_minor),0)::bigint completed_minor
        FROM refund_payment_allocations a
        WHERE a.tenant_id=r.tenant_id AND a.refund_id=r.id
      ) allocation_meta ON true
      LEFT JOIN LATERAL (
        SELECT cn.id,cn.credit_note_number,cn.status,cn.total_minor,cn.issued_at
        FROM credit_notes cn
        WHERE cn.tenant_id=r.tenant_id AND cn.refund_id=r.id
        ORDER BY cn.created_at DESC,cn.id DESC
        LIMIT 1
      ) credit_note ON true
      WHERE r.tenant_id=$1
        AND ($2::uuid[] IS NULL OR r.branch_id=ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR r.branch_id=$3)
        AND ($4::text IS NULL OR lower(concat_ws(' ',r.refund_reference,i.invoice_number,o.order_number,
          i.customer_snapshot_json->>'displayName',i.customer_snapshot_json->>'display_name',
          o.customer_snapshot_json->>'displayName',o.customer_snapshot_json->>'display_name',
          i.customer_snapshot_json->>'phone',o.customer_snapshot_json->>'phone')) LIKE lower('%'||$4||'%'))
        AND ($5::text IS NULL OR r.status=$5)
        AND ($6::text IS NULL OR item_meta.refund_kind=$6)
        AND ($7::text IS NULL OR EXISTS(
          SELECT 1 FROM refund_payment_allocations filter_allocation
          WHERE filter_allocation.tenant_id=r.tenant_id
            AND filter_allocation.refund_id=r.id
            AND filter_allocation.tender_type=$7
        ))
        AND ($8::date IS NULL OR r.requested_at >= $8::date)
        AND ($9::date IS NULL OR r.requested_at < ($9::date + interval '1 day'))
        AND ($10::uuid IS NULL OR r.customer_id=$10)
    `;
    const pageOffset = (query.page - 1) * query.pageSize;
    const [pageResult, summaryResult] = await Promise.all([
      this.db.query<any>(
        `SELECT r.id,r.branch_id,r.invoice_id,r.pos_order_id,r.customer_id,r.refund_reference,r.status,r.currency,
                r.requested_minor,r.approved_minor,r.completed_minor,r.service_refund_minor,r.tax_refund_minor,r.tip_refund_minor,
                r.reason_code,r.reason_text,r.requested_at,r.approved_at,r.completed_at,r.version,
                b.name branch_name,b.code branch_code,b.timezone,
                i.invoice_number,i.status invoice_status,i.total_minor invoice_total_minor,i.tip_minor invoice_tip_minor,
                o.order_number,o.status order_status,o.source order_source,o.appointment_id,
                COALESCE(NULLIF(i.customer_snapshot_json->>'displayName',''),NULLIF(i.customer_snapshot_json->>'display_name',''),
                  NULLIF(o.customer_snapshot_json->>'displayName',''),NULLIF(o.customer_snapshot_json->>'display_name',''),'Khách vãng lai') customer_display_name,
                COALESCE(NULLIF(i.customer_snapshot_json->>'phone',''),NULLIF(o.customer_snapshot_json->>'phone','')) customer_phone,
                requester.id requester_id,requester.display_name requester_display_name,
                approver.id approver_id,approver.display_name approver_display_name,
                item_meta.refund_kind,item_meta.item_count,
                allocation_meta.tender_types,allocation_meta.planned_minor allocation_planned_minor,allocation_meta.completed_minor allocation_completed_minor,
                credit_note.id credit_note_id,credit_note.credit_note_number,credit_note.status credit_note_status,
                credit_note.total_minor credit_note_total_minor,credit_note.issued_at credit_note_issued_at
         ${from}
         ORDER BY ${orderBy}
         LIMIT $11 OFFSET $12`,
        [...values, query.pageSize, pageOffset],
      ),
      this.db.query<any>(
        `SELECT count(*)::int total,
                count(*) FILTER (WHERE r.status='COMPLETED')::int completed,
                count(*) FILTER (WHERE r.status IN ('PENDING_APPROVAL','APPROVED','PROCESSING','FAILED','UNKNOWN'))::int needs_review,
                count(*) FILTER (WHERE r.status='UNKNOWN')::int unknown,
                count(*) FILTER (WHERE r.status='PENDING_APPROVAL')::int pending_approval,
                count(*) FILTER (WHERE r.status='PROCESSING')::int processing,
                COALESCE(sum(r.requested_minor),0)::bigint requested_minor,
                COALESCE(sum(r.completed_minor),0)::bigint completed_minor,
                COALESCE(sum(r.requested_minor-r.completed_minor),0)::bigint outstanding_minor,
                count(*) FILTER (WHERE item_meta.refund_kind='FULL')::int full_count,
                count(*) FILTER (WHERE item_meta.refund_kind='PARTIAL')::int partial_count,
                count(*) FILTER (WHERE item_meta.refund_kind='TIP_ONLY')::int tip_only_count,
                count(*) FILTER (WHERE item_meta.refund_kind='MIXED')::int mixed_count
         ${from}`,
        values,
      ),
    ]);
    const summary = summaryResult.rows[0] ?? {};
    const total = Number(summary.total ?? 0);
    return {
      items: pageResult.rows.map(refundDirectoryView),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      counts: {
        total,
        completed: Number(summary.completed ?? 0),
        needsReview: Number(summary.needs_review ?? 0),
        unknown: Number(summary.unknown ?? 0),
        pendingApproval: Number(summary.pending_approval ?? 0),
        processing: Number(summary.processing ?? 0),
      },
      summary: {
        requestedMinor: Number(summary.requested_minor ?? 0),
        completedMinor: Number(summary.completed_minor ?? 0),
        outstandingMinor: Number(summary.outstanding_minor ?? 0),
        completionPercentage: total
          ? Math.round((Number(summary.completed ?? 0) / total) * 1000) / 10
          : 0,
        kindMix: {
          full: Number(summary.full_count ?? 0),
          partial: Number(summary.partial_count ?? 0),
          tipOnly: Number(summary.tip_only_count ?? 0),
          mixed: Number(summary.mixed_count ?? 0),
        },
      },
    };
  }

  async detail(auth: AccessClaims, id: string) {
    this.assertTenant(auth);
    return this.db.transaction((client) => this.detailTx(client, auth, id));
  }

  async historyList(auth: AccessClaims, id: string) {
    await this.detail(auth, id);
    return (
      await this.db.query<any>(
        `SELECT h.*,u.display_name actor_display_name
           FROM refund_status_history h
           LEFT JOIN users u ON u.id=h.actor_user_id
          WHERE h.tenant_id=$1 AND h.refund_id=$2
          ORDER BY h.created_at,h.id`,
        [auth.tenantId, id],
      )
    ).rows;
  }

  async attempts(auth: AccessClaims, id: string) {
    await this.detail(auth, id);
    return (
      await this.db.query<any>(
        `SELECT id,refund_id,allocation_id,attempt_no,provider,result,error_code,occurred_at FROM refund_attempts
       WHERE tenant_id=$1 AND refund_id=$2 ORDER BY occurred_at,id`,
        [auth.tenantId, id],
      )
    ).rows;
  }

  submit(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = refundVersionSchema.parse(input);
    return this.transition(
      auth,
      id,
      body.version,
      "PENDING_APPROVAL",
      null,
      key,
      requestId,
    );
  }
  approve(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = refundDecisionSchema.parse(input);
    return this.transition(
      auth,
      id,
      body.version,
      "APPROVED",
      body.reason,
      key,
      requestId,
      true,
    );
  }
  reject(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = refundDecisionSchema.parse(input);
    return this.transition(
      auth,
      id,
      body.version,
      "REJECTED",
      body.reason,
      key,
      requestId,
      true,
    );
  }
  cancel(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = refundDecisionSchema.parse(input);
    return this.transition(
      auth,
      id,
      body.version,
      "CANCELLED",
      body.reason,
      key,
      requestId,
    );
  }

  async executeCash(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.assertTenant(auth);
    const body = cashRefundExecutionSchema.parse(input);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "refund.execute_cash",
          key,
          request: { id, ...body },
          work: async () => {
            const refund = await this.refundRow(client, auth, id, true);
            this.assertVersion(refund, body.version);
            if (
              !["APPROVED", "PROCESSING", "FAILED", "UNKNOWN"].includes(
                refund.status,
              )
            )
              this.invalid(refund.status, "PROCESSING");
            await this.assertActiveExecutionBranch(client, refund);
            await this.assertExecutionWithinRefundWindow(client, refund);
            const allocations = (
              await client.query<any>(
                "SELECT * FROM refund_payment_allocations WHERE tenant_id=$1 AND refund_id=$2 AND tender_type='CASH' AND status<>'COMPLETED' FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows;
            if (!allocations.length)
              throw new ConflictException({
                code: "REFUND_TENDER_MISMATCH",
                message: "No pending cash allocation",
              });
            await this.lockOriginalFinancials(client, refund);
            const session = (
              await client.query<any>(
                `SELECT cs.*,cd.currency drawer_currency FROM cash_sessions cs
                   JOIN cash_drawers cd ON cd.tenant_id=cs.tenant_id AND cd.id=cs.cash_drawer_id
                  WHERE cs.tenant_id=$1 AND cs.id=$2 FOR UPDATE OF cs`,
                [auth.tenantId, body.cashSessionId],
              )
            ).rows[0];
            if (
              !session ||
              session.status !== "OPEN" ||
              session.branch_id !== refund.branch_id ||
              session.drawer_currency !== refund.currency
            )
              throw new ConflictException({
                code: "CASH_REFUND_SESSION_INVALID",
                message: "An open same-branch cash session is required",
              });
            this.assertBranch(auth, refund.branch_id);
            if (!this.manager(auth) && session.cashier_user_id !== auth.userId)
              throw new ForbiddenException({
                code: "CASH_SESSION_OWNERSHIP_REQUIRED",
                message: "Cashier may use only own session",
              });
            await this.registerDevice.assertRegisterAccess({
              auth,
              registerId: session.register_id,
              branchId: refund.branch_id,
              client,
            });
            if (
              allocations.some(
                (row: any) => row.original_register_id !== session.register_id,
              )
            )
              throw new ConflictException({
                code: "CASH_REFUND_REGISTER_MISMATCH",
                message:
                  "Cash refund must be executed on the original payment register",
              });
            const amount = allocations.reduce(
              (sum: bigint, row: any) =>
                sum + BigInt(row.planned_minor) - BigInt(row.completed_minor),
              0n,
            );
            if (BigInt(session.expected_cash_minor) < amount)
              throw new ConflictException({
                code: "CASH_REFUND_INSUFFICIENT_DRAWER",
                message: "Cash drawer cannot become negative",
              });
            await this.revalidateBalances(client, refund);
            await client.query(
              `INSERT INTO cash_movements(tenant_id,branch_id,cash_session_id,movement_type,direction,amount_minor,currency,reason_code,note,actor_user_id,request_id,related_refund_id)
           VALUES($1,$2,$3,'CASH_REFUND','OUT',$4,$5,'REFUND',$6,$7,$8,$9)`,
              [
                auth.tenantId,
                refund.branch_id,
                session.id,
                amount,
                refund.currency,
                refund.reason_text,
                auth.userId,
                requestId,
                refund.id,
              ],
            );
            await client.query(
              "UPDATE cash_sessions SET expected_cash_minor=expected_cash_minor-$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, session.id, amount],
            );
            await client.query(
              `UPDATE refund_payment_allocations SET completed_minor=planned_minor,status='COMPLETED',completed_at=now(),execution_cash_session_id=$3,updated_at=now()
           WHERE tenant_id=$1 AND refund_id=$2 AND tender_type='CASH' AND status<>'COMPLETED'`,
              [auth.tenantId, refund.id, session.id],
            );
            await this.history(
              client,
              auth,
              refund.id,
              refund.status,
              "PROCESSING",
              "CASH_EXECUTION",
              requestId,
            );
            return this.finalizeIfComplete(
              client,
              auth,
              refund,
              requestId,
              key,
              "refund.cash_executed",
            );
          },
        }),
      )
      .then((result) => ({
        ...result.data,
        idempotencyReplayed: result.replayed,
      }));
  }

  async executeExternal(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.assertTenant(auth);
    const body = externalRefundExecutionSchema.parse(input);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "refund.execute_external",
          key,
          request: { id, ...body },
          work: async () => {
            const refund = await this.refundRow(client, auth, id, true);
            this.assertVersion(refund, body.version);
            if (
              !["APPROVED", "PROCESSING", "FAILED", "UNKNOWN"].includes(
                refund.status,
              )
            )
              this.invalid(refund.status, "PROCESSING");
            await this.assertActiveExecutionBranch(client, refund);
            await this.assertExecutionWithinRefundWindow(client, refund);
            const allocations = (
              await client.query<any>(
                "SELECT * FROM refund_payment_allocations WHERE tenant_id=$1 AND refund_id=$2 AND tender_type<>'CASH' AND status<>'COMPLETED' FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows;
            if (!allocations.length)
              throw new ConflictException({
                code: "REFUND_TENDER_MISMATCH",
                message: "No pending external allocation",
              });
            if (allocations.length !== 1)
              throw new ConflictException({
                code: "REFUND_PROVIDER_REFERENCE_REQUIRED",
                message:
                  "Record one provider refund reference per original payment allocation",
              });
            if (
              String(allocations[0].provider ?? "").toUpperCase() !==
              body.provider.toUpperCase()
            )
              throw new ConflictException({
                code: "REFUND_PROVIDER_MISMATCH",
                message:
                  "Refund provider must match the original captured payment provider",
              });
            await this.lockOriginalFinancials(client, refund);
            await this.revalidateBalances(client, refund);
            for (const allocation of allocations) {
              await client.query(
                `UPDATE refund_payment_allocations SET completed_minor=planned_minor,status='COMPLETED',completed_at=$4,provider=$5,provider_refund_id=$6,updated_at=now()
             WHERE tenant_id=$1 AND id=$2 AND refund_id=$3`,
                [
                  auth.tenantId,
                  allocation.id,
                  id,
                  body.processedAt,
                  body.provider,
                  body.providerRefundId,
                ],
              );
              await client.query(
                `INSERT INTO refund_attempts(tenant_id,refund_id,allocation_id,attempt_no,provider,provider_idempotency_key_hash,request_json_redacted,response_json_redacted,result)
             VALUES($1,$2,$3,1,$4,$5,$6,$7,'SUCCESS')`,
                [
                  auth.tenantId,
                  id,
                  allocation.id,
                  body.provider,
                  this.evidence.keyHash(`${id}:${allocation.id}`),
                  JSON.stringify({ evidenceNote: body.evidenceNote }),
                  JSON.stringify({ providerRefundId: body.providerRefundId }),
                ],
              );
            }
            return this.finalizeIfComplete(
              client,
              auth,
              refund,
              requestId,
              key,
              "refund.external_recorded",
            );
          },
        }),
      )
      .then((result) => ({
        ...result.data,
        idempotencyReplayed: result.replayed,
      }));
  }

  retry(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = refundVersionSchema.parse(input);
    return this.transition(
      auth,
      id,
      body.version,
      "PROCESSING",
      "PROVIDER_RETRY",
      key,
      requestId,
    );
  }

  private async transition(
    auth: AccessClaims,
    id: string,
    version: number,
    to: RefundStatus,
    reason: string | null,
    key: string,
    requestId: string,
    decision = false,
  ) {
    this.assertTenant(auth);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: `refund.${to.toLowerCase()}`,
          key,
          request: { id, version, reason },
          work: async () => {
            const refund = await this.refundRow(client, auth, id, true);
            this.assertVersion(refund, version);
            try {
              assertRefundTransition(refund.status, to);
            } catch {
              this.invalid(refund.status, to);
            }
            if (
              decision &&
              refund.requested_by_user_id === auth.userId &&
              refund.policy_snapshot_json?.requireDualControl !== false
            )
              throw new ForbiddenException({
                code: "REFUND_DUAL_CONTROL_REQUIRED",
                message: "Requester cannot decide own refund",
              });
            if (
              to === "APPROVED" &&
              Number(refund.requested_minor) > this.approvalLimit(auth)
            )
              throw new ForbiddenException({
                code: "REFUND_APPROVAL_LIMIT_EXCEEDED",
                message: "Refund exceeds approval limit",
              });
            const policySnapshot =
              to === "APPROVED"
                ? await this.enforceRefundWindow(
                    client,
                    auth,
                    refund,
                    reason ?? undefined,
                    "APPROVAL",
                  )
                : refund.policy_snapshot_json;
            const metadata =
              to === "APPROVED"
                ? ",approved_minor=requested_minor,approved_by_user_id=$6,approved_at=now(),approval_reason=$7"
                : to === "REJECTED"
                  ? ",rejected_by_user_id=$6,rejection_reason=$7"
                  : to === "CANCELLED"
                    ? ",cancelled_at=now()"
                    : to === "PROCESSING"
                      ? ",processing_at=now()"
                      : "";
            const updated = (
              await client.query<any>(
                `UPDATE refunds SET status=$3,version=version+1,updated_at=now(),policy_snapshot_json=$5${metadata} WHERE tenant_id=$1 AND id=$2 AND version=$4 RETURNING *`,
                to === "APPROVED" || to === "REJECTED"
                  ? [
                      auth.tenantId,
                      id,
                      to,
                      version,
                      JSON.stringify(policySnapshot),
                      auth.userId,
                      reason,
                    ]
                  : [
                      auth.tenantId,
                      id,
                      to,
                      version,
                      JSON.stringify(policySnapshot),
                    ],
              )
            ).rows[0];
            if (!updated) this.versionConflict();
            await this.history(
              client,
              auth,
              id,
              refund.status,
              to,
              null,
              requestId,
              reason ?? undefined,
            );
            await this.record(
              client,
              auth,
              updated,
              `refund.${to.toLowerCase()}`,
              requestId,
              key,
            );
            if (to === "APPROVED") {
              const external = await client.query(
                "SELECT 1 FROM refund_payment_allocations WHERE tenant_id=$1 AND refund_id=$2 LIMIT 1",
                [auth.tenantId, id],
              );
              const stored = await client.query(
                "SELECT 1 FROM refund_stored_value_line_plans WHERE tenant_id=$1 AND refund_id=$2 AND status='PENDING' LIMIT 1",
                [auth.tenantId, id],
              );
              if (
                !external.rowCount &&
                (stored.rowCount ||
                  updated.refund_destination === "CUSTOMER_CREDIT")
              )
                return this.finalizeIfComplete(
                  client,
                  auth,
                  updated,
                  requestId,
                  key,
                  "refund.stored_value_executed",
                );
            }
            return this.detailTx(client, auth, id);
          },
        }),
      )
      .then((result) => ({
        ...result.data,
        idempotencyReplayed: result.replayed,
      }));
  }

  private async buildPlan(
    client: PoolClient,
    auth: AccessClaims,
    invoiceId: string,
    body: any,
    lock: boolean,
  ) {
    const invoice = (
      await client.query<any>(
        `SELECT i.*,o.customer_id,b.code branch_code,b.timezone branch_timezone,COALESCE(bs.tax_policy_json,'{}'::jsonb) policy
       FROM invoices i JOIN pos_orders o ON o.tenant_id=i.tenant_id AND o.id=i.pos_order_id
       JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
       JOIN branch_settings bs ON bs.tenant_id=i.tenant_id AND bs.branch_id=i.branch_id
       WHERE i.tenant_id=$1 AND i.id=$2 AND i.status='ISSUED' ${lock ? "FOR UPDATE OF i" : ""}`,
        [auth.tenantId, invoiceId],
      )
    ).rows[0];
    if (!invoice)
      throw new NotFoundException({
        code: "INVOICE_NOT_FOUND",
        message: "Issued invoice not found",
      });
    this.assertBranch(auth, invoice.branch_id);
    if (
      new Set(body.items.map((x: any) => x.invoiceLineId)).size !==
      body.items.length
    )
      throw new ConflictException({
        code: "REFUND_DUPLICATE_LINE",
        message: "Each invoice line may be selected once",
      });
    const lines = (
      await client.query<any>(
        `SELECT l.*,b.refundable_minor,pol.line_type source_line_type,pol.gift_card_id,gc.source_payment_id gift_card_funding_payment_id,
                sva.id stored_value_account_id,sva.available_minor gift_card_available_minor,
                sva.reserved_minor gift_card_reserved_minor,sva.redeemed_minor gift_card_redeemed_minor,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('paymentId',fa.payment_id,'amountMinor',fa.allocated_minor::text)
                  ORDER BY fa.created_at,fa.id) FROM stored_value_funding_allocations fa
                  WHERE fa.tenant_id=pol.tenant_id AND fa.order_line_id=pol.id AND fa.funding_type='ACTIVATION'),'[]'::jsonb) gift_card_funding_allocations
           FROM invoice_lines l
           JOIN invoice_line_refund_balance b ON b.tenant_id=l.tenant_id AND b.invoice_line_id=l.id
           LEFT JOIN pos_order_lines pol ON pol.tenant_id=l.tenant_id AND pol.id=l.source_order_line_id
           LEFT JOIN gift_cards gc ON gc.tenant_id=pol.tenant_id AND gc.id=pol.gift_card_id
           LEFT JOIN stored_value_accounts sva ON sva.tenant_id=pol.tenant_id AND sva.gift_card_id=pol.gift_card_id
       WHERE l.tenant_id=$1 AND l.invoice_id=$2 AND l.id=ANY($3::uuid[])`,
        [auth.tenantId, invoiceId, body.items.map((x: any) => x.invoiceLineId)],
      )
    ).rows;
    if (lines.length !== body.items.length)
      throw new ConflictException({
        code: "REFUND_LINE_NOT_FOUND",
        message: "Invoice line not found",
      });
    const giftCardPurchaseLines = lines.filter(
      (line: any) => line.source_line_type === "GIFT_CARD",
    );
    if (
      giftCardPurchaseLines.length > 0 &&
      giftCardPurchaseLines.length !== lines.length
    )
      throw new ConflictException({
        code: "GIFT_CARD_PARTIAL_USE_MANUAL_REVIEW",
        message: "Gift-card funding refunds must be reviewed separately",
      });
    if (
      giftCardPurchaseLines.length > 0 &&
      body.refundDestination !== "ORIGINAL_TENDER"
    )
      throw new ConflictException({
        code: "GIFT_CARD_PURCHASE_REFUND_NOT_ALLOWED",
        message: "Gift-card funding can only return to its funding tender",
      });
    for (const line of giftCardPurchaseLines) {
      const selected = body.items.find(
        (item: any) => item.invoiceLineId === line.id,
      );
      if (
        !line.gift_card_id ||
        !line.stored_value_account_id ||
        !Array.isArray(line.gift_card_funding_allocations) ||
        line.gift_card_funding_allocations.reduce(
          (sum: bigint, item: any) => sum + BigInt(item.amountMinor),
          0n,
        ) !== BigInt(line.net_minor) ||
        selected.amountMinor !== Number(line.net_minor) ||
        BigInt(line.gift_card_reserved_minor ?? 0) !== 0n ||
        BigInt(line.gift_card_redeemed_minor ?? 0) !== 0n ||
        BigInt(line.gift_card_available_minor ?? 0) !== BigInt(line.net_minor)
      )
        throw new ConflictException({
          code:
            BigInt(line.gift_card_redeemed_minor ?? 0) > 0n
              ? "GIFT_CARD_PARTIAL_USE_MANUAL_REVIEW"
              : "GIFT_CARD_PURCHASE_REFUND_NOT_ALLOWED",
          message:
            "Only a fully unused gift card can be refunded automatically",
        });
    }
    const items = body.items.map((selected: any) => {
      const line = lines.find((x: any) => x.id === selected.invoiceLineId);
      if (selected.amountMinor > Number(line.refundable_minor))
        throw new ConflictException({
          code: "REFUND_LINE_BALANCE_EXCEEDED",
          message: "Refund exceeds line balance",
        });
      const componentBase = Number(line.taxable_minor) + Number(line.tax_minor);
      const components =
        componentBase === 0
          ? [
              { key: "taxable", amount: selected.amountMinor },
              { key: "tax", amount: 0 },
            ]
          : prorateMinor(selected.amountMinor, [
              { key: "taxable", amount: Number(line.taxable_minor) },
              { key: "tax", amount: Number(line.tax_minor) },
            ]);
      const taxable = components[0]?.amount ?? 0;
      const tax = components[1]?.amount ?? 0;
      const ratioBase = Number(line.net_minor) || 1;
      const discount = Math.floor(
        (Number(line.discount_minor) * selected.amountMinor) / ratioBase,
      );
      return {
        invoiceLineId: line.id,
        quantity: (Number(line.quantity) * selected.amountMinor) / ratioBase,
        grossRefundMinor: taxable + discount,
        discountReversalMinor: discount,
        taxableRefundMinor: taxable,
        taxRefundMinor: tax,
        totalRefundMinor: selected.amountMinor,
        sourceSnapshot: {
          lineNo: line.line_no,
          description: line.description_snapshot_json,
          quantity: line.quantity,
          unitPriceMinor: Number(line.unit_price_minor),
          discountMinor: Number(line.discount_minor),
          taxableMinor: Number(line.taxable_minor),
          taxMinor: Number(line.tax_minor),
          netMinor: Number(line.net_minor),
          tax: line.tax_snapshot_json,
        },
      };
    });
    const completedTip = Number(
      (
        await client.query<any>(
          `SELECT COALESCE(sum(r.tip_refund_minor),0) amount FROM refunds r WHERE r.tenant_id=$1 AND r.invoice_id=$2 AND r.status='COMPLETED'`,
          [auth.tenantId, invoiceId],
        )
      ).rows[0].amount,
    );
    if (body.tipAmountMinor > Number(invoice.tip_minor) - completedTip)
      throw new ConflictException({
        code: "REFUND_TIP_BALANCE_EXCEEDED",
        message: "Refund exceeds tip balance",
      });
    const requestedMinor =
      items.reduce((sum: number, item: any) => sum + item.totalRefundMinor, 0) +
      body.tipAmountMinor;
    const invoiceBalance = (
      await client.query<any>(
        "SELECT * FROM invoice_refund_summary WHERE tenant_id=$1 AND invoice_id=$2",
        [auth.tenantId, invoiceId],
      )
    ).rows[0];
    if (
      requestedMinor <= 0 ||
      requestedMinor > Number(invoiceBalance.refundable_minor)
    )
      throw new ConflictException({
        code: "REFUND_BALANCE_EXCEEDED",
        message: "Refund exceeds captured balance",
      });
    if (body.refundDestination === "CUSTOMER_CREDIT") {
      if (!invoice.customer_id)
        throw new ConflictException({
          code: "CUSTOMER_CREDIT_REFUND_CONFLICT",
          message: "Customer credit requires an identified customer",
        });
      if (body.tipAmountMinor > 0)
        throw new ConflictException({
          code: "STORED_VALUE_TIP_NOT_ALLOWED",
          message: "Customer credit cannot be issued for a tip refund",
        });
      if (body.paymentPreferences?.length)
        throw new ConflictException({
          code: "CUSTOMER_CREDIT_REFUND_CONFLICT",
          message:
            "Original-tender allocations cannot be combined with customer credit",
        });
    }
    const payments = (
      await client.query<any>(
        `SELECT p.*,b.refundable_minor FROM payments p JOIN payment_refund_balance b ON b.tenant_id=p.tenant_id AND b.payment_id=p.id
       WHERE p.tenant_id=$1 AND p.pos_order_id=$2 AND p.status='CAPTURED' AND b.refundable_minor>0 ORDER BY p.captured_at DESC,p.id`,
        [auth.tenantId, invoice.pos_order_id],
      )
    ).rows;
    const storedSources = (
      await client.query<any>(
        `SELECT sl.id settlement_line_allocation_id,sl.settlement_allocation_id,
                sl.invoice_line_id,sl.allocated_minor,sl.currency,s.account_id,il.net_minor,
                COALESCE((SELECT sum(ri.total_refund_minor)
                  FROM refund_items ri JOIN refunds rr ON rr.tenant_id=ri.tenant_id AND rr.id=ri.refund_id
                  WHERE ri.tenant_id=sl.tenant_id AND ri.invoice_line_id=sl.invoice_line_id
                    AND rr.status='COMPLETED'),0) completed_line_refund_minor,
                COALESCE((SELECT sum(ra.amount_minor) FROM stored_value_refund_allocations ra
                  WHERE ra.tenant_id=sl.tenant_id AND ra.settlement_line_allocation_id=sl.id),0) restored_minor,
                COALESCE((SELECT sum(rp.planned_minor) FROM refund_stored_value_line_plans rp
                  WHERE rp.tenant_id=sl.tenant_id AND rp.settlement_line_allocation_id=sl.id
                    AND rp.status='PENDING'),0) pending_minor
           FROM stored_value_settlement_line_allocations sl
           JOIN stored_value_settlement_allocations s ON s.tenant_id=sl.tenant_id AND s.id=sl.settlement_allocation_id
           JOIN invoice_lines il ON il.tenant_id=sl.tenant_id AND il.id=sl.invoice_line_id
          WHERE sl.tenant_id=$1 AND sl.invoice_line_id=ANY($2::uuid[])
          ORDER BY il.line_no,sl.created_at,sl.id`,
        [auth.tenantId, body.items.map((item: any) => item.invoiceLineId)],
      )
    ).rows;
    const issueCustomerCredit = body.refundDestination === "CUSTOMER_CREDIT";
    const refundGiftCardPurchase = giftCardPurchaseLines.length > 0;
    const storedValueAllocations: any[] = [];
    if (!issueCustomerCredit && !refundGiftCardPurchase) {
      for (const source of storedSources) {
        const selected = body.items.find(
          (item: any) => item.invoiceLineId === source.invoice_line_id,
        );
        if (!selected) continue;
        const lineNet = BigInt(source.net_minor);
        const cumulativeRefund =
          BigInt(source.completed_line_refund_minor) +
          BigInt(selected.amountMinor);
        const planned = cumulativeProportionalRestore({
          originalAllocation: BigInt(source.allocated_minor),
          lineNet,
          cumulativeRefund,
          previouslyRestored: BigInt(source.restored_minor),
          pendingRestore: BigInt(source.pending_minor),
        });
        if (planned <= 0n) continue;
        storedValueAllocations.push({
          settlementAllocationId: source.settlement_allocation_id,
          settlementLineAllocationId: source.settlement_line_allocation_id,
          invoiceLineId: source.invoice_line_id,
          accountId: source.account_id,
          plannedMinor: Number(planned),
          currency: source.currency,
        });
      }
    }
    let remaining = issueCustomerCredit
      ? 0
      : requestedMinor -
        storedValueAllocations.reduce(
          (sum, item) => sum + item.plannedMinor,
          0,
        );
    const giftCardFundingAmounts = new Map<string, number>();
    for (const line of giftCardPurchaseLines)
      for (const allocation of line.gift_card_funding_allocations ?? [])
        giftCardFundingAmounts.set(
          allocation.paymentId,
          (giftCardFundingAmounts.get(allocation.paymentId) ?? 0) +
            Number(allocation.amountMinor),
        );
    const giftCardFundingPaymentIds = new Set(giftCardFundingAmounts.keys());
    const eligiblePayments = refundGiftCardPurchase
      ? payments.filter((payment: any) =>
          giftCardFundingPaymentIds.has(payment.id),
        )
      : payments;
    const preferences = refundGiftCardPurchase
      ? [...giftCardFundingAmounts].map(([paymentId, amountMinor]) => ({
          paymentId,
          amountMinor,
        }))
      : body.paymentPreferences?.length
        ? body.paymentPreferences
        : eligiblePayments.map((p: any) => ({
            paymentId: p.id,
            amountMinor: Math.min(remaining, Number(p.refundable_minor)),
          }));
    const paymentAllocations: any[] = [];
    for (const preference of preferences) {
      if (remaining <= 0 || preference.amountMinor <= 0) continue;
      const payment = eligiblePayments.find(
        (p: any) => p.id === preference.paymentId,
      );
      if (!payment || preference.amountMinor > Number(payment.refundable_minor))
        throw new ConflictException({
          code: "REFUND_PAYMENT_BALANCE_EXCEEDED",
          message: "Refund exceeds original payment balance",
        });
      const amount = Math.min(remaining, preference.amountMinor);
      paymentAllocations.push({
        paymentId: payment.id,
        tenderType: payment.tender_type,
        plannedMinor: amount,
        refundableMinor: Number(payment.refundable_minor),
        registerId: payment.register_id,
        cashSessionId: payment.cash_session_id,
        provider: payment.provider,
      });
      remaining -= amount;
    }
    if (remaining !== 0)
      throw new ConflictException({
        code: "REFUND_PAYMENT_ALLOCATION_INVALID",
        message: "Payment allocations must equal requested refund",
      });
    const policy = {
      refundWindowDays: 30,
      managerApprovalLimitMinor: 5_000_000,
      ownerApprovalLimitMinor: Number.MAX_SAFE_INTEGER,
      requireDualControl: true,
      allowTipRefund: true,
      allowTenderSubstitution: false,
      ...(invoice.policy?.refundPolicy ?? {}),
    };
    const policyWithWindow = await this.enforceRefundWindow(
      client,
      auth,
      { ...invoice, policy_snapshot_json: policy },
      body.overrideReason,
      lock ? "CREATE" : "PLAN",
    );
    return {
      branchId: invoice.branch_id,
      branchCode: invoice.branch_code,
      branchTimezone: invoice.branch_timezone,
      posOrderId: invoice.pos_order_id,
      customerId: invoice.customer_id,
      currency: invoice.currency,
      originalTipMinor: Number(invoice.tip_minor),
      requestedMinor,
      serviceRefundMinor: items.reduce(
        (sum: number, x: any) => sum + x.taxableRefundMinor,
        0,
      ),
      taxRefundMinor: items.reduce(
        (sum: number, x: any) => sum + x.taxRefundMinor,
        0,
      ),
      tipRefundMinor: body.tipAmountMinor,
      items,
      paymentAllocations,
      storedValueAllocations,
      giftCardPurchaseAllocations: giftCardPurchaseLines.map((line: any) => ({
        giftCardId: line.gift_card_id,
        accountId: line.stored_value_account_id,
        plannedMinor: Number(line.net_minor),
        currency: invoice.currency,
      })),
      refundDestination: body.refundDestination,
      customerCreditAllocation: issueCustomerCredit
        ? {
            customerId: invoice.customer_id,
            amountMinor: requestedMinor,
            currency: invoice.currency,
          }
        : null,
      policy: policyWithWindow,
      approval: { required: true, reasonCodes: ["DUAL_CONTROL"] },
    };
  }

  private async finalizeIfComplete(
    client: PoolClient,
    auth: AccessClaims,
    refund: any,
    requestId: string,
    key: string,
    event: string,
  ) {
    let sums = (
      await client.query<any>(
        `SELECT count(*) FILTER(WHERE status<>'COMPLETED') pending,COALESCE(sum(completed_minor),0) completed FROM refund_payment_allocations
       WHERE tenant_id=$1 AND refund_id=$2`,
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    if (Number(sums.pending) === 0) {
      await this.issueCreditNote(client, auth, refund, requestId);
      await this.storedValue.restoreRefundAllocations(
        client,
        auth,
        refund,
        requestId,
      );
      if (refund.refund_destination === "CUSTOMER_CREDIT")
        await this.storedValue.issueRefundCustomerCreditTx(
          client,
          auth,
          refund,
          requestId,
        );
      await this.storedValue.cancelGiftCardPurchaseRefundsTx(
        client,
        auth,
        refund,
        requestId,
      );
    }
    const storedSums = (
      await client.query<any>(
        `SELECT count(*) FILTER(WHERE status<>'COMPLETED') pending,COALESCE(sum(completed_minor),0) completed
           FROM refund_stored_value_line_plans WHERE tenant_id=$1 AND refund_id=$2`,
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    const customerCreditCompleted = BigInt(
      (
        await client.query<any>(
          `SELECT COALESCE(sum(amount_minor),0) completed FROM stored_value_refund_allocations
           WHERE tenant_id=$1 AND refund_id=$2 AND destination='CUSTOMER_CREDIT'`,
          [auth.tenantId, refund.id],
        )
      ).rows[0].completed,
    );
    const purchasePlanPending = Number(
      (
        await client.query<any>(
          `SELECT count(*) FILTER(WHERE status<>'COMPLETED') pending
             FROM gift_card_purchase_refund_plans WHERE tenant_id=$1 AND refund_id=$2`,
          [auth.tenantId, refund.id],
        )
      ).rows[0].pending,
    );
    sums = {
      pending:
        Number(sums.pending) + Number(storedSums.pending) + purchasePlanPending,
      completed:
        BigInt(sums.completed) +
        BigInt(storedSums.completed) +
        customerCreditCompleted,
    };
    const status =
      Number(sums.pending) === 0 &&
      BigInt(sums.completed) === BigInt(refund.requested_minor)
        ? "COMPLETED"
        : "PROCESSING";
    const updated = (
      await client.query<any>(
        `UPDATE refunds SET status=$3,completed_minor=$4,processing_at=COALESCE(processing_at,now()),completed_at=CASE WHEN $3='COMPLETED' THEN now() ELSE NULL END,
         version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [auth.tenantId, refund.id, status, sums.completed],
      )
    ).rows[0];
    await this.history(
      client,
      auth,
      refund.id,
      refund.status,
      status,
      null,
      requestId,
    );
    if (status === "COMPLETED") {
      await this.issueCreditNote(client, auth, updated, requestId);
      await this.generateTipReversals(client, auth, updated);
      await this.generateCommissionReversals(client, auth, updated);
      await this.benefits.reverseRefundBenefits(
        client,
        auth,
        updated,
        requestId,
      );
    }
    await this.record(
      client,
      auth,
      updated,
      status === "COMPLETED" ? "refund.completed" : event,
      requestId,
      key,
    );
    return this.detailTx(client, auth, refund.id);
  }

  private async issueCreditNote(
    client: PoolClient,
    auth: AccessClaims,
    refund: any,
    requestId: string,
  ) {
    if (
      (
        await client.query(
          "SELECT 1 FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2",
          [auth.tenantId, refund.id],
        )
      ).rowCount
    )
      return;
    const branch = (
      await client.query<any>(
        "SELECT code,timezone FROM branches WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, refund.branch_id],
      )
    ).rows[0];
    const fiscalYear = branchFiscalYear(new Date(), branch.timezone);
    const counter = (
      await client.query<any>(
        `INSERT INTO credit_note_counters(tenant_id,branch_id,fiscal_year,last_number) VALUES($1,$2,$3,1)
       ON CONFLICT(tenant_id,branch_id,fiscal_year) DO UPDATE SET last_number=credit_note_counters.last_number+1,updated_at=now() RETURNING last_number`,
        [auth.tenantId, refund.branch_id, fiscalYear],
      )
    ).rows[0];
    const number = `CN-${branch.code}-${fiscalYear}-${String(counter.last_number).padStart(6, "0")}`;
    const invoice = (
      await client.query<any>(
        "SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, refund.invoice_id],
      )
    ).rows[0];
    const note = (
      await client.query<any>(
        `INSERT INTO credit_notes(tenant_id,branch_id,refund_id,original_invoice_id,credit_note_number,status,currency,gross_minor,discount_reversal_minor,
         taxable_minor,tax_minor,tip_minor,total_minor,customer_snapshot_json,branch_snapshot_json,original_invoice_snapshot_json,issued_at,issued_by_user_id)
       SELECT $1,$2,$3,$4,$5,'ISSUED',$6,COALESCE(sum(gross_refund_minor),0),COALESCE(sum(discount_reversal_minor),0),COALESCE(sum(taxable_refund_minor),0),
         COALESCE(sum(tax_refund_minor),0),COALESCE(sum(tip_refund_minor),0),COALESCE(sum(total_refund_minor),0),$7,$8,$9,now(),$10
       FROM refund_items WHERE tenant_id=$1 AND refund_id=$3 RETURNING *`,
        [
          auth.tenantId,
          refund.branch_id,
          refund.id,
          refund.invoice_id,
          number,
          refund.currency,
          JSON.stringify(invoice.customer_snapshot_json),
          JSON.stringify(invoice.branch_snapshot_json),
          JSON.stringify({
            invoiceNumber: invoice.invoice_number,
            issuedAt: invoice.issued_at,
            totals: {
              subtotalMinor: invoice.subtotal_minor,
              discountMinor: invoice.discount_minor,
              taxMinor: invoice.tax_minor,
              tipMinor: invoice.tip_minor,
              totalMinor: invoice.total_minor,
            },
          }),
          auth.userId,
        ],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO credit_note_lines(tenant_id,credit_note_id,line_no,refund_item_id,original_invoice_line_id,description_snapshot_json,quantity,gross_minor,
         discount_reversal_minor,taxable_minor,tax_minor,tip_minor,total_minor,tax_snapshot_json)
       SELECT ri.tenant_id,$2,row_number() OVER(ORDER BY ri.created_at,ri.id),ri.id,ri.invoice_line_id,
         COALESCE(ri.source_snapshot_json->'description',jsonb_build_object('type',ri.item_type)),ri.quantity,ri.gross_refund_minor,ri.discount_reversal_minor,
         ri.taxable_refund_minor,ri.tax_refund_minor,ri.tip_refund_minor,ri.total_refund_minor,COALESCE(ri.source_snapshot_json->'tax','{}'::jsonb)
       FROM refund_items ri WHERE ri.tenant_id=$1 AND ri.refund_id=$3`,
      [auth.tenantId, note.id, refund.id],
    );
    await this.evidence.record(client, {
      auth,
      branchId: refund.branch_id,
      event: "credit_note.issued",
      aggregateType: "credit_note",
      aggregateId: note.id,
      aggregateVersion: 1,
      requestId,
      currency: refund.currency,
      amountMinor: BigInt(refund.completed_minor),
      payload: { creditNoteNumber: number, refundId: refund.id },
    });
  }

  private async generateTipReversals(
    client: PoolClient,
    auth: AccessClaims,
    refund: any,
  ) {
    const tipItem = (
      await client.query<any>(
        "SELECT * FROM refund_items WHERE tenant_id=$1 AND refund_id=$2 AND item_type='TIP'",
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    if (!tipItem) return;
    const allocations = (
      await client.query<any>(
        `SELECT a.*,GREATEST(0,a.amount_minor-COALESCE((SELECT sum(rta.amount_minor) FROM refund_tip_allocations rta JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id WHERE rta.tenant_id=a.tenant_id AND rta.original_tip_allocation_id=a.id AND r.status='COMPLETED'),0)) remaining
       FROM pos_tip_allocations a JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id WHERE t.tenant_id=$1 AND t.pos_order_id=$2 AND t.status='ACTIVE' ORDER BY a.id`,
        [auth.tenantId, refund.pos_order_id],
      )
    ).rows;
    const split = prorateMinor(
      Number(tipItem.tip_refund_minor),
      allocations.map((a: any) => ({ key: a.id, amount: Number(a.remaining) })),
    );
    for (const part of split.filter((x) => x.amount > 0)) {
      const original = allocations.find((a: any) => a.id === part.key);
      await client.query(
        `INSERT INTO refund_tip_allocations(tenant_id,refund_item_id,original_tip_allocation_id,staff_id,amount_minor,allocation_basis)
         VALUES($1,$2,$3,$4,$5,'PRO_RATA_ORIGINAL') ON CONFLICT DO NOTHING`,
        [
          auth.tenantId,
          tipItem.id,
          original.id,
          original.staff_id,
          part.amount,
        ],
      );
    }
  }

  private async generateCommissionReversals(
    client: PoolClient,
    auth: AccessClaims,
    refund: any,
  ) {
    await client.query(
      `INSERT INTO commission_entries(tenant_id,branch_id,staff_id,invoice_id,invoice_line_id,service_session_id,original_entry_id,refund_id,credit_note_id,
         entry_type,business_date,currency,base_minor,commission_minor,contribution_basis_json,rule_snapshot_json,source_snapshot_json,generation_key,status,period_id)
       SELECT e.tenant_id,e.branch_id,e.staff_id,e.invoice_id,e.invoice_line_id,e.service_session_id,e.id,$2,c.id,
         CASE WHEN p.status='LOCKED' THEN 'LOCKED_PERIOD_REFUND_ADJUSTMENT' ELSE 'REFUND_REVERSAL' END,CURRENT_DATE,e.currency,
         -LEAST(abs(e.base_minor),round(abs(e.base_minor)*(ri.taxable_refund_minor::numeric/NULLIF(il.net_minor-il.tax_minor,0)))::bigint),
         -LEAST(GREATEST(abs(e.commission_minor)-prior.reversed_minor,0),round(abs(e.commission_minor)*(ri.taxable_refund_minor::numeric/NULLIF(il.net_minor-il.tax_minor,0)))::bigint),e.contribution_basis_json,e.rule_snapshot_json,
         jsonb_build_object('refundId',$2,'creditNoteId',c.id,'originalEntryId',e.id),concat('refund:',$2,':entry:',e.id),
         CASE WHEN p.status='LOCKED' THEN 'GENERATED' ELSE e.status END,CASE WHEN p.status='LOCKED' THEN NULL ELSE e.period_id END
       FROM commission_entries e JOIN refund_items ri ON ri.tenant_id=e.tenant_id AND ri.invoice_line_id=e.invoice_line_id
       JOIN invoice_lines il ON il.tenant_id=e.tenant_id AND il.id=e.invoice_line_id JOIN credit_notes c ON c.tenant_id=e.tenant_id AND c.refund_id=$2
       LEFT JOIN commission_periods p ON p.tenant_id=e.tenant_id AND p.id=e.period_id
       CROSS JOIN LATERAL(
         SELECT COALESCE(sum(abs(previous.commission_minor)),0)::bigint reversed_minor
         FROM commission_entries previous
         WHERE previous.tenant_id=e.tenant_id AND previous.original_entry_id=e.id
           AND previous.entry_type IN('REFUND_REVERSAL','LOCKED_PERIOD_REFUND_ADJUSTMENT')
       ) prior
       WHERE e.tenant_id=$1 AND ri.refund_id=$2 AND e.entry_type='EARNING'
         AND ri.taxable_refund_minor>0 AND (il.net_minor-il.tax_minor)>0
         AND GREATEST(abs(e.commission_minor)-prior.reversed_minor,0)>0
       ON CONFLICT DO NOTHING`,
      [auth.tenantId, refund.id],
    );
  }

  private async detailTx(client: PoolClient, auth: AccessClaims, id: string) {
    const row = await this.refundRow(client, auth, id, false);
    const items = await client.query<any>(
      "SELECT * FROM refund_items WHERE tenant_id=$1 AND refund_id=$2 ORDER BY created_at,id",
      [auth.tenantId, id],
    );
    const allocations = await client.query<any>(
      "SELECT id,original_payment_id,tender_type,planned_minor,completed_minor,status,original_register_id,original_cash_session_id,execution_cash_session_id,provider,provider_refund_id,completed_at FROM refund_payment_allocations WHERE tenant_id=$1 AND refund_id=$2 ORDER BY created_at,id",
      [auth.tenantId, id],
    );
    const note = await client.query<any>(
      "SELECT id,credit_note_number,status,currency,gross_minor,discount_reversal_minor,taxable_minor,tax_minor,tip_minor,total_minor,issued_at,issued_by_user_id,original_invoice_id FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2",
      [auth.tenantId, id],
    );
    const [contextResult, originalPayments, cashEvidence, refundable] =
      await Promise.all([
        client.query<any>(
          `SELECT b.id branch_id,b.name branch_name,b.code branch_code,b.timezone branch_timezone,b.status branch_status,
                  i.id invoice_id,i.invoice_number,i.status invoice_status,i.currency invoice_currency,
                  i.subtotal_minor invoice_subtotal_minor,i.discount_minor invoice_discount_minor,
                  i.taxable_minor invoice_taxable_minor,i.tax_minor invoice_tax_minor,i.total_minor invoice_total_minor,
                  i.tip_minor invoice_tip_minor,i.paid_minor invoice_paid_minor,i.issued_at invoice_issued_at,
                  i.customer_snapshot_json invoice_customer_snapshot,i.branch_snapshot_json invoice_branch_snapshot,
                  o.id order_id,o.order_number,o.status order_status,o.source order_source,o.appointment_id,
                  o.customer_snapshot_json order_customer_snapshot,o.appointment_snapshot_json order_appointment_snapshot,
                  a.id appointment_id,a.booking_reference,a.status appointment_status,a.start_at appointment_start_at,a.end_at appointment_end_at,
                  requester.id requester_id,requester.display_name requester_display_name,
                  approver.id approver_id,approver.display_name approver_display_name
             FROM refunds r
             JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id
             JOIN invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
             JOIN pos_orders o ON o.tenant_id=r.tenant_id AND o.id=r.pos_order_id
             LEFT JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id
             LEFT JOIN users requester ON requester.id=r.requested_by_user_id
             LEFT JOIN users approver ON approver.id=r.approved_by_user_id
            WHERE r.tenant_id=$1 AND r.id=$2`,
          [auth.tenantId, id],
        ),
        client.query<any>(
          `SELECT p.id,p.payment_reference,p.tender_type,p.status,p.currency,p.requested_minor,p.captured_minor,
                  p.cash_received_minor,p.change_due_minor,p.provider,p.provider_transaction_id,p.card_brand,p.card_last4,
                  p.cash_session_id,p.register_id,p.captured_at,
                  cs.status cash_session_status,cs.business_date cash_business_date,
                  pr.code register_code,pr.name register_name
             FROM refund_payment_allocations a
             JOIN payments p ON p.tenant_id=a.tenant_id AND p.id=a.original_payment_id
             LEFT JOIN cash_sessions cs ON cs.tenant_id=p.tenant_id AND cs.id=p.cash_session_id
             LEFT JOIN pos_registers pr ON pr.tenant_id=p.tenant_id AND pr.id=p.register_id
            WHERE a.tenant_id=$1 AND a.refund_id=$2
            ORDER BY p.captured_at NULLS LAST,p.created_at,p.id`,
          [auth.tenantId, id],
        ),
        client.query<any>(
          `SELECT cm.id movement_id,cm.cash_session_id,cm.amount_minor,cm.currency,cm.occurred_at,
                  cs.status cash_session_status,cs.business_date cash_business_date,cs.register_id,
                  pr.code register_code,pr.name register_name
             FROM cash_movements cm
             JOIN cash_sessions cs ON cs.tenant_id=cm.tenant_id AND cs.id=cm.cash_session_id
             LEFT JOIN pos_registers pr ON pr.tenant_id=cs.tenant_id AND pr.id=cs.register_id
            WHERE cm.tenant_id=$1 AND cm.related_refund_id=$2
              AND cm.movement_type='CASH_REFUND' AND cm.direction='OUT'
            ORDER BY cm.occurred_at DESC,cm.id DESC
            LIMIT 1`,
          [auth.tenantId, id],
        ),
        client.query<any>(
          `SELECT refundable_minor FROM invoice_refund_summary WHERE tenant_id=$1 AND invoice_id=$2`,
          [auth.tenantId, row.invoice_id],
        ),
      ]);
    const context = contextResult.rows[0] ?? {};
    const canSeePii = !auth.supportAccess && !auth.roles.includes("PLATFORM_SUPER_ADMIN");
    const invoiceCustomer = context.invoice_customer_snapshot ?? {};
    const orderCustomer = context.order_customer_snapshot ?? {};
    const customerSnapshot = Object.keys(invoiceCustomer).length
      ? invoiceCustomer
      : orderCustomer;
    const cashCompletedMinor = allocations.rows
      .filter((allocation) => allocation.tender_type === "CASH")
      .reduce((sum, allocation) => sum + Number(allocation.completed_minor ?? 0), 0);
    const cashRow = cashEvidence.rows[0] ?? null;
    return {
      ...refundView(row),
      items: items.rows.map((item) => ({
        ...item,
        itemType: item.item_type,
        invoiceLineId: item.invoice_line_id,
        quantity: item.quantity === null ? null : Number(item.quantity),
        grossRefundMinor: Number(item.gross_refund_minor),
        discountReversalMinor: Number(item.discount_reversal_minor),
        taxableRefundMinor: Number(item.taxable_refund_minor),
        taxRefundMinor: Number(item.tax_refund_minor),
        tipRefundMinor: Number(item.tip_refund_minor),
        totalRefundMinor: Number(item.total_refund_minor),
        sourceSnapshot: item.source_snapshot_json,
      })),
      paymentAllocations: allocations.rows.map((x) => ({
        ...x,
        provider_refund_id: x.provider_refund_id
          ? "***" + String(x.provider_refund_id).slice(-4)
          : null,
        originalPaymentId: x.original_payment_id,
        tenderType: x.tender_type,
        plannedMinor: Number(x.planned_minor),
        completedMinor: Number(x.completed_minor),
        originalRegisterId: x.original_register_id,
        originalCashSessionId: x.original_cash_session_id,
        executionCashSessionId: x.execution_cash_session_id,
        providerRefundId: x.provider_refund_id
          ? "***" + String(x.provider_refund_id).slice(-4)
          : null,
        completedAt: x.completed_at,
      })),
      creditNote: note.rows[0]
        ? {
            ...note.rows[0],
            creditNoteNumber: note.rows[0].credit_note_number,
            totalMinor: Number(note.rows[0].total_minor),
            issuedAt: note.rows[0].issued_at,
          }
        : null,
      context: {
        branch: {
          id: context.branch_id ?? row.branch_id,
          name: context.branch_name ?? null,
          code: context.branch_code ?? null,
          timezone: context.branch_timezone ?? null,
          status: context.branch_status ?? null,
        },
        customer: {
          id: row.customer_id ?? null,
          displayName: snapshotField(customerSnapshot, "displayName", "display_name") ?? "Khách vãng lai",
          phone: canSeePii ? snapshotField(customerSnapshot, "phone") : null,
          email: canSeePii ? snapshotField(customerSnapshot, "email") : null,
        },
        invoice: {
          id: context.invoice_id ?? row.invoice_id,
          invoiceNumber: context.invoice_number ?? null,
          status: context.invoice_status ?? null,
          currency: context.invoice_currency ?? row.currency,
          subtotalMinor: Number(context.invoice_subtotal_minor ?? 0),
          discountMinor: Number(context.invoice_discount_minor ?? 0),
          taxableMinor: Number(context.invoice_taxable_minor ?? 0),
          taxMinor: Number(context.invoice_tax_minor ?? 0),
          tipMinor: Number(context.invoice_tip_minor ?? 0),
          totalMinor: Number(context.invoice_total_minor ?? 0),
          paidMinor: Number(context.invoice_paid_minor ?? 0),
          issuedAt: context.invoice_issued_at ?? null,
          customerSnapshot: context.invoice_customer_snapshot ?? null,
          branchSnapshot: context.invoice_branch_snapshot ?? null,
          href: `/admin/financial/invoices?branchId=${encodeURIComponent(row.branch_id)}&invoiceId=${encodeURIComponent(row.invoice_id)}`,
        },
        order: {
          id: context.order_id ?? row.pos_order_id,
          orderNumber: context.order_number ?? null,
          status: context.order_status ?? null,
          source: context.order_source ?? null,
          appointmentId: context.appointment_id ?? null,
          href: `/admin/pos/orders/${encodeURIComponent(row.pos_order_id)}`,
        },
        appointment: context.appointment_id
          ? {
              id: context.appointment_id,
              bookingReference: context.booking_reference ?? null,
              status: context.appointment_status ?? null,
              startAt: context.appointment_start_at ?? null,
              endAt: context.appointment_end_at ?? null,
              href: `/admin/appointments/${encodeURIComponent(context.appointment_id)}/overview`,
            }
          : null,
        requester: context.requester_id
          ? { id: context.requester_id, displayName: context.requester_display_name }
          : null,
        approver: context.approver_id
          ? { id: context.approver_id, displayName: context.approver_display_name }
          : null,
        processedBy: null,
        originalPayments: originalPayments.rows.map((payment) => ({
          id: payment.id,
          paymentReference: payment.payment_reference,
          tenderType: payment.tender_type,
          status: payment.status,
          currency: payment.currency,
          requestedMinor: Number(payment.requested_minor),
          capturedMinor: Number(payment.captured_minor),
          cashReceivedMinor: payment.cash_received_minor === null ? null : Number(payment.cash_received_minor),
          changeDueMinor: payment.change_due_minor === null ? null : Number(payment.change_due_minor),
          provider: payment.provider,
          providerTransactionIdSafe: redactProviderReference(payment.provider_transaction_id),
          cardBrand: payment.card_brand,
          cardLast4: payment.card_last4,
          cashSession: payment.cash_session_id
            ? { id: payment.cash_session_id, status: payment.cash_session_status, businessDate: payment.cash_business_date }
            : null,
          register: payment.register_id
            ? { id: payment.register_id, code: payment.register_code, name: payment.register_name }
            : null,
          capturedAt: payment.captured_at,
        })),
        cashEvidence: cashRow
          ? {
              verified: Number(cashRow.amount_minor) === cashCompletedMinor,
              cashSessionId: cashRow.cash_session_id,
              movementId: cashRow.movement_id,
              amountMinor: Number(cashRow.amount_minor),
              currency: cashRow.currency,
              occurredAt: cashRow.occurred_at,
              cashSession: {
                id: cashRow.cash_session_id,
                status: cashRow.cash_session_status,
                businessDate: cashRow.cash_business_date,
              },
              register: cashRow.register_id
                ? { id: cashRow.register_id, code: cashRow.register_code, name: cashRow.register_name }
                : null,
              href: `/admin/pos/cash-sessions/${encodeURIComponent(cashRow.cash_session_id)}`,
            }
          : null,
        remainingRefundableMinor: Number(refundable.rows[0]?.refundable_minor ?? 0),
        policy: row.policy_snapshot_json ?? null,
      },
    };
  }

  private async refundRow(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
    lock: boolean,
  ) {
    const row = (
      await client.query<any>(
        `SELECT * FROM refunds WHERE tenant_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "REFUND_NOT_FOUND",
        message: "Refund not found",
      });
    this.assertBranch(auth, row.branch_id);
    return row;
  }
  private async revalidateBalances(client: PoolClient, refund: any) {
    const balance = (
      await client.query<any>(
        "SELECT refundable_minor FROM invoice_refund_summary WHERE tenant_id=$1 AND invoice_id=$2",
        [refund.tenant_id, refund.invoice_id],
      )
    ).rows[0];
    const outstanding =
      Number(refund.requested_minor) - Number(refund.completed_minor);
    if (!balance || outstanding > Number(balance.refundable_minor))
      throw new ConflictException({
        code: "REFUND_BALANCE_CHANGED",
        message: "Refundable balance changed",
      });
    const overPayment = (
      await client.query<any>(
        `SELECT a.id FROM refund_payment_allocations a JOIN payment_refund_balance b
         ON b.tenant_id=a.tenant_id AND b.payment_id=a.original_payment_id
       WHERE a.tenant_id=$1 AND a.refund_id=$2 AND a.status<>'COMPLETED'
         AND (a.planned_minor-a.completed_minor)>b.refundable_minor LIMIT 1`,
        [refund.tenant_id, refund.id],
      )
    ).rows[0];
    if (overPayment)
      throw new ConflictException({
        code: "REFUND_EXCEEDS_PAYMENT_BALANCE",
        message: "Original payment refundable balance changed",
      });
    const overLine = (
      await client.query<any>(
        `SELECT ri.id FROM refund_items ri JOIN invoice_line_refund_balance b
         ON b.tenant_id=ri.tenant_id AND b.invoice_line_id=ri.invoice_line_id
       WHERE ri.tenant_id=$1 AND ri.refund_id=$2 AND ri.item_type='INVOICE_LINE' AND ri.total_refund_minor>b.refundable_minor LIMIT 1`,
        [refund.tenant_id, refund.id],
      )
    ).rows[0];
    if (overLine)
      throw new ConflictException({
        code: "REFUND_EXCEEDS_LINE_BALANCE",
        message: "Invoice line refundable balance changed",
      });
  }
  private async lockOriginalFinancials(client: PoolClient, refund: any) {
    await client.query(
      "SELECT id FROM invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [refund.tenant_id, refund.invoice_id],
    );
    await client.query(
      "SELECT id FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 AND status='CAPTURED' ORDER BY id FOR UPDATE",
      [refund.tenant_id, refund.pos_order_id],
    );
  }
  private async assertActiveExecutionBranch(client: PoolClient, refund: any) {
    const branch = (
      await client.query<{ status: string }>(
        "SELECT status FROM branches WHERE tenant_id=$1 AND id=$2",
        [refund.tenant_id, refund.branch_id],
      )
    ).rows[0];
    if (!branch || branch.status !== "ACTIVE")
      throw new ConflictException({
        code: "REFUND_BRANCH_INACTIVE",
        message: "Refund execution requires an active branch",
      });
  }
  private async enforceRefundWindow(
    client: PoolClient,
    auth: AccessClaims,
    refundOrInvoice: any,
    overrideReason: string | undefined,
    phase: "PLAN" | "CREATE" | "APPROVAL",
  ) {
    const context = refundOrInvoice.issued_at
      ? {
          issued_at: refundOrInvoice.issued_at,
          timezone: refundOrInvoice.branch_timezone,
        }
      : (
          await client.query<any>(
            `SELECT i.issued_at,b.timezone FROM invoices i
             JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
             WHERE i.tenant_id=$1 AND i.id=$2`,
            [refundOrInvoice.tenant_id, refundOrInvoice.invoice_id],
          )
        ).rows[0];
    if (!context)
      throw new NotFoundException({
        code: "INVOICE_NOT_FOUND",
        message: "Invoice not found",
      });
    const policy = { ...(refundOrInvoice.policy_snapshot_json ?? {}) };
    const evidence = refundWindowEvidence(
      context.issued_at,
      context.timezone,
      Number(policy.refundWindowDays ?? 30),
    );
    policy.refundWindowEvidence = evidence;
    if (!evidence.outOfWindow) return policy;
    if (
      !overrideReason ||
      !(await this.hasPermission(client, auth, "refund.override_window"))
    )
      throw new ForbiddenException({
        code: "REFUND_WINDOW_OVERRIDE_REQUIRED",
        message:
          "Refund is outside the branch-local refund window; permission and reason are required",
      });
    policy.refundWindowOverride = {
      phase,
      reason: overrideReason,
      actorUserId: auth.userId,
      approvedAt: new Date().toISOString(),
      evidence,
    };
    return policy;
  }
  private async assertExecutionWithinRefundWindow(
    client: PoolClient,
    refund: any,
  ) {
    const context = (
      await client.query<any>(
        `SELECT i.issued_at,b.timezone FROM invoices i
         JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
         WHERE i.tenant_id=$1 AND i.id=$2`,
        [refund.tenant_id, refund.invoice_id],
      )
    ).rows[0];
    const evidence = refundWindowEvidence(
      context.issued_at,
      context.timezone,
      Number(refund.policy_snapshot_json?.refundWindowDays ?? 30),
    );
    if (
      evidence.outOfWindow &&
      !refund.policy_snapshot_json?.refundWindowOverride?.reason
    )
      throw new ForbiddenException({
        code: "REFUND_WINDOW_OVERRIDE_REQUIRED",
        message:
          "Refund execution is outside the branch-local refund window and lacks approved override evidence",
      });
  }
  private async hasPermission(
    client: PoolClient,
    auth: AccessClaims,
    permission: string,
  ) {
    return Boolean(
      (
        await client.query(
          `SELECT 1 FROM membership_roles mr
           JOIN role_permissions rp ON rp.role=mr.role
           WHERE mr.membership_id=$1 AND rp.permission_code=$2 LIMIT 1`,
          [auth.membershipId, permission],
        )
      ).rowCount,
    );
  }
  private async history(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
    from: string | null,
    to: string,
    reasonCode: string | null,
    requestId: string,
    note?: string,
  ) {
    await client.query(
      `INSERT INTO refund_status_history(tenant_id,refund_id,from_status,to_status,actor_user_id,actor_type,reason_code,note,request_id)
       VALUES($1,$2,$3,$4,$5,'USER',$6,$7,$8)`,
      [
        auth.tenantId,
        id,
        from,
        to,
        auth.userId,
        reasonCode,
        note ?? null,
        requestId,
      ],
    );
  }
  private record(
    client: PoolClient,
    auth: AccessClaims,
    refund: any,
    event: string,
    requestId: string,
    key: string,
  ) {
    return this.evidence.record(client, {
      auth,
      branchId: refund.branch_id,
      event,
      aggregateType: "refund",
      aggregateId: refund.id,
      aggregateVersion: Number(refund.version),
      requestId,
      currency: refund.currency,
      amountMinor: BigInt(refund.requested_minor),
      reason: refund.reason_code,
      idempotencyKey: key,
      payload: {
        status: refund.status,
        invoiceId: refund.invoice_id,
        refundReference: refund.refund_reference,
      },
    });
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
        code: "REFUND_NOT_FOUND",
        message: "Refund not found",
      });
  }
  private manager(auth: AccessClaims) {
    return auth.roles.some(
      (x) => x === "SALON_OWNER" || x === "BRANCH_MANAGER",
    );
  }
  private approvalLimit(auth: AccessClaims) {
    return auth.roles.includes("SALON_OWNER")
      ? Number.MAX_SAFE_INTEGER
      : 5_000_000;
  }
  private assertVersion(row: any, version: number) {
    if (Number(row.version) !== version) this.versionConflict();
  }
  private versionConflict(): never {
    throw new ConflictException({
      code: "REFUND_VERSION_CONFLICT",
      message: "Refund was changed by another request",
    });
  }
  private invalid(from: string, to: string): never {
    throw new ConflictException({
      code: "REFUND_STATUS_INVALID",
      message: `Refund cannot transition from ${from} to ${to}`,
    });
  }
}

function refundView(row: any) {
  return {
    id: row.id,
    branchId: row.branch_id,
    invoiceId: row.invoice_id,
    posOrderId: row.pos_order_id,
    refundReference: row.refund_reference,
    status: row.status,
    currency: row.currency,
    requestedMinor: Number(row.requested_minor),
    approvedMinor:
      row.approved_minor === null ? null : Number(row.approved_minor),
    completedMinor: Number(row.completed_minor),
    serviceRefundMinor: Number(row.service_refund_minor),
    taxRefundMinor: Number(row.tax_refund_minor),
    tipRefundMinor: Number(row.tip_refund_minor),
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    refundDestination: row.refund_destination ?? "ORIGINAL_TENDER",
    policy: row.policy_snapshot_json ?? null,
    approvalReason: row.approval_reason ?? null,
    rejectionReason: row.rejection_reason ?? null,
    version: Number(row.version),
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    processingAt: row.processing_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    cancelledAt: row.cancelled_at,
  };
}

function snapshotField(snapshot: any, ...keys: string[]) {
  for (const key of keys) {
    const value = snapshot?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "")
      return String(value);
  }
  return null;
}

function redactProviderReference(value: unknown) {
  if (!value) return null;
  const text = String(value);
  return text.length <= 4 ? "****" : `••••${text.slice(-8)}`;
}

function refundDirectoryView(row: any) {
  const invoiceHref = row.invoice_id
    ? `/admin/financial/invoices?branchId=${encodeURIComponent(row.branch_id)}&invoiceId=${encodeURIComponent(row.invoice_id)}`
    : null;
  return {
    id: row.id,
    branchId: row.branch_id,
    branch: {
      id: row.branch_id,
      name: row.branch_name,
      code: row.branch_code,
      timezone: row.timezone,
    },
    invoice: row.invoice_id
      ? {
          id: row.invoice_id,
          number: row.invoice_number,
          status: row.invoice_status,
          href: invoiceHref,
        }
      : null,
    posOrder: row.pos_order_id
      ? {
          id: row.pos_order_id,
          number: row.order_number,
          status: row.order_status,
          href: `/admin/pos/orders/${row.pos_order_id}`,
        }
      : null,
    appointment: row.appointment_id
      ? {
          id: row.appointment_id,
          href: `/admin/appointments/${row.appointment_id}/overview`,
        }
      : null,
    customer: {
      id: row.customer_id,
      displayName: row.customer_display_name,
      phone: row.customer_phone ?? null,
    },
    refundReference: row.refund_reference,
    status: row.status,
    refundKind: row.refund_kind,
    tenderTypes: row.tender_types ?? [],
    currency: row.currency,
    requestedMinor: Number(row.requested_minor),
    approvedMinor:
      row.approved_minor === null ? null : Number(row.approved_minor),
    completedMinor: Number(row.completed_minor),
    outstandingMinor: Math.max(
      Number(row.requested_minor) - Number(row.completed_minor),
      0,
    ),
    serviceRefundMinor: Number(row.service_refund_minor),
    taxRefundMinor: Number(row.tax_refund_minor),
    tipRefundMinor: Number(row.tip_refund_minor),
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    completedAt: row.completed_at,
    version: Number(row.version),
    requester: row.requester_id
      ? { id: row.requester_id, displayName: row.requester_display_name }
      : null,
    approver: row.approver_id
      ? { id: row.approver_id, displayName: row.approver_display_name }
      : null,
    creditNote: row.credit_note_id
      ? {
          id: row.credit_note_id,
          number: row.credit_note_number,
          status: row.credit_note_status,
          totalMinor: Number(row.credit_note_total_minor),
          issuedAt: row.credit_note_issued_at,
          href: `/admin/credit-notes/${row.credit_note_id}`,
        }
      : null,
    itemCount: Number(row.item_count ?? 0),
    orderSource: row.order_source,
    orderStatus: row.order_status,
    invoiceTotalMinor:
      Number(row.invoice_total_minor ?? 0) + Number(row.invoice_tip_minor ?? 0),
  };
}
