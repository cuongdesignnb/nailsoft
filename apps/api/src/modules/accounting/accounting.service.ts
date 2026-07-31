/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import type { AccessClaims } from "../identity/auth.types.js";

const json = (v: unknown) => JSON.stringify(v ?? {});
const fingerprint = (v: unknown) => createHash("sha256").update(json(v)).digest("hex");
const str = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v.trim()) throw new BadRequestException({ code: `${name.toUpperCase()}_REQUIRED` });
  return v.trim();
};

@Injectable()
export class AccountingService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private owner(auth: AccessClaims) {
    return auth.roles.includes("SALON_OWNER") || auth.roles.includes("ACCOUNTANT");
  }
  private guard(auth: AccessClaims) {
    if (!auth.tenantId) throw new ForbiddenException({ code: "TENANT_SCOPE_REQUIRED" });
  }
  private async audit(c: PoolClient, auth: AccessClaims, action: string, entity: string, id: string, before: unknown, after: unknown, requestId: string, reason?: string) {
    await c.query(
      `INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,reason,request_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [auth.tenantId, auth.userId, action, entity, id, before == null ? null : json(before), after == null ? null : json(after), reason ?? null, requestId],
    );
  }
  private async event(c: PoolClient, auth: AccessClaims, type: string, entity: string, id: string, payload: unknown, requestId: string) {
    await c.query(
      `INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [auth.tenantId, type, entity, id, json(payload), json({ type: "USER", id: auth.userId }), json({ requestId, schemaVersion: 1 })],
    );
  }
  private async book(auth: AccessClaims, id: string) {
    this.guard(auth);
    const r = await this.db.query<any>("SELECT * FROM accounting_books WHERE tenant_id=$1 AND id=$2", [auth.tenantId, id]);
    if (!r.rows[0]) throw new NotFoundException({ code: "ACCOUNTING_BOOK_NOT_FOUND" });
    return r.rows[0];
  }
  async books(auth: AccessClaims) {
    this.guard(auth);
    return (await this.db.query<any>("SELECT * FROM accounting_books WHERE tenant_id=$1 ORDER BY code", [auth.tenantId])).rows;
  }
  async createBook(auth: AccessClaims, input: any, requestId: string) {
    this.guard(auth);
    const code = str(input?.code, "book_code");
    const name = str(input?.name, "book_name");
    const currency = str(input?.functionalCurrency ?? input?.currency, "currency").toUpperCase();
    if (currency.length !== 3) throw new BadRequestException({ code: "CURRENCY_INVALID" });
    return this.db.transaction(async (c) => {
      const r = await c.query<any>(`INSERT INTO accounting_books(tenant_id,code,name,functional_currency,timezone,status,configuration_status,posting_mode)
        VALUES($1,$2,$3,$4,$5,'DRAFT','INCOMPLETE','DISABLED') RETURNING *`, [auth.tenantId, code, name, currency, input?.timezone ?? "UTC"]);
      await this.audit(c, auth, "accounting.book_created", "accounting_book", r.rows[0].id, null, r.rows[0], requestId);
      await this.event(c, auth, "accounting.book.created", "accounting_book", r.rows[0].id, { code }, requestId);
      return r.rows[0];
    });
  }
  async activateBook(auth: AccessClaims, id: string, input: any, requestId: string) {
    await this.book(auth, id);
    return this.db.transaction(async (c) => {
      const r = await c.query<any>(`UPDATE accounting_books SET status='ACTIVE',configuration_status='ACTIVE',posting_mode=COALESCE($3,posting_mode),version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND status IN('DRAFT','CONFIGURING') RETURNING *`, [auth.tenantId, id, input?.postingMode ?? null]);
      if (!r.rows[0]) throw new ConflictException({ code: "ACCOUNTING_BOOK_STATE_INVALID" });
      await this.audit(c, auth, "accounting.book_activated", "accounting_book", id, null, r.rows[0], requestId);
      await this.event(c, auth, "accounting.book.activated", "accounting_book", id, {}, requestId);
      return r.rows[0];
    });
  }
  async accounts(auth: AccessClaims, bookId: string) {
    await this.book(auth, bookId);
    return (await this.db.query<any>("SELECT * FROM accounting_accounts WHERE tenant_id=$1 AND book_id=$2 ORDER BY code", [auth.tenantId, bookId])).rows;
  }
  async createAccount(auth: AccessClaims, input: any, requestId: string) {
    const bookId = str(input?.bookId, "book_id"); await this.book(auth, bookId);
    const code = str(input?.code, "account_code"); const name = str(input?.name, "account_name");
    const type = str(input?.accountType ?? input?.type, "account_type").toUpperCase();
    return this.db.transaction(async (c) => {
      const r = await c.query<any>(`INSERT INTO accounting_accounts(tenant_id,book_id,code,name,account_type,control_class,group_id,parent_account_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [auth.tenantId, bookId, code, name, type, input?.controlClass ?? null, input?.groupId ?? null, input?.parentAccountId ?? null]);
      await this.audit(c, auth, "accounting.account_created", "accounting_account", r.rows[0].id, null, r.rows[0], requestId);
      return r.rows[0];
    });
  }
  async updateAccount(auth: AccessClaims, id: string, input: any, requestId: string) {
    const r = await this.db.query<any>("SELECT * FROM accounting_accounts WHERE tenant_id=$1 AND id=$2", [auth.tenantId, id]);
    if (!r.rows[0]) throw new NotFoundException({ code: "ACCOUNT_NOT_FOUND" });
    if (input?.version != null && Number(input.version) !== Number(r.rows[0].version)) throw new ConflictException({ code: "VERSION_CONFLICT" });
    return this.db.transaction(async (c) => {
      const next = await c.query<any>(`UPDATE accounting_accounts SET name=COALESCE($3,name),control_class=COALESCE($4,control_class),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [auth.tenantId, id, input?.name ?? null, input?.controlClass ?? null]);
      await this.audit(c, auth, "accounting.account_updated", "accounting_account", id, r.rows[0], next.rows[0], requestId); return next.rows[0];
    });
  }
  async deactivateAccount(auth: AccessClaims, id: string, input: any, requestId: string) {
    return this.updateAccount(auth, id, { ...input, name: input?.name }, requestId).then(async (x) => {
      await this.db.query("UPDATE accounting_accounts SET active=false,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2", [auth.tenantId, id]); return { ...x, active: false };
    });
  }
  async periods(auth: AccessClaims, bookId: string) { await this.book(auth, bookId); return (await this.db.query<any>("SELECT * FROM accounting_periods WHERE tenant_id=$1 AND book_id=$2 ORDER BY starts_on", [auth.tenantId, bookId])).rows; }
  async createPeriod(auth: AccessClaims, input: any, requestId: string) {
    const bookId = str(input?.bookId, "book_id"); await this.book(auth, bookId);
    return this.db.transaction(async (c) => {
      const fy = await c.query<any>(`INSERT INTO accounting_fiscal_years(tenant_id,book_id,year_no,starts_on,ends_on) VALUES($1,$2,$3,$4,$5) ON CONFLICT(book_id,year_no) DO UPDATE SET starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on RETURNING id`, [auth.tenantId, bookId, input?.yearNo ?? new Date(input.startsOn).getUTCFullYear(), input.startsOn, input.endsOn]);
      const p = await c.query<any>(`INSERT INTO accounting_periods(tenant_id,book_id,fiscal_year_id,code,starts_on,ends_on,state) VALUES($1,$2,$3,$4,$5,$6,'FUTURE') RETURNING *`, [auth.tenantId, bookId, fy.rows[0].id, str(input?.code, "period_code"), input.startsOn, input.endsOn]);
      await this.audit(c, auth, "accounting.period_created", "accounting_period", p.rows[0].id, null, p.rows[0], requestId); return p.rows[0];
    });
  }
  async transitionPeriod(auth: AccessClaims, id: string, target: string, input: any, requestId: string) {
    const allowed: Record<string, string[]> = { OPEN: ["FUTURE","REOPENED"], SOFT_CLOSED: ["OPEN"], PENDING_CLOSE: ["SOFT_CLOSED"], CLOSED: ["PENDING_CLOSE"], REOPEN_PENDING: ["CLOSED"], REOPENED: ["REOPEN_PENDING"] };
    return this.db.transaction(async (c) => {
      const current = await c.query<any>("SELECT * FROM accounting_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [auth.tenantId, id]);
      if (!current.rows[0]) throw new NotFoundException({ code: "ACCOUNTING_PERIOD_NOT_FOUND" });
      if (!allowed[target]?.includes(current.rows[0].state)) throw new ConflictException({ code: "ACCOUNTING_PERIOD_STATE_INVALID" });
      if ((target === "CLOSED" || target === "REOPENED") && !input?.reason) throw new BadRequestException({ code: "REASON_REQUIRED" });
      const next = await c.query<any>("UPDATE accounting_periods SET state=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [auth.tenantId, id, target]);
      await c.query(`INSERT INTO accounting_period_close_history(tenant_id,period_id,from_state,to_state,actor_user_id,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [auth.tenantId,id,current.rows[0].state,target,auth.userId,input?.reason ?? "state transition",requestId]);
      await this.audit(c, auth, `accounting.period_${target.toLowerCase()}`, "accounting_period", id, current.rows[0], next.rows[0], requestId, input?.reason); return next.rows[0];
    });
  }
  async journals(auth: AccessClaims, query: any) { this.guard(auth); const values: any[]=[auth.tenantId]; let where="tenant_id=$1"; if(query?.bookId){values.push(query.bookId);where+=" AND book_id=$"+values.length;} if(query?.state){values.push(query.state);where+=" AND state=$"+values.length;} return (await this.db.query<any>(`SELECT * FROM accounting_journals WHERE ${where} ORDER BY accounting_date DESC,created_at DESC LIMIT 200`, values)).rows; }
  async journal(auth: AccessClaims, id: string) { const j=await this.db.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2",[auth.tenantId,id]); if(!j.rows[0]) throw new NotFoundException({code:"JOURNAL_NOT_FOUND"}); const l=await this.db.query<any>("SELECT * FROM accounting_journal_lines WHERE tenant_id=$1 AND journal_id=$2 ORDER BY line_no",[auth.tenantId,id]); return {...j.rows[0],lines:l.rows}; }
  async createJournal(auth: AccessClaims, input: any, requestId: string, key?: string) {
    const bookId=str(input?.bookId,"book_id"), periodId=str(input?.periodId,"period_id"); await this.book(auth,bookId); const lines=input?.lines; if(!Array.isArray(lines)||lines.length<2) throw new BadRequestException({code:"JOURNAL_LINES_REQUIRED"});
    const debit: bigint = lines.reduce((n: bigint, l: any) => n + BigInt(l.debitMinor ?? 0), 0n);
    const credit: bigint = lines.reduce((n: bigint, l: any) => n + BigInt(l.creditMinor ?? 0), 0n);
    if(debit!==credit||debit<=0n) throw new BadRequestException({code:"JOURNAL_NOT_BALANCED"});
    return this.db.transaction(async(c)=>{ const generation=key??fingerprint({bookId,periodId,lines}); if(key){const old=await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND book_id=$2 AND generation_key=$3",[auth.tenantId,bookId,generation]);if(old.rows[0]){const oldLines=await c.query<any>("SELECT * FROM accounting_journal_lines WHERE tenant_id=$1 AND journal_id=$2 ORDER BY line_no",[auth.tenantId,old.rows[0].id]);return {...old.rows[0],lines:oldLines.rows};}} const j=await c.query<any>(`INSERT INTO accounting_journals(tenant_id,book_id,period_id,journal_type,accounting_date,currency,source_type,source_id,generation_key,requested_by_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[auth.tenantId,bookId,periodId,input?.journalType??"MANUAL",input?.accountingDate,str(input?.currency,"currency").toUpperCase(),input?.sourceType??null,input?.sourceId??null,generation,auth.userId,requestId]); for(let i=0;i<lines.length;i++){const l=lines[i];await c.query(`INSERT INTO accounting_journal_lines(tenant_id,journal_id,line_no,account_id,debit_minor,credit_minor,functional_debit_minor,functional_credit_minor,currency,exchange_numerator,exchange_denominator,branch_id,cost_center_id,staff_id,vendor_id,customer_id,tax_code_id,source_line_reference,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$5,$6,$7,1,1,$8,$9,$10,$11,$12,$13,$14,$15)`,[auth.tenantId,j.rows[0].id,i+1,l.accountId, l.debitMinor??0,l.creditMinor??0,str(input?.currency,"currency").toUpperCase(),l.branchId??null,l.costCenterId??null,l.staffId??null,l.vendorId??null,l.customerId??null,l.taxCodeId??null,l.sourceLineReference??null,fingerprint(l)]);} await this.audit(c,auth,"accounting.journal_created","accounting_journal",j.rows[0].id,null,j.rows[0],requestId); return {...j.rows[0],lines}; });
  }
  async journalTransition(auth: AccessClaims,id:string,target:string,input:any,requestId:string){return this.db.transaction(async(c)=>{const x=await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!x.rows[0])throw new NotFoundException({code:"JOURNAL_NOT_FOUND"});if(input?.version!=null&&Number(input.version)!==Number(x.rows[0].version))throw new ConflictException({code:"VERSION_CONFLICT"});if(target==="APPROVED"&&x.rows[0].requested_by_user_id===auth.userId)throw new ForbiddenException({code:"JOURNAL_SELF_APPROVAL_DENIED"});const valid:Record<string,string[]|undefined>={PENDING_APPROVAL:["DRAFT"],APPROVED:["PENDING_APPROVAL"],REJECTED:["PENDING_APPROVAL"],POSTED:["APPROVED"]};if(!valid[target]?.includes(x.rows[0].state))throw new ConflictException({code:"JOURNAL_STATE_INVALID"});const n=await c.query<any>(`UPDATE accounting_journals SET state=$3,${target==="APPROVED"?"approved_by_user_id=$4,":""}${target==="POSTED"?"posted_by_user_id=$4,posted_at=now(),":""}version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[auth.tenantId,id,target,auth.userId]);await c.query(`INSERT INTO accounting_journal_approval_history(tenant_id,journal_id,from_state,to_state,actor_user_id,reason,fingerprint,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[auth.tenantId,id,x.rows[0].state,target,auth.userId,input?.reason??"state transition",fingerprint({id,target,version:n.rows[0].version}),requestId]);await this.audit(c,auth,`accounting.journal_${target.toLowerCase()}`,"accounting_journal",id,x.rows[0],n.rows[0],requestId,input?.reason);await this.event(c,auth,`accounting.journal.${target.toLowerCase()}`,"accounting_journal",id,{state:target},requestId);return n.rows[0];});}
  async candidates(auth: AccessClaims, q:any){return (await this.db.query<any>("SELECT * FROM accounting_posting_candidates WHERE tenant_id=$1 AND ($2::uuid IS NULL OR book_id=$2) ORDER BY created_at DESC LIMIT 200",[auth.tenantId,q?.bookId??null])).rows;}
  async taxCodes(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT * FROM accounting_tax_codes WHERE tenant_id=$1 AND book_id=$2 ORDER BY code,effective_from DESC",[auth.tenantId,bookId])).rows;}
  async createTaxCode(auth:AccessClaims,input:any,requestId:string){const bookId=str(input?.bookId,"book_id");await this.book(auth,bookId);const num=BigInt(input?.rateNumerator??0),den=BigInt(input?.rateDenominator??0);if(num<0n||den<=0n)throw new BadRequestException({code:"TAX_RATE_INVALID"});return this.db.transaction(async c=>{const body={...input,rateNumerator:num.toString(),rateDenominator:den.toString()};const r=await c.query<any>(`INSERT INTO accounting_tax_codes(tenant_id,book_id,code,jurisdiction_reference,tax_type,rate_numerator,rate_denominator,inclusive,direction,effective_from,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[auth.tenantId,bookId,str(input?.code,"tax_code"),str(input?.jurisdictionReference,"jurisdiction_reference"),input?.taxType??"VAT",num.toString(),den.toString(),Boolean(input?.inclusive),input?.direction??"OUTPUT",input?.effectiveFrom,fingerprint(body)]);await this.audit(c,auth,"accounting.tax_code_created","accounting_tax_code",r.rows[0].id,null,r.rows[0],requestId);return r.rows[0];});}
  async postingRules(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT r.*,json_agg(v ORDER BY v.version_no DESC) FILTER(WHERE v.id IS NOT NULL) versions FROM accounting_posting_rules r LEFT JOIN accounting_posting_rule_versions v ON v.tenant_id=r.tenant_id AND v.rule_id=r.id WHERE r.tenant_id=$1 AND r.book_id=$2 GROUP BY r.id ORDER BY r.code",[auth.tenantId,bookId])).rows;}
  async openingBalances(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT * FROM accounting_opening_balance_imports WHERE tenant_id=$1 AND book_id=$2 ORDER BY created_at DESC",[auth.tenantId,bookId])).rows;}
  async createOpeningBalance(auth:AccessClaims,input:any,requestId:string){const bookId=str(input?.bookId,"book_id");await this.book(auth,bookId);const rows=input?.rows;if(!Array.isArray(rows)||!rows.length)throw new BadRequestException({code:"OPENING_BALANCE_ROWS_REQUIRED"});const d=rows.reduce((n:any,x:any)=>n+BigInt(x.debitMinor??0),0n),c=rows.reduce((n:any,x:any)=>n+BigInt(x.creditMinor??0),0n);if(d!==c)throw new BadRequestException({code:"OPENING_BALANCE_NOT_BALANCED"});return this.db.transaction(async client=>{const i=await client.query<any>(`INSERT INTO accounting_opening_balance_imports(tenant_id,book_id,cutover_date,currency,file_checksum,state,total_debit_minor,total_credit_minor,created_by_user_id) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8) RETURNING *`,[auth.tenantId,bookId,input.cutoverDate,str(input.currency,"currency").toUpperCase(),input.fileChecksum??fingerprint(rows),d.toString(),c.toString(),auth.userId]);for(let n=0;n<rows.length;n++){const x=rows[n];await client.query(`INSERT INTO accounting_opening_balance_rows(tenant_id,import_id,row_no,account_id,debit_minor,credit_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7)`,[auth.tenantId,i.rows[0].id,n+1,x.accountId,x.debitMinor??0,x.creditMinor??0,str(input.currency,"currency").toUpperCase()]);}await this.audit(client,auth,"accounting.opening_balance_created","accounting_opening_balance_import",i.rows[0].id,null,i.rows[0],requestId);return i.rows[0];});}
  async transitionOpeningBalance(auth:AccessClaims,id:string,target:string,input:any,requestId:string){return this.db.transaction(async c=>{const current=await c.query<any>("SELECT * FROM accounting_opening_balance_imports WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!current.rows[0])throw new NotFoundException({code:"OPENING_BALANCE_NOT_FOUND"});if(target==="APPROVED"&&current.rows[0].created_by_user_id===auth.userId)throw new ForbiddenException({code:"OPENING_BALANCE_SELF_APPROVAL_DENIED"});const valid:any={VALIDATED:["DRAFT"],PENDING_APPROVAL:["VALIDATED"],APPROVED:["PENDING_APPROVAL"],POSTED:["APPROVED"]};if(!valid[target]?.includes(current.rows[0].state))throw new ConflictException({code:"OPENING_BALANCE_STATE_INVALID"});const n=await c.query<any>(`UPDATE accounting_opening_balance_imports SET state=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,[auth.tenantId,id,target,auth.userId]);await this.audit(c,auth,`accounting.opening_balance_${target.toLowerCase()}`,"accounting_opening_balance_import",id,current.rows[0],n.rows[0],requestId,input?.reason);return n.rows[0];});}
  async bankImports(auth:AccessClaims,bankAccountId:string){return (await this.db.query<any>("SELECT * FROM accounting_bank_statement_imports WHERE tenant_id=$1 AND bank_account_id=$2 ORDER BY created_at DESC",[auth.tenantId,bankAccountId])).rows;}
  async reconciliations(auth:AccessClaims,bankAccountId:string){return (await this.db.query<any>("SELECT * FROM accounting_bank_reconciliations WHERE tenant_id=$1 AND bank_account_id=$2 ORDER BY created_at DESC",[auth.tenantId,bankAccountId])).rows;}
  async statementSnapshots(auth:AccessClaims,bookId:string){return (await this.db.query<any>("SELECT * FROM accounting_statement_snapshots WHERE tenant_id=$1 AND book_id=$2 ORDER BY created_at DESC",[auth.tenantId,bookId])).rows;}
  async trialBalance(auth:AccessClaims, q:any){const params=[auth.tenantId,q?.bookId??null,q?.periodId??null];return (await this.db.query<any>(`SELECT l.account_id,a.code,a.name,a.account_type,SUM(l.functional_debit_minor)::bigint debit_minor,SUM(l.functional_credit_minor)::bigint credit_minor,SUM(l.functional_debit_minor-l.functional_credit_minor)::bigint balance_minor FROM accounting_journal_lines l JOIN accounting_journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id JOIN accounting_accounts a ON a.id=l.account_id WHERE l.tenant_id=$1 AND j.state='POSTED' AND ($2::uuid IS NULL OR j.book_id=$2) AND ($3::uuid IS NULL OR j.period_id=$3) GROUP BY l.account_id,a.code,a.name,a.account_type ORDER BY a.code`,params)).rows;}
  async generalLedger(auth:AccessClaims,q:any){const params=[auth.tenantId,q?.bookId??null,q?.accountId??null];return (await this.db.query<any>(`SELECT j.id,j.journal_number,j.accounting_date,j.journal_type,l.line_no,l.account_id,a.code,a.name,l.debit_minor,l.credit_minor,l.currency FROM accounting_journal_lines l JOIN accounting_journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id JOIN accounting_accounts a ON a.id=l.account_id WHERE l.tenant_id=$1 AND j.state='POSTED' AND ($2::uuid IS NULL OR j.book_id=$2) AND ($3::uuid IS NULL OR l.account_id=$3) ORDER BY j.accounting_date,j.created_at,l.line_no LIMIT 5000`,params)).rows;}
  async reports(auth:AccessClaims,q:any){return {trialBalance:await this.trialBalance(auth,q),generalLedger:await this.generalLedger(auth,q),generatedAt:new Date().toISOString(),source:"POSTED_JOURNALS"};}
  async profitAndLoss(auth:AccessClaims,q:any){const rows=await this.trialBalance(auth,q);return rows.filter((x:any)=>["REVENUE","EXPENSE","CONTRA_REVENUE","CONTRA_EXPENSE"].includes(x.account_type));}
  async balanceSheet(auth:AccessClaims,q:any){const rows=await this.trialBalance(auth,q);return rows.filter((x:any)=>!["REVENUE","EXPENSE","CONTRA_REVENUE","CONTRA_EXPENSE"].includes(x.account_type));}
  async openItems(auth:AccessClaims,q:any){return (await this.db.query<any>("SELECT * FROM accounting_open_items WHERE tenant_id=$1 AND ($2::uuid IS NULL OR book_id=$2) ORDER BY due_on",[auth.tenantId,q?.bookId??null])).rows;}
  async allocateOpenItem(auth:AccessClaims,id:string,input:any,requestId:string){const value=BigInt(input?.amountMinor??0);if(value<=0n)throw new BadRequestException({code:"ALLOCATION_AMOUNT_INVALID"});return this.db.transaction(async c=>{const x=await c.query<any>("SELECT * FROM accounting_open_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!x.rows[0])throw new NotFoundException({code:"OPEN_ITEM_NOT_FOUND"});const remaining=BigInt(x.rows[0].original_minor)-BigInt(x.rows[0].settled_minor);if(value>remaining)throw new ConflictException({code:"OPEN_ITEM_ALLOCATION_EXCEEDS_BALANCE"});await c.query("UPDATE accounting_open_items SET settled_minor=settled_minor+$3,state=CASE WHEN settled_minor+$3=original_minor THEN 'SETTLED' ELSE 'PARTIALLY_SETTLED' END,version=version+1 WHERE tenant_id=$1 AND id=$2",[auth.tenantId,id,value.toString()]);const a=await c.query<any>(`INSERT INTO accounting_open_item_allocations(tenant_id,open_item_id,settlement_journal_id,amount_minor) VALUES($1,$2,$3,$4) RETURNING *`,[auth.tenantId,id,str(input?.settlementJournalId,"settlement_journal_id"),value.toString()]);await this.audit(c,auth,"accounting.open_item_allocated","accounting_open_item",id,x.rows[0],a.rows[0],requestId);return a.rows[0];});}
  async bankAccounts(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT * FROM accounting_bank_accounts WHERE tenant_id=$1 AND book_id=$2",[auth.tenantId,bookId])).rows;}
}
