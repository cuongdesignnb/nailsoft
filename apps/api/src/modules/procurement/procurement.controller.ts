/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequireAnyPermission, RequirePermission } from "../identity/permission.decorator.js";
import { ProcurementService } from "./procurement.service.js";

const rid = (request: AuthenticatedRequest) => request.raw.requestId ?? "unknown";
const idem = (value?: string) => value ?? "";
const ok = (data: unknown, request: AuthenticatedRequest) => ({
  success: true,
  data,
  meta: { requestId: rid(request), timestamp: new Date().toISOString() },
});

@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@ApiTags("procurement")
@Controller("procurement")
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  @Get("vendors") @RequirePermission("procurement.vendor.read")
  vendors(@Req() r: AuthenticatedRequest) { return this.service.listVendors(r.auth).then((x) => ok(x, r)); }
  @Post("vendors") @RequirePermission("procurement.vendor.manage")
  createVendor(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createVendor(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Get("vendors/:id") @RequirePermission("procurement.vendor.read")
  vendor(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.getVendor(r.auth, id).then((x) => ok(x, r)); }
  @Get("vendors/:id/contacts") @RequirePermission("procurement.vendor.read")
  vendorContacts(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.listVendorContacts(r.auth, id).then((x) => ok(x, r)); }
  @Post("vendors/:id/contacts") @RequirePermission("procurement.vendor.contact.manage")
  createVendorContact(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createVendorContact(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Get("vendors/:id/payment-methods") @RequirePermission("procurement.vendor.read")
  vendorPaymentMethods(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.listVendorPaymentMethods(r.auth, id).then((x) => ok(x, r)); }
  @Post("vendors/:id/payment-methods") @RequirePermission("procurement.vendor.payment_method.manage")
  createVendorPaymentMethod(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createVendorPaymentMethod(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendors/:id/activate") @RequirePermission("procurement.vendor.manage")
  activateVendor(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.vendorStatus(r.auth, id, "ACTIVE", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendors/:id/hold") @RequirePermission("procurement.vendor.manage")
  holdVendor(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.vendorStatus(r.auth, id, "ON_HOLD", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendors/:id/release-hold") @RequirePermission("procurement.vendor.manage")
  releaseVendor(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.vendorStatus(r.auth, id, "ACTIVE", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendors/:id/deactivate") @RequirePermission("procurement.vendor.manage")
  deactivateVendor(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.vendorStatus(r.auth, id, "INACTIVE", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Get("purchase-requests") @RequirePermission("procurement.request.read")
  requests(@Req() r: AuthenticatedRequest) { return this.service.listRequests(r.auth).then((x) => ok(x, r)); }
  @Post("purchase-requests") @RequirePermission("procurement.request.create")
  createRequest(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createRequest(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Get("purchase-requests/:id") @RequirePermission("procurement.request.read")
  request(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.getRequest(r.auth, id).then((x) => ok(x, r)); }
  @Post("purchase-requests/:id/submit") @RequirePermission("procurement.request.submit")
  submitRequest(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.requestStatus(r.auth, id, "SUBMITTED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("purchase-requests/:id/approve") @RequirePermission("procurement.request.approve")
  approveRequest(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return (b.lines ? this.service.partialApproveRequest(r.auth, id, b, idem(k), rid(r)) : this.service.requestStatus(r.auth, id, "APPROVED", b, idem(k), rid(r))).then((x) => ok(x, r)); }
  @Post("purchase-requests/:id/reject") @RequirePermission("procurement.request.approve")
  rejectRequest(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.requestStatus(r.auth, id, "REJECTED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("purchase-requests/:id/cancel") @RequirePermission("procurement.request.cancel")
  cancelRequest(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.requestStatus(r.auth, id, "CANCELLED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("purchase-requests/:id/convert-to-po") @RequirePermission("procurement.po.create")
  convertRequest(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.convertRequest(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Get("purchase-orders") @RequirePermission("procurement.po.read")
  pos(@Req() r: AuthenticatedRequest) { return this.service.listPos(r.auth).then((x) => ok(x, r)); }
  @Post("purchase-orders") @RequirePermission("procurement.po.create")
  createPo(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createPo(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Get("purchase-orders/:id") @RequirePermission("procurement.po.read")
  po(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.getPo(r.auth, id).then((x) => ok(x, r)); }
  @Post("purchase-orders/:id/submit") @RequirePermission("procurement.po.submit")
  submitPo(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.poStatus(r.auth, id, "PENDING_APPROVAL", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("purchase-orders/:id/approve") @RequirePermission("procurement.po.approve")
  approvePo(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.poStatus(r.auth, id, "APPROVED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("purchase-orders/:id/amend") @RequirePermission("procurement.po.amend")
  amendPo(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.amendPo(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("purchase-orders/:id/send") @RequirePermission("procurement.po.send")
  sendPo(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.poStatus(r.auth, id, "SENT", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("purchase-orders/:id/cancel") @RequirePermission("procurement.po.cancel")
  cancelPo(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.poStatus(r.auth, id, "CANCELLED", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Get("receipts") @RequirePermission("procurement.receipt.read")
  receipts(@Req() r: AuthenticatedRequest) { return this.service.listReceipts(r.auth).then((x) => ok(x, r)); }
  @Post("receipts") @RequirePermission("procurement.receipt.create")
  receipt(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createReceipt(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("receipts/:id/receive") @RequirePermission("procurement.receipt.create")
  receiveReceipt(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.receiptStatus(r.auth, id, "RECEIVED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("receipts/:id/accept") @RequirePermission("procurement.receipt.accept")
  acceptReceipt(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.receiptStatus(r.auth, id, b.partial ? "PARTIALLY_ACCEPTED" : "ACCEPTED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("receipts/:id/reject") @RequirePermission("procurement.receipt.reject")
  rejectReceipt(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.receiptStatus(r.auth, id, "REJECTED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("receipts/:id/reversal-request") @RequirePermission("procurement.receipt.reverse")
  requestReceiptReversal(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.requestReceiptReversal(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("receipts/:id/reverse") @RequirePermission("procurement.receipt.reverse")
  reverseReceipt(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.receiptStatus(r.auth, id, "REVERSED", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Get("vendor-bills") @RequirePermission("procurement.bill.read")
  bills(@Req() r: AuthenticatedRequest) { return this.service.listBills(r.auth).then((x) => ok(x, r)); }
  @Post("vendor-bills") @RequirePermission("procurement.bill.create")
  createBill(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createBill(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Get("vendor-bills/:id") @RequirePermission("procurement.bill.read")
  bill(@Param("id") id: string, @Req() r: AuthenticatedRequest) { return this.service.getBill(r.auth, id).then((x) => ok(x, r)); }
  @Post("vendor-bills/:id/match") @RequirePermission("procurement.bill.match")
  matchBill(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.runMatch(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-bills/:id/match-override") @RequirePermission("procurement.bill.match_override")
  requestMatchOverride(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.overrideMatch(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-bills/:id/match-override/approve") @RequirePermission("procurement.bill.match_override")
  approveMatchOverride(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.approveMatchOverride(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-bills/:id/match-override/reject") @RequirePermission("procurement.bill.match_override")
  rejectMatchOverride(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.rejectMatchOverride(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-bills/:id/approve") @RequirePermission("procurement.bill.approve")
  approveBill(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.billStatus(r.auth, id, "APPROVED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-bills/:id/post") @RequirePermission("procurement.bill.post")
  postBill(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.billStatus(r.auth, id, "POSTED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-bills/:id/void") @RequirePermission("procurement.bill.void")
  voidBill(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.billStatus(r.auth, id, "VOID_PENDING", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Get("ap/open-items") @RequirePermission("procurement.ap.read")
  ap(@Req() r: AuthenticatedRequest) { return this.service.listAp(r.auth).then((x) => ok(x, r)); }
  @Post("ap/open-items/:id/hold") @RequirePermission("procurement.ap.hold")
  holdAp(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.apStatus(r.auth, id, "HOLD", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("ap/open-items/:id/release-hold") @RequirePermission("procurement.ap.hold")
  releaseAp(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.apStatus(r.auth, id, "RELEASE_HOLD", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Post("payment-proposals") @RequirePermission("procurement.payment.create")
  createProposal(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createPaymentProposal(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Get("payment-proposals") @RequirePermission("procurement.payment.read")
  paymentProposals(@Req() r: AuthenticatedRequest) { return this.service.listPaymentProposals(r.auth).then((x) => ok(x, r)); }
  @Post("payment-proposals/:id/submit") @RequirePermission("procurement.payment.submit")
  submitProposal(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.proposalStatus(r.auth, id, "PENDING_APPROVAL", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("payment-proposals/:id/approve") @RequirePermission("procurement.payment.approve")
  approveProposal(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.proposalStatus(r.auth, id, "APPROVED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("payment-proposals/:id/cancel") @RequirePermission("procurement.payment.create")
  cancelProposal(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.proposalStatus(r.auth, id, "CANCELLED", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Get("vendor-payments") @RequirePermission("procurement.payment.read")
  payments(@Req() r: AuthenticatedRequest) { return this.service.listPayments(r.auth).then((x) => ok(x, r)); }
  @Post("vendor-payments") @RequirePermission("procurement.payment.create")
  createPayment(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createPayment(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-payments/:id/approve") @RequirePermission("procurement.payment.approve")
  approvePayment(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.paymentStatus(r.auth, id, "APPROVED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-payments/:id/process") @RequirePermission("procurement.payment.process")
  processPayment(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.schedulePayment(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-payments/:id/reconcile") @RequirePermission("procurement.payment.reconcile")
  reconcilePayment(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.reconcilePaymentOutcome(r.auth, id, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-payments/:id/reverse") @RequirePermission("procurement.payment.reverse")
  reversePayment(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.paymentStatus(r.auth, id, "REVERSAL_PENDING", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Post("vendor-credit-notes") @RequirePermission("procurement.credit_note.create")
  createCredit(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createCredit(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-credit-notes/:id/submit") @RequirePermission("procurement.credit_note.create")
  submitCredit(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.creditStatus(r.auth, id, "SUBMITTED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-credit-notes/:id/approve") @RequirePermission("procurement.credit_note.approve")
  approveCredit(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.creditStatus(r.auth, id, "APPROVED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-credit-notes/:id/post") @RequirePermission("procurement.credit_note.post")
  postCredit(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.creditStatus(r.auth, id, "POSTED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-credit-notes/:id/apply") @RequirePermission("procurement.credit_note.apply")
  applyCredit(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.creditStatus(r.auth, id, "APPLIED", b, idem(k), rid(r)).then((x) => ok(x, r)); }

  @Post("vendor-returns") @RequirePermission("procurement.return.create")
  createReturn(@Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.createReturn(r.auth, b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Get("vendor-returns") @RequireAnyPermission("procurement.return.create", "procurement.return.approve", "procurement.return.dispatch", "procurement.return.complete")
  vendorReturns(@Req() r: AuthenticatedRequest) { return this.service.listVendorReturns(r.auth).then((x) => ok(x, r)); }
  @Post("vendor-returns/:id/submit") @RequirePermission("procurement.return.create")
  submitReturn(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.returnStatus(r.auth, id, "PENDING_APPROVAL", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-returns/:id/approve") @RequirePermission("procurement.return.approve")
  approveReturn(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.returnStatus(r.auth, id, "APPROVED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-returns/:id/dispatch") @RequirePermission("procurement.return.dispatch")
  dispatchReturn(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.returnStatus(r.auth, id, "DISPATCHED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
  @Post("vendor-returns/:id/complete") @RequirePermission("procurement.return.complete")
  completeReturn(@Param("id") id: string, @Body() b: any, @Headers("idempotency-key") k: string, @Req() r: AuthenticatedRequest) { return this.service.returnStatus(r.auth, id, "COMPLETED", b, idem(k), rid(r)).then((x) => ok(x, r)); }
}
