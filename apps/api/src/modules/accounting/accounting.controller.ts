/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequirePermission } from "../identity/permission.decorator.js";
import { AccountingService } from "./accounting.service.js";

const rid=(r:AuthenticatedRequest)=>r.raw.requestId??"unknown";
const ok=(data:unknown,r:AuthenticatedRequest)=>({success:true,data,meta:{requestId:rid(r),timestamp:new Date().toISOString()}});
const idem=(v?:string)=>v??"";

@ApiTags("accounting") @ApiBearerAuth() @UseGuards(AuthGuard,PermissionGuard) @Controller("accounting")
export class AccountingController {
  constructor(private readonly s: AccountingService) {}
  @Get("books") @RequirePermission("accounting.book.read") books(@Req() r:AuthenticatedRequest){return this.s.books(r.auth).then(x=>ok(x,r));}
  @Post("books") @RequirePermission("accounting.book.manage") createBook(@Body() b:any,@Headers("idempotency-key") k:string,@Req() r:AuthenticatedRequest){return this.s.createBook(r.auth,b,rid(r),idem(k)).then(x=>ok(x,r));}
  @Post("books/:id/activate") @RequirePermission("accounting.book.manage") activateBook(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.activateBook(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Get("accounts") @RequirePermission("accounting.account.read") accounts(@Query("bookId") bookId:string,@Req() r:AuthenticatedRequest){return this.s.accounts(r.auth,bookId).then(x=>ok(x,r));}
  @Post("accounts") @RequirePermission("accounting.account.manage") createAccount(@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.createAccount(r.auth,b,rid(r)).then(x=>ok(x,r));}
  @Post("accounts/:id/update") @RequirePermission("accounting.account.manage") updateAccount(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.updateAccount(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Post("accounts/:id/deactivate") @RequirePermission("accounting.account.manage") deactivate(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.deactivateAccount(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Get("periods") @RequirePermission("accounting.period.read") periods(@Query("bookId") bookId:string,@Req() r:AuthenticatedRequest){return this.s.periods(r.auth,bookId).then(x=>ok(x,r));}
  @Post("periods") @RequirePermission("accounting.period.manage") createPeriod(@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.createPeriod(r.auth,b,rid(r)).then(x=>ok(x,r));}
  @Post("periods/:id/open") @RequirePermission("accounting.period.manage") openPeriod(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionPeriod(r.auth,id,"OPEN",b,rid(r)).then(x=>ok(x,r));}
  @Post("periods/:id/soft-close") @RequirePermission("accounting.period.manage") softClosePeriod(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionPeriod(r.auth,id,"SOFT_CLOSED",b,rid(r)).then(x=>ok(x,r));}
  @Post("periods/:id/request-close") @RequirePermission("accounting.period.manage") requestClose(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionPeriod(r.auth,id,"PENDING_CLOSE",b,rid(r)).then(x=>ok(x,r));}
  @Post("periods/:id/approve-close") @RequirePermission("accounting.period.close") approveClose(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionPeriod(r.auth,id,"CLOSED",b,rid(r)).then(x=>ok(x,r));}
  @Post("periods/:id/request-reopen") @RequirePermission("accounting.period.manage") requestReopen(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionPeriod(r.auth,id,"REOPEN_PENDING",b,rid(r)).then(x=>ok(x,r));}
  @Post("periods/:id/approve-reopen") @RequirePermission("accounting.period.reopen") approveReopen(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionPeriod(r.auth,id,"REOPENED",b,rid(r)).then(x=>ok(x,r));}
  @Get("journals") @RequirePermission("accounting.journal.read") journals(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.journals(r.auth,q).then(x=>ok(x,r));}
  @Get("journals/:id") @RequirePermission("accounting.journal.read") journal(@Param("id") id:string,@Req() r:AuthenticatedRequest){return this.s.journal(r.auth,id).then(x=>ok(x,r));}
  @Post("journals") @RequirePermission("accounting.journal.create") createJournal(@Body() b:any,@Headers("idempotency-key") k:string,@Req() r:AuthenticatedRequest){return this.s.createJournal(r.auth,b,rid(r),idem(k)).then(x=>ok(x,r));}
  @Post("journals/:id/submit") @RequirePermission("accounting.journal.submit") submitJournal(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.journalTransition(r.auth,id,"PENDING_APPROVAL",b,rid(r)).then(x=>ok(x,r));}
  @Post("journals/:id/approve") @RequirePermission("accounting.journal.approve") approveJournal(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.journalTransition(r.auth,id,"APPROVED",b,rid(r)).then(x=>ok(x,r));}
  @Post("journals/:id/reject") @RequirePermission("accounting.journal.approve") rejectJournal(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.journalTransition(r.auth,id,"REJECTED",b,rid(r)).then(x=>ok(x,r));}
  @Post("journals/:id/post") @RequirePermission("accounting.journal.post") postJournal(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.postJournal(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Post("journals/:id/request-reversal") @RequirePermission("accounting.journal.reverse") requestReversal(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.requestJournalReversal(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Post("journals/:id/approve-reversal") @RequirePermission("accounting.journal.reverse") approveReversal(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.approveJournalReversal(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Get("posting-candidates") @RequirePermission("accounting.posting.read") candidates(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.candidates(r.auth,q).then(x=>ok(x,r));}
  @Get("tax-codes") @RequirePermission("accounting.tax.read") taxCodes(@Query("bookId") bookId:string,@Req() r:AuthenticatedRequest){return this.s.taxCodes(r.auth,bookId).then(x=>ok(x,r));}
  @Post("tax-codes") @RequirePermission("accounting.tax.manage") createTaxCode(@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.createTaxCode(r.auth,b,rid(r)).then(x=>ok(x,r));}
  @Get("posting-rules") @RequirePermission("accounting.mapping.read") postingRules(@Query("bookId") bookId:string,@Req() r:AuthenticatedRequest){return this.s.postingRules(r.auth,bookId).then(x=>ok(x,r));}
  @Get("opening-balances") @RequirePermission("accounting.opening_balance.import") openingBalances(@Query("bookId") bookId:string,@Req() r:AuthenticatedRequest){return this.s.openingBalances(r.auth,bookId).then(x=>ok(x,r));}
  @Post("opening-balances") @RequirePermission("accounting.opening_balance.import") createOpeningBalance(@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.createOpeningBalance(r.auth,b,rid(r)).then(x=>ok(x,r));}
  @Post("opening-balances/:id/validate") @RequirePermission("accounting.opening_balance.import") validateOpeningBalance(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionOpeningBalance(r.auth,id,"VALIDATED",b,rid(r)).then(x=>ok(x,r));}
  @Post("opening-balances/:id/submit") @RequirePermission("accounting.opening_balance.import") submitOpeningBalance(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionOpeningBalance(r.auth,id,"PENDING_APPROVAL",b,rid(r)).then(x=>ok(x,r));}
  @Post("opening-balances/:id/approve") @RequirePermission("accounting.opening_balance.approve") approveOpeningBalance(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.transitionOpeningBalance(r.auth,id,"APPROVED",b,rid(r)).then(x=>ok(x,r));}
  @Post("opening-balances/:id/post") @RequirePermission("accounting.opening_balance.approve") postOpeningBalance(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.postOpeningBalance(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Get("reports/trial-balance") @RequirePermission("accounting.report.read") trial(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.trialBalance(r.auth,q).then(x=>ok(x,r));}
  @Get("reports/general-ledger") @RequirePermission("accounting.report.read") ledger(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.generalLedger(r.auth,q).then(x=>ok(x,r));}
  @Get("reports/profit-and-loss") @RequirePermission("accounting.report.read") pnl(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.profitAndLoss(r.auth,q).then(x=>ok(x,r));}
  @Get("reports/balance-sheet") @RequirePermission("accounting.report.read") balanceSheet(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.balanceSheet(r.auth,q).then(x=>ok(x,r));}
  @Get("reports") @RequirePermission("accounting.report.read") reports(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.reports(r.auth,q).then(x=>ok(x,r));}
  @Get("open-items") @RequirePermission("accounting.open_item.read") openItems(@Query() q:any,@Req() r:AuthenticatedRequest){return this.s.openItems(r.auth,q).then(x=>ok(x,r));}
  @Post("open-items/:id/allocate") @RequirePermission("accounting.open_item.settle") allocate(@Param("id") id:string,@Body() b:any,@Req() r:AuthenticatedRequest){return this.s.allocateOpenItem(r.auth,id,b,rid(r)).then(x=>ok(x,r));}
  @Get("bank-accounts") @RequirePermission("accounting.bank_account.read") bankAccounts(@Query("bookId") bookId:string,@Req() r:AuthenticatedRequest){return this.s.bankAccounts(r.auth,bookId).then(x=>ok(x,r));}
  @Get("bank-accounts/:bankAccountId/imports") @RequirePermission("accounting.bank_statement.import") bankImports(@Param("bankAccountId") id:string,@Req() r:AuthenticatedRequest){return this.s.bankImports(r.auth,id).then(x=>ok(x,r));}
  @Get("bank-accounts/:bankAccountId/reconciliations") @RequirePermission("accounting.bank_reconciliation.read") reconciliations(@Param("bankAccountId") id:string,@Req() r:AuthenticatedRequest){return this.s.reconciliations(r.auth,id).then(x=>ok(x,r));}
  @Get("statement-snapshots") @RequirePermission("accounting.report.read") snapshots(@Query("bookId") bookId:string,@Req() r:AuthenticatedRequest){return this.s.statementSnapshots(r.auth,bookId).then(x=>ok(x,r));}
}
