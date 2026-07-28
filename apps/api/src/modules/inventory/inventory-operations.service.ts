/* eslint-disable @typescript-eslint/no-explicit-any */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  inventoryAdjustmentSchema,
  inventoryConsumeSchema,
  inventoryCountLineSchema,
  inventoryCountSchema,
  inventoryVersionCommandSchema,
  retailReturnDecisionSchema,
} from "@nailsoft/validation";
import type { AccessClaims } from "../identity/auth.types.js";
import { lineTotalMinor, parseQuantity } from "./inventory-domain.js";
import { InventoryCoreService } from "./inventory-core.service.js";

@Injectable()
export class InventoryOperationsService {
  constructor(
    @Inject(InventoryCoreService) private readonly core: InventoryCoreService,
  ) {}
  ownMaterials(auth: AccessClaims) {
    this.core.access(auth);
    if (!auth.ownStaffId) this.core.notFound("STAFF_PROFILE_NOT_FOUND");
    return this.core.db
      .query<any>(
        `SELECT ss.id "serviceSessionId",ss.status,ss.branch_id "branchId",i.sku,i.name_json "itemName",rl.required_quantity::text "requiredQuantity",rl.reserved_quantity::text "reservedQuantity",rl.consumed_quantity::text "consumedQuantity",mr.status "reservationStatus",mr.version
      FROM service_session_staff_segments seg JOIN service_sessions ss ON ss.tenant_id=seg.tenant_id AND ss.id=seg.service_session_id
      LEFT JOIN service_material_reservations mr ON mr.tenant_id=ss.tenant_id AND mr.service_session_id=ss.id
      LEFT JOIN service_material_reservation_lines rl ON rl.tenant_id=mr.tenant_id AND rl.service_material_reservation_id=mr.id
      LEFT JOIN service_material_recipe_lines recipe ON recipe.tenant_id=rl.tenant_id AND recipe.id=rl.recipe_line_id
      LEFT JOIN inventory_items i ON i.tenant_id=recipe.tenant_id AND i.id=recipe.item_id
      WHERE seg.tenant_id=$1 AND seg.staff_id=$2 AND (seg.ended_at IS NULL OR seg.ended_at>=CURRENT_DATE) ORDER BY ss.scheduled_start_at,i.sku`,
        [auth.tenantId, auth.ownStaffId],
      )
      .then((r) => r.rows);
  }
  async reserveForServiceStart(
    c: PoolClient,
    auth: AccessClaims,
    sessionId: string,
    requestId: string,
  ) {
    const session = (
      await c.query<any>(
        `SELECT ss.*,ai.service_id FROM service_sessions ss
         JOIN appointment_items ai ON ai.tenant_id=ss.tenant_id AND ai.id=ss.appointment_item_id
         WHERE ss.tenant_id=$1 AND ss.id=$2 FOR UPDATE OF ss`,
        [auth.tenantId, sessionId],
      )
    ).rows[0];
    if (!session) this.core.notFound("SERVICE_SESSION_NOT_FOUND");
    const existing = (
      await c.query<any>(
        "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2",
        [auth.tenantId, sessionId],
      )
    ).rows[0];
    if (existing) {
      if (existing.status === "SHORTAGE")
        this.core.conflict("INVENTORY_SERVICE_MATERIAL_SHORTAGE");
      return existing;
    }
    const recipe = (
      await c.query<any>(
        `SELECT * FROM service_material_recipes WHERE tenant_id=$1 AND service_id=$2 AND status='ACTIVE'
         AND (branch_id=$3 OR branch_id IS NULL) ORDER BY branch_id NULLS LAST,recipe_version DESC LIMIT 1`,
        [auth.tenantId, session.service_id, session.branch_id],
      )
    ).rows[0];
    if (!recipe) return { serviceSessionId: sessionId, status: "NO_RECIPE" };
    const recipeLines = (
      await c.query<any>(
        `SELECT rl.*,COALESCE(bs.service_material_mode,'DISABLED') material_mode,
                COALESCE(bs.shortage_policy,'BLOCK_START') shortage_policy,
                COALESCE(rl.source_location_id,bs.default_location_id) configured_location_id
         FROM service_material_recipe_lines rl
         LEFT JOIN inventory_item_branch_settings bs ON bs.tenant_id=rl.tenant_id AND bs.branch_id=$3 AND bs.item_id=rl.item_id
         WHERE rl.tenant_id=$1 AND rl.recipe_id=$2 ORDER BY rl.item_id`,
        [auth.tenantId, recipe.id, session.branch_id],
      )
    ).rows;
    if (!recipeLines.some((line) => line.material_mode !== "DISABLED"))
      return { serviceSessionId: sessionId, status: "DISABLED" };
    const reservationId = randomUUID();
    await c.query(
      "INSERT INTO service_material_reservations(id,tenant_id,branch_id,service_session_id) VALUES($1,$2,$3,$4)",
      [reservationId, auth.tenantId, session.branch_id, sessionId],
    );
    for (const line of recipeLines) {
      if (line.material_mode === "DISABLED") continue;
      const requiredQuantity = String(line.base_quantity);
      const candidate = (
        await c.query<any>(
          `SELECT b.* FROM inventory_stock_balances b
           JOIN inventory_locations loc ON loc.tenant_id=b.tenant_id AND loc.id=b.location_id AND loc.status='ACTIVE'
           LEFT JOIN inventory_lots lot ON lot.tenant_id=b.tenant_id AND lot.id=b.lot_id
           WHERE b.tenant_id=$1 AND b.branch_id=$2 AND b.item_id=$3
             AND ($5::uuid IS NULL OR b.location_id=$5) AND loc.location_type NOT IN('QUARANTINE','DAMAGED','IN_TRANSIT')
             AND b.on_hand-b.reserved >= $4::numeric
             AND (lot.id IS NULL OR (lot.status='AVAILABLE' AND (lot.expiry_date IS NULL OR lot.expiry_date>=CURRENT_DATE)))
           ORDER BY CASE WHEN $6='FIFO' THEN lot.received_at END NULLS LAST,lot.expiry_date NULLS LAST,b.location_id
           LIMIT 1 FOR UPDATE OF b`,
          [
            auth.tenantId,
            session.branch_id,
            line.item_id,
            requiredQuantity,
            line.configured_location_id,
            line.selection_method,
          ],
        )
      ).rows[0];
      if (!candidate && line.required) {
        await this.core.evidence(
          c,
          auth,
          "inventory.service_shortage",
          "service_session",
          sessionId,
          requestId,
          session.branch_id,
          { itemId: line.item_id },
        );
        this.core.conflict("INVENTORY_SERVICE_MATERIAL_SHORTAGE");
      }
      const stockReservationId = candidate
        ? await this.core.reserve(c, auth, {
            branchId: session.branch_id,
            locationId: candidate.location_id,
            itemId: line.item_id,
            lotId: candidate.lot_id,
            quantity: requiredQuantity,
            type: "SERVICE",
            aggregateId: reservationId,
          })
        : null;
      await c.query(
        "INSERT INTO service_material_reservation_lines(tenant_id,service_material_reservation_id,recipe_line_id,inventory_reservation_id,required_quantity,reserved_quantity) VALUES($1,$2,$3,$4,$5,$6)",
        [
          auth.tenantId,
          reservationId,
          line.id,
          stockReservationId,
          requiredQuantity,
          stockReservationId ? requiredQuantity : "0",
        ],
      );
    }
    await this.core.evidence(
      c,
      auth,
      "inventory.service_reserved",
      "service_material_reservation",
      reservationId,
      requestId,
      session.branch_id,
    );
    return {
      id: reservationId,
      serviceSessionId: sessionId,
      status: "ACTIVE",
      version: 1,
    };
  }
  async consumeForServiceCompletion(
    c: PoolClient,
    auth: AccessClaims,
    sessionId: string,
    requestId: string,
  ) {
    const reservation = (
      await c.query<any>(
        "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2 FOR UPDATE",
        [auth.tenantId, sessionId],
      )
    ).rows[0];
    if (!reservation || reservation.status === "COMMITTED") return reservation;
    if (reservation.status !== "ACTIVE")
      this.core.conflict("INVENTORY_RESERVATION_STATUS_INVALID");
    const lines = (
      await c.query<any>(
        "SELECT * FROM service_material_reservation_lines WHERE tenant_id=$1 AND service_material_reservation_id=$2 ORDER BY id FOR UPDATE",
        [auth.tenantId, reservation.id],
      )
    ).rows;
    for (const line of lines) {
      const actual = String(line.actual_quantity ?? line.reserved_quantity);
      if (line.inventory_reservation_id) {
        const stockReservation = (
          await c.query<any>(
            "SELECT * FROM inventory_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, line.inventory_reservation_id],
          )
        ).rows[0];
        await this.core.releaseReservation(
          c,
          auth,
          line.inventory_reservation_id,
          parseQuantity(actual) ===
            parseQuantity(String(line.reserved_quantity))
            ? "COMMITTED"
            : "RELEASED",
        );
        if (
          parseQuantity(actual) !==
            parseQuantity(String(line.reserved_quantity)) &&
          parseQuantity(actual) > 0n
        )
          await this.core.move(c, auth, {
            branchId: stockReservation.branch_id,
            locationId: stockReservation.location_id,
            itemId: stockReservation.item_id,
            lotId: stockReservation.lot_id,
            quantityDelta: `-${actual}`,
            entryType: "SERVICE_CONSUMPTION",
            referenceType: "service_material_reservation_line",
            referenceId: line.id,
            requestId,
          });
      }
      await c.query(
        "UPDATE service_material_reservation_lines SET consumed_quantity=$3,actual_quantity=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, line.id, actual],
      );
    }
    await c.query(
      "UPDATE service_material_reservations SET status='COMMITTED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, reservation.id],
    );
    await this.core.evidence(
      c,
      auth,
      "inventory.service_consumed",
      "service_material_reservation",
      reservation.id,
      requestId,
      reservation.branch_id,
    );
    return { ...reservation, status: "COMMITTED" };
  }
  async releaseForServiceCancellation(
    c: PoolClient,
    auth: AccessClaims,
    sessionId: string,
    requestId: string,
  ) {
    const reservation = (
      await c.query<any>(
        "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2 FOR UPDATE",
        [auth.tenantId, sessionId],
      )
    ).rows[0];
    if (!reservation || reservation.status !== "ACTIVE") return reservation;
    const lines = (
      await c.query<any>(
        "SELECT inventory_reservation_id FROM service_material_reservation_lines WHERE tenant_id=$1 AND service_material_reservation_id=$2",
        [auth.tenantId, reservation.id],
      )
    ).rows;
    for (const line of lines)
      if (line.inventory_reservation_id)
        await this.core.releaseReservation(
          c,
          auth,
          line.inventory_reservation_id,
          "RELEASED",
        );
    await c.query(
      "UPDATE service_material_reservations SET status='RELEASED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, reservation.id],
    );
    await this.core.evidence(
      c,
      auth,
      "inventory.service_released",
      "service_material_reservation",
      reservation.id,
      requestId,
      reservation.branch_id,
    );
    return { ...reservation, status: "RELEASED" };
  }
  stock(
    auth: AccessClaims,
    branchId: string,
    locationId?: string,
    itemId?: string,
  ) {
    this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT b.id,b.branch_id "branchId",b.location_id "locationId",b.item_id "itemId",b.lot_id "lotId",i.sku,i.name_json "name",b.on_hand::text "onHand",b.reserved::text reserved,
          CASE WHEN loc.location_type IN('QUARANTINE','DAMAGED','IN_TRANSIT') OR (l.id IS NOT NULL AND (l.status<>'AVAILABLE' OR l.expiry_date<CURRENT_DATE)) THEN '0' ELSE (b.on_hand-b.reserved)::text END available,
          b.version::text version,l.expiry_date "expiryDate",l.status "lotStatus",loc.location_type "locationType"
         FROM inventory_stock_balances b JOIN inventory_items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id
         JOIN inventory_locations loc ON loc.tenant_id=b.tenant_id AND loc.id=b.location_id
         LEFT JOIN inventory_lots l ON l.tenant_id=b.tenant_id AND l.id=b.lot_id
         WHERE b.tenant_id=$1 AND b.branch_id=$2 ${locationId ? "AND b.location_id=$3" : ""} ${itemId ? `AND b.item_id=$${locationId ? 4 : 3}` : ""} ORDER BY i.sku,l.expiry_date NULLS LAST`,
        [
          auth.tenantId,
          branchId,
          ...(locationId ? [locationId] : []),
          ...(itemId ? [itemId] : []),
        ],
      )
      .then((r) => r.rows);
  }
  ledger(auth: AccessClaims, branchId: string, itemId?: string) {
    this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT id,branch_id "branchId",location_id "locationId",item_id "itemId",lot_id "lotId",entry_type "entryType",quantity_delta::text "quantityDelta",reference_type "referenceType",reference_id "referenceId",reason_code "reasonCode",occurred_at "occurredAt" FROM inventory_stock_ledger_entries WHERE tenant_id=$1 AND branch_id=$2 ${itemId ? "AND item_id=$3" : ""} ORDER BY occurred_at DESC,id DESC LIMIT 500`,
        itemId ? [auth.tenantId, branchId, itemId] : [auth.tenantId, branchId],
      )
      .then((r) => r.rows);
  }
  valuation(auth: AccessClaims, branchId: string) {
    this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        'SELECT branch_id "branchId",sum(on_hand)::text "onHand",round(sum(total_cost_minor))::bigint::text "totalCostMinor",now() "generatedAt" FROM inventory_stock_balances WHERE tenant_id=$1 AND branch_id=$2 GROUP BY branch_id',
        [auth.tenantId, branchId],
      )
      .then(
        (r) =>
          r.rows[0] ?? {
            branchId,
            onHand: "0",
            totalCostMinor: "0",
            generatedAt: new Date().toISOString(),
          },
      );
  }
  adjustments(auth: AccessClaims, branchId?: string) {
    this.core.access(auth);
    if (branchId) this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT * FROM inventory_adjustment_requests WHERE tenant_id=$1 ${branchId ? "AND branch_id=$2" : ""} ORDER BY created_at DESC`,
        branchId ? [auth.tenantId, branchId] : [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  createAdjustment(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryAdjustmentSchema.parse(input);
    this.core.branch(auth, b.branchId);
    return this.core.command(
      auth,
      "inventory.adjustment.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_adjustment_requests(id,tenant_id,branch_id,location_id,item_id,lot_id,quantity_delta,reason_code,note,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            id,
            auth.tenantId,
            b.branchId,
            b.locationId,
            b.itemId,
            b.lotId ?? null,
            b.quantityDelta,
            b.reasonCode,
            b.note,
            auth.userId,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.adjustment_requested",
          "inventory_adjustment",
          id,
          requestId,
          b.branchId,
          { quantityDelta: b.quantityDelta, reasonCode: b.reasonCode },
        );
        return { id, status: "PENDING", version: 1, ...b };
      },
    );
  }
  decideAdjustment(
    auth: AccessClaims,
    id: string,
    action: "APPROVED" | "REJECTED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      `inventory.adjustment.${action.toLowerCase()}`,
      key,
      { id, action, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM inventory_adjustment_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("INVENTORY_ADJUSTMENT_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (row.status !== "PENDING")
          this.core.conflict("INVENTORY_ADJUSTMENT_STATUS_INVALID");
        if (action === "APPROVED" && row.requested_by_user_id === auth.userId)
          this.core.conflict(
            "INVENTORY_ADJUSTMENT_DUAL_CONTROL_REQUIRED",
            "The requester cannot approve their own adjustment",
          );
        const status: string = action;
        await c.query(
          "UPDATE inventory_adjustment_requests SET status=$3,version=version+1,decided_by_user_id=$4,decided_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, status, auth.userId],
        );
        await this.core.evidence(
          c,
          auth,
          `inventory.adjustment_${status.toLowerCase()}`,
          "inventory_adjustment",
          id,
          requestId,
          row.branch_id,
          { reason: b.reason },
        );
        return { id, status, version: row.version + 1 };
      },
    );
  }
  postAdjustment(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.adjustment.post",
      key,
      { id, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM inventory_adjustment_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("INVENTORY_ADJUSTMENT_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (row.status !== "APPROVED")
          this.core.conflict("INVENTORY_ADJUSTMENT_STATUS_INVALID");
        await this.core.move(c, auth, {
          branchId: row.branch_id,
          locationId: row.location_id,
          itemId: row.item_id,
          lotId: row.lot_id,
          quantityDelta: String(row.quantity_delta),
          entryType:
            parseQuantity(String(row.quantity_delta)) > 0n
              ? "ADJUSTMENT_IN"
              : "ADJUSTMENT_OUT",
          referenceType: "inventory_adjustment",
          referenceId: id,
          reasonCode: row.reason_code,
          requestId,
        });
        await c.query(
          "UPDATE inventory_adjustment_requests SET status='POSTED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.adjustment_posted",
          "inventory_adjustment",
          id,
          requestId,
          row.branch_id,
          { reason: b.reason },
        );
        return { id, status: "POSTED", version: row.version + 1 };
      },
    );
  }
  counts(auth: AccessClaims, branchId?: string) {
    this.core.access(auth);
    if (branchId) this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT id,branch_id "branchId",location_id "locationId",status,blind,version,created_at "createdAt" FROM inventory_count_sessions WHERE tenant_id=$1 ${branchId ? "AND branch_id=$2" : ""} ORDER BY created_at DESC`,
        branchId ? [auth.tenantId, branchId] : [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  createCount(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryCountSchema.parse(input);
    this.core.branch(auth, b.branchId);
    return this.core.command(
      auth,
      "inventory.count.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_count_sessions(id,tenant_id,branch_id,location_id,blind,created_by_user_id) VALUES($1,$2,$3,$4,true,$5)",
          [id, auth.tenantId, b.branchId, b.locationId, auth.userId],
        );
        for (const item of b.items) {
          await c.query(
            "INSERT INTO inventory_count_lines(tenant_id,count_session_id,item_id,lot_id) VALUES($1,$2,$3,$4)",
            [auth.tenantId, id, item.itemId, item.lotId ?? null],
          );
        }
        await this.core.evidence(
          c,
          auth,
          "inventory.count_created",
          "inventory_count",
          id,
          requestId,
          b.branchId,
          { blind: true },
        );
        return { id, status: "DRAFT", blind: true, version: 1 };
      },
    );
  }
  async countDetail(auth: AccessClaims, id: string, canSeeExpected: boolean) {
    const row = (
      await this.core.db.query<any>(
        "SELECT * FROM inventory_count_sessions WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.core.notFound("INVENTORY_COUNT_NOT_FOUND");
    this.core.branch(auth, row.branch_id);
    const columns =
      canSeeExpected || !["DRAFT", "COUNTING"].includes(row.status)
        ? ',expected_quantity_snapshot::text "expectedQuantity",variance_quantity::text "varianceQuantity"'
        : "";
    const lines = (
      await this.core.db.query<any>(
        `SELECT id,item_id "itemId",lot_id "lotId",counted_quantity::text "countedQuantity",version ${columns} FROM inventory_count_lines WHERE tenant_id=$1 AND count_session_id=$2 ORDER BY item_id,lot_id`,
        [auth.tenantId, id],
      )
    ).rows;
    return {
      id: row.id,
      branchId: row.branch_id,
      locationId: row.location_id,
      status: row.status,
      blind: true,
      version: row.version,
      lines,
    };
  }
  countLine(
    auth: AccessClaims,
    countId: string,
    lineId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryCountLineSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.count.line",
      key,
      { countId, lineId, ...b },
      async (c) => {
        const session = (
          await c.query<any>(
            "SELECT * FROM inventory_count_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, countId],
          )
        ).rows[0];
        if (!session) this.core.notFound("INVENTORY_COUNT_NOT_FOUND");
        this.core.branch(auth, session.branch_id);
        if (session.status !== "COUNTING")
          this.core.conflict("INVENTORY_COUNT_STATUS_INVALID");
        const line = (
          await c.query<any>(
            "UPDATE inventory_count_lines SET counted_quantity=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND count_session_id=$2 AND id=$3 AND version=$5 RETURNING id,version",
            [auth.tenantId, countId, lineId, b.countedQuantity, b.version],
          )
        ).rows[0];
        if (!line) this.core.conflict("INVENTORY_VERSION_CONFLICT");
        await this.core.evidence(
          c,
          auth,
          "inventory.count_line_recorded",
          "inventory_count",
          countId,
          requestId,
          session.branch_id,
          { lineId },
        );
        return line;
      },
    );
  }
  countStatus(
    auth: AccessClaims,
    id: string,
    to:
      "COUNTING" | "SUBMITTED" | "REVIEW" | "APPROVED" | "POSTED" | "CANCELLED",
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      `inventory.count.${to.toLowerCase()}`,
      key,
      { id, to, ...b },
      async (c) => {
        const s = (
          await c.query<any>(
            "SELECT * FROM inventory_count_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!s) this.core.notFound("INVENTORY_COUNT_NOT_FOUND");
        this.core.branch(auth, s.branch_id);
        if (s.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        const allowed: any = {
          DRAFT: ["COUNTING", "CANCELLED"],
          COUNTING: ["REVIEW", "SUBMITTED", "CANCELLED"],
          SUBMITTED: ["APPROVED", "CANCELLED"],
          APPROVED: ["POSTED"],
          REVIEW: ["POSTED", "CANCELLED"],
        };
        if (!allowed[s.status]?.includes(to))
          this.core.conflict("INVENTORY_COUNT_STATUS_INVALID");
        if (to === "COUNTING") {
          await c.query(
            `UPDATE inventory_count_lines cl SET expected_quantity_snapshot=COALESCE((
               SELECT sum(bal.on_hand) FROM inventory_stock_balances bal
               WHERE bal.tenant_id=cl.tenant_id AND bal.branch_id=$3 AND bal.location_id=$4
                 AND bal.item_id=cl.item_id AND bal.lot_id IS NOT DISTINCT FROM cl.lot_id
             ),0),updated_at=now()
             WHERE cl.tenant_id=$1 AND cl.count_session_id=$2`,
            [auth.tenantId, id, s.branch_id, s.location_id],
          );
        }
        if (["SUBMITTED", "REVIEW"].includes(to)) {
          const missing = await c.query(
            "SELECT 1 FROM inventory_count_lines WHERE tenant_id=$1 AND count_session_id=$2 AND counted_quantity IS NULL LIMIT 1",
            [auth.tenantId, id],
          );
          if (missing.rowCount)
            this.core.conflict("INVENTORY_COUNT_INCOMPLETE");
          await c.query(
            `UPDATE inventory_count_lines cl SET
               expected_quantity_snapshot=COALESCE((SELECT sum(bal.on_hand) FROM inventory_stock_balances bal
                 WHERE bal.tenant_id=cl.tenant_id AND bal.branch_id=$3 AND bal.location_id=$4
                   AND bal.item_id=cl.item_id AND bal.lot_id IS NOT DISTINCT FROM cl.lot_id),0),
               variance_quantity=counted_quantity-COALESCE((SELECT sum(bal.on_hand) FROM inventory_stock_balances bal
                 WHERE bal.tenant_id=cl.tenant_id AND bal.branch_id=$3 AND bal.location_id=$4
                   AND bal.item_id=cl.item_id AND bal.lot_id IS NOT DISTINCT FROM cl.lot_id),0),updated_at=now()
             WHERE cl.tenant_id=$1 AND cl.count_session_id=$2`,
            [auth.tenantId, id, s.branch_id, s.location_id],
          );
        }
        if (to === "POSTED") {
          const lines = (
            await c.query<any>(
              "SELECT * FROM inventory_count_lines WHERE tenant_id=$1 AND count_session_id=$2 AND variance_quantity<>0 ORDER BY item_id,lot_id FOR UPDATE",
              [auth.tenantId, id],
            )
          ).rows;
          for (const l of lines)
            await this.core.move(c, auth, {
              branchId: s.branch_id,
              locationId: s.location_id,
              itemId: l.item_id,
              lotId: l.lot_id,
              quantityDelta: String(l.variance_quantity),
              entryType: "STOCKTAKE_VARIANCE",
              referenceType: "inventory_count_line",
              referenceId: l.id,
              reasonCode: "PHYSICAL_COUNT",
              requestId,
            });
        }
        await c.query(
          "UPDATE inventory_count_sessions SET status=$3,version=version+1,started_at=CASE WHEN $3='COUNTING' THEN now() ELSE started_at END,submitted_at=CASE WHEN $3 IN('SUBMITTED','REVIEW') THEN now() ELSE submitted_at END,posted_at=CASE WHEN $3='POSTED' THEN now() ELSE posted_at END,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, to],
        );
        await this.core.evidence(
          c,
          auth,
          `inventory.count_${to.toLowerCase()}`,
          "inventory_count",
          id,
          requestId,
          s.branch_id,
          { reason: b.reason },
        );
        return { id, status: to, version: s.version + 1 };
      },
    );
  }
  reserveService(
    auth: AccessClaims,
    sessionId: string,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "inventory.service.reserve",
      key,
      { sessionId },
      async (c) => {
        const session = (
          await c.query<any>(
            `SELECT ss.*,ai.service_id FROM service_sessions ss JOIN appointment_items ai ON ai.tenant_id=ss.tenant_id AND ai.id=ss.appointment_item_id WHERE ss.tenant_id=$1 AND ss.id=$2 FOR UPDATE OF ss`,
            [auth.tenantId, sessionId],
          )
        ).rows[0];
        if (!session) this.core.notFound("SERVICE_SESSION_NOT_FOUND");
        this.core.branch(auth, session.branch_id);
        const existing = (
          await c.query<any>(
            "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2",
            [auth.tenantId, sessionId],
          )
        ).rows[0];
        if (existing) return existing;
        const recipe = (
          await c.query<any>(
            "SELECT * FROM service_material_recipes WHERE tenant_id=$1 AND service_id=$2 AND status='ACTIVE' AND (branch_id=$3 OR branch_id IS NULL) ORDER BY branch_id NULLS LAST LIMIT 1",
            [auth.tenantId, session.service_id, session.branch_id],
          )
        ).rows[0];
        if (!recipe)
          return {
            serviceSessionId: sessionId,
            status: "NO_RECIPE",
            lines: [],
          };
        const materialMode = await c.query(
          `SELECT 1 FROM service_material_recipe_lines rl
           JOIN inventory_item_branch_settings bs ON bs.tenant_id=rl.tenant_id AND bs.item_id=rl.item_id AND bs.branch_id=$3
           WHERE rl.tenant_id=$1 AND rl.recipe_id=$2 AND bs.service_material_mode<>'DISABLED' LIMIT 1`,
          [auth.tenantId, recipe.id, session.branch_id],
        );
        if (!materialMode.rowCount)
          return { serviceSessionId: sessionId, status: "DISABLED", lines: [] };
        const id = randomUUID();
        await c.query(
          "INSERT INTO service_material_reservations(id,tenant_id,branch_id,service_session_id) VALUES($1,$2,$3,$4)",
          [id, auth.tenantId, session.branch_id, sessionId],
        );
        const recipeLines = (
          await c.query<any>(
            "SELECT * FROM service_material_recipe_lines WHERE tenant_id=$1 AND recipe_id=$2 ORDER BY item_id",
            [auth.tenantId, recipe.id],
          )
        ).rows;
        for (const line of recipeLines) {
          const candidate = (
            await c.query<any>(
              `SELECT b.* FROM inventory_stock_balances b LEFT JOIN inventory_lots l ON l.tenant_id=b.tenant_id AND l.id=b.lot_id WHERE b.tenant_id=$1 AND b.branch_id=$2 AND b.item_id=$3 AND b.on_hand-b.reserved >= $4::numeric AND (l.id IS NULL OR (l.status='AVAILABLE' AND (l.expiry_date IS NULL OR l.expiry_date>=CURRENT_DATE))) ORDER BY l.expiry_date NULLS LAST,b.location_id LIMIT 1 FOR UPDATE OF b`,
              [auth.tenantId, session.branch_id, line.item_id, line.quantity],
            )
          ).rows[0];
          let inventoryReservationId = null,
            reserved = "0";
          if (candidate) {
            inventoryReservationId = await this.core.reserve(c, auth, {
              branchId: session.branch_id,
              locationId: candidate.location_id,
              itemId: line.item_id,
              lotId: candidate.lot_id,
              quantity: String(line.quantity),
              type: "SERVICE",
              aggregateId: id,
            });
            reserved = String(line.quantity);
          }
          await c.query(
            "INSERT INTO service_material_reservation_lines(tenant_id,service_material_reservation_id,recipe_line_id,inventory_reservation_id,required_quantity,reserved_quantity) VALUES($1,$2,$3,$4,$5,$6)",
            [
              auth.tenantId,
              id,
              line.id,
              inventoryReservationId,
              line.quantity,
              reserved,
            ],
          );
        }
        const shortage = await c.query(
          "SELECT 1 FROM service_material_reservation_lines WHERE tenant_id=$1 AND service_material_reservation_id=$2 AND reserved_quantity<required_quantity LIMIT 1",
          [auth.tenantId, id],
        );
        if (shortage.rowCount)
          await c.query(
            "UPDATE service_material_reservations SET status='SHORTAGE',updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, id],
          );
        await this.core.evidence(
          c,
          auth,
          shortage.rowCount
            ? "inventory.service_shortage"
            : "inventory.service_reserved",
          "service_material_reservation",
          id,
          requestId,
          session.branch_id,
        );
        return {
          id,
          serviceSessionId: sessionId,
          status: shortage.rowCount ? "SHORTAGE" : "ACTIVE",
          version: 1,
        };
      },
    );
  }
  async serviceMaterials(auth: AccessClaims, sessionId: string) {
    this.core.access(auth);
    const session = (
      await this.core.db.query<any>(
        "SELECT branch_id FROM service_sessions WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, sessionId],
      )
    ).rows[0];
    if (!session) this.core.notFound("SERVICE_SESSION_NOT_FOUND");
    this.core.branch(auth, session.branch_id);
    if (auth.roles.includes("NAIL_TECHNICIAN")) {
      const assigned = await this.core.db.query(
        "SELECT 1 FROM service_session_staff_segments WHERE tenant_id=$1 AND service_session_id=$2 AND staff_id=$3 LIMIT 1",
        [auth.tenantId, sessionId, auth.ownStaffId ?? null],
      );
      if (!assigned.rowCount) this.core.notFound("SERVICE_SESSION_NOT_FOUND");
    }
    const reservation = (
      await this.core.db.query<any>(
        'SELECT id,status,version,branch_id "branchId",created_at "createdAt",updated_at "updatedAt" FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2',
        [auth.tenantId, sessionId],
      )
    ).rows[0];
    if (!reservation)
      return { serviceSessionId: sessionId, status: "NOT_RESERVED", lines: [] };
    const lines = (
      await this.core.db.query<any>(
        `SELECT l.id "reservationLineId",r.item_id "itemId",i.sku,i.name_json "itemName",l.required_quantity::text "requiredQuantity",l.reserved_quantity::text "reservedQuantity",l.actual_quantity::text "actualQuantity",l.consumed_quantity::text "consumedQuantity",l.override_reason "overrideReason",ir.location_id "locationId",ir.lot_id "lotId"
         FROM service_material_reservation_lines l JOIN service_material_recipe_lines r ON r.tenant_id=l.tenant_id AND r.id=l.recipe_line_id JOIN inventory_items i ON i.tenant_id=r.tenant_id AND i.id=r.item_id
         LEFT JOIN inventory_reservations ir ON ir.tenant_id=l.tenant_id AND ir.id=l.inventory_reservation_id
         WHERE l.tenant_id=$1 AND l.service_material_reservation_id=$2 ORDER BY i.sku`,
        [auth.tenantId, reservation.id],
      )
    ).rows;
    return { serviceSessionId: sessionId, ...reservation, lines };
  }
  recordActualUsage(
    auth: AccessClaims,
    sessionId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryConsumeSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.service.actual_usage",
      key,
      { sessionId, ...b },
      async (c) => {
        const reservation = (
          await c.query<any>(
            "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2 FOR UPDATE",
            [auth.tenantId, sessionId],
          )
        ).rows[0];
        if (!reservation)
          this.core.notFound("INVENTORY_SERVICE_RESERVATION_NOT_FOUND");
        this.core.branch(auth, reservation.branch_id);
        if (reservation.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (!["ACTIVE", "MANUAL_REVIEW"].includes(reservation.status))
          this.core.conflict("INVENTORY_RESERVATION_STATUS_INVALID");
        for (const actual of b.actualLines) {
          const line = (
            await c.query<any>(
              "SELECT reserved_quantity FROM service_material_reservation_lines WHERE tenant_id=$1 AND service_material_reservation_id=$2 AND id=$3 FOR UPDATE",
              [auth.tenantId, reservation.id, actual.reservationLineId],
            )
          ).rows[0];
          if (!line)
            this.core.notFound("INVENTORY_SERVICE_MATERIAL_LINE_NOT_FOUND");
          if (
            parseQuantity(actual.quantity) >
              parseQuantity(String(line.reserved_quantity)) &&
            !actual.overrideReason
          )
            this.core.conflict("INVENTORY_OVERRIDE_REASON_REQUIRED");
          const updated = await c.query(
            "UPDATE service_material_reservation_lines SET actual_quantity=$4,override_reason=$5,updated_at=now() WHERE tenant_id=$1 AND service_material_reservation_id=$2 AND id=$3 RETURNING id",
            [
              auth.tenantId,
              reservation.id,
              actual.reservationLineId,
              actual.quantity,
              actual.overrideReason ?? null,
            ],
          );
          if (!updated.rowCount)
            this.core.notFound("INVENTORY_SERVICE_MATERIAL_LINE_NOT_FOUND");
        }
        await c.query(
          "UPDATE service_material_reservations SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, reservation.id],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.service_actual_usage_recorded",
          "service_material_reservation",
          reservation.id,
          requestId,
          reservation.branch_id,
        );
        return {
          id: reservation.id,
          status: reservation.status,
          version: reservation.version + 1,
        };
      },
    );
  }
  overrideServiceShortage(
    auth: AccessClaims,
    sessionId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    if (!input?.version || !String(input?.reason ?? "").trim())
      this.core.conflict("INVENTORY_OVERRIDE_REASON_REQUIRED");
    return this.core.command(
      auth,
      "inventory.service.override_shortage",
      key,
      { sessionId, ...input },
      async (c) => {
        const reservation = (
          await c.query<any>(
            "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2 FOR UPDATE",
            [auth.tenantId, sessionId],
          )
        ).rows[0];
        if (!reservation)
          this.core.notFound("INVENTORY_SERVICE_RESERVATION_NOT_FOUND");
        this.core.branch(auth, reservation.branch_id);
        if (reservation.version !== input.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (reservation.status !== "SHORTAGE")
          this.core.conflict("INVENTORY_RESERVATION_STATUS_INVALID");
        await c.query(
          "UPDATE service_material_reservations SET status='MANUAL_REVIEW',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, reservation.id],
        );
        await c.query(
          "UPDATE service_material_reservation_lines SET override_reason=$3,updated_at=now() WHERE tenant_id=$1 AND service_material_reservation_id=$2 AND reserved_quantity<required_quantity",
          [auth.tenantId, reservation.id, String(input.reason).trim()],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.service_shortage_overridden",
          "service_material_reservation",
          reservation.id,
          requestId,
          reservation.branch_id,
          { reason: String(input.reason).trim() },
        );
        return {
          id: reservation.id,
          status: "MANUAL_REVIEW",
          version: reservation.version + 1,
        };
      },
    );
  }
  consumeService(
    auth: AccessClaims,
    sessionId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryConsumeSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.service.consume",
      key,
      { sessionId, ...b },
      async (c) => {
        const r = (
          await c.query<any>(
            "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2 FOR UPDATE",
            [auth.tenantId, sessionId],
          )
        ).rows[0];
        if (!r) this.core.notFound("INVENTORY_SERVICE_RESERVATION_NOT_FOUND");
        this.core.branch(auth, r.branch_id);
        if (r.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (!["ACTIVE", "MANUAL_REVIEW"].includes(r.status))
          this.core.conflict("INVENTORY_RESERVATION_STATUS_INVALID");
        const lines = (
          await c.query<any>(
            "SELECT * FROM service_material_reservation_lines WHERE tenant_id=$1 AND service_material_reservation_id=$2 ORDER BY id FOR UPDATE",
            [auth.tenantId, r.id],
          )
        ).rows;
        for (const line of lines) {
          const actual = b.actualLines.find(
            (x) => x.reservationLineId === line.id,
          );
          if (
            actual &&
            parseQuantity(actual.quantity) >
              parseQuantity(String(line.reserved_quantity)) &&
            !actual.overrideReason
          )
            this.core.conflict("INVENTORY_OVERRIDE_REASON_REQUIRED");
          const quantity = String(
            actual?.quantity ?? line.actual_quantity ?? line.reserved_quantity,
          );
          if (line.inventory_reservation_id) {
            const stockReservation = (
              await c.query<any>(
                "SELECT * FROM inventory_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, line.inventory_reservation_id],
              )
            ).rows[0];
            await this.core.releaseReservation(
              c,
              auth,
              line.inventory_reservation_id,
              parseQuantity(quantity) ===
                parseQuantity(String(line.reserved_quantity))
                ? "COMMITTED"
                : "RELEASED",
            );
            if (
              parseQuantity(quantity) !==
                parseQuantity(String(line.reserved_quantity)) &&
              parseQuantity(quantity) > 0n
            )
              await this.core.move(c, auth, {
                branchId: stockReservation.branch_id,
                locationId: stockReservation.location_id,
                itemId: stockReservation.item_id,
                lotId: stockReservation.lot_id,
                quantityDelta: `-${quantity}`,
                entryType: "SERVICE_CONSUMPTION",
                referenceType: "service_material_reservation_line",
                referenceId: line.id,
                requestId,
              });
          }
          await c.query(
            "UPDATE service_material_reservation_lines SET consumed_quantity=$3,actual_quantity=$3,override_reason=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [auth.tenantId, line.id, quantity, actual?.overrideReason ?? null],
          );
        }
        await c.query(
          "UPDATE service_material_reservations SET status='COMMITTED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, r.id],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.service_consumed",
          "service_material_reservation",
          r.id,
          requestId,
          r.branch_id,
        );
        return { id: r.id, status: "COMMITTED", version: r.version + 1 };
      },
    );
  }
  releaseService(
    auth: AccessClaims,
    sessionId: string,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "inventory.service.release",
      key,
      { sessionId },
      async (c) => {
        const r = (
          await c.query<any>(
            "SELECT * FROM service_material_reservations WHERE tenant_id=$1 AND service_session_id=$2 FOR UPDATE",
            [auth.tenantId, sessionId],
          )
        ).rows[0];
        if (!r) this.core.notFound("INVENTORY_SERVICE_RESERVATION_NOT_FOUND");
        this.core.branch(auth, r.branch_id);
        const lines = (
          await c.query<any>(
            "SELECT inventory_reservation_id FROM service_material_reservation_lines WHERE tenant_id=$1 AND service_material_reservation_id=$2",
            [auth.tenantId, r.id],
          )
        ).rows;
        for (const l of lines)
          if (l.inventory_reservation_id)
            await this.core.releaseReservation(
              c,
              auth,
              l.inventory_reservation_id,
              "RELEASED",
            );
        await c.query(
          "UPDATE service_material_reservations SET status='RELEASED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, r.id],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.service_released",
          "service_material_reservation",
          r.id,
          requestId,
          r.branch_id,
        );
        return { id: r.id, status: "RELEASED" };
      },
    );
  }
  addProduct(
    auth: AccessClaims,
    orderId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const b = input as any;
    if (!b.itemId || !b.locationId || !b.quantity || !b.version)
      this.core.conflict("INVENTORY_VALIDATION_FAILED");
    return this.core.command(
      auth,
      "inventory.pos_product.add",
      key,
      { orderId, ...b },
      async (c) => {
        const order = (
          await c.query<any>(
            "SELECT * FROM pos_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, orderId],
          )
        ).rows[0];
        if (!order) this.core.notFound("POS_ORDER_NOT_FOUND");
        this.core.branch(auth, order.branch_id);
        if (order.version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (order.status !== "DRAFT" || order.pricing_locked_at)
          this.core.conflict("POS_PRICING_LOCKED");
        const item = (
          await c.query<any>(
            "SELECT * FROM inventory_items WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' AND item_type IN('RETAIL','BOTH')",
            [auth.tenantId, b.itemId],
          )
        ).rows[0];
        if (!item) this.core.notFound("INVENTORY_ITEM_NOT_FOUND");
        const reservationId = await this.core.reserve(c, auth, {
          branchId: order.branch_id,
          locationId: b.locationId,
          itemId: item.id,
          lotId: b.lotId ?? null,
          quantity: String(b.quantity),
          type: "POS_PRODUCT",
          aggregateId: orderId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
        const lineNo = (
            await c.query<any>(
              "SELECT COALESCE(max(line_no),0)+1 value FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2",
              [auth.tenantId, orderId],
            )
          ).rows[0].value,
          unit = String(item.retail_price_minor ?? 0),
          gross = lineTotalMinor(String(b.quantity), unit),
          lineId = randomUUID();
        await c.query(
          `INSERT INTO pos_order_lines(id,tenant_id,pos_order_id,line_no,line_type,inventory_item_id,inventory_reservation_id,description_snapshot_json,quantity,unit_price_minor,gross_minor,taxable_minor,net_minor,source_snapshot_json) VALUES($1,$2,$3,$4,'PRODUCT',$5,$6,$7,$8,$9,$10,$10,$10,$11)`,
          [
            lineId,
            auth.tenantId,
            orderId,
            lineNo,
            item.id,
            reservationId,
            JSON.stringify({ sku: item.sku, name: item.name_json }),
            b.quantity,
            unit,
            gross,
            JSON.stringify({ inventoryItemId: item.id }),
          ],
        );
        await c.query(
          "UPDATE pos_orders SET subtotal_minor=subtotal_minor+$3::bigint,taxable_minor=taxable_minor+$3::bigint,total_minor=total_minor+$3::bigint,amount_due_minor=amount_due_minor+$3::bigint,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, orderId, gross],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.product_reserved",
          "pos_order",
          orderId,
          requestId,
          order.branch_id,
          { lineId, itemId: item.id },
        );
        return {
          lineId,
          reservationId,
          grossMinor: gross,
          version: order.version + 1,
        };
      },
    );
  }
  updateProduct(
    auth: AccessClaims,
    orderId: string,
    lineId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const b = input as any;
    if (!b.quantity || !b.version)
      this.core.conflict("INVENTORY_VALIDATION_FAILED");
    return this.core.command(
      auth,
      "inventory.pos_product.update",
      key,
      { orderId, lineId, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            `SELECT o.branch_id,o.status order_status,o.pricing_locked_at,o.version order_version,
                    l.*,r.location_id,r.lot_id
             FROM pos_orders o JOIN pos_order_lines l ON l.tenant_id=o.tenant_id AND l.pos_order_id=o.id
             JOIN inventory_reservations r ON r.tenant_id=l.tenant_id AND r.id=l.inventory_reservation_id
             WHERE o.tenant_id=$1 AND o.id=$2 AND l.id=$3 AND l.line_type='PRODUCT' AND l.status='ACTIVE'
             FOR UPDATE OF o,l,r`,
            [auth.tenantId, orderId, lineId],
          )
        ).rows[0];
        if (!row) this.core.notFound("POS_PRODUCT_LINE_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.order_version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (row.order_status !== "DRAFT" || row.pricing_locked_at)
          this.core.conflict("POS_PRICING_LOCKED");
        await this.core.releaseReservation(
          c,
          auth,
          row.inventory_reservation_id,
          "RELEASED",
        );
        const reservationId = await this.core.reserve(c, auth, {
          branchId: row.branch_id,
          locationId: b.locationId ?? row.location_id,
          itemId: row.inventory_item_id,
          lotId: b.lotId ?? row.lot_id,
          quantity: String(b.quantity),
          type: "POS_PRODUCT",
          aggregateId: orderId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
        const gross = lineTotalMinor(
          String(b.quantity),
          String(row.unit_price_minor),
        );
        const delta = BigInt(gross) - BigInt(row.gross_minor);
        await c.query(
          "UPDATE pos_order_lines SET inventory_reservation_id=$4,quantity=$5,gross_minor=$6,taxable_minor=$6,net_minor=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND pos_order_id=$2 AND id=$3",
          [auth.tenantId, orderId, lineId, reservationId, b.quantity, gross],
        );
        await c.query(
          "UPDATE pos_orders SET subtotal_minor=subtotal_minor+$3::bigint,taxable_minor=taxable_minor+$3::bigint,total_minor=total_minor+$3::bigint,amount_due_minor=amount_due_minor+$3::bigint,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, orderId, delta.toString()],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.product_reservation_updated",
          "pos_order",
          orderId,
          requestId,
          row.branch_id,
          { lineId },
        );
        return {
          lineId,
          reservationId,
          grossMinor: gross,
          version: row.order_version + 1,
        };
      },
    );
  }
  removeProduct(
    auth: AccessClaims,
    orderId: string,
    lineId: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryVersionCommandSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.pos_product.remove",
      key,
      { orderId, lineId, ...b },
      async (c) => {
        const row = (
          await c.query<any>(
            `SELECT o.branch_id,o.status order_status,o.pricing_locked_at,o.version order_version,l.*
             FROM pos_orders o JOIN pos_order_lines l ON l.tenant_id=o.tenant_id AND l.pos_order_id=o.id
             WHERE o.tenant_id=$1 AND o.id=$2 AND l.id=$3 AND l.line_type='PRODUCT' AND l.status='ACTIVE' FOR UPDATE OF o,l`,
            [auth.tenantId, orderId, lineId],
          )
        ).rows[0];
        if (!row) this.core.notFound("POS_PRODUCT_LINE_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.order_version !== b.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (row.order_status !== "DRAFT" || row.pricing_locked_at)
          this.core.conflict("POS_PRICING_LOCKED");
        await this.core.releaseReservation(
          c,
          auth,
          row.inventory_reservation_id,
          "RELEASED",
        );
        await c.query(
          "UPDATE pos_order_lines SET status='VOIDED',void_reason=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND pos_order_id=$2 AND id=$3",
          [auth.tenantId, orderId, lineId, b.reason ?? "PRODUCT_REMOVED"],
        );
        await c.query(
          "UPDATE pos_orders SET subtotal_minor=subtotal_minor-$3::bigint,taxable_minor=taxable_minor-$3::bigint,total_minor=total_minor-$3::bigint,amount_due_minor=amount_due_minor-$3::bigint,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, orderId, String(row.gross_minor)],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.product_reservation_released",
          "pos_order",
          orderId,
          requestId,
          row.branch_id,
          { lineId },
        );
        return { lineId, status: "VOIDED", version: row.order_version + 1 };
      },
    );
  }
  async commitOrderProducts(
    c: PoolClient,
    auth: AccessClaims,
    orderId: string,
  ) {
    const rows = (
      await c.query<any>(
        "SELECT inventory_reservation_id FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND line_type='PRODUCT' AND status='ACTIVE' AND inventory_reservation_id IS NOT NULL",
        [auth.tenantId, orderId],
      )
    ).rows;
    for (const row of rows)
      await this.core.releaseReservation(
        c,
        auth,
        row.inventory_reservation_id,
        "COMMITTED",
      );
  }
  async releaseOrderProducts(
    c: PoolClient,
    auth: AccessClaims,
    orderId: string,
  ) {
    const rows = (
      await c.query<any>(
        "SELECT inventory_reservation_id FROM pos_order_lines WHERE tenant_id=$1 AND pos_order_id=$2 AND line_type='PRODUCT' AND status='ACTIVE' AND inventory_reservation_id IS NOT NULL",
        [auth.tenantId, orderId],
      )
    ).rows;
    for (const row of rows)
      await this.core.releaseReservation(
        c,
        auth,
        row.inventory_reservation_id,
        "RELEASED",
      );
  }
  inspectReturn(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = retailReturnDecisionSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.return.inspect",
      key,
      b,
      async (c) => {
        const item = (
          await c.query<any>(
            `SELECT ri.*,r.branch_id,pol.inventory_item_id,pol.inventory_reservation_id
             FROM refund_items ri JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id
             JOIN invoice_lines il ON il.tenant_id=ri.tenant_id AND il.id=ri.invoice_line_id
             JOIN pos_order_lines pol ON pol.tenant_id=il.tenant_id AND pol.id=il.source_order_line_id
             WHERE ri.tenant_id=$1 AND ri.id=$2 AND r.status='COMPLETED' AND pol.line_type='PRODUCT' FOR UPDATE OF ri`,
            [auth.tenantId, b.refundItemId],
          )
        ).rows[0];
        if (!item) this.core.notFound("REFUND_ITEM_NOT_FOUND");
        this.core.branch(auth, item.branch_id);
        if (item.inventory_item_id !== b.inventoryItemId)
          this.core.conflict("INVENTORY_RETURN_ITEM_MISMATCH");
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_return_decisions(id,tenant_id,refund_item_id,inventory_item_id,disposition,quantity,branch_id,location_id,lot_id,inspected_by_user_id,reason_code,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            id,
            auth.tenantId,
            b.refundItemId,
            b.inventoryItemId,
            b.disposition,
            b.quantity,
            item.branch_id,
            b.locationId ?? null,
            b.lotId ?? null,
            auth.userId,
            b.reasonCode,
            b.note ?? null,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.return_inspected",
          "inventory_return_decision",
          id,
          requestId,
          item.branch_id,
          { disposition: b.disposition },
        );
        return { id, ...b, status: "INSPECTED" };
      },
    );
  }
  postReturn(auth: AccessClaims, id: string, key: string, requestId: string) {
    return this.core.command(
      auth,
      "inventory.return.post",
      key,
      { id },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM inventory_return_decisions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("INVENTORY_RETURN_DECISION_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        if (row.status !== "INSPECTED")
          this.core.conflict("INVENTORY_RETURN_ALREADY_POSTED");
        const movementByDisposition: Record<
          string,
          { type: string; locations: string[] }
        > = {
          RESTOCK: {
            type: "POS_RETURN_RESTOCK",
            locations: ["RETAIL", "RETAIL_FLOOR", "STOCKROOM"],
          },
          QUARANTINE: {
            type: "POS_RETURN_QUARANTINE",
            locations: ["QUARANTINE"],
          },
          DAMAGED: { type: "POS_RETURN_DISCARD", locations: ["DAMAGED"] },
        };
        const movement = movementByDisposition[String(row.disposition)];
        if (movement) {
          if (!row.location_id)
            this.core.conflict("INVENTORY_RETURN_LOCATION_REQUIRED");
          const location = (
            await c.query<any>(
              "SELECT location_type FROM inventory_locations WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='ACTIVE'",
              [auth.tenantId, row.branch_id, row.location_id],
            )
          ).rows[0];
          if (!location || !movement.locations.includes(location.location_type))
            this.core.conflict("INVENTORY_RETURN_LOCATION_INVALID");
          await this.core.move(c, auth, {
            branchId: row.branch_id,
            locationId: row.location_id,
            itemId: row.inventory_item_id,
            lotId: row.lot_id,
            quantityDelta: String(row.quantity),
            entryType: movement.type,
            referenceType: "inventory_return_decision",
            referenceId: id,
            reasonCode: row.reason_code,
            requestId,
          });
        }
        await c.query(
          "UPDATE inventory_return_decisions SET status='POSTED',posted_by_user_id=$3,posted_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, auth.userId],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.return_posted",
          "inventory_return_decision",
          id,
          requestId,
          row.branch_id,
          { disposition: row.disposition },
        );
        return { id, status: "POSTED", disposition: row.disposition };
      },
    );
  }
  alerts(auth: AccessClaims, branchId?: string) {
    this.core.access(auth);
    if (branchId) this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT id,branch_id "branchId",item_id "itemId",lot_id "lotId",alert_type "alertType",status,details_json "details",detected_at "detectedAt" FROM inventory_alerts WHERE tenant_id=$1 ${branchId ? "AND branch_id=$2" : ""} ORDER BY detected_at DESC`,
        branchId ? [auth.tenantId, branchId] : [auth.tenantId],
      )
      .then((r) => r.rows);
  }
  acknowledgeAlert(
    auth: AccessClaims,
    id: string,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "inventory.alert.acknowledge",
      key,
      { id },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE inventory_alerts SET status='ACKNOWLEDGED',acknowledged_by_user_id=$3,acknowledged_at=now() WHERE tenant_id=$1 AND id=$2 AND status='OPEN' RETURNING *",
            [auth.tenantId, id, auth.userId],
          )
        ).rows[0];
        if (!row) this.core.notFound("INVENTORY_ALERT_NOT_FOUND");
        this.core.branch(auth, row.branch_id);
        await this.core.evidence(
          c,
          auth,
          "inventory.alert_acknowledged",
          "inventory_alert",
          id,
          requestId,
          row.branch_id,
        );
        return row;
      },
    );
  }
  export(auth: AccessClaims, input: any, key: string, requestId: string) {
    const b = input as any;
    return this.core.command(
      auth,
      "inventory.export.create",
      key,
      b,
      async (c) => {
        if (
          !["STOCK", "LEDGER", "VALUATION", "PURCHASES", "VARIANCES"].includes(
            b.exportType,
          )
        )
          this.core.conflict("INVENTORY_EXPORT_INVALID");
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_export_jobs(id,tenant_id,export_type,filters_json,requested_by_user_id) VALUES($1,$2,$3,$4,$5)",
          [
            id,
            auth.tenantId,
            b.exportType,
            JSON.stringify(b.filters ?? {}),
            auth.userId,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.export_requested",
          "inventory_export",
          id,
          requestId,
        );
        return { id, status: "PENDING" };
      },
    );
  }
}
