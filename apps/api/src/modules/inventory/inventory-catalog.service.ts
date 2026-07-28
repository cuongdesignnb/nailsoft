/* eslint-disable @typescript-eslint/no-explicit-any */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  inventoryItemSchema,
  inventoryLocationSchema,
  inventorySupplierSchema,
  serviceMaterialRecipeSchema,
} from "@nailsoft/validation";
import type { AccessClaims } from "../identity/auth.types.js";
import { InventoryCoreService } from "./inventory-core.service.js";

@Injectable()
export class InventoryCatalogService {
  constructor(
    @Inject(InventoryCoreService) private readonly core: InventoryCoreService,
  ) {}
  list(
    auth: AccessClaims,
    resource:
      "uoms" | "categories" | "items" | "locations" | "suppliers" | "recipes",
    branchId?: string,
  ) {
    this.core.access(auth);
    const map = {
      uoms: "inventory_uoms",
      categories: "inventory_categories",
      items: "inventory_items",
      locations: "inventory_locations",
      suppliers: "inventory_suppliers",
      recipes: "service_material_recipes",
    } as const;
    if (branchId) this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT * FROM ${map[resource]} WHERE tenant_id=$1 ${branchId && ["locations", "recipes"].includes(resource) ? "AND (branch_id=$2 OR branch_id IS NULL)" : ""} ORDER BY created_at DESC`,
        branchId && ["locations", "recipes"].includes(resource)
          ? [auth.tenantId, branchId]
          : [auth.tenantId],
      )
      .then((r) =>
        r.rows.map((row) => {
          const view = this.view(row);
          if (
            resource === "suppliers" &&
            !auth.roles.some((role) =>
              ["SALON_OWNER", "BRANCH_MANAGER"].includes(role),
            )
          )
            delete view.contactJson;
          return view;
        }),
      );
  }
  async item(auth: AccessClaims, id: string) {
    this.core.access(auth);
    const row = (
      await this.core.db.query<any>(
        "SELECT i.*,COALESCE(jsonb_agg(b.barcode) FILTER(WHERE b.id IS NOT NULL),'[]') barcodes FROM inventory_items i LEFT JOIN inventory_item_barcodes b ON b.tenant_id=i.tenant_id AND b.item_id=i.id WHERE i.tenant_id=$1 AND i.id=$2 GROUP BY i.id",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.core.notFound("INVENTORY_ITEM_NOT_FOUND");
    return this.view(row);
  }
  async supplier(auth: AccessClaims, id: string) {
    this.core.access(auth);
    const row = (
      await this.core.db.query<any>(
        "SELECT * FROM inventory_suppliers WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row) this.core.notFound("INVENTORY_SUPPLIER_NOT_FOUND");
    const result = this.view(row);
    if (
      !auth.roles.some((role) =>
        ["SALON_OWNER", "BRANCH_MANAGER"].includes(role),
      )
    )
      delete result.contactJson;
    result.items = (
      await this.core.db.query<any>(
        `SELECT si.id,si.item_id "itemId",si.supplier_sku "supplierSku",si.purchase_uom_id "purchaseUomId",
                si.minimum_order_quantity::text "minimumOrderQuantity",si.lead_time_days "leadTimeDays",si.preferred
         FROM inventory_supplier_items si WHERE si.tenant_id=$1 AND si.supplier_id=$2 ORDER BY si.created_at`,
        [auth.tenantId, id],
      )
    ).rows;
    return result;
  }
  lots(auth: AccessClaims, branchId: string, itemId?: string) {
    this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT id,branch_id "branchId",item_id "itemId",lot_code "lotCode",expiry_date "expiryDate",status,version
         FROM inventory_lots WHERE tenant_id=$1 AND branch_id=$2 ${itemId ? "AND item_id=$3" : ""}
         ORDER BY expiry_date NULLS LAST,lot_code`,
        itemId ? [auth.tenantId, branchId, itemId] : [auth.tenantId, branchId],
      )
      .then((r) => r.rows);
  }
  availability(auth: AccessClaims, itemId: string, branchId: string) {
    this.core.branch(auth, branchId);
    return this.core.db
      .query<any>(
        `SELECT $2::uuid "itemId",$3::uuid "branchId",
                COALESCE(sum(b.on_hand) FILTER(WHERE loc.location_type NOT IN('QUARANTINE','DAMAGED','IN_TRANSIT') AND (lot.id IS NULL OR (lot.status='AVAILABLE' AND (lot.expiry_date IS NULL OR lot.expiry_date>=CURRENT_DATE)))),0)::text "onHand",
                COALESCE(sum(b.reserved) FILTER(WHERE loc.location_type NOT IN('QUARANTINE','DAMAGED','IN_TRANSIT') AND (lot.id IS NULL OR (lot.status='AVAILABLE' AND (lot.expiry_date IS NULL OR lot.expiry_date>=CURRENT_DATE)))),0)::text reserved,
                COALESCE(sum(b.on_hand-b.reserved) FILTER(WHERE loc.location_type NOT IN('QUARANTINE','DAMAGED','IN_TRANSIT') AND (lot.id IS NULL OR (lot.status='AVAILABLE' AND (lot.expiry_date IS NULL OR lot.expiry_date>=CURRENT_DATE)))),0)::text available,
                now() "generatedAt"
         FROM inventory_items i LEFT JOIN inventory_stock_balances b ON b.tenant_id=i.tenant_id AND b.item_id=i.id AND b.branch_id=$3
         LEFT JOIN inventory_locations loc ON loc.tenant_id=b.tenant_id AND loc.id=b.location_id
         LEFT JOIN inventory_lots lot ON lot.tenant_id=b.tenant_id AND lot.id=b.lot_id
         WHERE i.tenant_id=$1 AND i.id=$2 GROUP BY i.id`,
        [auth.tenantId, itemId, branchId],
      )
      .then((r) => {
        if (!r.rows[0]) this.core.notFound("INVENTORY_ITEM_NOT_FOUND");
        return r.rows[0];
      });
  }
  createUom(auth: AccessClaims, input: any, key: string, requestId: string) {
    const b = input as any;
    if (
      !b.code ||
      !b.name ||
      !["COUNT", "MASS", "WEIGHT", "VOLUME", "LENGTH"].includes(b.category)
    )
      this.core.conflict("INVENTORY_VALIDATION_FAILED");
    return this.core.command(
      auth,
      "inventory.uom.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_uoms(id,tenant_id,code,name_json,category,precision_scale) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            auth.tenantId,
            String(b.code).trim(),
            JSON.stringify(b.name),
            b.category,
            b.precisionScale ?? 3,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.uom_created",
          "inventory_uom",
          id,
          requestId,
        );
        return { id, ...b };
      },
    );
  }
  createConversion(
    auth: AccessClaims,
    input: any,
    key: string,
    requestId: string,
  ) {
    const b = input as any;
    if (
      !b.fromUomId ||
      !b.toUomId ||
      BigInt(b.numerator ?? 0) <= 0n ||
      BigInt(b.denominator ?? 0) <= 0n
    )
      this.core.conflict("INVENTORY_UOM_CONVERSION_INVALID");
    return this.core.command(
      auth,
      "inventory.uom_conversion.create",
      key,
      b,
      async (c) => {
        const cats = await c.query<any>(
          "SELECT id,category FROM inventory_uoms WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
          [auth.tenantId, [b.fromUomId, b.toUomId]],
        );
        if (
          cats.rowCount !== 2 ||
          cats.rows[0].category !== cats.rows[1].category
        )
          this.core.conflict("INVENTORY_UOM_CATEGORY_MISMATCH");
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_uom_conversions(id,tenant_id,from_uom_id,to_uom_id,numerator,denominator) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            auth.tenantId,
            b.fromUomId,
            b.toUomId,
            String(b.numerator),
            String(b.denominator),
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.uom_conversion_created",
          "inventory_uom_conversion",
          id,
          requestId,
        );
        return { id, ...b };
      },
    );
  }
  async createItemConversion(
    auth: AccessClaims,
    itemId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const item = await this.item(auth, itemId);
    const b = { ...input };
    if (b.fromUomId !== item.baseUomId && b.toUomId !== item.baseUomId)
      this.core.conflict("INVENTORY_UOM_CONVERSION_ITEM_MISMATCH");
    return this.createConversion(auth, b, key, requestId);
  }
  createCategory(
    auth: AccessClaims,
    input: any,
    key: string,
    requestId: string,
  ) {
    const b = input as any;
    if (!b.code || !b.name) this.core.conflict("INVENTORY_VALIDATION_FAILED");
    return this.core.command(
      auth,
      "inventory.category.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_categories(id,tenant_id,parent_id,code,name_json,sort_order) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            auth.tenantId,
            b.parentId ?? null,
            b.code,
            JSON.stringify(b.name),
            b.sortOrder ?? 0,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.category_created",
          "inventory_category",
          id,
          requestId,
        );
        return { id, ...b, status: "ACTIVE", version: 1 };
      },
    );
  }
  createItem(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryItemSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.item.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_items(id,tenant_id,category_id,base_uom_id,sku,name_json,item_type,track_lot,track_expiry,quantity_precision,currency,retail_price_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            id,
            auth.tenantId,
            b.categoryId ?? null,
            b.baseUomId,
            b.sku,
            JSON.stringify(b.name),
            b.itemType,
            b.trackLot,
            b.trackExpiry,
            b.quantityPrecision,
            b.currency,
            b.retailPriceMinor ?? null,
          ],
        );
        for (const barcode of b.barcodes)
          await c.query(
            "INSERT INTO inventory_item_barcodes(tenant_id,item_id,barcode) VALUES($1,$2,$3)",
            [auth.tenantId, id, barcode],
          );
        await this.core.evidence(
          c,
          auth,
          "inventory.item_created",
          "inventory_item",
          id,
          requestId,
        );
        return this.itemTx(c, auth, id);
      },
    );
  }
  archiveItem(
    auth: AccessClaims,
    id: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      "inventory.item.archive",
      key,
      { id, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE inventory_items SET status='ARCHIVED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [auth.tenantId, id, input.version],
          )
        ).rows[0];
        if (!row) this.core.conflict("INVENTORY_VERSION_CONFLICT");
        await this.core.evidence(
          c,
          auth,
          "inventory.item_archived",
          "inventory_item",
          id,
          requestId,
        );
        return this.view(row);
      },
    );
  }
  setItemStatus(
    auth: AccessClaims,
    id: string,
    to: "ACTIVE" | "ARCHIVED",
    input: any,
    key: string,
    requestId: string,
    action: string,
  ) {
    return this.core.command(
      auth,
      `inventory.item.${action}`,
      key,
      { id, to, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "UPDATE inventory_items SET status=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [auth.tenantId, id, input.version, to],
          )
        ).rows[0];
        if (!row) this.core.conflict("INVENTORY_VERSION_CONFLICT");
        await this.core.evidence(
          c,
          auth,
          `inventory.item_${action}`,
          "inventory_item",
          id,
          requestId,
        );
        return this.view(row);
      },
    );
  }
  createLocation(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventoryLocationSchema.parse(input);
    this.core.branch(auth, b.branchId);
    return this.core.command(
      auth,
      "inventory.location.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_locations(id,tenant_id,branch_id,code,name,location_type) VALUES($1,$2,$3,$4,$5,$6)",
          [id, auth.tenantId, b.branchId, b.code, b.name, b.locationType],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.location_created",
          "inventory_location",
          id,
          requestId,
          b.branchId,
        );
        return { id, ...b, status: "ACTIVE", version: 1 };
      },
    );
  }
  createSupplier(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = inventorySupplierSchema.parse(input);
    return this.core.command(
      auth,
      "inventory.supplier.create",
      key,
      { ...b, contact: "[REDACTED]" },
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO inventory_suppliers(id,tenant_id,code,name,legal_name,contact_json,lead_time_days,payment_terms,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            id,
            auth.tenantId,
            b.code,
            b.name,
            b.legalName ?? null,
            JSON.stringify(b.contact),
            b.leadTimeDays,
            b.paymentTerms ?? null,
            b.notes ?? null,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.supplier_created",
          "inventory_supplier",
          id,
          requestId,
        );
        return { id, code: b.code, name: b.name, status: "ACTIVE", version: 1 };
      },
    );
  }
  addSupplierItem(
    auth: AccessClaims,
    supplierId: string,
    input: any,
    key: string,
    requestId: string,
  ) {
    const b = input as any;
    if (!b.itemId || !b.purchaseUomId)
      this.core.conflict("INVENTORY_VALIDATION_FAILED");
    return this.core.command(
      auth,
      "inventory.supplier_item.create",
      key,
      { supplierId, ...b },
      async (c) => {
        const id = randomUUID();
        await c.query(
          `INSERT INTO inventory_supplier_items(id,tenant_id,supplier_id,item_id,supplier_sku,purchase_uom_id,conversion_numerator,conversion_denominator,lead_time_days,minimum_order_quantity,preferred)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            auth.tenantId,
            supplierId,
            b.itemId,
            b.supplierSku ?? null,
            b.purchaseUomId,
            String(b.conversionNumerator ?? 1),
            String(b.conversionDenominator ?? 1),
            b.leadTimeDays ?? 0,
            String(b.minimumOrderQuantity ?? "0"),
            b.preferred ?? false,
          ],
        );
        await this.core.evidence(
          c,
          auth,
          "inventory.supplier_item_created",
          "inventory_supplier_item",
          id,
          requestId,
        );
        return { id, supplierId, ...b };
      },
    );
  }
  recipeStatus(
    auth: AccessClaims,
    id: string,
    to: "ACTIVE" | "SUPERSEDED",
    input: any,
    key: string,
    requestId: string,
  ) {
    return this.core.command(
      auth,
      `inventory.recipe.${to.toLowerCase()}`,
      key,
      { id, ...input },
      async (c) => {
        const row = (
          await c.query<any>(
            "SELECT * FROM service_material_recipes WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [auth.tenantId, id],
          )
        ).rows[0];
        if (!row) this.core.notFound("INVENTORY_RECIPE_NOT_FOUND");
        if (row.branch_id) this.core.branch(auth, row.branch_id);
        if (row.version !== input.version)
          this.core.conflict("INVENTORY_VERSION_CONFLICT");
        if (
          (to === "ACTIVE" && row.status !== "DRAFT") ||
          (to === "SUPERSEDED" && row.status !== "ACTIVE")
        )
          this.core.conflict("INVENTORY_RECIPE_STATUS_INVALID");
        await c.query(
          "UPDATE service_material_recipes SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id, to],
        );
        await this.core.evidence(
          c,
          auth,
          `inventory.recipe_${to.toLowerCase()}`,
          "service_material_recipe",
          id,
          requestId,
          row.branch_id ?? undefined,
        );
        return { id, status: to, version: row.version + 1 };
      },
    );
  }
  createRecipe(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const b = serviceMaterialRecipeSchema.parse(input);
    if (b.branchId) this.core.branch(auth, b.branchId);
    return this.core.command(
      auth,
      "inventory.recipe.create",
      key,
      b,
      async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO service_material_recipes(id,tenant_id,service_id,branch_id,name,status) VALUES($1,$2,$3,$4,$5,'DRAFT')",
          [id, auth.tenantId, b.serviceId, b.branchId ?? null, b.name],
        );
        for (const line of b.lines) {
          await c.query(
            "INSERT INTO service_material_recipe_lines(tenant_id,recipe_id,item_id,quantity,uom_id,wastage_basis_points,source_location_id,selection_method,required,allow_override) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              auth.tenantId,
              id,
              line.itemId,
              line.quantity,
              line.uomId,
              line.wastageBasisPoints,
              line.sourceLocationId ?? null,
              line.selectionMethod,
              line.required,
              line.allowOverride,
            ],
          );
        }
        await this.core.evidence(
          c,
          auth,
          "inventory.recipe_created",
          "service_material_recipe",
          id,
          requestId,
          b.branchId ?? undefined,
        );
        return { id, ...b, status: "DRAFT", version: 1 };
      },
    );
  }
  barcode(auth: AccessClaims, code: string) {
    this.core.access(auth);
    return this.core.db
      .query<any>(
        'SELECT i.id,i.sku,i.name_json "name",i.item_type "itemType",i.retail_price_minor::text "retailPriceMinor",i.currency FROM inventory_item_barcodes b JOIN inventory_items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id WHERE b.tenant_id=$1 AND b.barcode=$2 AND i.status=\'ACTIVE\'',
        [auth.tenantId, code],
      )
      .then((r) => {
        if (!r.rows[0]) this.core.notFound("INVENTORY_BARCODE_NOT_FOUND");
        return r.rows[0];
      });
  }
  private async itemTx(c: any, auth: AccessClaims, id: string) {
    return this.view(
      (
        await c.query(
          "SELECT * FROM inventory_items WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id],
        )
      ).rows[0],
    );
  }
  private view(row: any) {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) {
      const camel = k.replace(/_([a-z])/g, (_, x) => x.toUpperCase());
      out[camel] = v;
    }
    if (out.retailPriceMinor != null)
      out.retailPriceMinor = String(out.retailPriceMinor);
    return out;
  }
}
