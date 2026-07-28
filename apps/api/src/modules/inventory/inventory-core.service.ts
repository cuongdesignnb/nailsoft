/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import {
  formatQuantity,
  divideRounded,
  parseQuantity,
  QUANTITY_SCALE,
} from "./inventory-domain.js";

@Injectable()
export class InventoryCoreService {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(BookingIdempotencyService) readonly idem: BookingIdempotencyService,
  ) {}

  access(auth: AccessClaims) {
    if (
      auth.roles.includes("PLATFORM_SUPER_ADMIN") &&
      !auth.roles.some((r) =>
        [
          "SALON_OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER",
          "ACCOUNTANT",
          "NAIL_TECHNICIAN",
        ].includes(r),
      )
    )
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Platform support requires an explicit tenant access grant",
      });
  }
  branch(auth: AccessClaims, branchId: string) {
    this.access(auth);
    if (
      !auth.roles.includes("SALON_OWNER") &&
      !auth.branchIds.includes(branchId)
    )
      throw new ForbiddenException({
        code: "BRANCH_ACCESS_DENIED",
        message: "Branch is outside membership scope",
      });
  }
  notFound(code: string): never {
    throw new NotFoundException({
      code,
      message: "Inventory resource not found",
    });
  }
  conflict(
    code: string,
    message = "Inventory command conflicts with current state",
  ): never {
    throw new ConflictException({ code, message });
  }
  command<T>(
    auth: AccessClaims,
    name: string,
    key: string,
    request: unknown,
    work: (c: PoolClient) => Promise<T>,
  ) {
    this.access(auth);
    return this.db.transaction(
      async (c) =>
        (
          await this.idem.execute(c, {
            tenantId: auth.tenantId,
            actorScope: `user:${auth.userId}`,
            command: name,
            key,
            request,
            work: () => work(c),
          })
        ).data,
    );
  }
  async evidence(
    c: PoolClient,
    auth: AccessClaims,
    event: string,
    type: string,
    id: string,
    requestId: string,
    branchId?: string,
    after: Record<string, unknown> = {},
  ) {
    await c.query(
      "INSERT INTO audit_logs(tenant_id,branch_id,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        auth.tenantId,
        branchId ?? null,
        auth.userId,
        event,
        type,
        id,
        JSON.stringify(after),
        requestId,
      ],
    );
    await c.query(
      "INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        auth.tenantId,
        event,
        type,
        id,
        JSON.stringify({
          aggregateId: id,
          branchId: branchId ?? null,
          refetch: true,
        }),
        JSON.stringify({ type: "USER", id: auth.userId }),
        JSON.stringify({ schemaVersion: 1, pii: false }),
      ],
    );
  }
  async balance(
    c: PoolClient,
    tenantId: string,
    branchId: string,
    locationId: string,
    itemId: string,
    lotId: string | null,
  ) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `inventory:${tenantId}:${branchId}:${locationId}:${itemId}:${lotId ?? "none"}`,
    ]);
    await c.query(
      `INSERT INTO inventory_stock_balances(tenant_id,branch_id,location_id,item_id,lot_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [tenantId, branchId, locationId, itemId, lotId],
    );
    return (
      await c.query<any>(
        "SELECT * FROM inventory_stock_balances WHERE tenant_id=$1 AND branch_id=$2 AND location_id=$3 AND item_id=$4 AND lot_id IS NOT DISTINCT FROM $5 FOR UPDATE",
        [tenantId, branchId, locationId, itemId, lotId],
      )
    ).rows[0];
  }
  async move(
    c: PoolClient,
    auth: AccessClaims,
    input: {
      branchId: string;
      locationId: string;
      itemId: string;
      lotId?: string | null;
      quantityDelta: string;
      unitCostMinor?: string;
      entryType: string;
      referenceType: string;
      referenceId: string;
      reasonCode?: string;
      requestId: string;
      keyHash?: string;
    },
  ) {
    const item = (
      await c.query<any>(
        "SELECT quantity_precision,tracking_mode FROM inventory_items WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
        [auth.tenantId, input.itemId],
      )
    ).rows[0];
    if (!item) this.conflict("INVENTORY_ITEM_INVALID");
    const fraction = (
      input.quantityDelta.replace("-", "").split(".")[1] ?? ""
    ).replace(/0+$/, "");
    if (fraction.length > item.quantity_precision)
      this.conflict("INVENTORY_QUANTITY_PRECISION_EXCEEDED");
    if (item.tracking_mode !== "NONE" && !input.lotId)
      this.conflict("INVENTORY_LOT_REQUIRED");
    const row = await this.balance(
      c,
      auth.tenantId,
      input.branchId,
      input.locationId,
      input.itemId,
      input.lotId ?? null,
    );
    const oldQty = parseQuantity(String(row.on_hand)),
      delta = parseQuantity(input.quantityDelta),
      newQty = oldQty + delta,
      reserved = parseQuantity(String(row.reserved));
    if (newQty < reserved || newQty < 0n)
      this.conflict("INVENTORY_INSUFFICIENT_AVAILABLE");
    const oldValue = parseQuantity(String(row.total_cost_minor));
    let unitCost = parseQuantity(
      input.unitCostMinor === undefined
        ? String(row.average_unit_cost_minor)
        : input.unitCostMinor,
    );
    let valueDelta: bigint;
    if (delta >= 0n) {
      valueDelta = divideRounded(delta * unitCost, QUANTITY_SCALE);
    } else {
      const outgoing = -delta;
      const outboundValue =
        outgoing === oldQty
          ? oldValue
          : divideRounded(oldValue * outgoing, oldQty);
      valueDelta = -outboundValue;
      unitCost =
        outgoing === 0n
          ? 0n
          : divideRounded(outboundValue * QUANTITY_SCALE, outgoing);
    }
    let newValue = oldValue + valueDelta;
    if (newQty === 0n) newValue = 0n;
    if (newValue < 0n) this.conflict("INVENTORY_COST_INVARIANT");
    const average =
      newQty === 0n ? 0n : divideRounded(newValue * QUANTITY_SCALE, newQty);
    await c.query(
      "UPDATE inventory_stock_balances SET on_hand=$6,total_cost_minor=$7,average_unit_cost_minor=$8,version=version+1,updated_at=now() WHERE tenant_id=$1 AND branch_id=$2 AND location_id=$3 AND item_id=$4 AND lot_id IS NOT DISTINCT FROM $5",
      [
        auth.tenantId,
        input.branchId,
        input.locationId,
        input.itemId,
        input.lotId ?? null,
        formatQuantity(newQty),
        formatQuantity(newValue),
        formatQuantity(average),
      ],
    );
    const id = randomUUID();
    await c.query(
      `INSERT INTO inventory_stock_ledger_entries(id,tenant_id,branch_id,location_id,item_id,lot_id,entry_type,quantity_delta,unit_cost_minor,value_delta_minor,balance_quantity_after,balance_value_after_minor,reference_type,reference_id,reason_code,actor_user_id,idempotency_key_hash,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        id,
        auth.tenantId,
        input.branchId,
        input.locationId,
        input.itemId,
        input.lotId ?? null,
        input.entryType,
        input.quantityDelta,
        formatQuantity(unitCost),
        formatQuantity(valueDelta),
        formatQuantity(newQty),
        formatQuantity(newValue),
        input.referenceType,
        input.referenceId,
        input.reasonCode ?? null,
        auth.userId,
        input.keyHash ?? null,
        input.requestId,
      ],
    );
    return {
      id,
      onHand: formatQuantity(newQty),
      available: formatQuantity(newQty - reserved),
      averageUnitCostMinor: formatQuantity(average),
    };
  }
  async reserve(
    c: PoolClient,
    auth: AccessClaims,
    input: {
      branchId: string;
      locationId: string;
      itemId: string;
      lotId?: string | null;
      quantity: string;
      type: "SERVICE" | "POS" | "POS_PRODUCT" | "TRANSFER";
      aggregateId: string;
      expiresAt?: string | null;
    },
  ) {
    const stockKey = (
      await c.query<any>(
        `SELECT i.quantity_precision,i.tracking_mode,l.location_type,l.status location_status,
                lot.status lot_status,(lot.expiry_date<CURRENT_DATE) lot_expired
         FROM inventory_items i JOIN inventory_locations l ON l.tenant_id=i.tenant_id AND l.id=$3 AND l.branch_id=$2
         LEFT JOIN inventory_lots lot ON lot.tenant_id=i.tenant_id AND lot.branch_id=$2 AND lot.id=$5 AND lot.item_id=i.id
         WHERE i.tenant_id=$1 AND i.id=$4 AND i.status='ACTIVE'`,
        [
          auth.tenantId,
          input.branchId,
          input.locationId,
          input.itemId,
          input.lotId ?? null,
        ],
      )
    ).rows[0];
    if (!stockKey || stockKey.location_status !== "ACTIVE")
      this.conflict("INVENTORY_LOCATION_INVALID");
    if (
      ["QUARANTINE", "DAMAGED", "IN_TRANSIT"].includes(stockKey.location_type)
    )
      this.conflict("INVENTORY_STOCK_NOT_AVAILABLE");
    if (stockKey.tracking_mode !== "NONE" && !input.lotId)
      this.conflict("INVENTORY_LOT_REQUIRED");
    if (
      input.lotId &&
      (stockKey.lot_status !== "AVAILABLE" || stockKey.lot_expired)
    )
      this.conflict("INVENTORY_LOT_NOT_AVAILABLE");
    const fraction = (input.quantity.split(".")[1] ?? "").replace(/0+$/, "");
    if (fraction.length > stockKey.quantity_precision)
      this.conflict("INVENTORY_QUANTITY_PRECISION_EXCEEDED");
    const balance = await this.balance(
        c,
        auth.tenantId,
        input.branchId,
        input.locationId,
        input.itemId,
        input.lotId ?? null,
      ),
      quantity = parseQuantity(input.quantity);
    if (
      quantity <= 0n ||
      parseQuantity(String(balance.on_hand)) -
        parseQuantity(String(balance.reserved)) <
        quantity
    )
      this.conflict("INVENTORY_INSUFFICIENT_AVAILABLE");
    const id = randomUUID();
    await c.query(
      "INSERT INTO inventory_reservations(id,tenant_id,branch_id,location_id,item_id,lot_id,reservation_type,aggregate_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        auth.tenantId,
        input.branchId,
        input.locationId,
        input.itemId,
        input.lotId ?? null,
        input.type,
        input.aggregateId,
        input.quantity,
        input.expiresAt ?? null,
      ],
    );
    await c.query(
      "UPDATE inventory_stock_balances SET reserved=reserved+$6::numeric,version=version+1,updated_at=now() WHERE tenant_id=$1 AND branch_id=$2 AND location_id=$3 AND item_id=$4 AND lot_id IS NOT DISTINCT FROM $5",
      [
        auth.tenantId,
        input.branchId,
        input.locationId,
        input.itemId,
        input.lotId ?? null,
        input.quantity,
      ],
    );
    return id;
  }
  async releaseReservation(
    c: PoolClient,
    auth: AccessClaims,
    id: string,
    status: "RELEASED" | "COMMITTED" | "EXPIRED",
  ) {
    const r = (
      await c.query<any>(
        "SELECT * FROM inventory_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!r) this.notFound("INVENTORY_RESERVATION_NOT_FOUND");
    if (r.status !== "ACTIVE") return r;
    await this.balance(
      c,
      auth.tenantId,
      r.branch_id,
      r.location_id,
      r.item_id,
      r.lot_id,
    );
    await c.query(
      "UPDATE inventory_stock_balances SET reserved=GREATEST(0,reserved-$6::numeric),version=version+1,updated_at=now() WHERE tenant_id=$1 AND branch_id=$2 AND location_id=$3 AND item_id=$4 AND lot_id IS NOT DISTINCT FROM $5",
      [
        auth.tenantId,
        r.branch_id,
        r.location_id,
        r.item_id,
        r.lot_id,
        r.quantity,
      ],
    );
    if (status === "COMMITTED")
      await this.move(c, auth, {
        branchId: r.branch_id,
        locationId: r.location_id,
        itemId: r.item_id,
        lotId: r.lot_id,
        quantityDelta: `-${r.quantity}`,
        entryType:
          r.reservation_type === "SERVICE"
            ? "SERVICE_CONSUMPTION"
            : r.reservation_type === "TRANSFER"
              ? "TRANSFER_OUT"
              : "POS_SALE",
        referenceType: "inventory_reservation",
        referenceId: r.id,
        requestId: "reservation-commit",
      });
    await c.query(
      "UPDATE inventory_reservations SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, id, status],
    );
    return { ...r, status };
  }
}
