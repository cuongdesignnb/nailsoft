/* eslint-disable @typescript-eslint/no-explicit-any */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  inventoryPurchaseOrderSchema,
  inventoryReceiptSchema,
  inventoryTransferSchema,
  inventoryVersionCommandSchema,
} from "@nailsoft/validation";
import type { AccessClaims } from "../identity/auth.types.js";
import {
  assertPurchaseOrderTransition,
  assertTransferTransition,
  convertQuantity,
  lineTotalMinor,
  parseQuantity,
} from "./inventory-domain.js";
import { InventoryCoreService } from "./inventory-core.service.js";

@Injectable()
export class InventoryProcurementService {
  constructor(
    @Inject(InventoryCoreService) private readonly core: InventoryCoreService,
  ) {}
  purchaseOrders(auth: AccessClaims, branchId?: string) {
    this.core.access(auth);
    if (branchId) this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT id,branch_id "branchId",supplier_id "supplierId",po_number "poNumber",status,currency,subtotal_minor::text "subtotalMinor",expected_at "expectedAt",version,created_at "createdAt" FROM purchase_orders WHERE tenant_id=$1 ${branchId ? "AND branch_id=$2" : ""} ORDER BY created_at DESC`,
        branchId ? [auth.tenantId, branchId] : [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async purchaseOrder(auth: AccessClaims, id: string) {
    const row = (
      await this.core.db.query<any>(
        "SELECT * FROM purchase_orders WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.core.notFound("PURCHASE_ORDER_NOT_FOUND");
    this.core.branch(auth, row.branch_id);
    const lines = (
      await this.core.db.query<any>(
        'SELECT id,item_id "itemId",uom_id "uomId",ordered_quantity::text "orderedQuantity",received_quantity::text "receivedQuantity",unit_price_minor::text "unitPriceMinor",line_total_minor::text "lineTotalMinor" FROM purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 ORDER BY line_no',
        [auth.tenantId, id],
      )
    ).rows;
    return { ...row, subtotal_minor: String(row.subtotal_minor), lines };
  }
  createPurchaseOrder(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryPurchaseOrderSchema.parse(input);
    this.core.branch(auth, b.branchId);
    return this.core.command(
      auth,
      "inventory.purchase_order.create",
      key,
      b,
      async (c) => {
        const scope = (
          await c.query<any>(
            `SELECT b.code,t.currency FROM branches b JOIN tenants t ON t.id=b.tenant_id
             WHERE b.tenant_id=$1 AND b.id=$2 AND b.status='ACTIVE'`,
            [auth.tenantId, b.branchId],
          )
        ).rows[0];
        if (!scope) this.core.conflict("INVENTORY_BRANCH_INACTIVE");
        if (scope.currency !== b.currency)
          this.core.conflict("PURCHASE_ORDER_CURRENCY_MISMATCH");
        if (
          !(
            await c.query(
              "SELECT 1 FROM inventory_suppliers WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
              [auth.tenantId, b.supplierId],
            )
          ).rowCount
        )
          this.core.conflict("INVENTORY_SUPPLIER_INACTIVE");
        const year = new Date().getUTCFullYear();
        await c.query(
          "INSERT INTO purchase_order_counters(tenant_id,branch_id,local_year,next_value) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING",
          [auth.tenantId, b.branchId, year],
        );
        const counter = (
          await c.query<any>(
            "UPDATE purchase_order_counters SET next_value=next_value+1 WHERE tenant_id=$1 AND branch_id=$2 AND local_year=$3 RETURNING next_value-1 value",
            [auth.tenantId, b.branchId, year],
          )
        ).rows[0];
        const poNumber = `PO-${scope.code}-${year}-${String(counter.value).padStart(6, "0")}`,
          id = randomUUID();
        let total = 0n;
        const totals = b.lines.map((l) => {
          const value = BigInt(lineTotalMinor(l.quantity, l.unitPriceMinor));
          total += value;
          return value.toString();
        });
        await c.query(
          "INSERT INTO purchase_orders(id,tenant_id,branch_id,supplier_id,po_number,currency,subtotal_minor,expected_at,note,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            id,
            auth.tenantId,
            b.branchId,
            b.supplierId,
            poNumber,
            b.currency,
            total.toString(),
            b.expectedAt ?? null,
            b.note ?? null,
            auth.userId,
          ],
        );
        for (const [i, l] of b.lines.entries())
          await c.query(
            "INSERT INTO purchase_order_lines(tenant_id,purchase_order_id,line_no,item_id,uom_id,ordered_quantity,unit_price_minor,line_total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              auth.tenantId,
              id,
              i + 1,
              l.itemId,
              l.uomId,
              l.quantity,
              l.unitPriceMinor,
              totals[i],
            ],
          );
        await this.history(c, auth, id, null, "DRAFT", requestId);
        await this.core.evidence(
          c,
          auth,
          "inventory.purchase_order_created",
          "purchase_order",
          id,
          requestId,
          b.branchId,
          { status: "DRAFT", poNumber },
        );
        return {
          id,
          poNumber,
          status: "DRAFT",
          subtotalMinor: total.toString(),
          currency: b.currency,
          version: 1,
        };
      },
    );
  }
  purchaseOrderStatus(
    auth: AccessClaims,
    id: string,
    to: "SUBMITTED" | "APPROVED" | "CLOSED" | "CANCELLED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      `inventory.purchase_order.${to.toLowerCase()}`,
      key,
      { id, to, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM purchase_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("PURCHASE_ORDER_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (to === "APPROVED" && row.created_by_user_id === auth.userId)
          this.core.conflict(
            "PURCHASE_ORDER_DUAL_CONTROL_REQUIRED",
            "The requester cannot approve their own purchase order",
          );
        try {
          assertPurchaseOrderTransition(row.status, to);
        } catch {
          this.core.conflict("PURCHASE_ORDER_STATUS_INVALID");
        }
        const updated = (
          await c.query<any>(
            "UPDATE purchase_orders SET status=$3,version=version+1,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,approved_at=CASE WHEN $3='APPROVED' THEN now() ELSE approved_at END,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [auth.tenantId, id, to, auth.userId],
          )
        ).rows[0];
        await this.history(c, auth, id, row.status, to, requestId, b.reason);
        await this.core.evidence(
          c,
          auth,
          `inventory.purchase_order_${to.toLowerCase()}`,
          "purchase_order",
          id,
          requestId,
          row.branch_id,
          { from: row.status, to, reason: b.reason },
        );
        return updated;
      },
    );
  }
  receipts(auth: AccessClaims, branchId?: string) {
    this.core.access(auth);
    if (branchId) this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT id,branch_id "branchId",purchase_order_id "purchaseOrderId",receipt_number "receiptNumber",status,received_at "receivedAt",version FROM inventory_receipts WHERE tenant_id=$1 ${branchId ? "AND branch_id=$2" : ""} ORDER BY created_at DESC`,
        branchId ? [auth.tenantId, branchId] : [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  async receipt(auth: AccessClaims, id: string) {
    const row = (
      await this.core.db.query<any>(
        "SELECT * FROM inventory_receipts WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.core.notFound("INVENTORY_RECEIPT_NOT_FOUND");
    this.core.branch(auth, row.branch_id);
    const lines = (
      await this.core.db.query<any>(
        `SELECT id,purchase_order_line_id "purchaseOrderLineId",item_id "itemId",lot_id "lotId",
                received_quantity::text "receivedQuantity",base_quantity::text "baseQuantity",
                unit_cost_minor::text "unitCostMinor",quality_disposition "qualityDisposition",
                uom_id "uomId",conversion_id "conversionId",conversion_numerator::text "conversionNumerator",conversion_denominator::text "conversionDenominator"
         FROM inventory_receipt_lines WHERE tenant_id=$1 AND receipt_id=$2 ORDER BY created_at,id`,
        [auth.tenantId, id],
      )
    ).rows;
    return { ...row, lines };
  }
  createReceipt(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryReceiptSchema.parse(input);
    this.core.branch(auth, b.branchId);
    return this.core.command(
      auth,
      "inventory.receipt.create",
      key,
      b,
      async (c) => {
        await this.assertLocation(c, auth, b.branchId, b.locationId);
        const location = (
          await c.query<any>(
            "SELECT location_type FROM inventory_locations WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            [auth.tenantId, b.branchId, b.locationId],
          )
        ).rows[0];
        const branch = (
          await c.query<any>(
            "SELECT code FROM branches WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
            [auth.tenantId, b.branchId],
          )
        ).rows[0];
        if (!branch) this.core.conflict("INVENTORY_BRANCH_INACTIVE");
        if (b.purchaseOrderId) {
          const po = (
            await c.query<any>(
              "SELECT branch_id,status FROM purchase_orders WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, b.purchaseOrderId],
            )
          ).rows[0];
          if (!po || po.branch_id !== b.branchId)
            this.core.conflict("GOODS_RECEIPT_PO_SCOPE_MISMATCH");
          if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status))
            this.core.conflict("GOODS_RECEIPT_PO_STATUS_INVALID");
        }
        const year = new Date(b.receivedAt).getUTCFullYear();
        await c.query(
          "INSERT INTO inventory_receipt_counters(tenant_id,branch_id,local_year,next_value) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING",
          [auth.tenantId, b.branchId, year],
        );
        const counter = (
            await c.query<any>(
              "UPDATE inventory_receipt_counters SET next_value=next_value+1 WHERE tenant_id=$1 AND branch_id=$2 AND local_year=$3 RETURNING next_value-1 value",
              [auth.tenantId, b.branchId, year],
            )
          ).rows[0],
          receiptNumber = `GRN-${branch.code}-${year}-${String(counter.value).padStart(6, "0")}`,
          id = randomUUID();
        await c.query(
          "INSERT INTO inventory_receipts(id,tenant_id,branch_id,purchase_order_id,receipt_number,received_at,location_id,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id,
            auth.tenantId,
            b.branchId,
            b.purchaseOrderId ?? null,
            receiptNumber,
            b.receivedAt,
            b.locationId,
            auth.userId,
          ],
        );
        for (const l of b.lines) {
          const item = (
            await c.query<any>(
              `SELECT i.base_uom_id,i.tracking_mode,i.quantity_precision,pol.uom_id po_uom_id
               FROM inventory_items i LEFT JOIN purchase_order_lines pol
                 ON pol.tenant_id=i.tenant_id AND pol.id=$3 AND pol.item_id=i.id
               WHERE i.tenant_id=$1 AND i.id=$2 AND i.status='ACTIVE'`,
              [auth.tenantId, l.itemId, l.purchaseOrderLineId ?? null],
            )
          ).rows[0];
          if (!item) this.core.conflict("INVENTORY_ITEM_INVALID");
          if (b.purchaseOrderId && (!l.purchaseOrderLineId || !item.po_uom_id))
            this.core.conflict("GOODS_RECEIPT_PO_LINE_MISMATCH");
          if (
            l.qualityDisposition === "QUARANTINE" &&
            location.location_type !== "QUARANTINE"
          )
            this.core.conflict("GOODS_RECEIPT_QUARANTINE_LOCATION_REQUIRED");
          const uomId = l.uomId ?? item.po_uom_id ?? item.base_uom_id;
          let conversionId: string | null = null,
            numerator = 1n,
            denominator = 1n;
          if (uomId !== item.base_uom_id) {
            const conversion = (
              await c.query<any>(
                `SELECT id,numerator,denominator FROM inventory_uom_conversions
                 WHERE tenant_id=$1 AND from_uom_id=$2 AND to_uom_id=$3
                   AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now())`,
                [auth.tenantId, uomId, item.base_uom_id],
              )
            ).rows[0];
            if (!conversion)
              this.core.conflict("INVENTORY_UOM_CONVERSION_NOT_FOUND");
            conversionId = conversion.id;
            numerator = BigInt(conversion.numerator);
            denominator = BigInt(conversion.denominator);
          }
          const baseQuantity = convertQuantity(
            l.quantity,
            numerator,
            denominator,
          );
          const fraction = baseQuantity.split(".")[1] ?? "";
          if (fraction.length > item.quantity_precision)
            this.core.conflict("INVENTORY_QUANTITY_PRECISION_EXCEEDED");
          if (
            item.tracking_mode !== "NONE" &&
            l.qualityDisposition !== "REJECTED"
          ) {
            if (!l.lotId) this.core.conflict("INVENTORY_LOT_REQUIRED");
            const lot = (
              await c.query<any>(
                "SELECT expiry_date,status FROM inventory_lots WHERE tenant_id=$1 AND branch_id=$2 AND item_id=$3 AND id=$4",
                [auth.tenantId, b.branchId, l.itemId, l.lotId],
              )
            ).rows[0];
            if (!lot) this.core.conflict("INVENTORY_LOT_INVALID");
            if (item.tracking_mode === "LOT_AND_EXPIRY" && !lot.expiry_date)
              this.core.conflict("INVENTORY_EXPIRY_REQUIRED");
          }
          await c.query(
            "INSERT INTO inventory_receipt_lines(tenant_id,receipt_id,purchase_order_line_id,item_id,lot_id,received_quantity,base_quantity,unit_cost_minor,quality_disposition,uom_id,conversion_id,conversion_numerator,conversion_denominator) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
            [
              auth.tenantId,
              id,
              l.purchaseOrderLineId ?? null,
              l.itemId,
              l.lotId ?? null,
              l.quantity,
              baseQuantity,
              l.unitCostMinor,
              l.qualityDisposition,
              uomId,
              conversionId,
              numerator.toString(),
              denominator.toString(),
            ],
          );
        }
        await this.core.evidence(
          c,
          auth,
          "inventory.receipt_created",
          "inventory_receipt",
          id,
          requestId,
          b.branchId,
          { status: "DRAFT", receiptNumber },
        );
        return { id, receiptNumber, status: "DRAFT", version: 1 };
      },
    );
  }
  postReceipt(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.receipt.post",
      key,
      { id, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM inventory_receipts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("INVENTORY_RECEIPT_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (row.status !== "DRAFT")
          this.core.conflict("INVENTORY_RECEIPT_IMMUTABLE");
        if (row.purchase_order_id) {
          const po = (
            await c.query<any>(
              "SELECT status FROM purchase_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [auth.tenantId, row.purchase_order_id],
            )
          ).rows[0];
          if (!po || !["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status))
            this.core.conflict("GOODS_RECEIPT_PO_STATUS_INVALID");
        }
        const lines = (
          await c.query<any>(
            "SELECT * FROM inventory_receipt_lines WHERE tenant_id=$1 AND receipt_id=$2 ORDER BY id FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows;
        for (const l of lines) {
          if (
            l.purchase_order_line_id &&
            l.quality_disposition !== "REJECTED"
          ) {
            const poLine = (
              await c.query<any>(
                "SELECT ordered_quantity,received_quantity FROM purchase_order_lines WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, l.purchase_order_line_id],
              )
            ).rows[0];
            if (
              !poLine ||
              parseQuantity(String(poLine.received_quantity)) +
                parseQuantity(String(l.received_quantity)) >
                parseQuantity(String(poLine.ordered_quantity))
            )
              this.core.conflict("GOODS_RECEIPT_OVER_RECEIPT");
          }
          if (l.quality_disposition !== "REJECTED") {
            await this.core.move(c, auth, {
              branchId: row.branch_id,
              locationId: row.location_id,
              itemId: l.item_id,
              lotId: l.lot_id,
              quantityDelta: String(l.base_quantity),
              unitCostMinor: String(l.unit_cost_minor),
              entryType: "PURCHASE_RECEIPT",
              referenceType: "inventory_receipt_line",
              referenceId: l.id,
              requestId,
            });
            if (l.purchase_order_line_id)
              await c.query(
                "UPDATE purchase_order_lines SET received_quantity=received_quantity+$3::numeric,version=version+1 WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, l.purchase_order_line_id, l.received_quantity],
              );
          }
        }
        await c.query(
          "UPDATE inventory_receipts SET status='POSTED',version=version+1,posted_by_user_id=$3,posted_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, auth.userId],
        );
        if (row.purchase_order_id)
          await this.refreshPo(c, auth, row.purchase_order_id, requestId);
        await this.core.evidence(
          c,
          auth,
          "inventory.receipt_posted",
          "inventory_receipt",
          id,
          requestId,
          row.branch_id,
          { lineCount: lines.length },
        );
        return { id, status: "POSTED", version: row.version + 1 };
      },
    );
  }
  cancelReceipt(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.receipt.cancel",
      key,
      { id, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM inventory_receipts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("INVENTORY_RECEIPT_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (row.status !== "DRAFT")
          this.core.conflict("INVENTORY_RECEIPT_IMMUTABLE");
        await c.query(
          "UPDATE inventory_receipts SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.receipt_cancelled",
          "inventory_receipt",
          id,
          requestId,
          row.branch_id,
          { reason: b.reason },
        );
        return { id, status: "CANCELLED", version: row.version + 1 };
      },
    );
  }
  transfers(auth: AccessClaims, branchId?: string) {
    this.core.access(auth);
    if (branchId) this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT * FROM inventory_transfers WHERE tenant_id=$1 ${branchId ? "AND (source_branch_id=$2 OR destination_branch_id=$2)" : ""} ORDER BY created_at DESC`,
        branchId ? [auth.tenantId, branchId] : [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  createTransfer(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryTransferSchema.parse(input);
    this.core.branch(auth, b.sourceBranchId);
    this.core.branch(auth, b.destinationBranchId);
    return this.core.command(
      auth,
      "inventory.transfer.create",
      key,
      b,
      async (c) => {
        await this.assertLocation(
          c,
          auth,
          b.sourceBranchId,
          b.sourceLocationId,
        );
        await this.assertLocation(
          c,
          auth,
          b.destinationBranchId,
          b.destinationLocationId,
        );
        const year = new Date().getUTCFullYear();
        const branch = (
          await c.query<any>(
            "SELECT code FROM branches WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
            [auth.tenantId, b.sourceBranchId],
          )
        ).rows[0];
        if (!branch) this.core.conflict("INVENTORY_BRANCH_INACTIVE");
        await c.query(
          "INSERT INTO inventory_transfer_counters(tenant_id,branch_id,local_year,next_value) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING",
          [auth.tenantId, b.sourceBranchId, year],
        );
        const counter = (
          await c.query<any>(
            "UPDATE inventory_transfer_counters SET next_value=next_value+1 WHERE tenant_id=$1 AND branch_id=$2 AND local_year=$3 RETURNING next_value-1 value",
            [auth.tenantId, b.sourceBranchId, year],
          )
        ).rows[0];
        const id = randomUUID(),
          number = `TRF-${branch.code}-${year}-${String(counter.value).padStart(6, "0")}`;
        await c.query(
          "INSERT INTO inventory_transfers(id,tenant_id,source_branch_id,destination_branch_id,source_location_id,destination_location_id,transfer_number,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id,
            auth.tenantId,
            b.sourceBranchId,
            b.destinationBranchId,
            b.sourceLocationId,
            b.destinationLocationId,
            number,
            auth.userId,
          ],
        );
        for (const l of b.lines)
          await c.query(
            "INSERT INTO inventory_transfer_lines(tenant_id,transfer_id,item_id,lot_id,requested_quantity) VALUES($1,$2,$3,$4,$5)",
            [auth.tenantId, id, l.itemId, l.lotId ?? null, l.quantity],
          );
        await this.core.evidence(
          c,
          auth,
          "inventory.transfer_created",
          "inventory_transfer",
          id,
          requestId,
          b.sourceBranchId,
        );
        return { id, transferNumber: number, status: "DRAFT", version: 1 };
      },
    );
  }
  transferStatus(
    auth: AccessClaims,
    id: string,
    to: "REQUESTED" | "APPROVED" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      `inventory.transfer.${to.toLowerCase()}`,
      key,
      { id, to, ...b },
      async (c) => {
        const t = (
          await c.query<any>(
            "SELECT * FROM inventory_transfers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!t) this.core.notFound("INVENTORY_TRANSFER_NOT_FOUND");
        this.core.branch(
          auth,
          to === "RECEIVED" ? t.destination_branch_id : t.source_branch_id,
        );
        if (t.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        try {
          assertTransferTransition(t.status, to);
        } catch {
          this.core.conflict("INVENTORY_TRANSFER_STATUS_INVALID");
        }
        const lines = (
          await c.query<any>(
            "SELECT * FROM inventory_transfer_lines WHERE tenant_id=$1 AND transfer_id=$2 ORDER BY item_id,lot_id FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows;
        if (to === "APPROVED") {
          if (t.created_by_user_id === auth.userId)
            this.core.conflict(
              "INVENTORY_TRANSFER_DUAL_CONTROL_REQUIRED",
              "The requester cannot approve their own transfer",
            );
          for (const l of lines) {
            const reservationId = await this.core.reserve(c, auth, {
              branchId: t.source_branch_id,
              locationId: t.source_location_id,
              itemId: l.item_id,
              lotId: l.lot_id,
              quantity: String(l.requested_quantity),
              type: "TRANSFER",
              aggregateId: l.id,
            });
            await c.query(
              "UPDATE inventory_transfer_lines SET reservation_id=$3 WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, l.id, reservationId],
            );
          }
        }
        if (to === "IN_TRANSIT")
          for (const l of lines) {
            if (!l.reservation_id)
              this.core.conflict("INVENTORY_TRANSFER_NOT_RESERVED");
            await this.core.releaseReservation(
              c,
              auth,
              l.reservation_id,
              "RELEASED",
            );
            const bal = await this.core.balance(
              c,
              auth.tenantId,
              t.source_branch_id,
              t.source_location_id,
              l.item_id,
              l.lot_id,
            );
            await this.core.move(c, auth, {
              branchId: t.source_branch_id,
              locationId: t.source_location_id,
              itemId: l.item_id,
              lotId: l.lot_id,
              quantityDelta: `-${l.requested_quantity}`,
              entryType: "TRANSFER_OUT",
              referenceType: "inventory_transfer_line",
              referenceId: l.id,
              requestId,
            });
            const transitLocation = (
              await c.query<{ id: string }>(
                `INSERT INTO inventory_locations(tenant_id,branch_id,code,name,location_type)
                 VALUES($1,$2,'SYSTEM-IN-TRANSIT','In transit','IN_TRANSIT')
                 ON CONFLICT (tenant_id,branch_id,code) DO UPDATE SET updated_at=now() RETURNING id`,
                [auth.tenantId, t.source_branch_id],
              )
            ).rows[0];
            if (!transitLocation)
              this.core.conflict("INVENTORY_TRANSIT_LOCATION_FAILED");
            await this.core.move(c, auth, {
              branchId: t.source_branch_id,
              locationId: transitLocation.id,
              itemId: l.item_id,
              lotId: l.lot_id,
              quantityDelta: String(l.requested_quantity),
              unitCostMinor: String(bal.average_unit_cost_minor),
              entryType: "TRANSFER_IN",
              referenceType: "inventory_transfer_line",
              referenceId: l.id,
              requestId,
            });
            await c.query(
              "UPDATE inventory_transfer_lines SET shipped_quantity=requested_quantity,unit_cost_minor=$3,transit_location_id=$4 WHERE tenant_id=$1 AND id=$2",
              [
                auth.tenantId,
                l.id,
                bal.average_unit_cost_minor,
                transitLocation.id,
              ],
            );
          }
        if (to === "RECEIVED")
          for (const l of lines) {
            if (!l.transit_location_id)
              this.core.conflict("INVENTORY_TRANSFER_NOT_IN_TRANSIT");
            await this.core.move(c, auth, {
              branchId: t.source_branch_id,
              locationId: l.transit_location_id,
              itemId: l.item_id,
              lotId: l.lot_id,
              quantityDelta: `-${l.shipped_quantity}`,
              unitCostMinor: String(l.unit_cost_minor),
              entryType: "TRANSFER_OUT",
              referenceType: "inventory_transfer_line",
              referenceId: l.id,
              requestId,
            });
            let destinationLotId: string | null = null;
            if (l.lot_id) {
              const sourceLot = (
                await c.query<any>(
                  "SELECT lot_code,expiry_date,status,received_at FROM inventory_lots WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                  [auth.tenantId, t.source_branch_id, l.lot_id],
                )
              ).rows[0];
              if (!sourceLot) this.core.conflict("INVENTORY_LOT_INVALID");
              const destinationLot = (
                await c.query<{ id: string }>(
                  `INSERT INTO inventory_lots(tenant_id,branch_id,item_id,lot_code,expiry_date,status,received_at)
                   VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,now()))
                   ON CONFLICT (tenant_id,branch_id,item_id,lot_code) DO UPDATE SET
                     expiry_date=COALESCE(inventory_lots.expiry_date,EXCLUDED.expiry_date),updated_at=now()
                   RETURNING id`,
                  [
                    auth.tenantId,
                    t.destination_branch_id,
                    l.item_id,
                    sourceLot.lot_code,
                    sourceLot.expiry_date,
                    sourceLot.status,
                    sourceLot.received_at,
                  ],
                )
              ).rows[0];
              if (!destinationLot)
                this.core.conflict("INVENTORY_LOT_CREATE_FAILED");
              destinationLotId = destinationLot.id;
            }
            await this.core.move(c, auth, {
              branchId: t.destination_branch_id,
              locationId: t.destination_location_id,
              itemId: l.item_id,
              lotId: destinationLotId,
              quantityDelta: String(l.shipped_quantity),
              unitCostMinor: String(l.unit_cost_minor),
              entryType: "TRANSFER_IN",
              referenceType: "inventory_transfer_line",
              referenceId: l.id,
              requestId,
            });
            await c.query(
              "UPDATE inventory_transfer_lines SET received_quantity=shipped_quantity WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, l.id],
            );
          }
        await c.query(
          "UPDATE inventory_transfers SET status=$3,version=version+1,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,approved_at=CASE WHEN $3='APPROVED' THEN now() ELSE approved_at END,shipped_at=CASE WHEN $3='IN_TRANSIT' THEN now() ELSE shipped_at END,received_at=CASE WHEN $3='RECEIVED' THEN now() ELSE received_at END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, to, auth.userId],
        );
        await this.core.evidence(
          c,
          auth,
          `inventory.transfer_${to.toLowerCase()}`,
          "inventory_transfer",
          id,
          requestId,
          t.source_branch_id,
          { to },
        );
        return { id, status: to, version: t.version + 1 };
      },
    );
  }
  private async history(
    c: PoolClient,
    auth: AccessClaims,
    id: string,
    from: string | null,
    to: string,
    requestId: string,
    reason?: string,
  ) {
    await c.query(
      "INSERT INTO purchase_order_status_history(tenant_id,purchase_order_id,from_status,to_status,actor_user_id,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [auth.tenantId, id, from, to, auth.userId, reason ?? null, requestId],
    );
  }
  private async assertLocation(
    c: PoolClient,
    auth: AccessClaims,
    branchId: string,
    locationId: string,
  ) {
    if (
      !(
        await c.query(
          "SELECT 1 FROM inventory_locations WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='ACTIVE'",
          [auth.tenantId, branchId, locationId],
        )
      ).rowCount
    )
      this.core.conflict("INVENTORY_LOCATION_INVALID");
  }
  private async refreshPo(
    c: PoolClient,
    auth: AccessClaims,
    id: string,
    requestId: string,
  ) {
    const po = (
      await c.query<any>(
        "SELECT * FROM purchase_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!po) return;
    const s = (
        await c.query<any>(
          "SELECT bool_and(received_quantity=ordered_quantity) complete,bool_or(received_quantity>0) partial FROM purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2",
          [auth.tenantId, id],
        )
      ).rows[0],
      next = s.complete
        ? "RECEIVED"
        : s.partial
          ? "PARTIALLY_RECEIVED"
          : po.status;
    if (next !== po.status) {
      await c.query(
        "UPDATE purchase_orders SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id, next],
      );
      await this.history(c, auth, id, po.status, next, requestId);
    }
  }
}
