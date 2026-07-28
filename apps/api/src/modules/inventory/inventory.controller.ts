/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import {
  RequireAnyPermission,
  RequirePermission,
} from "../identity/permission.decorator.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { InventoryCatalogService } from "./inventory-catalog.service.js";
import { InventoryOperationsService } from "./inventory-operations.service.js";
import { InventoryProcurementService } from "./inventory-procurement.service.js";
const rid = (r: any) => r.raw?.requestId ?? "unknown",
  ok = (data: unknown, r: any) => ({
    success: true,
    data,
    meta: { requestId: rid(r), timestamp: new Date().toISOString() },
  });

@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@ApiTags("inventory-catalog")
@Controller()
export class InventoryCatalogController {
  constructor(
    @Inject(InventoryCatalogService)
    private readonly s: InventoryCatalogService,
  ) {}
  @Get("inventory/uoms") @RequirePermission("inventory.item.read") async uoms(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "uoms"), r);
  }
  @Post("inventory/uoms")
  @RequirePermission("inventory.item.manage")
  async createUom(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createUom(r.auth, b, k, rid(r)), r);
  }
  @Post("inventory/uom-conversions")
  @RequirePermission("inventory.item.manage")
  async conversion(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createConversion(r.auth, b, k, rid(r)), r);
  }
  @Post("inventory/items/:itemId/uom-conversions")
  @RequirePermission("inventory.item.manage")
  async itemConversion(
    @Param("itemId") itemId: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.createItemConversion(r.auth, itemId, b, k, rid(r)),
      r,
    );
  }
  @Get("inventory/categories")
  @RequirePermission("inventory.item.read")
  async categories(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "categories"), r);
  }
  @Post("inventory/categories")
  @RequirePermission("inventory.item.manage")
  async createCategory(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createCategory(r.auth, b, k, rid(r)), r);
  }
  @Get("inventory/items") @RequirePermission("inventory.item.read") async items(
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "items"), r);
  }
  @Post("inventory/items")
  @RequirePermission("inventory.item.manage")
  async createItem(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createItem(r.auth, b, k, rid(r)), r);
  }
  @Get("inventory/items/:itemId")
  @RequirePermission("inventory.item.read")
  async item(@Param("itemId") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.item(r.auth, id), r);
  }
  @Post("inventory/items/:itemId/archive")
  @RequirePermission("inventory.item.manage")
  async archiveItem(
    @Param("itemId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.archiveItem(r.auth, id, b, k, rid(r)), r);
  }
  @Post("inventory/items/:itemId/activate")
  @RequirePermission("inventory.item.manage")
  async activateItem(
    @Param("itemId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.setItemStatus(
        r.auth,
        id,
        "ACTIVE",
        b,
        k,
        rid(r),
        "activated",
      ),
      r,
    );
  }
  @Post([
    "inventory/items/:itemId/deactivate",
    "inventory/items/:itemId/supersede",
  ])
  @RequirePermission("inventory.item.manage")
  async deactivateItem(
    @Param("itemId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.setItemStatus(
        r.auth,
        id,
        "ARCHIVED",
        b,
        k,
        rid(r),
        "deactivated",
      ),
      r,
    );
  }
  @Get("inventory/barcodes/:barcode")
  @RequirePermission("inventory.item.read")
  async barcode(
    @Param("barcode") code: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.barcode(r.auth, code), r);
  }
  @Get("inventory/locations")
  @RequirePermission("inventory.location.read")
  async locations(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "locations", branchId), r);
  }
  @Get("inventory/lots")
  @RequirePermission("inventory.stock.read")
  async lots(
    @Query("branchId") branchId: string,
    @Query("itemId") itemId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.lots(r.auth, branchId, itemId), r);
  }
  @Get("inventory/items/:itemId/availability")
  @RequirePermission("inventory.stock.read")
  async availability(
    @Param("itemId") itemId: string,
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.availability(r.auth, itemId, branchId), r);
  }
  @Post("inventory/locations")
  @RequirePermission("inventory.location.manage")
  async createLocation(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createLocation(r.auth, b, k, rid(r)), r);
  }
  @Get("inventory/suppliers")
  @RequirePermission("inventory.supplier.read")
  async suppliers(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.list(r.auth, "suppliers"), r);
  }
  @Post("inventory/suppliers")
  @RequirePermission("inventory.supplier.manage")
  async createSupplier(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createSupplier(r.auth, b, k, rid(r)), r);
  }
  @Get("inventory/suppliers/:supplierId")
  @RequirePermission("inventory.supplier.read")
  async supplier(
    @Param("supplierId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.supplier(r.auth, id), r);
  }
  @Post("inventory/suppliers/:supplierId/items")
  @RequirePermission("inventory.supplier.manage")
  async supplierItem(
    @Param("supplierId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.addSupplierItem(r.auth, id, b, k, rid(r)), r);
  }
  @Get("inventory/service-recipes")
  @RequirePermission("inventory.recipe.read")
  async recipes(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.list(r.auth, "recipes", branchId), r);
  }
  @Post("inventory/service-recipes")
  @RequirePermission("inventory.recipe.manage")
  async createRecipe(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createRecipe(r.auth, b, k, rid(r)), r);
  }
  @Post("inventory/service-recipes/:recipeId/activate")
  @RequirePermission("inventory.recipe.manage")
  async activateRecipe(
    @Param("recipeId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.recipeStatus(r.auth, id, "ACTIVE", b, k, rid(r)), r);
  }
  @Post("inventory/service-recipes/:recipeId/supersede")
  @RequirePermission("inventory.recipe.manage")
  async supersedeRecipe(
    @Param("recipeId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.recipeStatus(r.auth, id, "SUPERSEDED", b, k, rid(r)),
      r,
    );
  }
}

@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@ApiTags("inventory-procurement")
@Controller()
export class InventoryProcurementController {
  constructor(
    @Inject(InventoryProcurementService)
    private readonly s: InventoryProcurementService,
  ) {}
  @Get("inventory/purchase-orders")
  @RequirePermission("inventory.purchase_order.read")
  async pos(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.purchaseOrders(r.auth, branchId), r);
  }
  @Post("inventory/purchase-orders")
  @RequirePermission("inventory.purchase_order.create")
  async createPo(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createPurchaseOrder(r.auth, b, k, rid(r)), r);
  }
  @Get("inventory/purchase-orders/:poId")
  @RequirePermission("inventory.purchase_order.read")
  async po(@Param("poId") id: string, @Req() r: AuthenticatedRequest) {
    return ok(await this.s.purchaseOrder(r.auth, id), r);
  }
  @Post("inventory/purchase-orders/:poId/submit")
  @RequirePermission("inventory.purchase_order.submit")
  async submit(
    @Param("poId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.purchaseOrderStatus(r.auth, id, "SUBMITTED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/purchase-orders/:poId/approve")
  @RequirePermission("inventory.purchase_order.approve")
  async approve(
    @Param("poId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.purchaseOrderStatus(r.auth, id, "APPROVED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/purchase-orders/:poId/cancel")
  @RequirePermission("inventory.purchase_order.cancel")
  async cancel(
    @Param("poId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.purchaseOrderStatus(r.auth, id, "CANCELLED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/purchase-orders/:poId/close")
  @RequirePermission("inventory.purchase_order.close")
  async closePo(
    @Param("poId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.purchaseOrderStatus(r.auth, id, "CLOSED", b, k, rid(r)),
      r,
    );
  }
  @Get(["inventory/receipts", "inventory/goods-receipts"])
  @RequirePermission("inventory.receipt.read")
  async receipts(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.receipts(r.auth, branchId), r);
  }
  @Post(["inventory/receipts", "inventory/goods-receipts"])
  @RequirePermission("inventory.receipt.create")
  async createReceipt(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createReceipt(r.auth, b, k, rid(r)), r);
  }
  @Get(["inventory/receipts/:receiptId", "inventory/goods-receipts/:receiptId"])
  @RequirePermission("inventory.receipt.read")
  async receipt(
    @Param("receiptId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.receipt(r.auth, id), r);
  }
  @Post([
    "inventory/receipts/:receiptId/post",
    "inventory/goods-receipts/:receiptId/post",
  ])
  @RequirePermission("inventory.receipt.post")
  async postReceipt(
    @Param("receiptId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.postReceipt(r.auth, id, b, k, rid(r)), r);
  }
  @Post([
    "inventory/receipts/:receiptId/cancel",
    "inventory/goods-receipts/:receiptId/cancel",
  ])
  @RequirePermission("inventory.receipt.create")
  async cancelReceipt(
    @Param("receiptId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.cancelReceipt(r.auth, id, b, k, rid(r)), r);
  }
  @Get("inventory/transfers")
  @RequirePermission("inventory.transfer.read")
  async transfers(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.transfers(r.auth, branchId), r);
  }
  @Post("inventory/transfers")
  @RequirePermission("inventory.transfer.create")
  async createTransfer(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createTransfer(r.auth, b, k, rid(r)), r);
  }
  @Post("inventory/transfers/:transferId/ship")
  @RequirePermission("inventory.transfer.ship")
  async ship(
    @Param("transferId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transferStatus(r.auth, id, "IN_TRANSIT", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/transfers/:transferId/request")
  @RequirePermission("inventory.transfer.create")
  async requestTransfer(
    @Param("transferId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transferStatus(r.auth, id, "REQUESTED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/transfers/:transferId/approve")
  @RequirePermission("inventory.transfer.approve")
  async approveTransfer(
    @Param("transferId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transferStatus(r.auth, id, "APPROVED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/transfers/:transferId/receive")
  @RequirePermission("inventory.transfer.receive")
  async receive(
    @Param("transferId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transferStatus(r.auth, id, "RECEIVED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/transfers/:transferId/cancel")
  @RequirePermission("inventory.transfer.create")
  async cancelTransfer(
    @Param("transferId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.transferStatus(r.auth, id, "CANCELLED", b, k, rid(r)),
      r,
    );
  }
}

@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@ApiTags("inventory-operations")
@Controller()
export class InventoryOperationsController {
  constructor(
    @Inject(InventoryOperationsService)
    private readonly s: InventoryOperationsService,
  ) {}
  @Get("staff/me/materials")
  @RequireAnyPermission(
    "inventory.service.reserve",
    "inventory.service.consume",
  )
  async ownMaterials(@Req() r: AuthenticatedRequest) {
    return ok(await this.s.ownMaterials(r.auth), r);
  }
  @Get("inventory/stock")
  @RequirePermission("inventory.stock.read")
  async stock(
    @Query("branchId") branchId: string,
    @Query("locationId") locationId: string,
    @Query("itemId") itemId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.stock(r.auth, branchId, locationId, itemId), r);
  }
  @Get("inventory/ledger")
  @RequirePermission("inventory.ledger.read")
  async ledger(
    @Query("branchId") branchId: string,
    @Query("itemId") itemId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.ledger(r.auth, branchId, itemId), r);
  }
  @Get("inventory/items/:itemId/ledger")
  @RequirePermission("inventory.ledger.read")
  async itemLedger(
    @Param("itemId") itemId: string,
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.ledger(r.auth, branchId, itemId), r);
  }
  @Get("inventory/reports/valuation")
  @RequirePermission("inventory.cost.read")
  async valuation(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.valuation(r.auth, branchId), r);
  }
  @Get("inventory/adjustments")
  @RequirePermission("inventory.adjustment.read")
  async adjustments(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.adjustments(r.auth, branchId), r);
  }
  @Post("inventory/adjustments")
  @RequirePermission("inventory.adjustment.create")
  async adjustment(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createAdjustment(r.auth, b, k, rid(r)), r);
  }
  @Post("inventory/adjustments/:adjustmentId/approve")
  @RequirePermission("inventory.adjustment.approve")
  async approveAdjustment(
    @Param("adjustmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.decideAdjustment(r.auth, id, "APPROVED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/adjustments/:adjustmentId/reject")
  @RequirePermission("inventory.adjustment.approve")
  async rejectAdjustment(
    @Param("adjustmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.decideAdjustment(r.auth, id, "REJECTED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/adjustments/:adjustmentId/post")
  @RequirePermission("inventory.adjustment.post")
  async postAdjustment(
    @Param("adjustmentId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.postAdjustment(r.auth, id, b, k, rid(r)), r);
  }
  @Get("inventory/counts")
  @RequirePermission("inventory.count.read")
  async counts(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.counts(r.auth, branchId), r);
  }
  @Post("inventory/counts")
  @RequirePermission("inventory.count.create")
  async count(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.createCount(r.auth, b, k, rid(r)), r);
  }
  @Get("inventory/counts/:countId")
  @RequirePermission("inventory.count.read")
  async countDetail(
    @Param("countId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.countDetail(r.auth, id, false), r);
  }
  @Post("inventory/counts/:countId/lines/:lineId")
  @RequirePermission("inventory.count.create")
  async countLine(
    @Param("countId") id: string,
    @Param("lineId") lineId: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.countLine(r.auth, id, lineId, b, k, rid(r)), r);
  }
  @Post("inventory/counts/:countId/start")
  @RequirePermission("inventory.count.create")
  async startCount(
    @Param("countId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.countStatus(r.auth, id, "COUNTING", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/counts/:countId/lines/:lineId/declare")
  @RequirePermission("inventory.count.declare")
  async declareCountLine(
    @Param("countId") id: string,
    @Param("lineId") lineId: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.countLine(r.auth, id, lineId, b, k, rid(r)), r);
  }
  @Post("inventory/counts/:countId/start-review")
  @RequirePermission("inventory.count.review")
  async startCountReview(
    @Param("countId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.countStatus(r.auth, id, "REVIEW", b, k, rid(r)), r);
  }
  @Get("inventory/counts/:countId/review")
  @RequirePermission("inventory.count.review")
  async countReview(
    @Param("countId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.countDetail(r.auth, id, true), r);
  }
  @Post("inventory/counts/:countId/submit")
  @RequirePermission("inventory.count.submit")
  async submitCount(
    @Param("countId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.countStatus(r.auth, id, "SUBMITTED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/counts/:countId/approve")
  @RequirePermission("inventory.count.approve")
  async approveCount(
    @Param("countId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.countStatus(r.auth, id, "APPROVED", b, k, rid(r)),
      r,
    );
  }
  @Post("inventory/counts/:countId/post")
  @RequirePermission("inventory.count.post")
  async postCount(
    @Param("countId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.countStatus(r.auth, id, "POSTED", b, k, rid(r)), r);
  }
  @Post("service-sessions/:sessionId/materials/reserve")
  @RequirePermission("inventory.service.reserve")
  async reserve(
    @Param("sessionId") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.reserveService(r.auth, id, k, rid(r)), r);
  }
  @Get("service-sessions/:sessionId/materials")
  @RequireAnyPermission(
    "inventory.service.reserve",
    "inventory.service.consume",
    "inventory.stock.read",
  )
  async materials(
    @Param("sessionId") id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.serviceMaterials(r.auth, id), r);
  }
  @Post("service-sessions/:sessionId/materials/actual-usage")
  @RequirePermission("inventory.service.consume")
  async actualUsage(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.recordActualUsage(r.auth, id, b, k, rid(r)), r);
  }
  @Post([
    "service-sessions/:sessionId/materials/consume",
    "service-sessions/:sessionId/materials/commit",
  ])
  @RequirePermission("inventory.service.consume")
  async consume(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.consumeService(r.auth, id, b, k, rid(r)), r);
  }
  @Post("service-sessions/:sessionId/materials/override-shortage")
  @RequirePermission("inventory.service.override_shortage")
  async overrideShortage(
    @Param("sessionId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.overrideServiceShortage(r.auth, id, b, k, rid(r)),
      r,
    );
  }
  @Post("service-sessions/:sessionId/materials/release")
  @RequirePermission("inventory.service.consume")
  async release(
    @Param("sessionId") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.releaseService(r.auth, id, k, rid(r)), r);
  }
  @Post(["pos/orders/:orderId/products", "pos-orders/:orderId/product-lines"])
  @RequirePermission("inventory.pos_product.sell")
  async product(
    @Param("orderId") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.addProduct(r.auth, id, b, k, rid(r)), r);
  }
  @Post("pos-orders/:orderId/product-lines/:lineId/update")
  @RequirePermission("inventory.pos_product.sell")
  async updateProduct(
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.updateProduct(r.auth, orderId, lineId, b, k, rid(r)),
      r,
    );
  }
  @Post("pos-orders/:orderId/product-lines/:lineId/remove")
  @RequirePermission("inventory.pos_product.sell")
  async removeProduct(
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(
      await this.s.removeProduct(r.auth, orderId, lineId, b, k, rid(r)),
      r,
    );
  }
  @Post("refunds/:refundId/inventory-return-decisions")
  @RequirePermission("inventory.return.inspect")
  async inspectRefundReturn(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.inspectReturn(r.auth, b, k, rid(r)), r);
  }
  @Post("inventory/returns/inspect")
  @RequirePermission("inventory.return.inspect")
  async inspect(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.inspectReturn(r.auth, b, k, rid(r)), r);
  }
  @Post("inventory/return-decisions/:decisionId/post")
  @RequirePermission("inventory.return.post")
  async postReturn(
    @Param("decisionId") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.postReturn(r.auth, id, k, rid(r)), r);
  }
  @Get("inventory/alerts")
  @RequirePermission("inventory.alert.read")
  async alerts(
    @Query("branchId") branchId: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.alerts(r.auth, branchId), r);
  }
  @Post("inventory/alerts/:alertId/acknowledge")
  @RequirePermission("inventory.alert.manage")
  async acknowledge(
    @Param("alertId") id: string,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.acknowledgeAlert(r.auth, id, k, rid(r)), r);
  }
  @Post("inventory/exports")
  @RequireAnyPermission("inventory.export", "inventory.report.read")
  async export(
    @Body() b: unknown,
    @Headers("idempotency-key") k: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return ok(await this.s.export(r.auth, b, k, rid(r)), r);
  }
}
