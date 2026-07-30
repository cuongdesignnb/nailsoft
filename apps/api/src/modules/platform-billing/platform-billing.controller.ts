/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, ConflictException, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequirePermission } from "../identity/permission.decorator.js";
import { PlatformBillingService } from "./platform-billing.service.js";

const rid=(r:any)=>r.raw?.requestId??"unknown", idem=(value?:string)=>value??"", ok=(data:unknown,r:any)=>({success:true,data,meta:{requestId:rid(r),timestamp:new Date().toISOString()}});

@ApiTags("tenant-platform-billing") @ApiBearerAuth() @UseGuards(AuthGuard,PermissionGuard) @Controller("tenant/billing")
export class TenantBillingController {
  constructor(@Inject(PlatformBillingService) private readonly s:PlatformBillingService){}
  @Get("account") @RequirePermission("tenant.billing.read") async account(@Req()r:AuthenticatedRequest){return ok(await this.s.tenantAccount(r.auth),r);}
  @Post("account") @RequirePermission("tenant.billing.manage") async updateAccount(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.updateTenantAccount(r.auth,b,idem(k),rid(r)),r);}
  @Get("plans") @RequirePermission("tenant.billing.read") async plans(@Req()r:AuthenticatedRequest){return ok(await this.s.publicPlans(r.auth),r);}
  @Get("subscription") @RequirePermission("tenant.billing.read") async subscription(@Req()r:AuthenticatedRequest){return ok(await this.s.tenantSubscription(r.auth),r);}
  @Post("subscription/start-trial") @RequirePermission("tenant.billing.manage") async trial(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.startTrial(r.auth,b,idem(k),rid(r)),r);}
  @Post("subscription/change-plan") @RequirePermission("tenant.billing.manage") async change(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){const current:any=await this.s.tenantSubscription(r.auth);if(!current?.id)throw new ConflictException({code:"SUBSCRIPTION_NOT_FOUND",message:"Subscription not found"});return ok(await this.s.changePlan(r.auth,current.id,b,idem(k),rid(r)),r);}
  @Post("subscription/cancel") @RequirePermission("tenant.billing.manage") async cancel(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){const current:any=await this.s.tenantSubscription(r.auth);if(!current?.id)throw new ConflictException({code:"SUBSCRIPTION_NOT_FOUND",message:"Subscription not found"});return ok(await this.s.cancel(r.auth,current.id,b,idem(k),rid(r)),r);}
  @Post("subscription/reactivate") @RequirePermission("tenant.billing.manage") async reactivate(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){const current:any=await this.s.tenantSubscription(r.auth);if(!current?.id)throw new ConflictException({code:"SUBSCRIPTION_NOT_FOUND",message:"Subscription not found"});return ok(await this.s.reactivate(r.auth,current.id,b,idem(k),rid(r)),r);}
  @Get("entitlements") @RequirePermission("tenant.billing.read") async entitlements(@Req()r:AuthenticatedRequest){return ok(await this.s.tenantEntitlements(r.auth),r);}
  @Get("usage") @RequirePermission("tenant.billing.read") async usage(@Req()r:AuthenticatedRequest){return ok(await this.s.tenantUsage(r.auth),r);}
  @Get("invoices") @RequirePermission("tenant.billing.read") async invoices(@Req()r:AuthenticatedRequest){return ok(await this.s.tenantInvoices(r.auth),r);}
  @Get("invoices/:id") @RequirePermission("tenant.billing.read") async invoice(@Param("id")id:string,@Req()r:AuthenticatedRequest){return ok(await this.s.tenantInvoices(r.auth,id),r);}
  @Post("invoices/:id/pay") @RequirePermission("tenant.billing.manage") async pay(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.createPaymentIntent(r.auth,{...b,invoiceId:id},idem(k),rid(r),true),r);}
  @Get("payment-methods") @RequirePermission("tenant.billing.read") async methods(@Req()r:AuthenticatedRequest){return ok(await this.s.tenantPaymentMethods(r.auth),r);}
  @Post("payment-methods") @RequirePermission("tenant.billing.manage") async method(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.addPaymentMethod(r.auth,b,idem(k),rid(r)),r);}
}

@ApiTags("platform-catalog") @ApiBearerAuth() @UseGuards(AuthGuard,PermissionGuard) @Controller("platform")
export class PlatformBillingController {
  constructor(@Inject(PlatformBillingService) private readonly s:PlatformBillingService){}
  @Get("plans") @RequirePermission("platform.plan.read") async plans(@Req()r:AuthenticatedRequest){return ok(await this.s.platformPlans(r.auth),r);}
  @Post("plans") @RequirePermission("platform.plan.manage") async plan(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.createPlan(r.auth,b,idem(k),rid(r)),r);}
  @Post("plans/:id/versions") @RequirePermission("platform.plan.manage") async version(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.createPlanVersion(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("plans/:id/versions/:versionId/publish") @RequirePermission("platform.plan.manage") async publish(@Param("id")id:string,@Param("versionId")versionId:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.publishPlanVersion(r.auth,id,versionId,b,idem(k),rid(r)),r);}
  @Get("prices") @RequirePermission("platform.price.read") async prices(@Req()r:AuthenticatedRequest){return ok(await this.s.prices(r.auth),r);}
  @Post("prices") @RequirePermission("platform.price.manage") async price(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.createPrice(r.auth,b,idem(k),rid(r)),r);}
  @Post("prices/:id/activate") @RequirePermission("platform.price.manage") async activate(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.activatePrice(r.auth,id,b,idem(k),rid(r)),r);}
  @Get("tenants") @RequirePermission("platform.tenant.read") async tenants(@Req()r:AuthenticatedRequest){return ok(await this.s.platformTenants(r.auth),r);}
  @Get("tenants/:tenantId") @RequirePermission("platform.tenant.read") async tenant(@Param("tenantId")tenant:string,@Req()r:AuthenticatedRequest){return ok(await this.s.platformTenants(r.auth,tenant),r);}
  @Get("tenants/:tenantId/subscription") @RequirePermission("platform.subscription.read") async tenantSubscription(@Param("tenantId")tenant:string,@Req()r:AuthenticatedRequest){const item:any=await this.s.platformTenants(r.auth,tenant);return ok(item,r);}
  @Post("subscriptions/:id/change-plan") @RequirePermission("platform.subscription.change") async change(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.changePlan(r.auth,id,b,idem(k),rid(r),true),r);}
  @Post("subscriptions/:id/cancel") @RequirePermission("platform.subscription.cancel") async cancel(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.cancel(r.auth,id,b,idem(k),rid(r),true),r);}
  @Post("subscriptions/:id/reactivate") @RequirePermission("platform.subscription.reactivate") async reactivate(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.reactivate(r.auth,id,b,idem(k),rid(r),true),r);}
  @Post("tenants/:tenantId/entitlement-overrides") @RequirePermission("platform.entitlement.override") async override(@Param("tenantId")tenant:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.overrideEntitlement(r.auth,tenant,b,idem(k),rid(r)),r);}
  @Post("entitlement-overrides/:id/revoke") @RequirePermission("platform.entitlement.override") async revokeOverride(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.revokeOverride(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("tenants/:tenantId/access-mode") @RequirePermission("platform.tenant.lifecycle.manage") async access(@Param("tenantId")tenant:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.setAccessMode(r.auth,tenant,b,idem(k),rid(r)),r);}

  @Get("invoices") @RequirePermission("platform.invoice.read") async invoices(@Req()r:AuthenticatedRequest){return ok(await this.s.listInvoices(r.auth),r);}
  @Post("invoices") @RequirePermission("platform.invoice.generate") async invoice(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.createInvoice(r.auth,b,idem(k),rid(r)),r);}
  @Post("invoices/:id/calculate") @RequirePermission("platform.invoice.generate") async calculate(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.calculateInvoice(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("invoices/:id/finalize") @RequirePermission("platform.invoice.finalize") async finalize(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.finalizeInvoice(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("invoices/:id/void") @RequirePermission("platform.invoice.void") async void(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.voidInvoice(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("invoices/:id/credit-notes") @RequirePermission("platform.credit_note.manage") async credit(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.createCreditNote(r.auth,id,b,idem(k),rid(r)),r);}
  @Get("payment-intents") @RequirePermission("platform.payment.read") async payments(@Req()r:AuthenticatedRequest){return ok(await this.s.paymentIntents(r.auth),r);}
  @Post("payment-intents") @RequirePermission("platform.payment.collect") async payment(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.createPaymentIntent(r.auth,b,idem(k),rid(r)),r);}
  @Post("payment-intents/:id/confirm") @RequirePermission("platform.payment.collect") async confirm(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.confirmPayment(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("payment-intents/:id/retry") @RequirePermission("platform.payment.retry") async retry(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.confirmPayment(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("payment-intents/:id/reconcile") @RequirePermission("platform.payment.reconcile") async reconcile(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.reconcilePayment(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("invoices/:id/manual-payments") @RequirePermission("platform.payment.manual_record") async manual(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.manualPayment(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("payments/:id/refunds") @RequirePermission("platform.payment.refund") async refund(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.refund(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("billing-provider-events") @RequirePermission("platform.payment.reconcile") async providerEvent(@Body()b:any,@Headers("x-platform-signature")signature:string,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.providerEvent(r.auth,b,signature??"",idem(k)),r);}
  @Get("tenants/:tenantId/usage/aggregates") @RequirePermission("platform.usage.read") async usage(@Param("tenantId")tenant:string,@Req()r:AuthenticatedRequest){return ok(await this.s.usageAggregates(r.auth,tenant),r);}
  @Post("tenants/:tenantId/usage/corrections") @RequirePermission("platform.usage.correct") async correction(@Param("tenantId")tenant:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.correctUsage(r.auth,tenant,b,idem(k),rid(r)),r);}
  @Post("tenants/:tenantId/quotas/:code/reserve") @RequirePermission("platform.entitlement.override") async quota(@Param("tenantId")tenant:string,@Param("code")code:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.reserveQuota(r.auth,tenant,code,b.resourceType,b.resourceId,idem(k)),r);}
  @Get("support-access-grants") @RequirePermission("platform.support_grant.read") async grants(@Req()r:AuthenticatedRequest){return ok(await this.s.platformSupportGrants(r.auth),r);}
  @Post("support-access-grants") @RequirePermission("platform.support_grant.request") async grant(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.requestSupportGrant(r.auth,b,idem(k),rid(r)),r);}
  @Post("support-access-grants/:id/start-session") @RequirePermission("platform.support_session.start") async startSession(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.startSupportSession(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("support-sessions/:id/end") @RequirePermission("platform.support_session.start") async endSession(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.endSupportSession(r.auth,id,b,idem(k),rid(r)),r);}
  @Post("break-glass/requests") @RequirePermission("platform.support_grant.request") breakGlass(){throw new ConflictException({code:"BREAK_GLASS_DISABLED",message:"Break-glass is disabled"});}
}

@ApiTags("tenant-support-access") @ApiBearerAuth() @UseGuards(AuthGuard,PermissionGuard) @Controller("tenant/support-access-grants")
export class TenantSupportController {
  constructor(@Inject(PlatformBillingService) private readonly s:PlatformBillingService){}
  @Get() @RequirePermission("tenant.support_grant.read") async list(@Req()r:AuthenticatedRequest){return ok(await this.s.tenantSupportGrants(r.auth),r);}
  @Post(":id/approve") @RequirePermission("tenant.support_grant.approve") async approve(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.decideSupportGrant(r.auth,id,"approve",b,idem(k),rid(r)),r);}
  @Post(":id/deny") @RequirePermission("tenant.support_grant.approve") async deny(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.decideSupportGrant(r.auth,id,"deny",b,idem(k),rid(r)),r);}
  @Post(":id/revoke") @RequirePermission("tenant.support_grant.approve") async revoke(@Param("id")id:string,@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.decideSupportGrant(r.auth,id,"revoke",b,idem(k),rid(r)),r);}
}

@ApiTags("internal-platform-usage") @ApiBearerAuth() @UseGuards(AuthGuard,PermissionGuard) @Controller("internal/platform-usage")
export class PlatformUsageController {
  constructor(@Inject(PlatformBillingService) private readonly s:PlatformBillingService){}
  @Post("events") @RequirePermission("platform.usage.correct") async event(@Body()b:any,@Headers("idempotency-key")k:string,@Req()r:AuthenticatedRequest){return ok(await this.s.recordUsage(r.auth,b,idem(k),rid(r)),r);}
}
