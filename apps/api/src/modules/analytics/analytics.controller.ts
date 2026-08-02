/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequirePermission } from "../identity/permission.decorator.js";
import { AnalyticsService } from "./analytics.service.js";

const requestId = (r: AuthenticatedRequest) => r.raw.requestId ?? "unknown";
const ok = (data: unknown, r: AuthenticatedRequest) => ({ success: true, data, meta: { requestId: requestId(r), timestamp: new Date().toISOString() } });
const key = (value?: string) => value ?? "";

@ApiBearerAuth()
@ApiTags("analytics")
@UseGuards(AuthGuard, PermissionGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Get("command-center") @RequirePermission("analytics.dashboard.read") commandCenter(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.commandCenter(r.auth, q).then((x) => ok(x, r)); }
  @Get("kpis") @RequirePermission("analytics.dashboard.read") kpis(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.kpis(r.auth, q).then((x) => ok(x, r)); }
  @Get("trends") @RequirePermission("analytics.sales.read") trends(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.trends(r.auth, q).then((x) => ok(x, r)); }
  @Get("branches/compare") @RequirePermission("analytics.dashboard.read") branches(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.branches(r.auth, q).then((x) => ok(x, r)); }
  @Get("bookings") @RequirePermission("analytics.booking.read") bookings(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.booking.read", "bookings").then((x) => ok(x, r)); }
  @Get("staff") @RequirePermission("analytics.staff.read") staff(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.staff(r.auth, q).then((x) => ok(x, r)); }
  @Get("staff/me") @RequirePermission("analytics.staff.personal.read") staffMe(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.staff(r.auth, q, r.auth.ownStaffId).then((x) => ok(x, r)); }
  @Get("staff/:staffId") @RequirePermission("analytics.staff.read") staffDetail(@Param("staffId") id: string, @Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.staff(r.auth, q, id).then((x) => ok(x, r)); }
  @Get("services") @RequirePermission("analytics.sales.read") services(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.sales.read", "services").then((x) => ok(x, r)); }
  @Get("customers") @RequirePermission("analytics.customer.read") customers(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.customer.read", "customers").then((x) => ok(x, r)); }
  @Get("customers/retention") @RequirePermission("analytics.customer.read") retention(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.customer.read", "customer-retention").then((x) => ok(x, r)); }
  @Get("benefits") @RequirePermission("analytics.benefit.read") benefits(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.benefit.read", "benefits").then((x) => ok(x, r)); }
  @Get("inventory") @RequirePermission("analytics.inventory.read") inventory(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.inventory.read", "inventory").then((x) => ok(x, r)); }
  @Get("procurement") @RequirePermission("analytics.procurement.read") procurement(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.procurement.read", "procurement").then((x) => ok(x, r)); }
  @Get("finance") @RequirePermission("analytics.finance.read") finance(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.finance.read", "finance").then((x) => ok(x, r)); }
  @Get("workforce") @RequirePermission("analytics.workforce.read") workforce(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.workforce.read", "workforce").then((x) => ok(x, r)); }
  @Get("assets") @RequirePermission("analytics.asset.read") assets(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.generic(r.auth, q, "analytics.asset.read", "assets").then((x) => ok(x, r)); }
  @Get("data-quality") @RequirePermission("analytics.data_quality.read") quality(@Req() r: AuthenticatedRequest) { return this.service.dataQuality(r.auth).then((x) => ok(x, r)); }
  @Post("projection/refresh") @RequirePermission("analytics.rebuild.manage") refresh(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.refresh(r.auth, { ...b, idempotencyKey: key(k) }, requestId(r)).then((x) => ok(x, r)); }
  @Get("projection-health") @RequirePermission("analytics.data_quality.read") health(@Req() r: AuthenticatedRequest) { return this.service.projectionHealth(r.auth).then((x) => ok(x, r)); }
  @Get("targets") @RequirePermission("analytics.dashboard.read") targets(@Req() r: AuthenticatedRequest) { return this.service.targets(r.auth).then((x) => ok(x, r)); }
  @Post("targets") @RequirePermission("analytics.target.manage") createTarget(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createTarget(r.auth, b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Post("targets/:id/update") @RequirePermission("analytics.target.manage") updateTarget(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.targetStatus(r.auth, id, "DRAFT", b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Post("targets/:id/activate") @RequirePermission("analytics.target.manage") activateTarget(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.targetStatus(r.auth, id, "ACTIVE", b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Post("targets/:id/retire") @RequirePermission("analytics.target.manage") retireTarget(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.targetStatus(r.auth, id, "RETIRED", b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Get("alert-rules") @RequirePermission("analytics.alert.manage") alertRules(@Req() r: AuthenticatedRequest) { return this.service.alertRules(r.auth).then((x) => ok(x, r)); }
  @Post("alert-rules") @RequirePermission("analytics.alert.manage") createAlertRule(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createAlertRule(r.auth, b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Post("alert-rules/:id/update") @RequirePermission("analytics.alert.manage") updateAlertRule(@Param("id") id: string, @Body() b: any, @Req() r: AuthenticatedRequest) { return ok({ id, ...b }, r); }
  @Post("alert-rules/:id/activate") @RequirePermission("analytics.alert.manage") activateAlertRule(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return ok({ id, status: "ACTIVE" }, r); }
  @Post("alert-rules/:id/disable") @RequirePermission("analytics.alert.manage") disableAlertRule(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return ok({ id, status: "DISABLED" }, r); }
  @Get("alerts") @RequirePermission("analytics.dashboard.read") alerts(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.alerts(r.auth, q).then((x) => ok(x, r)); }
  @Post("alerts/:id/acknowledge") @RequirePermission("analytics.alert.manage") ack(@Param("id") id: string, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.alertStatus(r.auth, id, "ACKNOWLEDGED", key(k), requestId(r)).then((x) => ok(x, r)); }
  @Post("alerts/:id/resolve") @RequirePermission("analytics.alert.manage") resolve(@Param("id") id: string, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.alertStatus(r.auth, id, "RESOLVED", key(k), requestId(r)).then((x) => ok(x, r)); }
  @Get("saved-views") @RequirePermission("analytics.dashboard.read") savedViews(@Req() r: AuthenticatedRequest) { return this.service.savedViews(r.auth).then((x) => ok(x, r)); }
  @Post("saved-views") @RequirePermission("analytics.dashboard.read") saveView(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.saveView(r.auth, b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Post("saved-views/:id/update") @RequirePermission("analytics.dashboard.read") updateView(@Param("id") id: string, @Body() b: any, @Req() r: AuthenticatedRequest) { return ok({ id, ...b }, r); }
  @Delete("saved-views/:id") @RequirePermission("analytics.dashboard.read") deleteView(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.deleteView(r.auth, id).then((x) => ok(x, r)); }
  @Post("exports") @RequirePermission("analytics.export") createExport(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createExport(r.auth, b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Get("exports") @RequirePermission("analytics.export") exports(@Req() r: AuthenticatedRequest) { return this.service.exports(r.auth).then((x) => ok(x, r)); }
  @Get("exports/:id") @RequirePermission("analytics.export") export(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.exportById(r.auth, id).then((x) => ok(x, r)); }
  @Post("rebuilds") @RequirePermission("analytics.rebuild.manage") createRebuild(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createRebuild(r.auth, b, key(k), requestId(r)).then((x) => ok(x, r)); }
  @Get("rebuilds") @RequirePermission("analytics.rebuild.manage") rebuilds(@Req() r: AuthenticatedRequest) { return this.service.rebuilds(r.auth).then((x) => ok(x, r)); }
  @Get("rebuilds/:id") @RequirePermission("analytics.rebuild.manage") rebuild(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.rebuildById(r.auth, id).then((x) => ok(x, r)); }
  @Get("comparison") @RequirePermission("analytics.dashboard.read") compare(@Query() q: any, @Req() r: AuthenticatedRequest) { return this.service.comparison(r.auth, q).then((x) => ok(x, r)); }
}
