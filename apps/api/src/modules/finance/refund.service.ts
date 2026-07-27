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
  refundDecisionSchema,
  refundPlanSchema,
  refundVersionSchema,
} from "@nailsoft/validation";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "../pos/financial-evidence.service.js";
import { RegisterDeviceAuthorizationService } from "../pos/register-device-authorization.service.js";
import {
  assertRefundTransition,
  prorateMinor,
  type RefundStatus,
} from "./refund-state-machine.js";

@Injectable()
export class RefundService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
    @Inject(RegisterDeviceAuthorizationService)
    private readonly registerDevice: RegisterDeviceAuthorizationService,
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
            const fiscalYear = new Date().getUTCFullYear();
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
             service_refund_minor,tax_refund_minor,tip_refund_minor,reason_code,reason_text,policy_snapshot_json,requested_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
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
                `INSERT INTO refund_payment_allocations(tenant_id,refund_id,original_payment_id,tender_type,planned_minor,refund_register_id,cash_session_id,provider)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
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

  async detail(auth: AccessClaims, id: string) {
    this.assertTenant(auth);
    return this.db.transaction((client) => this.detailTx(client, auth, id));
  }

  async historyList(auth: AccessClaims, id: string) {
    await this.detail(auth, id);
    return (
      await this.db.query<any>(
        "SELECT * FROM refund_status_history WHERE tenant_id=$1 AND refund_id=$2 ORDER BY created_at,id",
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
            const amount = allocations.reduce(
              (sum: number, row: any) =>
                sum + Number(row.planned_minor) - Number(row.completed_minor),
              0,
            );
            if (Number(session.expected_cash_minor) < amount)
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
              `UPDATE refund_payment_allocations SET completed_minor=planned_minor,status='COMPLETED',completed_at=now(),refund_register_id=$3,cash_session_id=$4,updated_at=now()
           WHERE tenant_id=$1 AND refund_id=$2 AND tender_type='CASH' AND status<>'COMPLETED'`,
              [auth.tenantId, refund.id, session.register_id, session.id],
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
            const metadata =
              to === "APPROVED"
                ? ",approved_minor=requested_minor,approved_by_user_id=$5,approved_at=now(),approval_reason=$6"
                : to === "REJECTED"
                  ? ",rejected_by_user_id=$5,rejection_reason=$6"
                  : to === "CANCELLED"
                    ? ",cancelled_at=now()"
                    : to === "PROCESSING"
                      ? ",processing_at=now()"
                      : "";
            const updated = (
              await client.query<any>(
                `UPDATE refunds SET status=$3,version=version+1,updated_at=now()${metadata} WHERE tenant_id=$1 AND id=$2 AND version=$4 RETURNING *`,
                [auth.tenantId, id, to, version, auth.userId, reason],
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
        `SELECT i.*,o.customer_id,b.code branch_code,COALESCE(bs.tax_policy_json,'{}'::jsonb) policy
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
        `SELECT l.*,b.refundable_minor FROM invoice_lines l JOIN invoice_line_refund_balance b ON b.tenant_id=l.tenant_id AND b.invoice_line_id=l.id
       WHERE l.tenant_id=$1 AND l.invoice_id=$2 AND l.id=ANY($3::uuid[])`,
        [auth.tenantId, invoiceId, body.items.map((x: any) => x.invoiceLineId)],
      )
    ).rows;
    if (lines.length !== body.items.length)
      throw new ConflictException({
        code: "REFUND_LINE_NOT_FOUND",
        message: "Invoice line not found",
      });
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
    const payments = (
      await client.query<any>(
        `SELECT p.*,b.refundable_minor FROM payments p JOIN payment_refund_balance b ON b.tenant_id=p.tenant_id AND b.payment_id=p.id
       WHERE p.tenant_id=$1 AND p.pos_order_id=$2 AND p.status='CAPTURED' AND b.refundable_minor>0 ORDER BY p.captured_at DESC,p.id`,
        [auth.tenantId, invoice.pos_order_id],
      )
    ).rows;
    let remaining = requestedMinor;
    const preferences = body.paymentPreferences?.length
      ? body.paymentPreferences
      : payments.map((p: any) => ({
          paymentId: p.id,
          amountMinor: Math.min(remaining, Number(p.refundable_minor)),
        }));
    const paymentAllocations: any[] = [];
    for (const preference of preferences) {
      if (remaining <= 0 || preference.amountMinor <= 0) continue;
      const payment = payments.find((p: any) => p.id === preference.paymentId);
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
    return {
      branchId: invoice.branch_id,
      branchCode: invoice.branch_code,
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
      policy,
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
    const sums = (
      await client.query<any>(
        `SELECT count(*) FILTER(WHERE status<>'COMPLETED') pending,COALESCE(sum(completed_minor),0) completed FROM refund_payment_allocations
       WHERE tenant_id=$1 AND refund_id=$2`,
        [auth.tenantId, refund.id],
      )
    ).rows[0];
    const status = Number(sums.pending) === 0 ? "COMPLETED" : "PROCESSING";
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
    const fiscalYear = new Date().getUTCFullYear();
    const branch = (
      await client.query<any>(
        "SELECT code FROM branches WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, refund.branch_id],
      )
    ).rows[0];
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
       FROM pos_tip_allocations a JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id WHERE t.tenant_id=$1 AND t.pos_order_id=$2 ORDER BY a.id`,
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
         -round(e.base_minor*(ri.total_refund_minor::numeric/NULLIF(il.net_minor,0)))::bigint,
         -round(e.commission_minor*(ri.total_refund_minor::numeric/NULLIF(il.net_minor,0)))::bigint,e.contribution_basis_json,e.rule_snapshot_json,
         jsonb_build_object('refundId',$2,'creditNoteId',c.id,'originalEntryId',e.id),concat('refund:',$2,':entry:',e.id),
         CASE WHEN p.status='LOCKED' THEN 'GENERATED' ELSE e.status END,CASE WHEN p.status='LOCKED' THEN NULL ELSE e.period_id END
       FROM commission_entries e JOIN refund_items ri ON ri.tenant_id=e.tenant_id AND ri.invoice_line_id=e.invoice_line_id
       JOIN invoice_lines il ON il.tenant_id=e.tenant_id AND il.id=e.invoice_line_id JOIN credit_notes c ON c.tenant_id=e.tenant_id AND c.refund_id=$2
       LEFT JOIN commission_periods p ON p.tenant_id=e.tenant_id AND p.id=e.period_id
       WHERE e.tenant_id=$1 AND ri.refund_id=$2 AND e.entry_type='EARNING' ON CONFLICT DO NOTHING`,
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
      "SELECT id,original_payment_id,tender_type,planned_minor,completed_minor,status,provider,provider_refund_id,completed_at FROM refund_payment_allocations WHERE tenant_id=$1 AND refund_id=$2 ORDER BY created_at,id",
      [auth.tenantId, id],
    );
    const note = await client.query<any>(
      "SELECT id,credit_note_number,status,total_minor,issued_at FROM credit_notes WHERE tenant_id=$1 AND refund_id=$2",
      [auth.tenantId, id],
    );
    return {
      ...refundView(row),
      items: items.rows,
      paymentAllocations: allocations.rows.map((x) => ({
        ...x,
        provider_refund_id: x.provider_refund_id
          ? "***" + String(x.provider_refund_id).slice(-4)
          : null,
      })),
      creditNote: note.rows[0] ?? null,
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
    version: Number(row.version),
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    completedAt: row.completed_at,
  };
}
