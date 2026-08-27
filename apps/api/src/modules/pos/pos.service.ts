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
import {
  posDiscountDecisionSchema,
  posDiscountSchema,
  posAssignRegisterSchema,
  posManualLineSchema,
  posOrderCreateSchema,
  posOrderDirectoryQuerySchema,
  invoiceDirectoryQuerySchema,
  paymentDirectoryQuerySchema,
  posOrderVersionSchema,
  posPaymentSchema,
  posTipSchema,
  posVoidSchema,
  invoiceDeliverySchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import { BenefitsTransactionService } from "../benefits/benefits-transaction.service.js";
import { InventoryOperationsService } from "../inventory/inventory-operations.service.js";
import { MarketingAttributionService } from "../marketing-attribution/marketing-attribution.service.js";
import { StoredValueService } from "../stored-value/stored-value.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "./financial-evidence.service.js";
import { ManualExternalProvider } from "./payment-provider.js";
import { RegisterDeviceAuthorizationService } from "./register-device-authorization.service.js";
import {
  minorNumber,
  PosPricingService,
  type PricingLineInput,
} from "./pos-pricing.service.js";

@Injectable()
export class PosService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(PosPricingService) private readonly pricing: PosPricingService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
    @Inject(RegisterDeviceAuthorizationService)
    private readonly registerDevice: RegisterDeviceAuthorizationService,
    @Inject(BenefitsTransactionService)
    private readonly benefits: BenefitsTransactionService,
    @Inject(InventoryOperationsService)
    private readonly inventory: InventoryOperationsService,
    @Inject(StoredValueService)
    private readonly storedValue: StoredValueService,
    @Inject(MarketingAttributionService)
    private readonly attribution: MarketingAttributionService,
  ) {}

  async createFromAppointment(
    auth: AccessClaims,
    appointmentId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posOrderCreateSchema.parse(input);
    this.assertTenantAccess(auth);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "pos.order.create",
          key,
          request: { appointmentId, ...body },
          work: async () => {
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`${auth.tenantId}:appointment-pos:${appointmentId}`],
            );
            const appointment = (
              await client.query<any>(
                `SELECT a.*,b.status branch_status,b.name branch_name,b.code branch_code,b.timezone branch_timezone,
                        bs.currency,bs.tax_policy_json,t.name tenant_name
                   FROM appointments a
                   JOIN branches b ON b.tenant_id=a.tenant_id AND b.id=a.branch_id
                   JOIN branch_settings bs ON bs.tenant_id=a.tenant_id AND bs.branch_id=a.branch_id
                   JOIN tenants t ON t.id=a.tenant_id
                  WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE OF a`,
                [auth.tenantId, appointmentId],
              )
            ).rows[0];
            if (!appointment)
              throw new NotFoundException({
                code: "APPOINTMENT_NOT_FOUND",
                message: "Appointment not found",
              });
            this.assertBranch(auth, appointment.branch_id);
            if (appointment.branch_status !== "ACTIVE")
              throw new ConflictException({
                code: "FINANCIAL_BRANCH_INACTIVE",
                message: "Branch is inactive",
              });
            const existing = (
              await client.query<any>(
                `SELECT id FROM pos_orders WHERE tenant_id=$1 AND appointment_id=$2
                  AND status IN ('DRAFT','READY_FOR_PAYMENT','PARTIALLY_PAID') FOR UPDATE`,
                [auth.tenantId, appointmentId],
              )
            ).rows[0];
            if (existing) return this.orderView(client, auth, existing.id);
            if (
              !appointment.checkout_ready ||
              !["COMPLETED", "PARTIALLY_COMPLETED"].includes(appointment.status)
            )
              throw new ConflictException({
                code: "POS_ORDER_NOT_CHECKOUT_READY",
                message: "Appointment is not checkout ready",
              });
            if (body.registerId) {
              await this.assertRegister(
                client,
                auth,
                appointment.branch_id,
                body.registerId,
              );
              await this.registerDevice.assertRegisterAccess({
                auth,
                registerId: body.registerId,
                branchId: appointment.branch_id,
                client,
              });
            }
            const sourceLines = (
              await client.query<any>(
                `SELECT ai.id appointment_item_id,ai.service_id,ai.service_snapshot_json,
                        ai.price_snapshot_json,ai.tax_snapshot_json,ai.item_source,
                        ss.id service_session_id,ss.actual_started_at,ss.actual_ended_at,ss.actual_work_seconds,
                        COALESCE((
                          SELECT jsonb_agg(jsonb_build_object(
                            'staffId',seg.staff_id,'workSeconds',
                            GREATEST(0,extract(epoch FROM (seg.ended_at-seg.started_at))::integer
                          )) ORDER BY seg.started_at,seg.id)
                          FROM service_session_staff_segments seg
                          WHERE seg.tenant_id=ss.tenant_id AND seg.service_session_id=ss.id AND seg.ended_at IS NOT NULL
                        ),'[]'::jsonb) contributions
                   FROM appointment_items ai
                   JOIN service_sessions ss ON ss.tenant_id=ai.tenant_id AND ss.appointment_item_id=ai.id
                  WHERE ai.tenant_id=$1 AND ai.appointment_id=$2
                    AND ai.status<>'CANCELLED' AND ss.status='COMPLETED'
                  ORDER BY ai.sequence_no,ai.id`,
                [auth.tenantId, appointmentId],
              )
            ).rows;
            if (!sourceLines.length)
              throw new ConflictException({
                code: "POS_LINE_INVALID",
                message:
                  "No completed appointment item is eligible for checkout",
              });
            const currency = appointment.currency;
            for (const line of sourceLines) {
              const lineCurrency =
                line.price_snapshot_json?.currency ?? currency;
              if (lineCurrency !== currency)
                throw new ConflictException({
                  code: "POS_ORDER_CURRENCY_MISMATCH",
                  message: "Appointment item currencies do not match",
                });
            }
            const id = randomUUID();
            const orderNumber = `POS-${new Date().getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
            await client.query(
              `INSERT INTO pos_orders(
                 id,tenant_id,branch_id,register_id,appointment_id,customer_id,order_number,source,status,currency,
                 customer_snapshot_json,appointment_snapshot_json,created_by_user_id,updated_by_user_id
               ) VALUES($1,$2,$3,$4,$5,$6,$7,'APPOINTMENT','DRAFT',$8,$9,$10,$11,$11)`,
              [
                id,
                auth.tenantId,
                appointment.branch_id,
                body.registerId ?? null,
                appointmentId,
                appointment.customer_id,
                orderNumber,
                currency,
                JSON.stringify(appointment.contact_snapshot_json ?? {}),
                JSON.stringify({
                  appointmentId,
                  bookingReference: appointment.booking_reference,
                  status: appointment.status,
                  checkoutReady: true,
                  branch: {
                    id: appointment.branch_id,
                    name: appointment.branch_name,
                    code: appointment.branch_code,
                    timezone: appointment.branch_timezone,
                    salonName: appointment.tenant_name,
                  },
                }),
                auth.userId,
              ],
            );
            let lineNo = 0;
            for (const source of sourceLines) {
              const amount = this.pricing.assertMoney(
                source.price_snapshot_json?.amountMinor ??
                  source.price_snapshot_json?.amount ??
                  0,
                "POS_LINE_PRICE_SNAPSHOT_MISSING",
              );
              const tax = normalizeTax(
                source.tax_snapshot_json,
                appointment.tax_policy_json,
              );
              await client.query(
                `INSERT INTO pos_order_lines(
                   tenant_id,pos_order_id,line_no,line_type,appointment_item_id,service_session_id,service_id,
                   description_snapshot_json,quantity,unit_price_minor,gross_minor,taxable_minor,tax_minor,net_minor,
                   tax_profile_snapshot_json,source_snapshot_json
                 ) VALUES($1,$2,$3,'SERVICE',$4,$5,$6,$7,1,$8,$8,0,0,$8,$9,$10)`,
                [
                  auth.tenantId,
                  id,
                  ++lineNo,
                  source.appointment_item_id,
                  source.service_session_id,
                  source.service_id,
                  JSON.stringify(source.service_snapshot_json),
                  amount.toString(),
                  JSON.stringify(tax),
                  JSON.stringify({
                    itemSource: source.item_source,
                    priceSnapshot: source.price_snapshot_json,
                    serviceSnapshot: source.service_snapshot_json,
                    serviceSession: {
                      actualStartedAt: source.actual_started_at,
                      actualEndedAt: source.actual_ended_at,
                      actualWorkSeconds: source.actual_work_seconds,
                    },
                    staffContributions: source.contributions,
                  }),
                ],
              );
            }
            await this.reprice(
              client,
              auth,
              id,
              requestId,
              "APPOINTMENT_IMPORT",
            );
            await this.appendHistory(
              client,
              auth,
              id,
              null,
              "DRAFT",
              requestId,
              "APPOINTMENT_IMPORT",
            );
            const created = await this.orderRow(client, auth, id);
            await this.evidence.record(client, {
              auth,
              branchId: appointment.branch_id,
              event: "pos.order_created",
              aggregateType: "pos_order",
              aggregateId: id,
              aggregateVersion: created.version,
              requestId,
              currency,
              amountMinor: BigInt(created.total_minor),
              registerId: body.registerId,
              idempotencyKey: key,
              payload: { orderId: id, appointmentId, status: "DRAFT" },
            });
            return this.orderView(client, auth, id);
          },
        }),
      )
    ).data;
  }

  async list(auth: AccessClaims, query: any) {
    this.assertTenantAccess(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches];
    let filter = "($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[]))";
    if (query?.branchId) {
      this.assertBranch(auth, String(query.branchId));
      values.push(query.branchId);
      filter += ` AND branch_id=$${values.length}`;
    }
    if (query?.status) {
      values.push(query.status);
      filter += ` AND status=$${values.length}`;
    }
    return (
      await this.db.query<any>(
        `SELECT * FROM pos_orders WHERE tenant_id=$1 AND ${filter} ORDER BY created_at DESC,id LIMIT 200`,
        values,
      )
    ).rows.map(orderSummary);
  }

  async directory(auth: AccessClaims, input: unknown) {
    const query = posOrderDirectoryQuerySchema.parse(input ?? {});
    this.assertTenantAccess(auth);
    if (query.branchId) this.assertBranch(auth, query.branchId);

    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches, query.branchId ?? null];
    const where = [
      "o.tenant_id=$1",
      "($2::uuid[] IS NULL OR o.branch_id=ANY($2::uuid[]))",
      "($3::uuid IS NULL OR o.branch_id=$3)",
    ];
    if (query.search) {
      values.push(`%${query.search.toLowerCase()}%`);
      const index = values.length;
      where.push(
        `(lower(o.order_number) LIKE $${index}
          OR lower(COALESCE(o.customer_snapshot_json->>'displayName', o.customer_snapshot_json->>'display_name', '')) LIKE $${index}
          OR lower(COALESCE(o.customer_snapshot_json->>'phone', '')) LIKE $${index}
          OR lower(COALESCE(a.booking_reference, o.appointment_snapshot_json->>'bookingReference', '')) LIKE $${index})`,
      );
    }
    const statuses = query.status
      ? Array.isArray(query.status)
        ? query.status
        : [query.status]
      : undefined;
    if (statuses?.length) {
      values.push(statuses);
      where.push(`o.status=ANY($${values.length}::text[])`);
    }
    if (query.source) {
      values.push(query.source);
      where.push(`o.source=$${values.length}`);
    }
    if (query.tenderType) {
      values.push(query.tenderType);
      where.push(
        `EXISTS (SELECT 1 FROM payments tf WHERE tf.tenant_id=o.tenant_id AND tf.pos_order_id=o.id AND tf.status='CAPTURED' AND tf.tender_type=$${values.length})`,
      );
    }
    if (query.dateFrom) {
      values.push(query.dateFrom);
      where.push(
        `(o.created_at AT TIME ZONE b.timezone)::date >= $${values.length}::date`,
      );
    }
    if (query.dateTo) {
      values.push(query.dateTo);
      where.push(
        `(o.created_at AT TIME ZONE b.timezone)::date <= $${values.length}::date`,
      );
    }
    if (query.refundFilter === "HAS_REFUND") {
      where.push(
        "EXISTS (SELECT 1 FROM refunds rf WHERE rf.tenant_id=o.tenant_id AND rf.pos_order_id=o.id)",
      );
    } else if (query.refundFilter === "NO_REFUND") {
      where.push(
        "NOT EXISTS (SELECT 1 FROM refunds rf WHERE rf.tenant_id=o.tenant_id AND rf.pos_order_id=o.id)",
      );
    }

    const from = `
      FROM pos_orders o
      JOIN branches b ON b.tenant_id=o.tenant_id AND b.id=o.branch_id
      LEFT JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int item_count,
               COALESCE(jsonb_agg(l.description_snapshot_json ORDER BY l.line_no,l.id) FILTER (WHERE l.status='ACTIVE'),'[]'::jsonb) item_summary
          FROM pos_order_lines l
         WHERE l.tenant_id=o.tenant_id AND l.pos_order_id=o.id
      ) lines ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(p.captured_minor),0)::bigint paid_minor,
               COALESCE(array_agg(DISTINCT p.tender_type ORDER BY p.tender_type) FILTER (WHERE p.status='CAPTURED'),'{}'::text[]) payment_methods,
               (array_agg(p.created_by_user_id ORDER BY p.captured_at DESC NULLS LAST,p.created_at DESC,p.id DESC) FILTER (WHERE p.status='CAPTURED'))[1] cashier_user_id
          FROM payments p
         WHERE p.tenant_id=o.tenant_id AND p.pos_order_id=o.id
      ) payments ON true
          LEFT JOIN users cashier ON cashier.id=payments.cashier_user_id
      LEFT JOIN LATERAL (
        SELECT i.id invoice_id,i.status invoice_status,i.invoice_number
          FROM invoices i
         WHERE i.tenant_id=o.tenant_id AND i.pos_order_id=o.id
         ORDER BY i.created_at DESC,i.id DESC LIMIT 1
      ) invoice ON true
      WHERE ${where.join(" AND ")}`;

    const countResult = await this.db.query<any>(
      `WITH filtered AS (
         SELECT o.status,(o.total_minor+o.tip_minor)::bigint grand_total_minor ${from}
       ), status_counts AS (
         SELECT status,count(*)::int status_count FROM filtered GROUP BY status
       )
       SELECT count(*)::int total,
              COALESCE(sum(grand_total_minor),0)::bigint total_grand_total_minor,
              COALESCE(avg(grand_total_minor),0)::numeric average_grand_total_minor,
              COALESCE((SELECT jsonb_object_agg(status,status_count) FROM status_counts),'{}'::jsonb) status_counts
         FROM filtered`,
      values,
    );
    const countRow = countResult.rows[0] ?? { total: 0, status_counts: {} };
    const orderBy = {
      NEWEST: "o.created_at DESC,o.id DESC",
      OLDEST: "o.created_at ASC,o.id ASC",
      AMOUNT_DESC: "(o.total_minor+o.tip_minor) DESC,o.created_at DESC,o.id DESC",
      AMOUNT_ASC: "(o.total_minor+o.tip_minor) ASC,o.created_at ASC,o.id ASC",
    }[query.sort];
    const offset = (query.page - 1) * query.pageSize;
    const pageIndex = values.length + 1;
    const sizeIndex = values.length + 2;
    const rows = await this.db.query<any>(
      `SELECT o.id,o.branch_id,o.register_id,o.appointment_id,o.customer_id,o.order_number,o.source,o.status,o.currency,
              o.subtotal_minor,o.discount_minor,o.taxable_minor,o.tax_minor,o.total_minor,o.tip_minor,
              o.amount_paid_minor,o.amount_due_minor,o.finalized_at,o.paid_at,o.created_at,o.updated_at,
              a.booking_reference,
              COALESCE(o.customer_snapshot_json->>'displayName',o.customer_snapshot_json->>'display_name','Khách vãng lai') customer_display_name,
              COALESCE(o.customer_snapshot_json->>'phone','') customer_phone,
              lines.item_count,lines.item_summary,
              payments.payment_methods, payments.paid_minor captured_paid_minor,
              payments.cashier_user_id, cashier.display_name cashier_name,
              invoice.invoice_id,invoice.invoice_status,invoice.invoice_number
         ${from}
        ORDER BY ${orderBy}
        LIMIT $${pageIndex} OFFSET $${sizeIndex}`,
      [...values, query.pageSize, offset],
    );
    const total = Number(countRow.total ?? 0);
    return {
      items: rows.rows.map((row) => ({
        ...orderSummary(row),
        bookingReference: row.booking_reference,
        customerDisplayName: row.customer_display_name,
        customerPhone: row.customer_phone,
        itemCount: Number(row.item_count ?? 0),
        itemSummary: row.item_summary ?? [],
        paymentMethods: row.payment_methods ?? [],
        cashier: row.cashier_user_id
          ? { userId: row.cashier_user_id, displayName: row.cashier_name ?? "" }
          : null,
        invoice: row.invoice_id
          ? {
              id: row.invoice_id,
              invoiceNumber: row.invoice_number,
              status: row.invoice_status,
            }
          : null,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      counts: {
        total,
        byStatus: countRow.status_counts ?? {},
      },
      summary: {
        totalGrandTotalMinor: Number(countRow.total_grand_total_minor ?? 0),
        averageGrandTotalMinor: Number(countRow.average_grand_total_minor ?? 0),
      },
      query,
    };
  }

  async directoryExport(auth: AccessClaims, input: unknown) {
    const query = posOrderDirectoryQuerySchema.parse({
      ...(input as Record<string, unknown>),
      page: 1,
      pageSize: 100,
    });
    const result = await this.directory(auth, query);
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = result.items.map((item: any) => [
      item.orderNumber,
      item.customerDisplayName,
      item.customerPhone,
      item.source,
      item.itemCount,
      item.grandTotalMinor,
      item.amountPaidMinor,
      item.amountDueMinor,
      item.status,
      item.cashier?.displayName ?? "",
      item.createdAt,
    ].map(escape).join(","));
    return [
      "Mã đơn,Khách hàng,Số điện thoại,Nguồn,Số dịch vụ,Tổng tiền minor,Đã thanh toán minor,Còn phải thu minor,Trạng thái,Thu ngân,Thời gian tạo",
      ...rows,
    ].join("\n");
  }

  async detail(auth: AccessClaims, id: string) {
    this.assertTenantAccess(auth);
    return this.db.transaction((client) => this.orderView(client, auth, id));
  }

  async history(auth: AccessClaims, id: string) {
    await this.detail(auth, id);
    return (
      await this.db.query<any>(
        `SELECT id,from_status "fromStatus",to_status "toStatus",reason_code "reasonCode",note,request_id "requestId",created_at "createdAt"
           FROM pos_order_status_history WHERE tenant_id=$1 AND pos_order_id=$2 ORDER BY created_at,id`,
        [auth.tenantId, id],
      )
    ).rows;
  }

  async addLine(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posManualLineSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "pos.order.add_line",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        this.assertDraft(order);
        const quantityUnits = decimalUnits(body.quantity);
        const gross = roundQuantity(BigInt(body.unitPriceMinor), quantityUnits);
        const lineNo = Number(
          (
            await client.query<any>(
              "SELECT COALESCE(max(line_no),0)+1 line_no FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2",
              [auth.tenantId, id],
            )
          ).rows[0].line_no,
        );
        await client.query(
          `INSERT INTO pos_order_lines(
           tenant_id,pos_order_id,line_no,line_type,description_snapshot_json,quantity,unit_price_minor,gross_minor,
           taxable_minor,tax_minor,net_minor,tax_profile_snapshot_json,source_snapshot_json
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,0,$8,$9,$10)`,
          [
            auth.tenantId,
            id,
            lineNo,
            body.lineType,
            JSON.stringify({ name: body.description }),
            body.quantity,
            String(body.unitPriceMinor),
            gross.toString(),
            JSON.stringify({
              calculationMode: "NONE",
              rateBasisPoints: 0,
              roundingMode: "HALF_UP",
            }),
            JSON.stringify({
              reasonCode: body.reasonCode,
              actorUserId: auth.userId,
            }),
          ],
        );
        const updated = await this.reprice(
          client,
          auth,
          id,
          requestId,
          "MANUAL_LINE",
        );
        await this.recordOrder(
          client,
          auth,
          updated,
          "pos.order_recalculated",
          requestId,
          key,
          { reasonCode: body.reasonCode },
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async recalculate(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posOrderVersionSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "pos.order.recalculate",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        this.assertDraft(order);
        const updated = await this.reprice(
          client,
          auth,
          id,
          requestId,
          "RECALCULATE",
        );
        await this.recordOrder(
          client,
          auth,
          updated,
          "pos.order_recalculated",
          requestId,
          key,
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async assignRegister(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posAssignRegisterSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "pos.order.assign_register",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        this.assertDraft(order);
        await this.assertBranchActive(client, auth.tenantId, order.branch_id);
        const paid = await client.query(
          "SELECT 1 FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 LIMIT 1",
          [auth.tenantId, id],
        );
        if (paid.rowCount)
          throw new ConflictException({
            code: "POS_ORDER_REGISTER_LOCKED",
            message: "Register cannot change after payment activity",
          });
        await this.assertRegister(
          client,
          auth,
          order.branch_id,
          body.registerId,
        );
        await this.registerDevice.assertRegisterAccess({
          auth,
          registerId: body.registerId,
          branchId: order.branch_id,
          client,
        });
        const updated = (
          await client.query<any>(
            `UPDATE pos_orders
                SET register_id=$3,version=version+1,updated_by_user_id=$4,updated_at=now()
              WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, body.registerId, auth.userId],
          )
        ).rows[0];
        await this.appendHistory(
          client,
          auth,
          id,
          order.status,
          order.status,
          requestId,
          "REGISTER_ASSIGNED",
        );
        await this.recordOrder(
          client,
          auth,
          updated,
          "pos.register_assigned",
          requestId,
          key,
          { registerId: body.registerId },
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async applyDiscount(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posDiscountSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "pos.discount.apply",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        this.assertDraft(order);
        if (!body.reasonCode)
          throw new ConflictException({
            code: "DISCOUNT_REASON_REQUIRED",
            message: "Discount reason is required",
          });
        const eligible = await this.discountEligible(
          client,
          auth,
          id,
          body.orderLineId,
        );
        const amount = this.pricing.discountAmount(
          body.discountType,
          body.value,
          eligible,
        );
        const threshold = BigInt(
          order.tax_policy_json?.manualDiscountApprovalThresholdMinor ?? 50000,
        );
        if (amount > threshold && !this.manager(auth)) {
          const request = (
            await client.query<any>(
              `INSERT INTO pos_discount_approval_requests(
               tenant_id,branch_id,pos_order_id,order_line_id,discount_type,value_numeric,reason_code,note,requested_by_user_id
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
              [
                auth.tenantId,
                order.branch_id,
                id,
                body.orderLineId ?? null,
                body.discountType,
                body.value,
                body.reasonCode,
                body.note ?? null,
                auth.userId,
              ],
            )
          ).rows[0];
          return {
            approvalRequired: true,
            approvalRequestId: request.id,
            amountMinor: minorNumber(amount),
            status: "PENDING",
          };
        }
        await this.insertDiscount(
          client,
          auth,
          id,
          body,
          amount,
          this.manager(auth) ? auth.userId : null,
        );
        const updated = await this.reprice(
          client,
          auth,
          id,
          requestId,
          "DISCOUNT_APPLIED",
        );
        await this.recordOrder(
          client,
          auth,
          updated,
          "pos.discount_applied",
          requestId,
          key,
          { discountMinor: amount.toString(), reasonCode: body.reasonCode },
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async approveDiscount(
    auth: AccessClaims,
    approvalId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posDiscountDecisionSchema.parse(input);
    if (!this.manager(auth))
      throw new ForbiddenException({
        code: "FINANCIAL_PERMISSION_DENIED",
        message: "Manager approval is required",
      });
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "pos.discount.approve",
          key,
          request: { approvalId, ...body },
          work: async () => {
            const request = (
              await client.query<any>(
                "SELECT * FROM pos_discount_approval_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, approvalId],
              )
            ).rows[0];
            if (!request)
              throw new NotFoundException({
                code: "DISCOUNT_APPROVAL_NOT_FOUND",
                message: "Approval request not found",
              });
            this.assertBranch(auth, request.branch_id);
            if (request.status !== "PENDING")
              throw new ConflictException({
                code: "DISCOUNT_APPROVAL_REQUIRED",
                message: "Approval request is already decided",
              });
            if (request.requested_by_user_id === auth.userId)
              throw new ForbiddenException({
                code: "FINANCIAL_PERMISSION_DENIED",
                message: "Requester cannot approve the same discount",
              });
            const order = await this.lockOrder(
              client,
              auth,
              request.pos_order_id,
            );
            this.assertVersion(order, body.version);
            this.assertDraft(order);
            const eligible = await this.discountEligible(
              client,
              auth,
              order.id,
              request.order_line_id,
            );
            const amount = this.pricing.discountAmount(
              request.discount_type,
              Number(request.value_numeric),
              eligible,
            );
            await this.insertDiscount(
              client,
              auth,
              order.id,
              {
                orderLineId: request.order_line_id,
                discountType: request.discount_type,
                value: Number(request.value_numeric),
                reasonCode: request.reason_code,
                note: request.note,
              },
              amount,
              auth.userId,
            );
            await client.query(
              "UPDATE pos_discount_approval_requests SET status='APPROVED',decided_by_user_id=$3,decision_reason=$4,decided_at=now() WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, approvalId, auth.userId, body.decisionReason],
            );
            const updated = await this.reprice(
              client,
              auth,
              order.id,
              requestId,
              "DISCOUNT_APPROVED",
            );
            await this.recordOrder(
              client,
              auth,
              updated,
              "pos.discount_approved",
              requestId,
              key,
              {
                approvalRequestId: approvalId,
                discountMinor: amount.toString(),
              },
            );
            return this.orderView(client, auth, order.id);
          },
        }),
      )
    ).data;
  }

  async setTip(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posTipSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "pos.tip.set",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        this.assertDraft(order);
        const amount = this.pricing.assertMoney(
          body.amountMinor,
          "TIP_INVALID",
        );
        const current = (
          await client.query<any>(
            "SELECT id FROM pos_tips WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (current)
          await client.query(
            "UPDATE pos_tips SET status='VOIDED',voided_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, current.id],
          );
        if (amount > 0n) {
          const contributionRows = await this.tipContributions(
            client,
            auth,
            order.appointment_id,
          );
          const participantKeys = new Set(
            contributionRows.map(
              (row) => `${row.staffId}:${row.appointmentItemId ?? ""}`,
            ),
          );
          let candidates: Array<{
            staffId: string;
            appointmentItemId?: string;
            amountMinor?: bigint;
            workSeconds?: number;
          }>;
          if (body.allocationBasis === "MANUAL") {
            candidates = (body.allocations ?? []).map((row) => ({
              staffId: row.staffId,
              amountMinor: BigInt(row.amountMinor),
              ...(row.appointmentItemId
                ? { appointmentItemId: row.appointmentItemId }
                : {}),
            }));
            if (
              candidates.some(
                (row) =>
                  !participantKeys.has(
                    `${row.staffId}:${row.appointmentItemId ?? ""}`,
                  ),
              )
            )
              throw new ConflictException({
                code: "TIP_ALLOCATION_INVALID",
                message: "Tip can only be allocated to actual contributors",
              });
          } else candidates = contributionRows;
          const allocations = this.pricing.allocateTip(
            amount,
            body.allocationBasis,
            candidates,
          );
          const tip = (
            await client.query<any>(
              "INSERT INTO pos_tips(tenant_id,pos_order_id,amount_minor,currency,source,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
              [
                auth.tenantId,
                id,
                amount.toString(),
                order.currency,
                body.source,
                auth.userId,
              ],
            )
          ).rows[0];
          for (const allocation of allocations)
            await client.query(
              "INSERT INTO pos_tip_allocations(tenant_id,pos_tip_id,staff_id,appointment_item_id,amount_minor,allocation_basis,contribution_snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                auth.tenantId,
                tip.id,
                allocation.staffId,
                allocation.appointmentItemId ?? null,
                allocation.amountMinor!.toString(),
                body.allocationBasis,
                JSON.stringify({ workSeconds: allocation.workSeconds ?? null }),
              ],
            );
        }
        const updated = await this.reprice(
          client,
          auth,
          id,
          requestId,
          "TIP_CHANGED",
        );
        await this.recordOrder(
          client,
          auth,
          updated,
          "pos.tip_set",
          requestId,
          key,
          {
            tipMinor: amount.toString(),
            allocationBasis: body.allocationBasis,
          },
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async finalize(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posOrderVersionSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "pos.order.finalize",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        if (
          order.finalized_at ||
          !["DRAFT", "PARTIALLY_PAID", "READY_FOR_PAYMENT"].includes(
            order.status,
          )
        )
          throw new ConflictException({
            code: "POS_ORDER_STATUS_INVALID",
            message: "Order cannot be finalized",
          });
        const fromStatus = order.status;
        await this.assertBranchActive(client, auth.tenantId, order.branch_id);
        this.assertOrderRegister(order);
        await this.registerDevice.assertRegisterAccess({
          auth,
          registerId: order.register_id,
          branchId: order.branch_id,
          client,
        });
        await this.reprice(client, auth, id, requestId, "FINALIZE");
        await this.benefits.revalidateOrderBenefits(client, auth, order);
        const priced = (
          await client.query<any>(
            "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        await this.storedValue.revalidateOrderApplications(
          client,
          auth,
          priced,
        );
        await this.validateTipInvariant(
          client,
          auth,
          id,
          BigInt(priced.tip_minor),
        );
        const zero = BigInt(priced.amount_due_minor) === 0n;
        const updated = (
          await client.query<any>(
            `UPDATE pos_orders SET status=$3,finalized_at=now(),pricing_snapshot_json=$4,
                  pricing_locked_at=CASE WHEN $3='PAID' THEN now() ELSE pricing_locked_at END,
                  paid_at=CASE WHEN $3='PAID' THEN now() ELSE paid_at END,
                  version=version+1,updated_by_user_id=$5,updated_at=now()
            WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [
              auth.tenantId,
              id,
              zero ? "PAID" : "READY_FOR_PAYMENT",
              JSON.stringify(this.pricingSnapshot(priced)),
              auth.userId,
            ],
          )
        ).rows[0];
        await this.appendHistory(
          client,
          auth,
          id,
          fromStatus,
          updated.status,
          requestId,
          "FINALIZED",
        );
        await this.ensureDraftInvoice(client, auth, updated);
        await this.checkoutAppointment(client, auth, updated, requestId, zero);
        if (zero) {
          const invoice = await this.issueInvoice(
            client,
            auth,
            updated,
            requestId,
            key,
          );
          await this.benefits.commitOrderBenefits(
            client,
            auth,
            updated,
            invoice?.id ?? null,
            requestId,
          );
          await this.inventory.commitOrderProducts(client, auth, id);
          await this.storedValue.commitOrderApplications(
            client,
            auth,
            updated,
            invoice?.id ?? null,
            requestId,
          );
          await this.attribution.projectPaidOrder(
            client,
            auth.tenantId,
            id,
            invoice?.id ?? null,
            null,
            requestId,
          );
        }
        await this.recordOrder(
          client,
          auth,
          updated,
          zero ? "pos.order_paid" : "pos.order_finalized",
          requestId,
          key,
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async pay(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posPaymentSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "payment.capture",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        if (!["READY_FOR_PAYMENT", "PARTIALLY_PAID"].includes(order.status))
          throw new ConflictException({
            code: "POS_ORDER_STATUS_INVALID",
            message: "Order is not ready for payment",
          });
        await this.assertBranchActive(client, auth.tenantId, order.branch_id);
        this.assertOrderRegister(order);
        await this.registerDevice.assertRegisterAccess({
          auth,
          registerId: order.register_id,
          branchId: order.branch_id,
          client,
        });
        await this.benefits.revalidateOrderBenefits(client, auth, order);
        Object.assign(
          order,
          (
            await client.query<any>(
              "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [auth.tenantId, id],
            )
          ).rows[0],
        );
        await this.storedValue.revalidateOrderApplications(client, auth, order);
        const due = BigInt(order.amount_due_minor);
        const captured = this.pricing.assertMoney(
          body.amountToApplyMinor,
          "PAYMENT_AMOUNT_INVALID",
        );
        if (captured <= 0n || captured > due)
          throw new ConflictException({
            code: "PAYMENT_EXCEEDS_AMOUNT_DUE",
            message: "Payment exceeds current amount due",
          });
        const policy = order.tax_policy_json ?? {};
        if (captured < due && policy.allowPartialPayments === false)
          throw new ConflictException({
            code: "PAYMENT_PARTIAL_NOT_ALLOWED",
            message: "Partial payment is disabled",
          });
        let cashReceived: bigint | null = null;
        let change = 0n;
        let cashSession: any = null;
        let provider: string | null = null;
        let providerTransactionId: string | null = null;
        let safeExternal: Record<string, unknown> = {};
        if (body.tenderType === "CASH") {
          cashReceived = this.pricing.assertMoney(
            body.cashReceivedMinor,
            "PAYMENT_AMOUNT_INVALID",
          );
          if (cashReceived < captured)
            throw new ConflictException({
              code: "PAYMENT_AMOUNT_INVALID",
              message: "Cash received is below amount applied",
            });
          change = cashReceived - captured;
          cashSession = (
            await client.query<any>(
              "SELECT * FROM cash_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [auth.tenantId, body.cashSessionId],
            )
          ).rows[0];
          if (
            !cashSession ||
            cashSession.branch_id !== order.branch_id ||
            cashSession.status !== "OPEN"
          )
            throw new ConflictException({
              code: "PAYMENT_CASH_SESSION_REQUIRED",
              message: "An open branch cash session is required",
            });
          if (cashSession.register_id !== order.register_id)
            throw new ConflictException({
              code: "PAYMENT_REGISTER_MISMATCH",
              message: "Cash session and order must use the same register",
            });
          if (order.cash_session_id && order.cash_session_id !== cashSession.id)
            throw new ConflictException({
              code: "PAYMENT_CASH_SESSION_MISMATCH",
              message: "All cash payments must use the original cash session",
            });
          if (
            cashSession.cashier_user_id !== auth.userId &&
            !this.manager(auth)
          )
            throw new ForbiddenException({
              code: "FINANCIAL_PERMISSION_DENIED",
              message: "Cashier can only use an own cash session",
            });
          if (
            cashSession.timezone !== order.branch_timezone ||
            order.currency !==
              (await this.drawerCurrency(
                client,
                auth,
                cashSession.cash_drawer_id,
              ))
          )
            throw new ConflictException({
              code: "CASH_SESSION_CURRENCY_MISMATCH",
              message: "Cash session currency does not match order",
            });
        } else {
          const externalPermission = await client.query(
            "SELECT 1 FROM membership_roles mr JOIN role_permissions rp ON rp.role=mr.role WHERE mr.membership_id=$1 AND rp.permission_code='payment.record_external' LIMIT 1",
            [auth.membershipId],
          );
          if (!externalPermission.rowCount)
            throw new ForbiddenException({
              code: "FINANCIAL_PERMISSION_DENIED",
              message: "External payment recording permission is required",
            });
          if (
            process.env.NODE_ENV === "production" &&
            process.env.MANUAL_EXTERNAL_PAYMENTS_ENABLED !== "true"
          )
            throw new ConflictException({
              code: "PAYMENT_PROVIDER_DISABLED",
              message: "Manual external payment recording is disabled",
            });
          provider =
            body.tenderType === "BANK_TRANSFER"
              ? "bank-transfer"
              : body.provider;
          providerTransactionId = body.providerTransactionId;
          const result = await new ManualExternalProvider().capture(
            body as unknown as Record<string, unknown>,
          );
          safeExternal = {
            ...result.safeMetadata,
            receivedAt: "receivedAt" in body ? body.receivedAt : null,
            evidenceNote: "evidenceNote" in body ? body.evidenceNote : null,
          };
        }
        const paymentId = randomUUID();
        const paymentReference = `PAY-${paymentId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
        try {
          await client.query(
            `INSERT INTO payments(
             id,tenant_id,branch_id,register_id,pos_order_id,payment_reference,tender_type,status,currency,requested_minor,captured_minor,
             cash_received_minor,change_due_minor,provider,provider_transaction_id,terminal_id,card_brand,card_last4,approval_code,
             external_evidence_json,cash_session_id,idempotency_key_hash,request_hash,created_by_user_id,captured_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,'CAPTURED',$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())`,
            [
              paymentId,
              auth.tenantId,
              order.branch_id,
              order.register_id,
              id,
              paymentReference,
              body.tenderType,
              order.currency,
              captured.toString(),
              cashReceived?.toString() ?? null,
              change.toString(),
              provider,
              providerTransactionId,
              "terminalId" in body ? (body.terminalId ?? null) : null,
              "cardBrand" in body ? (body.cardBrand ?? null) : null,
              "cardLast4" in body ? (body.cardLast4 ?? null) : null,
              "approvalCode" in body ? (body.approvalCode ?? null) : null,
              JSON.stringify(safeExternal),
              cashSession?.id ?? null,
              this.evidence.keyHash(key),
              this.idem.hash(body),
              auth.userId,
            ],
          );
        } catch (error: any) {
          if (error?.code === "23505")
            throw new ConflictException({
              code: "PAYMENT_PROVIDER_REFERENCE_REUSED",
              message: "External provider reference was already recorded",
            });
          throw error;
        }
        await client.query(
          "INSERT INTO payment_attempts(tenant_id,payment_id,attempt_no,request_json_redacted,provider_response_json_redacted,result) VALUES($1,$2,1,$3,$4,'SUCCESS')",
          [
            auth.tenantId,
            paymentId,
            JSON.stringify({
              tenderType: body.tenderType,
              amountToApplyMinor: body.amountToApplyMinor,
            }),
            JSON.stringify(safeExternal),
          ],
        );
        await this.allocatePayment(client, auth, order, paymentId, captured);
        // Captured external tender is allocated before stored value. Revalidate
        // immutable redemption line plans now so a late split tender cannot make
        // stored value fund a tip or a gift-card funding line.
        await this.storedValue.revalidateOrderApplications(client, auth, order);
        if (cashSession) {
          await client.query(
            `INSERT INTO cash_movements(
             tenant_id,branch_id,cash_session_id,movement_type,direction,amount_minor,currency,related_payment_id,reason_code,actor_user_id,request_id
           ) VALUES($1,$2,$3,'CASH_SALE','IN',$4,$5,$6,'POS_PAYMENT',$7,$8)`,
            [
              auth.tenantId,
              order.branch_id,
              cashSession.id,
              captured.toString(),
              order.currency,
              paymentId,
              auth.userId,
              requestId,
            ],
          );
          await this.refreshExpectedCash(client, auth, cashSession.id);
        }
        const paid = BigInt(order.amount_paid_minor) + captured;
        const remaining = due - captured;
        const nextStatus = remaining === 0n ? "PAID" : "PARTIALLY_PAID";
        const updated = (
          await client.query<any>(
            `UPDATE pos_orders SET status=$3,amount_paid_minor=$4,amount_due_minor=$5,
                  pricing_locked_at=COALESCE(pricing_locked_at,now()),paid_at=CASE WHEN $3='PAID' THEN now() ELSE paid_at END,
                  cash_session_id=COALESCE(cash_session_id,$6),version=version+1,updated_by_user_id=$7,updated_at=now()
            WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [
              auth.tenantId,
              id,
              nextStatus,
              paid.toString(),
              remaining.toString(),
              cashSession?.id ?? null,
              auth.userId,
            ],
          )
        ).rows[0];
        await this.appendHistory(
          client,
          auth,
          id,
          order.status,
          nextStatus,
          requestId,
          body.tenderType,
        );
        if (nextStatus === "PAID") {
          const invoice = await this.issueInvoice(
            client,
            auth,
            updated,
            requestId,
            key,
          );
          await this.benefits.commitOrderBenefits(
            client,
            auth,
            updated,
            invoice?.id ?? null,
            requestId,
          );
          await this.inventory.commitOrderProducts(client, auth, id);
          await this.storedValue.commitOrderApplications(
            client,
            auth,
            updated,
            invoice?.id ?? null,
            requestId,
          );
          await this.storedValue.activateFundedGiftCards(
            client,
            auth,
            updated,
            paymentId,
            requestId,
          );
          await this.checkoutAppointment(
            client,
            auth,
            updated,
            requestId,
            true,
          );
          await this.attribution.projectPaidOrder(
            client,
            auth.tenantId,
            id,
            invoice?.id ?? null,
            paymentId,
            requestId,
          );
        }
        await this.evidence.record(client, {
          auth,
          branchId: order.branch_id,
          event: "payment.captured",
          aggregateType: "payment",
          aggregateId: paymentId,
          aggregateVersion: 1,
          requestId,
          currency: order.currency,
          amountMinor: captured,
          registerId: order.register_id,
          idempotencyKey: key,
          payload: {
            paymentId,
            orderId: id,
            tenderType: body.tenderType,
            status: "CAPTURED",
            orderStatus: nextStatus,
          },
        });
        await this.recordOrder(
          client,
          auth,
          updated,
          nextStatus === "PAID" ? "pos.order_paid" : "pos.order_partially_paid",
          requestId,
          key,
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async void(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = posVoidSchema.parse(input);
    return this.mutateOrder(
      auth,
      id,
      "pos.order.void",
      key,
      body,
      requestId,
      async (client, order) => {
        this.assertVersion(order, body.version);
        if (
          !["DRAFT", "READY_FOR_PAYMENT"].includes(order.status) ||
          BigInt(order.amount_paid_minor) !== 0n
        )
          throw new ConflictException({
            code: "POS_ORDER_VOID_NOT_ALLOWED",
            message: "Only unpaid draft/ready orders can be voided",
          });
        const updated = (
          await client.query<any>(
            "UPDATE pos_orders SET status='VOIDED',voided_at=now(),voided_by_user_id=$3,void_reason=$4,version=version+1,updated_by_user_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, auth.userId, body.reason],
          )
        ).rows[0];
        await this.benefits.releaseOrderBenefits(
          client,
          auth,
          id,
          requestId,
          key,
        );
        await this.inventory.releaseOrderProducts(client, auth, id);
        await this.storedValue.releaseOrderApplications(
          client,
          auth,
          id,
          requestId,
        );
        await this.storedValue.cancelPendingOrderCards(
          client,
          auth,
          id,
          requestId,
        );
        await client.query(
          "UPDATE invoices SET status='VOIDED_BEFORE_PAYMENT',voided_at=now(),voided_by_user_id=$3,void_reason=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND pos_order_id=$2 AND status='DRAFT'",
          [auth.tenantId, id, auth.userId, body.reason],
        );
        await this.appendHistory(
          client,
          auth,
          id,
          order.status,
          "VOIDED",
          requestId,
          body.reason,
        );
        if (order.appointment_id)
          await client.query(
            "UPDATE appointments SET status=CASE WHEN checkout_ready THEN 'COMPLETED' ELSE status END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='CHECKED_OUT'",
            [auth.tenantId, order.appointment_id],
          );
        await this.recordOrder(
          client,
          auth,
          updated,
          "pos.order_voided",
          requestId,
          key,
          { reason: body.reason },
        );
        return this.orderView(client, auth, id);
      },
    );
  }

  async payments(auth: AccessClaims, query: any) {
    this.assertTenantAccess(auth);
    const values: unknown[] = [
      auth.tenantId,
      auth.roles.includes("SALON_OWNER") ? null : auth.branchIds,
    ];
    let filter = "($2::uuid[] IS NULL OR p.branch_id=ANY($2::uuid[]))";
    if (query?.orderId) {
      values.push(query.orderId);
      filter += ` AND p.pos_order_id=$${values.length}`;
    }
    return (
      await this.db.query<any>(
        `SELECT p.* FROM payments p WHERE p.tenant_id=$1 AND ${filter} ORDER BY p.created_at DESC,p.id LIMIT 250`,
        values,
      )
    ).rows.map(paymentView);
  }

  async paymentDirectory(auth: AccessClaims, input: unknown) {
    const query = paymentDirectoryQuerySchema.parse(input ?? {});
    this.assertTenantAccess(auth);
    if (query.branchId) this.assertBranch(auth, query.branchId);

    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches, query.branchId ?? null];
    const where = [
      "tenant_id=$1",
      "($2::uuid[] IS NULL OR branch_id=ANY($2))",
      "($3::uuid IS NULL OR branch_id=$3)",
    ];
    const canSeeCustomerPhone = !auth.supportAccess && !auth.roles.includes("PLATFORM_SUPER_ADMIN");
    if (query.search) {
      values.push(`%${query.search.toLowerCase()}%`);
      const index = values.length;
      where.push(
        `(lower(COALESCE(payment_reference,'')) LIKE $${index}
          OR lower(COALESCE(order_number,'')) LIKE $${index}
          OR lower(COALESCE(invoice_number,'')) LIKE $${index}
          OR lower(COALESCE(customer_display_name,'')) LIKE $${index}
          OR lower(COALESCE(booking_reference,'')) LIKE $${index}
          OR lower(COALESCE(provider_transaction_id_suffix,'')) LIKE $${index})`,
      );
    }
    if (query.tenderType) {
      values.push(query.tenderType);
      where.push(`tender_type=$${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`payment_status=$${values.length}`);
    }
    if (query.reconciliation === "NEEDS_ATTENTION") where.push("reconciliation_state='NEEDS_ATTENTION'");
    if (query.reconciliation === "NORMAL") where.push("reconciliation_state<>'NEEDS_ATTENTION'");
    if (query.refund === "HAS_REFUND") where.push("refund_relation_count>0");
    if (query.refund === "NO_REFUND") where.push("refund_relation_count=0");
    if (query.orderId) {
      values.push(query.orderId);
      where.push(`order_id=$${values.length}`);
    }
    if (query.invoiceId) {
      values.push(query.invoiceId);
      where.push(`invoice_id=$${values.length}`);
    }
    if (query.cashSessionId) {
      values.push(query.cashSessionId);
      where.push(`cash_session_id=$${values.length}`);
    }
    if (query.dateFrom) {
      values.push(query.dateFrom);
      where.push(`(COALESCE(captured_at,created_at) AT TIME ZONE branch_timezone)::date >= $${values.length}::date`);
    }
    if (query.dateTo) {
      values.push(query.dateTo);
      where.push(`(COALESCE(captured_at,created_at) AT TIME ZONE branch_timezone)::date <= $${values.length}::date`);
    }

    const base = `
      WITH base AS (
        SELECT p.tenant_id,p.id,p.branch_id,p.pos_order_id order_id,p.payment_reference,
               p.tender_type,p.status payment_status,p.currency,p.requested_minor,p.captured_minor,
               p.cash_received_minor,p.change_due_minor,p.provider,p.provider_transaction_id,
               right(COALESCE(p.provider_transaction_id,''),8) provider_transaction_id_suffix,
               p.terminal_id,p.card_brand,p.card_last4,p.cash_session_id,p.register_id,
               p.captured_at,p.created_at,p.created_by_user_id,
               o.order_number,o.source order_source,o.appointment_id,o.customer_id,
               a.booking_reference,
               i.id invoice_id,i.invoice_number,i.status invoice_status,
               b.name branch_name,b.code branch_code,b.timezone branch_timezone,
               r.code register_code,r.name register_name,
               actor.display_name cashier_display_name,
               cs.status cash_session_status,cs.business_date cash_business_date,
               COALESCE(o.customer_snapshot_json->>'displayName',o.customer_snapshot_json->>'display_name','Khách vãng lai') customer_display_name,
               COALESCE(o.customer_snapshot_json->>'phone','') customer_phone,
               CASE WHEN p.tender_type='CASH' AND p.status='CAPTURED' AND cash.matched_movement_id IS NOT NULL
                    THEN 'MATCHED'
                    WHEN p.tender_type='CASH' AND p.status='CAPTURED' THEN 'NEEDS_ATTENTION'
                    WHEN p.status='FAILED' OR attempts.unknown_attempt_count > 0 OR refunds.unknown_refund_count > 0
                    THEN 'NEEDS_ATTENTION'
                    ELSE 'NOT_APPLICABLE' END reconciliation_state,
               CASE WHEN p.status='FAILED' THEN 'PAYMENT_FAILED'
                    WHEN p.tender_type='CASH' AND p.status='CAPTURED' AND cash.matched_movement_id IS NULL THEN 'CASH_MOVEMENT_MISSING'
                    WHEN attempts.unknown_attempt_count > 0 THEN 'PAYMENT_ATTEMPT_UNKNOWN'
                    WHEN refunds.unknown_refund_count > 0 THEN 'REFUND_STATUS_UNKNOWN'
                    ELSE NULL END attention_code,
               CASE WHEN p.status='FAILED' THEN 'Giao dịch capture thất bại cần kiểm tra'
                    WHEN p.tender_type='CASH' AND p.status='CAPTURED' AND cash.matched_movement_id IS NULL THEN 'Chưa xác minh được CASH_SALE trong phiên thu ngân'
                    WHEN attempts.unknown_attempt_count > 0 THEN 'Payment attempt có kết quả chưa xác định'
                    WHEN refunds.unknown_refund_count > 0 THEN 'Có refund provider event chưa xác định'
                    ELSE NULL END attention_message,
               CASE WHEN p.status='FAILED' OR (p.tender_type='CASH' AND p.status='CAPTURED' AND cash.matched_movement_id IS NULL)
                    THEN 'WARNING'
                    WHEN attempts.unknown_attempt_count > 0 OR refunds.unknown_refund_count > 0 THEN 'WARNING'
                    ELSE NULL END attention_severity,
               cash.matched_movement_id,
               refunds.refund_amount_minor,refunds.refund_count,refunds.refund_relation_count,refunds.latest_refund_id,
               refunds.latest_refund_reference,refunds.latest_refund_status,
               refunds.unknown_refund_count,
               attempts.unknown_attempt_count,
               COALESCE(cash.cash_sale_count,0)::int cash_sale_count
          FROM payments p
          JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
          JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id
          LEFT JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id
          LEFT JOIN invoices i ON i.tenant_id=o.tenant_id AND i.pos_order_id=o.id
          LEFT JOIN pos_registers r ON r.tenant_id=p.tenant_id AND r.id=p.register_id
          LEFT JOIN users actor ON actor.origin_tenant_id=p.tenant_id AND actor.id=p.created_by_user_id
          LEFT JOIN cash_sessions cs ON cs.tenant_id=p.tenant_id AND cs.id=p.cash_session_id
          LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE cm.movement_type='CASH_SALE')::int cash_sale_count,
                   (array_agg(cm.id ORDER BY cm.occurred_at DESC,cm.id DESC)
                      FILTER (WHERE cm.movement_type='CASH_SALE' AND cm.amount_minor=p.captured_minor))[1] matched_movement_id
              FROM cash_movements cm
             WHERE cm.tenant_id=p.tenant_id AND cm.related_payment_id=p.id
          ) cash ON true
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(a.completed_minor) FILTER (WHERE a.status='COMPLETED'),0)::bigint refund_amount_minor,
                   count(*) FILTER (WHERE a.status='COMPLETED')::int refund_count,
                   count(*)::int refund_relation_count,
                   count(*) FILTER (WHERE a.status='UNKNOWN')::int unknown_refund_count,
                   (array_agg(rf.id ORDER BY rf.created_at DESC,rf.id DESC))[1] latest_refund_id,
                   (array_agg(rf.refund_reference ORDER BY rf.created_at DESC,rf.id DESC))[1] latest_refund_reference,
                   (array_agg(rf.status ORDER BY rf.created_at DESC,rf.id DESC))[1] latest_refund_status
              FROM refund_payment_allocations a
              JOIN refunds rf ON rf.tenant_id=a.tenant_id AND rf.id=a.refund_id
             WHERE a.tenant_id=p.tenant_id AND a.original_payment_id=p.id
          ) refunds ON true
          LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE pa.result='UNKNOWN')::int unknown_attempt_count
              FROM payment_attempts pa
             WHERE pa.tenant_id=p.tenant_id AND pa.payment_id=p.id
          ) attempts ON true
      ), filtered AS (
        SELECT * FROM base WHERE ${where.join(" AND ")}
      )`;

    const aggregate = await this.db.query<any>(
      `${base}
       SELECT count(*)::int total,
              count(*) FILTER (WHERE payment_status='CAPTURED')::int captured,
              count(*) FILTER (WHERE payment_status IN ('PENDING','AUTHORIZED'))::int processing,
              count(*) FILTER (WHERE payment_status='FAILED')::int failed,
              count(*) FILTER (WHERE attention_code IS NOT NULL)::int needs_attention,
              COALESCE(sum(captured_minor) FILTER (WHERE payment_status='CAPTURED'),0)::bigint captured_minor,
              COALESCE(sum(captured_minor) FILTER (WHERE payment_status='CAPTURED'),0)::bigint successful_amount_minor
         FROM filtered`,
      values,
    );
    const mix = await this.db.query<any>(
      `${base}
       SELECT tender_type,count(*)::int transaction_count,
              COALESCE(sum(captured_minor) FILTER (WHERE payment_status='CAPTURED'),0)::bigint captured_minor
         FROM filtered
        WHERE payment_status='CAPTURED'
        GROUP BY tender_type
        ORDER BY tender_type`,
      values,
    );
    const countRow = aggregate.rows[0] ?? {};
    const total = Number(countRow.total ?? 0);
    const capturedCount = Number(countRow.captured ?? 0);
    const capturedMinor = minorNumber(countRow.captured_minor);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const orderBy = {
      NEWEST: "COALESCE(captured_at,created_at) DESC,id DESC",
      OLDEST: "COALESCE(captured_at,created_at) ASC,id ASC",
      AMOUNT_DESC: "captured_minor DESC,COALESCE(captured_at,created_at) DESC,id DESC",
      AMOUNT_ASC: "captured_minor ASC,COALESCE(captured_at,created_at) ASC,id ASC",
    }[query.sort];
    const offset = (query.page - 1) * query.pageSize;
    const pageIndex = values.length + 1;
    const sizeIndex = values.length + 2;
    const rows = await this.db.query<any>(
      `${base}
       SELECT * FROM filtered ORDER BY ${orderBy} LIMIT $${pageIndex} OFFSET $${sizeIndex}`,
      [...values, query.pageSize, offset],
    );
    const mapRow = (row: any) => {
      const attention = row.attention_code
        ? { required: true, severity: row.attention_severity, code: row.attention_code, message: row.attention_message }
        : null;
      return {
        id: row.id,
        paymentReference: row.payment_reference,
        orderId: row.order_id,
        orderNumber: row.order_number,
        orderSource: row.order_source,
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        invoiceStatus: row.invoice_status,
        appointmentId: row.appointment_id,
        bookingReference: row.booking_reference,
        branchId: row.branch_id,
        branchName: row.branch_name,
        branchCode: row.branch_code,
        timezone: row.branch_timezone,
        registerId: row.register_id,
        registerCode: row.register_code,
        registerName: row.register_name,
        cashSessionId: row.cash_session_id,
        cashSessionStatus: row.cash_session_status,
        cashBusinessDate: row.cash_business_date,
        cashierUserId: row.created_by_user_id,
        cashierDisplayName: row.cashier_display_name,
        customerId: row.customer_id,
        customerDisplayName: row.customer_display_name,
        customerPhone: canSeeCustomerPhone ? row.customer_phone || null : null,
        tenderType: row.tender_type,
        status: row.payment_status,
        currency: row.currency,
        requestedMinor: minorNumber(row.requested_minor),
        capturedMinor: minorNumber(row.captured_minor),
        cashReceivedMinor: row.cash_received_minor == null ? null : minorNumber(row.cash_received_minor),
        changeDueMinor: row.change_due_minor == null ? null : minorNumber(row.change_due_minor),
        provider: row.provider,
        providerTransactionIdSafe: row.provider_transaction_id_suffix ? `****${row.provider_transaction_id_suffix}` : null,
        cardBrand: row.card_brand,
        cardLast4: row.card_last4,
        capturedAt: row.captured_at,
        createdAt: row.created_at,
        refundAmountMinor: minorNumber(row.refund_amount_minor),
        refundCount: Number(row.refund_count ?? 0),
        hasRefund: Number(row.refund_relation_count ?? 0) > 0,
        latestRefundId: row.latest_refund_id,
        latestRefundReference: row.latest_refund_reference,
        latestRefundStatus: row.latest_refund_status,
        reconciliationState: row.reconciliation_state,
        reconciliation: {
          cashSessionId: row.cash_session_id,
          movementId: row.matched_movement_id,
          reflectedInExpectedCash: row.tender_type === "CASH" && row.payment_status === "CAPTURED" ? Boolean(row.matched_movement_id) : null,
        },
        attention,
      };
    };
    const items = rows.rows.map(mapRow);
    const paymentMix = mix.rows.map((row) => ({
      tenderType: row.tender_type,
      transactionCount: Number(row.transaction_count ?? 0),
      capturedMinor: minorNumber(row.captured_minor),
      percentage: capturedMinor > 0 ? Math.round((minorNumber(row.captured_minor) / capturedMinor) * 1000) / 10 : 0,
    }));
    return {
      items,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages },
      counts: {
        total,
        captured: capturedCount,
        processing: Number(countRow.processing ?? 0),
        failed: Number(countRow.failed ?? 0),
        needsAttention: Number(countRow.needs_attention ?? 0),
      },
      periodSummary: {
        capturedMinor,
        averageCapturedMinor: capturedCount > 0 ? Math.round(capturedMinor / capturedCount) : 0,
        paymentMix,
      },
    };
  }

  async paymentDirectoryExport(auth: AccessClaims, input: unknown) {
    const parsed = paymentDirectoryQuerySchema.parse(input ?? {});
    const first = await this.paymentDirectory(auth, { ...parsed, page: 1, pageSize: 100 });
    const all = [...first.items];
    for (let page = 2; page <= first.pagination.totalPages; page += 1) {
      const next = await this.paymentDirectory(auth, { ...parsed, page, pageSize: 100 });
      all.push(...next.items);
    }
    const escape = (value: unknown) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const headers = ["Mã giao dịch", "Thời gian", "Khách hàng", "Phương thức", "Mã đơn POS", "Số hóa đơn", "Yêu cầu", "Đã ghi nhận", "Trạng thái", "Quầy", "Thu ngân", "Hoàn tiền", "Đối soát"];
    const rows = all.map((item) => [
      item.paymentReference, item.capturedAt ?? item.createdAt, item.customerDisplayName,
      item.tenderType, item.orderNumber, item.invoiceNumber ?? "", item.requestedMinor,
      item.capturedMinor, item.status, item.registerCode ?? item.registerName ?? "",
      item.cashierDisplayName ?? "", item.refundAmountMinor, item.reconciliationState,
    ].map(escape).join(","));
    return `\uFEFF${headers.map(escape).join(",")}\n${rows.join("\n")}\n`;
  }

  async payment(auth: AccessClaims, id: string) {
    const row = (
      await this.db.query<any>(
        "SELECT * FROM payments WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "PAYMENT_NOT_FOUND",
        message: "Payment not found",
      });
    this.assertTenantAccess(auth);
    this.assertBranch(auth, row.branch_id);
    const relation = (
      await this.db.query<any>(
        `SELECT p.pos_order_id order_id,p.branch_id,p.cash_session_id,p.register_id,p.created_by_user_id,
                o.order_number,o.source order_source,o.appointment_id,o.customer_id,o.customer_snapshot_json,
                a.booking_reference,a.status appointment_status,
                b.name branch_name,b.code branch_code,b.timezone branch_timezone,
                r.code register_code,r.name register_name,
                actor.display_name cashier_display_name,
                i.id invoice_id,i.invoice_number,i.status invoice_status,
                cs.status cash_session_status,cs.business_date cash_business_date,
                (SELECT cm.id FROM cash_movements cm
                  WHERE cm.tenant_id=p.tenant_id AND cm.related_payment_id=p.id
                    AND cm.movement_type='CASH_SALE' AND cm.amount_minor=p.captured_minor
                  ORDER BY cm.occurred_at DESC,cm.id DESC LIMIT 1) matched_movement_id,
                (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id',rf.id,'refundReference',rf.refund_reference,'status',rf.status,
                    'plannedMinor',rpa.planned_minor,'completedMinor',rpa.completed_minor,
                    'provider',rpa.provider,'createdAt',rpa.created_at
                  ) ORDER BY rf.created_at DESC,rf.id DESC),'[]'::jsonb)
                   FROM refund_payment_allocations rpa
                   JOIN refunds rf ON rf.tenant_id=rpa.tenant_id AND rf.id=rpa.refund_id
                  WHERE rpa.tenant_id=p.tenant_id AND rpa.original_payment_id=p.id) refund_relations,
                (SELECT count(*) FILTER (WHERE pa.result='UNKNOWN')::int
                   FROM payment_attempts pa WHERE pa.tenant_id=p.tenant_id AND pa.payment_id=p.id) unknown_attempt_count,
                (SELECT count(*) FILTER (WHERE rpa.status='UNKNOWN')::int
                   FROM refund_payment_allocations rpa WHERE rpa.tenant_id=p.tenant_id AND rpa.original_payment_id=p.id) unknown_refund_count,
                (SELECT count(*)::int FROM cash_movements cm
                  WHERE cm.tenant_id=p.tenant_id AND cm.related_payment_id=p.id AND cm.movement_type='CASH_SALE') cash_sale_count
           FROM payments p
           JOIN pos_orders o ON o.tenant_id=p.tenant_id AND o.id=p.pos_order_id
           JOIN branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id
           LEFT JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id
           LEFT JOIN invoices i ON i.tenant_id=o.tenant_id AND i.pos_order_id=o.id
           LEFT JOIN pos_registers r ON r.tenant_id=p.tenant_id AND r.id=p.register_id
           LEFT JOIN users actor ON actor.origin_tenant_id=p.tenant_id AND actor.id=p.created_by_user_id
           LEFT JOIN cash_sessions cs ON cs.tenant_id=p.tenant_id AND cs.id=p.cash_session_id
          WHERE p.tenant_id=$1 AND p.id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    const canSeeCustomerPhone = !auth.supportAccess && !auth.roles.includes("PLATFORM_SUPER_ADMIN");
    const attentionCode = row.status === "FAILED"
      ? "PAYMENT_FAILED"
      : row.tender_type === "CASH" && row.status === "CAPTURED" && !relation?.matched_movement_id
        ? "CASH_MOVEMENT_MISSING"
        : Number(relation?.unknown_attempt_count ?? 0) > 0
          ? "PAYMENT_ATTEMPT_UNKNOWN"
          : Number(relation?.unknown_refund_count ?? 0) > 0
            ? "REFUND_STATUS_UNKNOWN"
            : null;
    const reconciliationState = row.tender_type === "CASH" && row.status === "CAPTURED"
      ? relation?.matched_movement_id ? "MATCHED" : "NEEDS_ATTENTION"
      : attentionCode ? "NEEDS_ATTENTION" : "NOT_APPLICABLE";
    return {
      ...paymentView(row),
      orderNumber: relation?.order_number,
      orderSource: relation?.order_source,
      invoiceId: relation?.invoice_id,
      invoiceNumber: relation?.invoice_number,
      invoiceStatus: relation?.invoice_status,
      appointmentId: relation?.appointment_id,
      bookingReference: relation?.booking_reference,
      appointmentStatus: relation?.appointment_status,
      branch: { id: relation?.branch_id, name: relation?.branch_name, code: relation?.branch_code, timezone: relation?.branch_timezone },
      register: relation?.register_id ? { id: relation.register_id, code: relation.register_code, name: relation.register_name } : null,
      cashier: relation?.created_by_user_id ? { id: relation.created_by_user_id, displayName: relation.cashier_display_name } : null,
      customer: {
        id: relation?.customer_id,
        displayName: relation?.customer_snapshot_json?.displayName ?? relation?.customer_snapshot_json?.display_name ?? "Khách vãng lai",
        phone: canSeeCustomerPhone ? relation?.customer_snapshot_json?.phone ?? null : null,
      },
      cashSession: relation?.cash_session_id ? { id: relation.cash_session_id, status: relation.cash_session_status, businessDate: relation.cash_business_date } : null,
      refunds: relation?.refund_relations ?? [],
      reconciliation: {
        state: reconciliationState,
        cashSessionId: relation?.cash_session_id ?? null,
        movementId: relation?.matched_movement_id ?? null,
        reflectedInExpectedCash: row.tender_type === "CASH" && row.status === "CAPTURED" ? Boolean(relation?.matched_movement_id) : null,
        message: row.tender_type === "CASH" ? (relation?.matched_movement_id ? "Đã ghi nhận vào phiên thu ngân" : "Không thể xác minh CASH_SALE") : "Không áp dụng cho tiền mặt",
      },
      attention: attentionCode
        ? { required: true, severity: "WARNING", code: attentionCode, message: attentionCode === "CASH_MOVEMENT_MISSING" ? "Chưa xác minh được CASH_SALE trong phiên thu ngân" : attentionCode === "PAYMENT_FAILED" ? "Giao dịch capture thất bại cần kiểm tra" : attentionCode === "PAYMENT_ATTEMPT_UNKNOWN" ? "Payment attempt có kết quả chưa xác định" : "Có refund provider event chưa xác định" }
        : null,
      providerTransactionIdSafe: row.provider_transaction_id ? `••••${String(row.provider_transaction_id).slice(-8)}` : null,
    };
  }

  async invoices(auth: AccessClaims, query: any) {
    this.assertTenantAccess(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches];
    let filter = "($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[]))";
    if (query?.branchId) {
      this.assertBranch(auth, query.branchId);
      values.push(query.branchId);
      filter += ` AND branch_id=$${values.length}`;
    }
    if (query?.status) {
      values.push(query.status);
      filter += ` AND status=$${values.length}`;
    }
    return (
      await this.db.query<any>(
        `SELECT * FROM invoices WHERE tenant_id=$1 AND ${filter} ORDER BY COALESCE(issued_at,created_at) DESC,id LIMIT 250`,
        values,
      )
    ).rows.map(invoiceView);
  }

  async invoiceDirectory(auth: AccessClaims, input: unknown) {
    const query = invoiceDirectoryQuerySchema.parse(input ?? {});
    this.assertTenantAccess(auth);
    if (query.branchId) this.assertBranch(auth, query.branchId);

    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches, query.branchId ?? null];
    const where = [
      "tenant_id=$1",
      "($2::uuid[] IS NULL OR branch_id=ANY($2::uuid[]))",
      "($3::uuid IS NULL OR branch_id=$3)",
    ];
    const canSeeCustomerPhone = !auth.supportAccess && !auth.roles.includes("PLATFORM_SUPER_ADMIN");
    if (query.search) {
      values.push(`%${query.search.toLowerCase()}%`);
      const index = values.length;
      const phoneClause = canSeeCustomerPhone
        ? ` OR lower(COALESCE(customer_phone,'')) LIKE $${index}`
        : "";
      where.push(
        `(lower(COALESCE(invoice_number,'')) LIKE $${index}
          OR lower(COALESCE(order_number,'')) LIKE $${index}
          OR lower(COALESCE(customer_display_name,'')) LIKE $${index}
          ${phoneClause}
          OR lower(COALESCE(booking_reference,'')) LIKE $${index})`,
      );
    }
    if (query.invoiceStatus) {
      values.push(query.invoiceStatus);
      where.push(`invoice_status=$${values.length}`);
    }
    if (query.paymentState) {
      values.push(query.paymentState);
      where.push(`payment_state=$${values.length}`);
    }
    if (query.correction && query.correction !== "ANY") {
      if (query.correction === "NONE") where.push("refund_count=0 AND credit_note_count=0");
      if (query.correction === "REFUND") where.push("refund_count>0");
      if (query.correction === "CREDIT_NOTE") where.push("credit_note_count>0");
    } else if (query.correction === "ANY") {
      where.push("(refund_count>0 OR credit_note_count>0)");
    }
    if (query.customerId) {
      values.push(query.customerId);
      where.push(`customer_id=$${values.length}`);
    }
    if (query.source === "APPOINTMENT_POS") where.push("appointment_id IS NOT NULL");
    if (query.source === "OTHER_POS") where.push("appointment_id IS NULL");
    if (query.issuedFrom) {
      values.push(query.issuedFrom);
      where.push(`(COALESCE(issued_at,created_at) AT TIME ZONE branch_timezone)::date >= $${values.length}::date`);
    }
    if (query.issuedTo) {
      values.push(query.issuedTo);
      where.push(`(COALESCE(issued_at,created_at) AT TIME ZONE branch_timezone)::date <= $${values.length}::date`);
    }

    const base = `
      WITH base AS (
        SELECT i.tenant_id,i.id,i.pos_order_id,i.branch_id,i.invoice_number,i.status invoice_status,i.currency,
               i.subtotal_minor,i.discount_minor,i.taxable_minor,i.tax_minor,i.total_minor,i.tip_minor,
               i.paid_minor invoice_paid_minor,i.issued_at,i.created_at,i.version,
               o.order_number,o.appointment_id,o.customer_id,o.source,o.status order_status,
               o.amount_paid_minor order_paid_minor,o.amount_due_minor order_due_minor,
               a.booking_reference,b.name branch_name,b.code branch_code,b.timezone branch_timezone,
               COALESCE(i.customer_snapshot_json->>'displayName',i.customer_snapshot_json->>'display_name',
                        o.customer_snapshot_json->>'displayName',o.customer_snapshot_json->>'display_name','Khách vãng lai') customer_display_name,
               COALESCE(i.customer_snapshot_json->>'phone',o.customer_snapshot_json->>'phone','') customer_phone,
               GREATEST((i.total_minor+i.tip_minor)-COALESCE(o.amount_paid_minor,0),0)::bigint outstanding_minor,
               COALESCE(o.amount_paid_minor,i.paid_minor,0)::bigint paid_minor,
               CASE WHEN COALESCE(o.amount_due_minor, GREATEST((i.total_minor+i.tip_minor)-COALESCE(o.amount_paid_minor,0),0)) <= 0 THEN 'PAID'
                    WHEN COALESCE(o.amount_paid_minor,0) > 0 THEN 'PARTIAL' ELSE 'OUTSTANDING' END payment_state,
               payments.payment_methods,
               payments.captured_paid_minor,
               refunds.refund_count,refunds.refund_amount_minor,refunds.latest_refund_id,
               refunds.latest_refund_reference,refunds.latest_refund_status,
               notes.credit_note_count,notes.credit_note_amount_minor,notes.latest_credit_note_id,
               notes.latest_credit_note_number,notes.latest_credit_note_status,
               delivery.latest_delivery_status,delivery.latest_delivery_at
          FROM invoices i
          JOIN pos_orders o ON o.tenant_id=i.tenant_id AND o.id=i.pos_order_id
          JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
          LEFT JOIN appointments a ON a.tenant_id=o.tenant_id AND a.id=o.appointment_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(p.captured_minor) FILTER (WHERE p.status='CAPTURED'),0)::bigint captured_paid_minor,
                   COALESCE(array_agg(DISTINCT p.tender_type ORDER BY p.tender_type) FILTER (WHERE p.status='CAPTURED'),'{}'::text[]) payment_methods
              FROM payments p WHERE p.tenant_id=i.tenant_id AND p.pos_order_id=i.pos_order_id
          ) payments ON true
          LEFT JOIN LATERAL (
            SELECT count(*)::int refund_count,
                   COALESCE(sum(r.completed_minor) FILTER (WHERE r.status='COMPLETED'),0)::bigint refund_amount_minor,
                   (array_agg(r.id ORDER BY r.created_at DESC,r.id DESC))[1] latest_refund_id,
                   (array_agg(r.refund_reference ORDER BY r.created_at DESC,r.id DESC))[1] latest_refund_reference,
                   (array_agg(r.status ORDER BY r.created_at DESC,r.id DESC))[1] latest_refund_status
              FROM refunds r WHERE r.tenant_id=i.tenant_id AND (r.invoice_id=i.id OR r.pos_order_id=i.pos_order_id)
          ) refunds ON true
          LEFT JOIN LATERAL (
            SELECT count(*)::int credit_note_count,
                   COALESCE(sum(c.total_minor),0)::bigint credit_note_amount_minor,
                   (array_agg(c.id ORDER BY c.created_at DESC,c.id DESC))[1] latest_credit_note_id,
                   (array_agg(c.credit_note_number ORDER BY c.created_at DESC,c.id DESC))[1] latest_credit_note_number,
                   (array_agg(c.status ORDER BY c.created_at DESC,c.id DESC))[1] latest_credit_note_status
              FROM credit_notes c WHERE c.tenant_id=i.tenant_id AND c.original_invoice_id=i.id
          ) notes ON true
          LEFT JOIN LATERAL (
            SELECT d.status latest_delivery_status,d.created_at latest_delivery_at
              FROM invoice_deliveries d WHERE d.tenant_id=i.tenant_id AND d.invoice_id=i.id
             ORDER BY d.created_at DESC,d.id DESC LIMIT 1
          ) delivery ON true
      ), filtered AS (
        SELECT * FROM base WHERE ${where.join(" AND ")}
      )`;
    const countResult = await this.db.query<any>(
      `${base}
       SELECT count(*)::int total,
              count(*) FILTER (WHERE invoice_status='ISSUED')::int issued,
              count(*) FILTER (WHERE payment_state='PAID')::int paid,
              count(*) FILTER (WHERE outstanding_minor>0)::int outstanding,
              count(*) FILTER (WHERE refund_count>0)::int with_refund,
              count(*) FILTER (WHERE credit_note_count>0)::int with_credit_note,
              COALESCE(sum(total_minor+tip_minor),0)::bigint invoice_value_minor,
              COALESCE(sum(paid_minor),0)::bigint paid_minor,
              COALESCE(sum(outstanding_minor),0)::bigint outstanding_minor,
              count(*) FILTER (WHERE credit_note_count>0)::int adjusted_invoice_count
         FROM filtered`,
      values,
    );
    const countRow = countResult.rows[0] ?? {};
    const orderBy = {
      NEWEST: "COALESCE(issued_at,created_at) DESC,id DESC",
      OLDEST: "COALESCE(issued_at,created_at) ASC,id ASC",
      TOTAL_DESC: "(total_minor+tip_minor) DESC,COALESCE(issued_at,created_at) DESC,id DESC",
      TOTAL_ASC: "(total_minor+tip_minor) ASC,COALESCE(issued_at,created_at) ASC,id ASC",
      OUTSTANDING_DESC: "outstanding_minor DESC,COALESCE(issued_at,created_at) DESC,id DESC",
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
    const mapRow = (row: any) => {
      const grandTotalMinor = minorNumber(BigInt(row.total_minor ?? 0) + BigInt(row.tip_minor ?? 0));
      const refundAmountMinor = minorNumber(row.refund_amount_minor);
      const creditNoteAmountMinor = minorNumber(row.credit_note_amount_minor);
      const paymentState = row.payment_state as "PAID" | "PARTIAL" | "OUTSTANDING";
      const businessState = row.invoice_status === "VOIDED_BEFORE_PAYMENT"
        ? "VOIDED"
        : refundAmountMinor >= grandTotalMinor && grandTotalMinor > 0
          ? "REFUNDED"
          : refundAmountMinor > 0
            ? "REFUND_PARTIAL"
            : creditNoteAmountMinor > 0
              ? "CREDIT_NOTE"
              : paymentState;
      return {
        id: row.id, orderId: row.pos_order_id, orderNumber: row.order_number,
        appointmentId: row.appointment_id, bookingReference: row.booking_reference,
        branchId: row.branch_id, branchName: row.branch_name, branchCode: row.branch_code,
        customerId: row.customer_id, customerDisplayName: row.customer_display_name,
        customerPhone: canSeeCustomerPhone ? row.customer_phone || null : null,
        invoiceNumber: row.invoice_status === "ISSUED" ? row.invoice_number : null,
        draftReference: row.invoice_status === "ISSUED" ? null : row.order_number,
        invoiceStatus: row.invoice_status, currency: row.currency,
        subtotalMinor: minorNumber(row.subtotal_minor), discountMinor: minorNumber(row.discount_minor),
        taxableMinor: minorNumber(row.taxable_minor), taxMinor: minorNumber(row.tax_minor),
        totalMinor: minorNumber(row.total_minor), tipMinor: minorNumber(row.tip_minor), grandTotalMinor,
        paidMinor: minorNumber(row.paid_minor), outstandingMinor: minorNumber(row.outstanding_minor),
        paymentState, businessState, refundAmountMinor, refundCount: Number(row.refund_count ?? 0),
        latestRefundId: row.latest_refund_id, latestRefundReference: row.latest_refund_reference,
        latestRefundStatus: row.latest_refund_status, creditNoteAmountMinor,
        creditNoteCount: Number(row.credit_note_count ?? 0), latestCreditNoteId: row.latest_credit_note_id,
        latestCreditNoteNumber: row.latest_credit_note_number, latestCreditNoteStatus: row.latest_credit_note_status,
        hasRefund: Number(row.refund_count ?? 0) > 0, hasCreditNote: Number(row.credit_note_count ?? 0) > 0,
        issuedAt: row.issued_at, createdAt: row.created_at, paymentMethods: row.payment_methods ?? [],
        latestDeliveryStatus: row.latest_delivery_status, latestDeliveryAt: row.latest_delivery_at,
        orderStatus: row.order_status, timezone: row.branch_timezone, version: Number(row.version),
      };
    };
    const items = rows.rows.map(mapRow);
    const invoiceValueMinor = minorNumber(countRow.invoice_value_minor);
    const paidMinor = minorNumber(countRow.paid_minor);
    return {
      items,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      counts: {
        total, issued: Number(countRow.issued ?? 0), paid: Number(countRow.paid ?? 0),
        outstanding: Number(countRow.outstanding ?? 0), withRefund: Number(countRow.with_refund ?? 0),
        withCreditNote: Number(countRow.with_credit_note ?? 0),
      },
      periodSummary: {
        invoiceValueMinor, paidMinor, outstandingMinor: minorNumber(countRow.outstanding_minor),
        adjustedInvoiceCount: Number(countRow.adjusted_invoice_count ?? 0),
        paidPercentage: invoiceValueMinor > 0 ? Math.round((paidMinor / invoiceValueMinor) * 1000) / 10 : 0,
      },
    };
  }

  async invoiceDirectoryExport(auth: AccessClaims, input: unknown) {
    const parsed = invoiceDirectoryQuerySchema.parse(input ?? {});
    const first = await this.invoiceDirectory(auth, { ...parsed, page: 1, pageSize: 100 });
    const all = [...first.items];
    for (let page = 2; page <= first.pagination.totalPages; page += 1) {
      const next = await this.invoiceDirectory(auth, { ...parsed, page, pageSize: 100 });
      all.push(...next.items);
    }
    const escape = (value: unknown) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const headers = ["Số hóa đơn", "Mã đơn POS", "Khách hàng", "Chi nhánh", "Ngày phát hành", "Trạng thái hóa đơn", "Trạng thái thanh toán", "Tạm tính", "Thuế", "Tổng tiền", "Đã thanh toán", "Còn phải thu", "Hoàn tiền", "Credit note", "Giao chứng từ"];
    const rows = all.map((item) => [
      item.invoiceNumber ?? "Chưa phát hành", item.orderNumber, item.customerDisplayName, item.branchName,
      item.issuedAt ?? item.createdAt, item.invoiceStatus, item.businessState, item.subtotalMinor,
      item.taxMinor, item.grandTotalMinor, item.paidMinor, item.outstandingMinor, item.refundAmountMinor,
      item.creditNoteAmountMinor, item.latestDeliveryStatus ?? "",
    ].map(escape).join(","));
    return `\uFEFF${headers.map(escape).join(",")}\n${rows.join("\n")}\n`;
  }

  async invoice(auth: AccessClaims, id: string) {
    this.assertTenantAccess(auth);
    const invoice = (
      await this.db.query<any>(
        "SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!invoice)
      throw new NotFoundException({
        code: "INVOICE_NOT_FOUND",
        message: "Invoice not found",
      });
    this.assertBranch(auth, invoice.branch_id);
    const [lines, payments, deliveries] = await Promise.all([
      this.db.query<any>(
        "SELECT * FROM invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY line_no,id",
        [auth.tenantId, id],
      ),
      this.db.query<any>(
        "SELECT * FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 AND status='CAPTURED' ORDER BY captured_at,id",
        [auth.tenantId, invoice.pos_order_id],
      ),
      this.db.query<any>(
        "SELECT id,channel,destination_redacted,status,created_at,processed_at FROM invoice_deliveries WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY created_at,id",
        [auth.tenantId, id],
      ),
    ]);
    return {
      ...invoiceView(invoice),
      customerSnapshot: invoice.customer_snapshot_json,
      branchSnapshot: invoice.branch_snapshot_json,
      taxSnapshot: invoice.tax_snapshot_json,
      lines: lines.rows.map((row) => ({
        id: row.id,
        lineNo: row.line_no,
        description: row.description_snapshot_json,
        quantity: Number(row.quantity),
        unitPriceMinor: minorNumber(row.unit_price_minor),
        discountMinor: minorNumber(row.discount_minor),
        taxableMinor: minorNumber(row.taxable_minor),
        taxMinor: minorNumber(row.tax_minor),
        netMinor: minorNumber(row.net_minor),
        taxSnapshot: row.tax_snapshot_json,
      })),
      tenders: payments.rows.map(paymentView),
      deliveries: deliveries.rows,
    };
  }

  async printInvoice(auth: AccessClaims, id: string) {
    const invoice = await this.invoice(auth, id);
    if (invoice.status !== "ISSUED")
      throw new ConflictException({
        code: "INVOICE_NOT_READY",
        message: "Only an issued invoice can be printed",
      });
    const verificationCode = createHash("sha256")
      .update(`${auth.tenantId}:${invoice.invoiceNumber}:${invoice.paidMinor}`)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase();
    return {
      ...invoice,
      receipt: true,
      verificationCode,
      verificationUrl: `/receipts/verify/${verificationCode}`,
    };
  }

  async deliverInvoice(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = invoiceDeliverySchema.parse(input);
    this.assertTenantAccess(auth);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "invoice.deliver",
          key,
          request: { id, ...body },
          work: async () => {
            const invoice = (
              await client.query<any>(
                "SELECT * FROM invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (!invoice)
              throw new NotFoundException({
                code: "INVOICE_NOT_FOUND",
                message: "Invoice not found",
              });
            this.assertBranch(auth, invoice.branch_id);
            if (invoice.status !== "ISSUED")
              throw new ConflictException({
                code: "INVOICE_NOT_READY",
                message: "Invoice is not issued",
              });
            const enabled =
              body.channel === "PRINT" ||
              (body.channel === "EMAIL"
                ? process.env.EMAIL_PROVIDER_ENABLED === "true"
                : process.env.SMS_PROVIDER_ENABLED === "true");
            const status = enabled ? "PENDING" : "DISABLED";
            const redacted = body.destination
              ? redactDestination(body.destination)
              : null;
            const delivery = (
              await client.query<any>(
                "INSERT INTO invoice_deliveries(tenant_id,invoice_id,channel,destination_redacted,status,requested_by_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
                [
                  auth.tenantId,
                  id,
                  body.channel,
                  redacted,
                  status,
                  auth.userId,
                  requestId,
                ],
              )
            ).rows[0];
            await this.evidence.record(client, {
              auth,
              branchId: invoice.branch_id,
              event: "invoice.delivery_requested",
              aggregateType: "invoice",
              aggregateId: id,
              aggregateVersion: Number(invoice.version),
              requestId,
              currency: invoice.currency,
              amountMinor: BigInt(invoice.paid_minor),
              idempotencyKey: key,
              payload: {
                invoiceId: id,
                deliveryId: delivery.id,
                channel: body.channel,
                status,
              },
            });
            return {
              id: delivery.id,
              channel: body.channel,
              status,
              destinationRedacted: redacted,
              financialStateUnchanged: true,
            };
          },
        }),
      )
    ).data;
  }

  private async mutateOrder<T>(
    auth: AccessClaims,
    id: string,
    command: string,
    key: string,
    request: unknown,
    requestId: string,
    work: (client: PoolClient, order: any) => Promise<T>,
  ) {
    this.assertTenantAccess(auth);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command,
          key,
          request: { id, ...(request as any) },
          work: async () =>
            work(client, await this.lockOrder(client, auth, id)),
        }),
      )
    ).data;
  }

  private async lockOrder(client: PoolClient, auth: AccessClaims, id: string) {
    const row = (
      await client.query<any>(
        `SELECT o.*,b.status branch_status,b.timezone branch_timezone,bs.tax_policy_json
           FROM pos_orders o JOIN branches b ON b.tenant_id=o.tenant_id AND b.id=o.branch_id
           JOIN branch_settings bs ON bs.tenant_id=o.tenant_id AND bs.branch_id=o.branch_id
          WHERE o.tenant_id=$1 AND o.id=$2 FOR UPDATE OF o`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "POS_ORDER_NOT_FOUND",
        message: "POS order not found",
      });
    this.assertBranch(auth, row.branch_id);
    return row;
  }

  private async orderRow(client: PoolClient, auth: AccessClaims, id: string) {
    const row = (
      await client.query<any>(
        `SELECT o.*,b.timezone branch_timezone,bs.tax_policy_json
           FROM pos_orders o JOIN branches b ON b.tenant_id=o.tenant_id AND b.id=o.branch_id
           JOIN branch_settings bs ON bs.tenant_id=o.tenant_id AND bs.branch_id=o.branch_id
          WHERE o.tenant_id=$1 AND o.id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "POS_ORDER_NOT_FOUND",
        message: "POS order not found",
      });
    this.assertBranch(auth, row.branch_id);
    return row;
  }

  private async orderView(client: PoolClient, auth: AccessClaims, id: string) {
    const order = await this.orderRow(client, auth, id);
    // pg PoolClient serializes one wire connection. Keep these reads explicit and
    // sequential so transaction-local views remain deterministic with pg 9+.
    const lines = await client.query<any>(
      "SELECT * FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 ORDER BY line_no,id",
      [auth.tenantId, id],
    );
    const payments = await client.query<any>(
      "SELECT * FROM payments WHERE tenant_id=$1 AND pos_order_id=$2 ORDER BY created_at,id",
      [auth.tenantId, id],
    );
    const invoice = await client.query<any>(
      "SELECT * FROM invoices WHERE tenant_id=$1 AND pos_order_id=$2",
      [auth.tenantId, id],
    );
    const discounts = await client.query<any>(
      "SELECT * FROM pos_discounts WHERE tenant_id=$1 AND pos_order_id=$2 ORDER BY created_at,id",
      [auth.tenantId, id],
    );
    const tip = await client.query<any>(
      `SELECT t.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('staffId',a.staff_id,'appointmentItemId',a.appointment_item_id,'amountMinor',a.amount_minor,'allocationBasis',a.allocation_basis) ORDER BY a.created_at,a.id) FROM pos_tip_allocations a WHERE a.tenant_id=t.tenant_id AND a.pos_tip_id=t.id),'[]'::jsonb) allocations FROM pos_tips t WHERE t.tenant_id=$1 AND t.pos_order_id=$2 AND t.status='ACTIVE'`,
      [auth.tenantId, id],
    );
    const approvals = await client.query<any>(
      "SELECT id,status,reason_code,created_at FROM pos_discount_approval_requests WHERE tenant_id=$1 AND pos_order_id=$2 ORDER BY created_at,id",
      [auth.tenantId, id],
    );
    return {
      ...orderSummary(order),
      paymentCapabilities: {
        partialPaymentsAllowed:
          order.tax_policy_json?.allowPartialPayments !== false,
      },
      customerSnapshot: order.customer_snapshot_json,
      appointmentSnapshot: order.appointment_snapshot_json,
      pricingSnapshot: order.pricing_snapshot_json,
      taxSnapshot: order.tax_snapshot_json,
      lines: lines.rows.map(lineView),
      payments: payments.rows.map(paymentView),
      invoice: invoice.rows[0] ? invoiceView(invoice.rows[0]) : null,
      discounts: discounts.rows.map((row) => ({
        ...row,
        amountMinor: minorNumber(row.amount_minor),
        value: Number(row.value_numeric),
      })),
      tip: tip.rows[0]
        ? {
            id: tip.rows[0].id,
            amountMinor: minorNumber(tip.rows[0].amount_minor),
            source: tip.rows[0].source,
            createdAt: tip.rows[0].created_at,
            updatedAt: tip.rows[0].updated_at,
            allocations: tip.rows[0].allocations.map((row: any) => ({
              ...row,
              amountMinor: minorNumber(row.amountMinor),
            })),
          }
        : null,
      approvalRequests: approvals.rows,
    };
  }

  private async reprice(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
    requestId: string,
    reasonCode: string,
  ) {
    const order = await this.orderRow(client, auth, id);
    if (order.pricing_locked_at)
      throw new ConflictException({
        code: "POS_ORDER_PRICING_LOCKED",
        message: "Pricing is locked after the first captured payment",
      });
    const lines = (
      await client.query<any>(
        "SELECT * FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' ORDER BY line_no,id FOR UPDATE",
        [auth.tenantId, id],
      )
    ).rows;
    const discounts = (
      await client.query<any>(
        "SELECT * FROM pos_discounts WHERE tenant_id=$1 AND pos_order_id=$2 ORDER BY created_at,id",
        [auth.tenantId, id],
      )
    ).rows;
    const tip = (
      await client.query<any>(
        "SELECT amount_minor FROM pos_tips WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE'",
        [auth.tenantId, id],
      )
    ).rows[0];
    const inputs: PricingLineInput[] = lines.map((line) => {
      const tax = normalizeTax(line.tax_profile_snapshot_json, {});
      const lineDiscount = discounts
        .filter((discount) => discount.order_line_id === line.id)
        .reduce(
          (sum: bigint, discount: any) => sum + BigInt(discount.amount_minor),
          0n,
        );
      return {
        id: line.id,
        grossMinor: BigInt(line.gross_minor),
        lineDiscountMinor: lineDiscount,
        discountEligible: line.line_type !== "GIFT_CARD",
        taxMode: tax.calculationMode,
        rateBasisPoints: tax.rateBasisPoints,
        roundingMode: tax.roundingMode,
      };
    });
    const orderDiscount = discounts
      .filter((discount) => !discount.order_line_id)
      .reduce(
        (sum: bigint, discount: any) => sum + BigInt(discount.amount_minor),
        0n,
      );
    const totals = this.pricing.calculate(
      inputs,
      orderDiscount,
      BigInt(tip?.amount_minor ?? 0),
      BigInt(order.amount_paid_minor),
    );
    for (const line of totals.lines)
      await client.query(
        "UPDATE pos_order_lines SET discount_minor=$3,taxable_minor=$4,tax_minor=$5,net_minor=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [
          auth.tenantId,
          line.id,
          line.discountMinor.toString(),
          line.taxableMinor.toString(),
          line.taxMinor.toString(),
          line.netMinor.toString(),
        ],
      );
    const updated = (
      await client.query<any>(
        `UPDATE pos_orders SET subtotal_minor=$3,discount_minor=$4,taxable_minor=$5,tax_minor=$6,total_minor=$7,
                tip_minor=$8,amount_due_minor=$9,pricing_snapshot_json=$10,version=version+1,updated_by_user_id=$11,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [
          auth.tenantId,
          id,
          totals.subtotalMinor.toString(),
          totals.discountMinor.toString(),
          totals.taxableMinor.toString(),
          totals.taxMinor.toString(),
          totals.totalMinor.toString(),
          totals.tipMinor.toString(),
          totals.amountDueMinor.toString(),
          JSON.stringify(this.pricingSnapshot(totals)),
          auth.userId,
        ],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO pos_order_pricing_revisions(
         tenant_id,pos_order_id,revision_no,pricing_snapshot_json,reason_code,actor_user_id,request_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        auth.tenantId,
        id,
        Number(updated.version),
        JSON.stringify({
          ...this.pricingSnapshot(totals),
          lines: totals.lines.map((line) => ({
            id: line.id,
            grossMinor: String(line.grossMinor),
            discountMinor: String(line.discountMinor),
            taxableMinor: String(line.taxableMinor),
            taxMinor: String(line.taxMinor),
            netMinor: String(line.netMinor),
          })),
        }),
        reasonCode,
        auth.userId,
        requestId,
      ],
    );
    return updated;
  }

  private pricingSnapshot(totals: any) {
    return {
      formulaVersion: 1,
      subtotalMinor: String(totals.subtotalMinor ?? totals.subtotal_minor),
      discountMinor: String(totals.discountMinor ?? totals.discount_minor),
      taxableMinor: String(totals.taxableMinor ?? totals.taxable_minor),
      taxMinor: String(totals.taxMinor ?? totals.tax_minor),
      totalMinor: String(totals.totalMinor ?? totals.total_minor),
      tipMinor: String(totals.tipMinor ?? totals.tip_minor),
      grandTotalMinor: String(
        (totals.totalMinor ?? BigInt(totals.total_minor)) +
          (totals.tipMinor ?? BigInt(totals.tip_minor)),
      ),
      rounding: "MINOR_UNIT_DETERMINISTIC",
    };
  }

  private async discountEligible(
    client: PoolClient,
    auth: AccessClaims,
    orderId: string,
    lineId?: string | null,
  ) {
    if (lineId) {
      const line = (
        await client.query<any>(
          "SELECT line_type,gross_minor,discount_minor FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND id=$3 AND status='ACTIVE'",
          [auth.tenantId, orderId, lineId],
        )
      ).rows[0];
      if (!line)
        throw new NotFoundException({
          code: "POS_LINE_NOT_FOUND",
          message: "Order line not found",
        });
      if (line.line_type === "GIFT_CARD")
        throw new ConflictException({
          code: "GIFT_CARD_DISCOUNT_NOT_ALLOWED",
          message: "Gift-card funding lines are not discount eligible",
        });
      return BigInt(line.gross_minor) - BigInt(line.discount_minor);
    }
    const row = (
      await client.query<any>(
        "SELECT COALESCE(sum(gross_minor-discount_minor) FILTER (WHERE line_type<>'GIFT_CARD'),0) eligible FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE'",
        [auth.tenantId, orderId],
      )
    ).rows[0];
    return BigInt(row.eligible);
  }

  private async insertDiscount(
    client: PoolClient,
    auth: AccessClaims,
    orderId: string,
    body: any,
    amount: bigint,
    approvedBy: string | null,
  ) {
    await client.query(
      "INSERT INTO pos_discounts(tenant_id,pos_order_id,order_line_id,discount_type,value_numeric,amount_minor,reason_code,note,approved_by_user_id,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        auth.tenantId,
        orderId,
        body.orderLineId ?? null,
        body.discountType,
        body.value,
        amount.toString(),
        body.reasonCode,
        body.note ?? null,
        approvedBy,
        auth.userId,
      ],
    );
  }

  private async tipContributions(
    client: PoolClient,
    auth: AccessClaims,
    appointmentId: string | null,
  ) {
    if (!appointmentId) return [];
    return (
      await client.query<any>(
        `SELECT seg.staff_id "staffId",ss.appointment_item_id "appointmentItemId",
                sum(GREATEST(0,extract(epoch FROM (seg.ended_at-seg.started_at))))::integer "workSeconds"
           FROM service_session_staff_segments seg
           JOIN service_sessions ss ON ss.tenant_id=seg.tenant_id AND ss.id=seg.service_session_id
          WHERE seg.tenant_id=$1 AND ss.appointment_id=$2 AND seg.ended_at IS NOT NULL
          GROUP BY seg.staff_id,ss.appointment_item_id HAVING sum(extract(epoch FROM (seg.ended_at-seg.started_at)))>0
          ORDER BY "workSeconds" DESC,seg.staff_id,ss.appointment_item_id`,
        [auth.tenantId, appointmentId],
      )
    ).rows.map((row) => ({ ...row, workSeconds: Number(row.workSeconds) }));
  }

  private async validateTipInvariant(
    client: PoolClient,
    auth: AccessClaims,
    orderId: string,
    expected: bigint,
  ) {
    const allocated = BigInt(
      (
        await client.query<any>(
          `SELECT COALESCE(sum(a.amount_minor),0) amount FROM pos_tip_allocations a JOIN pos_tips t ON t.tenant_id=a.tenant_id AND t.id=a.pos_tip_id WHERE t.tenant_id=$1 AND t.pos_order_id=$2 AND t.status='ACTIVE'`,
          [auth.tenantId, orderId],
        )
      ).rows[0].amount,
    );
    if (allocated !== expected)
      throw new ConflictException({
        code: "TIP_ALLOCATION_TOTAL_MISMATCH",
        message: "Active tip allocations do not equal tip amount",
      });
  }

  private async allocatePayment(
    client: PoolClient,
    auth: AccessClaims,
    order: any,
    paymentId: string,
    captured: bigint,
  ) {
    const previousOrder = BigInt(
      (
        await client.query<any>(
          `SELECT COALESCE(sum(pa.amount_minor),0) amount FROM payment_allocations pa JOIN payments p ON p.tenant_id=pa.tenant_id AND p.id=pa.payment_id WHERE pa.tenant_id=$1 AND pa.pos_order_id=$2 AND pa.allocation_type='ORDER_TOTAL' AND p.status='CAPTURED'`,
          [auth.tenantId, order.id],
        )
      ).rows[0].amount,
    );
    const remainingOrder =
      BigInt(order.total_minor) > previousOrder
        ? BigInt(order.total_minor) - previousOrder
        : 0n;
    const orderAmount = captured < remainingOrder ? captured : remainingOrder;
    const tipAmount = captured - orderAmount;
    if (orderAmount > 0n)
      await client.query(
        "INSERT INTO payment_allocations(tenant_id,payment_id,pos_order_id,allocation_type,amount_minor) VALUES($1,$2,$3,'ORDER_TOTAL',$4)",
        [auth.tenantId, paymentId, order.id, orderAmount.toString()],
      );
    if (tipAmount > 0n)
      await client.query(
        "INSERT INTO payment_allocations(tenant_id,payment_id,pos_order_id,allocation_type,amount_minor) VALUES($1,$2,$3,'TIP',$4)",
        [auth.tenantId, paymentId, order.id, tipAmount.toString()],
      );
  }

  private async ensureDraftInvoice(
    client: PoolClient,
    auth: AccessClaims,
    order: any,
  ) {
    await client.query(
      `INSERT INTO invoices(
         tenant_id,branch_id,pos_order_id,invoice_number,status,currency,subtotal_minor,discount_minor,taxable_minor,tax_minor,total_minor,tip_minor,paid_minor,customer_snapshot_json,branch_snapshot_json,tax_snapshot_json
       ) VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(tenant_id,pos_order_id) DO NOTHING`,
      [
        auth.tenantId,
        order.branch_id,
        order.id,
        `DRAFT-${order.id}`,
        order.currency,
        order.subtotal_minor,
        order.discount_minor,
        order.taxable_minor,
        order.tax_minor,
        order.total_minor,
        order.tip_minor,
        order.amount_paid_minor,
        JSON.stringify(order.customer_snapshot_json),
        JSON.stringify(order.appointment_snapshot_json?.branch ?? {}),
        JSON.stringify(order.tax_snapshot_json),
      ],
    );
  }

  private async issueInvoice(
    client: PoolClient,
    auth: AccessClaims,
    order: any,
    requestId: string,
    key: string,
  ) {
    const existing = (
      await client.query<any>(
        "SELECT * FROM invoices WHERE tenant_id=$1 AND pos_order_id=$2 FOR UPDATE",
        [auth.tenantId, order.id],
      )
    ).rows[0];
    if (existing?.status === "ISSUED") return existing;
    await this.ensureDraftInvoice(client, auth, order);
    const branch = (
      await client.query<any>(
        "SELECT code,name,timezone FROM branches WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, order.branch_id],
      )
    ).rows[0];
    const fiscalYear = Number(
      new Intl.DateTimeFormat("en", {
        timeZone: branch.timezone,
        year: "numeric",
      }).format(new Date()),
    );
    const prefix =
      String(branch.code)
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .slice(0, 20) || "BRANCH";
    const counter = (
      await client.query<any>(
        `INSERT INTO invoice_counters(tenant_id,branch_id,fiscal_year,prefix,last_number)
         VALUES($1,$2,$3,$4,1)
         ON CONFLICT(tenant_id,branch_id,fiscal_year) DO UPDATE SET last_number=invoice_counters.last_number+1,updated_at=now()
         RETURNING last_number`,
        [auth.tenantId, order.branch_id, fiscalYear, prefix],
      )
    ).rows[0];
    const invoiceNumber = `${prefix}-${fiscalYear}-${String(counter.last_number).padStart(6, "0")}`;
    const invoice = (
      await client.query<any>(
        `UPDATE invoices SET invoice_number=$3,status='ISSUED',subtotal_minor=$4,discount_minor=$5,taxable_minor=$6,tax_minor=$7,total_minor=$8,tip_minor=$9,paid_minor=$10,
                customer_snapshot_json=$11,branch_snapshot_json=$12,tax_snapshot_json=$13,issued_at=now(),issued_by_user_id=$14,version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND pos_order_id=$2 AND status='DRAFT' RETURNING *`,
        [
          auth.tenantId,
          order.id,
          invoiceNumber,
          order.subtotal_minor,
          order.discount_minor,
          order.taxable_minor,
          order.tax_minor,
          order.total_minor,
          order.tip_minor,
          (BigInt(order.total_minor) + BigInt(order.tip_minor)).toString(),
          JSON.stringify(order.customer_snapshot_json),
          JSON.stringify({
            id: order.branch_id,
            name: branch.name,
            code: branch.code,
            timezone: branch.timezone,
          }),
          JSON.stringify(order.tax_snapshot_json),
          auth.userId,
        ],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO invoice_lines(tenant_id,invoice_id,line_no,source_order_line_id,description_snapshot_json,quantity,unit_price_minor,discount_minor,taxable_minor,tax_minor,net_minor,tax_snapshot_json)
       SELECT tenant_id,$3,line_no,id,description_snapshot_json,quantity,unit_price_minor,discount_minor,taxable_minor,tax_minor,net_minor,tax_profile_snapshot_json
         FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND status='ACTIVE' ORDER BY line_no,id`,
      [auth.tenantId, order.id, invoice.id],
    );
    await this.evidence.record(client, {
      auth,
      branchId: order.branch_id,
      event: "invoice.issued",
      aggregateType: "invoice",
      aggregateId: invoice.id,
      aggregateVersion: invoice.version,
      requestId,
      currency: order.currency,
      amountMinor: BigInt(order.total_minor) + BigInt(order.tip_minor),
      registerId: order.register_id,
      idempotencyKey: key,
      payload: {
        invoiceId: invoice.id,
        invoiceNumber,
        orderId: order.id,
        status: "ISSUED",
      },
    });
    await this.generateCommissionEvidence(client, auth, invoice.id);
    return invoice;
  }

  private async generateCommissionEvidence(
    client: PoolClient,
    auth: AccessClaims,
    invoiceId: string,
  ) {
    await client.query(
      `WITH source AS (
         SELECT il.tenant_id,il.id invoice_line_id,il.invoice_id,
                round(il.unit_price_minor*il.quantity)::bigint gross_minor,il.taxable_minor,
                pol.service_id,pol.service_session_id,i.branch_id,i.currency,
                (i.issued_at AT TIME ZONE b.timezone)::date business_date
           FROM invoice_lines il
           JOIN invoices i ON i.tenant_id=il.tenant_id AND i.id=il.invoice_id
           JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
           JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
          WHERE il.tenant_id=$1 AND il.invoice_id=$2 AND pol.line_type='SERVICE'
       ), contribution AS (
         SELECT s.*,seg.staff_id,sum(extract(epoch FROM(seg.ended_at-seg.started_at))) work_seconds,
                sum(sum(extract(epoch FROM(seg.ended_at-seg.started_at)))) OVER(PARTITION BY s.invoice_line_id) total_work_seconds
           FROM source s JOIN service_session_staff_segments seg
             ON seg.tenant_id=s.tenant_id AND seg.service_session_id=s.service_session_id AND seg.ended_at IS NOT NULL
          GROUP BY s.tenant_id,s.invoice_line_id,s.invoice_id,s.gross_minor,s.taxable_minor,s.service_id,s.service_session_id,
                   s.branch_id,s.currency,s.business_date,seg.staff_id
       ), resolved AS (
         SELECT c.*,r.id rule_id,r.rule_code,r.rule_type,r.base_mode,r.percent_basis_points,r.fixed_minor,r.currency rule_currency,
                r.priority,r.policy_json,r.effective_from,r.effective_to
           FROM contribution c LEFT JOIN LATERAL (
             SELECT cr.* FROM commission_rules cr
              WHERE cr.tenant_id=c.tenant_id AND cr.status='ACTIVE'
                AND (cr.branch_id IS NULL OR cr.branch_id=c.branch_id)
                AND (cr.staff_id IS NULL OR cr.staff_id=c.staff_id)
                AND (cr.service_id IS NULL OR cr.service_id=c.service_id)
                AND cr.effective_from<=now() AND (cr.effective_to IS NULL OR cr.effective_to>now())
              ORDER BY ((cr.staff_id IS NOT NULL)::int*4+(cr.service_id IS NOT NULL)::int*2+(cr.branch_id IS NOT NULL)::int) DESC,
                       cr.priority DESC,cr.id LIMIT 1
           ) r ON true
       ), calculated AS (
         SELECT r.*,
                CASE WHEN r.base_mode='GROSS_SERVICE_BEFORE_DISCOUNT' THEN r.gross_minor ELSE r.taxable_minor END total_base,
                CASE WHEN r.rule_type='SERVICE_FIXED' THEN r.fixed_minor
                     ELSE round((CASE WHEN r.base_mode='GROSS_SERVICE_BEFORE_DISCOUNT' THEN r.gross_minor ELSE r.taxable_minor END)
                                *r.percent_basis_points::numeric/10000)::bigint END total_commission
           FROM resolved r WHERE r.rule_id IS NOT NULL AND (r.rule_currency IS NULL OR r.rule_currency=r.currency)
       )
       INSERT INTO commission_entries(tenant_id,branch_id,staff_id,invoice_id,invoice_line_id,service_session_id,entry_type,business_date,
              currency,base_minor,commission_minor,contribution_basis_json,rule_snapshot_json,source_snapshot_json,generation_key,status)
       SELECT tenant_id,branch_id,staff_id,invoice_id,invoice_line_id,service_session_id,'EARNING',business_date,currency,
              round(total_base*work_seconds::numeric/NULLIF(total_work_seconds,0))::bigint,
              round(total_commission*work_seconds::numeric/NULLIF(total_work_seconds,0))::bigint,
              jsonb_build_object('workSeconds',work_seconds,'totalWorkSeconds',total_work_seconds),
              jsonb_build_object('id',rule_id,'code',rule_code,'type',rule_type,'baseMode',base_mode,'percentBasisPoints',percent_basis_points,
                                 'fixedMinor',fixed_minor,'priority',priority,'policy',policy_json,'effectiveFrom',effective_from,'effectiveTo',effective_to),
              jsonb_build_object('invoiceId',invoice_id,'invoiceLineId',invoice_line_id,'serviceSessionId',service_session_id),
              concat('invoice:',invoice_id,':line:',invoice_line_id,':staff:',staff_id),'GENERATED'
         FROM calculated ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
      [auth.tenantId, invoiceId],
    );
    await client.query(
      `WITH contribution AS (
         SELECT il.tenant_id,il.invoice_id,il.id invoice_line_id,i.branch_id,i.currency,pol.service_id,seg.staff_id
           FROM invoice_lines il
           JOIN invoices i ON i.tenant_id=il.tenant_id AND i.id=il.invoice_id
           JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
           JOIN service_session_staff_segments seg ON seg.tenant_id=pol.tenant_id AND seg.service_session_id=pol.service_session_id AND seg.ended_at IS NOT NULL
          WHERE il.tenant_id=$1 AND il.invoice_id=$2 AND pol.line_type='SERVICE'
          GROUP BY il.tenant_id,il.invoice_id,il.id,i.branch_id,i.currency,pol.service_id,seg.staff_id
       )
       INSERT INTO commission_generation_conflicts(tenant_id,invoice_id,invoice_line_id,staff_id,conflict_code,context_json)
       SELECT c.tenant_id,c.invoice_id,c.invoice_line_id,c.staff_id,'COMMISSION_RULE_MISSING',
              jsonb_build_object('branchId',c.branch_id,'serviceId',c.service_id,'currency',c.currency)
         FROM contribution c
        WHERE NOT EXISTS(
          SELECT 1 FROM commission_rules r
           WHERE r.tenant_id=c.tenant_id AND r.status='ACTIVE'
             AND (r.branch_id IS NULL OR r.branch_id=c.branch_id)
             AND (r.staff_id IS NULL OR r.staff_id=c.staff_id)
             AND (r.service_id IS NULL OR r.service_id=c.service_id)
             AND (r.currency IS NULL OR r.currency=c.currency)
             AND r.effective_from<=now() AND (r.effective_to IS NULL OR r.effective_to>now())
        )
          AND NOT EXISTS(
            SELECT 1 FROM commission_generation_conflicts x
             WHERE x.tenant_id=c.tenant_id AND x.invoice_line_id=c.invoice_line_id
               AND x.staff_id=c.staff_id AND x.conflict_code='COMMISSION_RULE_MISSING'
          )`,
      [auth.tenantId, invoiceId],
    );
    await client.query(
      `WITH source AS (
         SELECT il.tenant_id,il.invoice_id,il.id invoice_line_id,pol.service_session_id
           FROM invoice_lines il JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
          WHERE il.tenant_id=$1 AND il.invoice_id=$2 AND pol.line_type='SERVICE'
       )
       INSERT INTO commission_generation_conflicts(tenant_id,invoice_id,invoice_line_id,conflict_code,context_json)
       SELECT s.tenant_id,s.invoice_id,s.invoice_line_id,'COMMISSION_CONTRIBUTION_MISSING',jsonb_build_object('serviceSessionId',s.service_session_id)
         FROM source s WHERE NOT EXISTS(SELECT 1 FROM service_session_staff_segments seg WHERE seg.tenant_id=s.tenant_id AND seg.service_session_id=s.service_session_id AND seg.ended_at IS NOT NULL)
           AND NOT EXISTS(SELECT 1 FROM commission_generation_conflicts c WHERE c.tenant_id=s.tenant_id AND c.invoice_line_id=s.invoice_line_id AND c.conflict_code='COMMISSION_CONTRIBUTION_MISSING')`,
      [auth.tenantId, invoiceId],
    );
  }

  private async checkoutAppointment(
    client: PoolClient,
    auth: AccessClaims,
    order: any,
    requestId: string,
    paid: boolean,
  ) {
    if (!order.appointment_id) return;
    const appointment = (
      await client.query<any>(
        "SELECT status,version FROM appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, order.appointment_id],
      )
    ).rows[0];
    if (!appointment) return;
    if (paid) {
      if (appointment.status !== "CHECKED_OUT")
        await client.query(
          "INSERT INTO appointment_status_history(tenant_id,appointment_id,from_status,to_status,actor_type,actor_user_id,reason_code,request_id) VALUES($1,$2,$3,'CHECKED_OUT','USER',$4,'POS_FINALIZED',$5)",
          [
            auth.tenantId,
            order.appointment_id,
            appointment.status,
            auth.userId,
            requestId,
          ],
        );
      await client.query(
        "INSERT INTO appointment_status_history(tenant_id,appointment_id,from_status,to_status,actor_type,actor_user_id,reason_code,request_id) VALUES($1,$2,'CHECKED_OUT','PAID','USER',$3,'POS_PAID',$4)",
        [auth.tenantId, order.appointment_id, auth.userId, requestId],
      );
      await client.query(
        "UPDATE appointments SET status='PAID',version=version+1,updated_by_user_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, order.appointment_id, auth.userId],
      );
    } else if (appointment.status !== "CHECKED_OUT") {
      await client.query(
        "INSERT INTO appointment_status_history(tenant_id,appointment_id,from_status,to_status,actor_type,actor_user_id,reason_code,request_id) VALUES($1,$2,$3,'CHECKED_OUT','USER',$4,'POS_FINALIZED',$5)",
        [
          auth.tenantId,
          order.appointment_id,
          appointment.status,
          auth.userId,
          requestId,
        ],
      );
      await client.query(
        "UPDATE appointments SET status='CHECKED_OUT',version=version+1,updated_by_user_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, order.appointment_id, auth.userId],
      );
    }
  }

  private async refreshExpectedCash(
    client: PoolClient,
    auth: AccessClaims,
    sessionId: string,
  ) {
    return (
      await client.query<any>(
        `UPDATE cash_sessions cs SET expected_cash_minor=summary.expected,version=version+1,updated_at=now()
         FROM (SELECT cash_session_id,
           sum(CASE WHEN direction='IN' THEN amount_minor ELSE -amount_minor END) expected
           FROM cash_movements WHERE tenant_id=$1 AND cash_session_id=$2 GROUP BY cash_session_id) summary
         WHERE cs.tenant_id=$1 AND cs.id=summary.cash_session_id RETURNING cs.*`,
        [auth.tenantId, sessionId],
      )
    ).rows[0];
  }

  private async drawerCurrency(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
  ) {
    return (
      await client.query<any>(
        "SELECT currency FROM cash_drawers WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0]?.currency;
  }

  private async assertRegister(
    client: PoolClient,
    auth: AccessClaims,
    branchId: string,
    id: string,
  ) {
    const row = (
      await client.query<any>(
        "SELECT * FROM pos_registers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        [auth.tenantId, branchId, id],
      )
    ).rows[0];
    if (!row || row.status !== "ACTIVE")
      throw new NotFoundException({
        code: "CASH_REGISTER_NOT_FOUND",
        message: "Active register not found",
      });
    return row;
  }

  private async assertBranchActive(
    client: PoolClient,
    tenantId: string,
    branchId: string,
  ) {
    const row = (
      await client.query<any>(
        "SELECT status FROM branches WHERE tenant_id=$1 AND id=$2",
        [tenantId, branchId],
      )
    ).rows[0];
    if (!row || row.status !== "ACTIVE")
      throw new ConflictException({
        code: "FINANCIAL_BRANCH_INACTIVE",
        message: "Branch is inactive",
      });
  }

  private assertTenantAccess(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support Access Grant is required",
      });
  }
  private assertBranch(auth: AccessClaims, id: string) {
    if (!auth.roles.includes("SALON_OWNER") && !auth.branchIds.includes(id))
      throw new NotFoundException({
        code: "POS_ORDER_NOT_FOUND",
        message: "Financial record not found",
      });
  }
  private manager(auth: AccessClaims) {
    return auth.roles.some(
      (role) => role === "SALON_OWNER" || role === "BRANCH_MANAGER",
    );
  }
  private assertDraft(order: any) {
    if (order.pricing_locked_at)
      throw new ConflictException({
        code: "POS_ORDER_PRICING_LOCKED",
        message: "Pricing is locked",
      });
    if (order.status !== "DRAFT")
      throw new ConflictException({
        code: "POS_ORDER_STATUS_INVALID",
        message: "Only a draft order can be repriced",
      });
  }
  private assertOrderRegister(order: any) {
    if (!order.register_id)
      throw new ConflictException({
        code: "POS_ORDER_REGISTER_REQUIRED",
        message: "Assign an active register before finalization or payment",
      });
  }
  private assertVersion(order: any, version: number) {
    if (Number(order.version) !== version)
      throw new ConflictException({
        code: "POS_ORDER_VERSION_CONFLICT",
        message: "Order version changed; refetch and retry",
      });
  }
  private async appendHistory(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
    from: string | null,
    to: string,
    requestId: string,
    note?: string,
  ) {
    await client.query(
      "INSERT INTO pos_order_status_history(tenant_id,pos_order_id,from_status,to_status,actor_user_id,note,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [auth.tenantId, id, from, to, auth.userId, note ?? null, requestId],
    );
  }
  private async recordOrder(
    client: PoolClient,
    auth: AccessClaims,
    order: any,
    event: string,
    requestId: string,
    key: string,
    payload: Record<string, unknown> = {},
  ) {
    await this.evidence.record(client, {
      auth,
      branchId: order.branch_id,
      event,
      aggregateType: "pos_order",
      aggregateId: order.id,
      aggregateVersion: Number(order.version),
      requestId,
      currency: order.currency,
      amountMinor: BigInt(order.total_minor) + BigInt(order.tip_minor),
      registerId: order.register_id,
      idempotencyKey: key,
      payload: {
        orderId: order.id,
        appointmentId: order.appointment_id ?? null,
        cashSessionId: order.cash_session_id ?? null,
        status: order.status,
        ...payload,
      },
    });
  }
}

function normalizeTax(
  snapshot: any,
  fallback: any,
): {
  calculationMode: "EXCLUSIVE" | "INCLUSIVE" | "NONE";
  rateBasisPoints: number;
  roundingMode: "HALF_UP" | "HALF_EVEN";
} {
  const raw =
    snapshot && Object.keys(snapshot).length ? snapshot : (fallback ?? {});
  const calculationMode = ["EXCLUSIVE", "INCLUSIVE", "NONE"].includes(
    raw.calculationMode ?? raw.calculation_mode,
  )
    ? (raw.calculationMode ?? raw.calculation_mode)
    : "NONE";
  const roundingMode =
    (raw.roundingMode ?? raw.rounding_mode) === "HALF_EVEN"
      ? "HALF_EVEN"
      : "HALF_UP";
  const rateBasisPoints = Math.max(
    0,
    Math.min(100000, Number(raw.rateBasisPoints ?? raw.rate_basis_points ?? 0)),
  );
  return { calculationMode, rateBasisPoints, roundingMode };
}
function decimalUnits(value: number) {
  return BigInt(value.toFixed(4).replace(".", ""));
}
function roundQuantity(unitPrice: bigint, quantityUnits: bigint) {
  return (unitPrice * quantityUnits + 5000n) / 10000n;
}
function orderSummary(row: any) {
  return {
    id: row.id,
    branchId: row.branch_id,
    registerId: row.register_id,
    appointmentId: row.appointment_id,
    customerId: row.customer_id,
    orderNumber: row.order_number,
    source: row.source,
    status: row.status,
    currency: row.currency,
    subtotalMinor: minorNumber(row.subtotal_minor),
    discountMinor: minorNumber(row.discount_minor),
    taxableMinor: minorNumber(row.taxable_minor),
    taxMinor: minorNumber(row.tax_minor),
    totalMinor: minorNumber(row.total_minor),
    tipMinor: minorNumber(row.tip_minor),
    grandTotalMinor: minorNumber(
      BigInt(row.total_minor) + BigInt(row.tip_minor),
    ),
    amountPaidMinor: minorNumber(row.amount_paid_minor),
    amountDueMinor: minorNumber(row.amount_due_minor),
    pricingLockedAt: row.pricing_locked_at,
    finalizedAt: row.finalized_at,
    paidAt: row.paid_at,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function lineView(row: any) {
  return {
    id: row.id,
    lineNo: row.line_no,
    lineType: row.line_type,
    appointmentItemId: row.appointment_item_id,
    serviceSessionId: row.service_session_id,
    serviceId: row.service_id,
    description: row.description_snapshot_json,
    quantity: Number(row.quantity),
    unitPriceMinor: minorNumber(row.unit_price_minor),
    grossMinor: minorNumber(row.gross_minor),
    discountMinor: minorNumber(row.discount_minor),
    taxableMinor: minorNumber(row.taxable_minor),
    taxMinor: minorNumber(row.tax_minor),
    netMinor: minorNumber(row.net_minor),
    taxSnapshot: row.tax_profile_snapshot_json,
    sourceSnapshot: row.source_snapshot_json,
    status: row.status,
    version: Number(row.version),
  };
}
function paymentView(row: any) {
  return {
    id: row.id,
    orderId: row.pos_order_id,
    paymentReference: row.payment_reference,
    tenderType: row.tender_type,
    status: row.status,
    currency: row.currency,
    requestedMinor: minorNumber(row.requested_minor),
    capturedMinor: minorNumber(row.captured_minor),
    cashReceivedMinor:
      row.cash_received_minor == null
        ? null
        : minorNumber(row.cash_received_minor),
    changeDueMinor:
      row.change_due_minor == null ? null : minorNumber(row.change_due_minor),
    provider: row.provider,
    providerTransactionId: row.provider_transaction_id,
    terminalId: row.terminal_id,
    cardBrand: row.card_brand,
    cardLast4: row.card_last4,
    approvalCode: row.approval_code,
    cashSessionId: row.cash_session_id,
    registerId: row.register_id,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}
function invoiceView(row: any) {
  return {
    id: row.id,
    orderId: row.pos_order_id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    currency: row.currency,
    subtotalMinor: minorNumber(row.subtotal_minor),
    discountMinor: minorNumber(row.discount_minor),
    taxableMinor: minorNumber(row.taxable_minor),
    taxMinor: minorNumber(row.tax_minor),
    totalMinor: minorNumber(row.total_minor),
    tipMinor: minorNumber(row.tip_minor),
    paidMinor: minorNumber(row.paid_minor),
    issuedAt: row.issued_at,
    version: Number(row.version),
  };
}
function redactDestination(value: string) {
  if (value.includes("@")) {
    const [name = "", domain = ""] = value.split("@");
    return `${name.slice(0, 1)}***@${domain}`;
  }
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}
