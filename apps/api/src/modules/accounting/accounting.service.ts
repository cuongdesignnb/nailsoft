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
import {
  accountingReconciliationAdjustmentApproveSchema,
  accountingReconciliationAdjustmentCancelSchema,
  accountingReconciliationAdjustmentCreateSchema,
  accountingReconciliationAdjustmentPostSchema,
  accountingReconciliationAdjustmentRejectSchema,
  accountingReconciliationAdjustmentSubmitSchema,
  accountingStatementLineExcludeSchema,
  accountingStatementLineRestoreSchema,
} from "@nailsoft/validation";

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
  private present(row: any) {
    return row
      ? Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
            value,
          ]),
        )
      : row;
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

  /** Command idempotency is scoped to tenant + operation.  A replay returns
   * the exact persisted response; a reused key with a different body fails
   * closed rather than executing a second financial command. */
  private async beginCommand(c: PoolClient, auth: AccessClaims, operation: string, key: string | undefined, body: unknown) {
    const idempotencyKey = str(key, "idempotency_key");
    const requestFingerprint = fingerprint(body);
    const inserted = await c.query<any>(
      `INSERT INTO accounting_command_idempotency(tenant_id,operation,idempotency_key,request_fingerprint,state)
       VALUES($1,$2,$3,$4,'PROCESSING') ON CONFLICT DO NOTHING RETURNING id`,
      [auth.tenantId, operation, idempotencyKey, requestFingerprint],
    );
    if (inserted.rows[0]) return { key: idempotencyKey, replay: undefined as unknown };
    const prior = await c.query<any>(
      `SELECT * FROM accounting_command_idempotency
        WHERE tenant_id=$1 AND operation=$2 AND idempotency_key=$3 FOR UPDATE`,
      [auth.tenantId, operation, idempotencyKey],
    );
    if (prior.rows[0]?.request_fingerprint !== requestFingerprint) {
      throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED" });
    }
    if (prior.rows[0]?.response_json) return { key: idempotencyKey, replay: prior.rows[0].response_json };
    throw new ConflictException({ code: "IDEMPOTENCY_REQUEST_IN_PROGRESS" });
  }

  private async completeCommand(c: PoolClient, auth: AccessClaims, operation: string, key: string, response: unknown) {
    await c.query(
      `UPDATE accounting_command_idempotency
          SET state='COMPLETED',response_json=$4,completed_at=now()
        WHERE tenant_id=$1 AND operation=$2 AND idempotency_key=$3`,
      [auth.tenantId, operation, key, json(response)],
    );
  }

  private async statementContext(c: PoolClient, auth: AccessClaims, bankAccountId: string, statementLineId: string) {
    const bank = await c.query<any>(
      `SELECT b.*,ab.functional_currency
         FROM accounting_bank_accounts b
         JOIN accounting_books ab ON ab.tenant_id=b.tenant_id AND ab.id=b.book_id
        WHERE b.tenant_id=$1 AND b.id=$2 FOR UPDATE`,
      [auth.tenantId, bankAccountId],
    );
    if (!bank.rows[0]) throw new NotFoundException({ code: "BANK_ACCOUNT_NOT_FOUND" });
    if (!bank.rows[0].active) throw new ConflictException({ code: "BANK_ACCOUNT_INACTIVE" });
    const line = await c.query<any>(
      `SELECT * FROM accounting_bank_statement_lines
        WHERE tenant_id=$1 AND id=$2 AND bank_account_id=$3 FOR UPDATE`,
      [auth.tenantId, statementLineId, bankAccountId],
    );
    if (!line.rows[0]) throw new NotFoundException({ code: "BANK_STATEMENT_LINE_NOT_FOUND" });
    const period = await c.query<any>(
      `SELECT * FROM accounting_periods
        WHERE tenant_id=$1 AND book_id=$2 AND $3::date BETWEEN starts_on AND ends_on
        ORDER BY starts_on DESC LIMIT 1 FOR UPDATE`,
      [auth.tenantId, bank.rows[0].book_id, line.rows[0].transaction_date],
    );
    if (!period.rows[0]) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_PERIOD_REQUIRED" });
    if (!["OPEN", "REOPENED"].includes(period.rows[0].state)) {
      throw new ConflictException({ code: "ACCOUNTING_PERIOD_NOT_POSTABLE" });
    }
    const reconciliation = await c.query<any>(
      `SELECT * FROM accounting_bank_reconciliations
        WHERE tenant_id=$1 AND bank_account_id=$2 AND period_id=$3
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [auth.tenantId, bankAccountId, period.rows[0].id],
    );
    if (reconciliation.rows[0] && ["RECONCILED", "CLOSED", "VOID_PENDING", "VOIDED"].includes(reconciliation.rows[0].state)) {
      throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_IMMUTABLE" });
    }
    return { bank: bank.rows[0], line: line.rows[0], period: period.rows[0], reconciliation: reconciliation.rows[0] };
  }

  private async adjustmentContext(c: PoolClient, auth: AccessClaims, adjustmentId: string) {
    const adjustment = await c.query<any>(
      `SELECT * FROM accounting_reconciliation_adjustment_requests
        WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [auth.tenantId, adjustmentId],
    );
    if (!adjustment.rows[0]) throw new NotFoundException({ code: "ACCOUNTING_RECONCILIATION_ADJUSTMENT_NOT_FOUND" });
    const reconciliation = await c.query<any>(
      `SELECT r.*,b.account_id AS bank_account_gl_id,b.book_id,b.currency AS bank_currency,ab.functional_currency
         FROM accounting_bank_reconciliations r
         JOIN accounting_bank_accounts b ON b.tenant_id=r.tenant_id AND b.id=r.bank_account_id
         JOIN accounting_books ab ON ab.tenant_id=b.tenant_id AND ab.id=b.book_id
        WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE`,
      [auth.tenantId, adjustment.rows[0].reconciliation_id],
    );
    if (!reconciliation.rows[0]) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_NOT_FOUND" });
    if (!["MATCHING", "REVIEW"].includes(reconciliation.rows[0].state)) {
      throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_STATE_INVALID" });
    }
    if (!reconciliation.rows[0].period_id) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_PERIOD_REQUIRED" });
    const period = await c.query<any>(
      `SELECT * FROM accounting_periods
        WHERE tenant_id=$1 AND id=$2 AND book_id=$3 FOR UPDATE`,
      [auth.tenantId, reconciliation.rows[0].period_id, reconciliation.rows[0].book_id],
    );
    if (!period.rows[0]) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_PERIOD_REQUIRED" });
    if (!["OPEN", "REOPENED"].includes(period.rows[0].state)) throw new ConflictException({ code: "ACCOUNTING_PERIOD_NOT_POSTABLE" });
    return { adjustment: adjustment.rows[0], reconciliation: reconciliation.rows[0], period: period.rows[0] };
  }
  async books(auth: AccessClaims) {
    this.guard(auth);
    return (await this.db.query<any>("SELECT * FROM accounting_books WHERE tenant_id=$1 ORDER BY code", [auth.tenantId])).rows;
  }
  async createBook(auth: AccessClaims, input: any, requestId: string, idempotencyKey = "") {
    this.guard(auth);
    const code = str(input?.code, "book_code");
    const name = str(input?.name, "book_name");
    const currency = str(input?.functionalCurrency ?? input?.currency, "currency").toUpperCase();
    if (currency.length !== 3) throw new BadRequestException({ code: "CURRENCY_INVALID" });
    return this.db.transaction(async (c) => {
      const requestFingerprint = fingerprint({ code, name, currency, timezone: input?.timezone ?? "UTC" });
      if (idempotencyKey) {
        const inserted = await c.query<any>(`INSERT INTO accounting_command_idempotency(tenant_id,operation,idempotency_key,request_fingerprint,state) VALUES($1,'book.create',$2,$3,'PROCESSING') ON CONFLICT DO NOTHING RETURNING id`, [auth.tenantId, idempotencyKey, requestFingerprint]);
        if (!inserted.rows[0]) {
          const prior = await c.query<any>(`SELECT * FROM accounting_command_idempotency WHERE tenant_id=$1 AND operation='book.create' AND idempotency_key=$2 FOR UPDATE`, [auth.tenantId, idempotencyKey]);
          if (prior.rows[0]?.request_fingerprint !== requestFingerprint) throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED" });
          if (prior.rows[0]?.response_json) return prior.rows[0].response_json;
          throw new ConflictException({ code: "IDEMPOTENCY_REQUEST_IN_PROGRESS" });
        }
      }
      const r = await c.query<any>(`INSERT INTO accounting_books(tenant_id,code,name,functional_currency,timezone,status,configuration_status,posting_mode)
        VALUES($1,$2,$3,$4,$5,'DRAFT','INCOMPLETE','DISABLED') RETURNING *`, [auth.tenantId, code, name, currency, input?.timezone ?? "UTC"]);
      await this.audit(c, auth, "accounting.book_created", "accounting_book", r.rows[0].id, null, r.rows[0], requestId);
      await this.event(c, auth, "accounting.book.created", "accounting_book", r.rows[0].id, { code }, requestId);
      if (idempotencyKey) await c.query(`UPDATE accounting_command_idempotency SET state='COMPLETED',response_json=$3,completed_at=now() WHERE tenant_id=$1 AND operation='book.create' AND idempotency_key=$2`, [auth.tenantId, idempotencyKey, json(r.rows[0])]);
      return r.rows[0];
    });
  }
  async activateBook(auth: AccessClaims, id: string, input: any, requestId: string) {
    await this.book(auth, id);
    const readiness = await this.db.query<any>(`SELECT
      (SELECT count(*) FROM accounting_periods WHERE tenant_id=$1 AND book_id=$2) periods,
      (SELECT count(*) FROM accounting_accounts WHERE tenant_id=$1 AND book_id=$2 AND active) active_accounts,
      (SELECT count(*) FROM accounting_configuration_checklists WHERE tenant_id=$1 AND book_id=$2 AND status<>'READY') pending_checklist`, [auth.tenantId, id]);
    const ready = readiness.rows[0];
    if (Number(ready.periods) === 0 || Number(ready.active_accounts) === 0 || Number(ready.pending_checklist) > 0) throw new ConflictException({ code: "ACCOUNTING_BOOK_NOT_READY", message: "Accounting checklist, period and chart-of-accounts readiness are required" });
    if (input?.postingMode === "AUTO_POST" && Number(ready.pending_checklist) > 0) throw new ConflictException({ code: "ACCOUNTING_AUTO_POST_NOT_READY" });
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
    return this.db.transaction(async (c) => {
      const current = await c.query<any>("SELECT * FROM accounting_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [auth.tenantId, id]);
      if (!current.rows[0]) throw new NotFoundException({ code: "ACCOUNT_NOT_FOUND" });
      if (input?.version != null && Number(input.version) !== Number(current.rows[0].version)) throw new ConflictException({ code: "VERSION_CONFLICT" });
      const next = await c.query<any>("UPDATE accounting_accounts SET active=false,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [auth.tenantId, id]);
      await this.audit(c, auth, "accounting.account_deactivated", "accounting_account", id, current.rows[0], next.rows[0], requestId, input?.reason);
      await this.event(c, auth, "accounting.account.deactivated", "accounting_account", id, {}, requestId);
      return next.rows[0];
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
      if ((target === "CLOSED" || target === "REOPENED" || target === "PENDING_CLOSE" || target === "REOPEN_PENDING") && !input?.reason) throw new BadRequestException({ code: "REASON_REQUIRED" });
      if (target === "CLOSED" && current.rows[0].close_requested_by_user_id === auth.userId) throw new ForbiddenException({ code: "ACCOUNTING_PERIOD_SELF_APPROVAL_DENIED" });
      if (target === "REOPENED" && current.rows[0].reopen_requested_by_user_id === auth.userId) throw new ForbiddenException({ code: "ACCOUNTING_PERIOD_SELF_APPROVAL_DENIED" });
      if (target === "CLOSED") {
        const pending = await c.query<any>(`SELECT
          (SELECT count(*) FROM accounting_posting_candidates WHERE tenant_id=$1 AND book_id=$2 AND period_id=$3 AND state NOT IN ('POSTED','IGNORED','REVERSED')) AS candidates,
          (SELECT count(*) FROM accounting_journals WHERE tenant_id=$1 AND book_id=$2 AND period_id=$3 AND state IN ('DRAFT','PENDING_APPROVAL','APPROVED','POSTING','FAILED','REVERSAL_PENDING')) AS journals`, [auth.tenantId, current.rows[0].book_id, id]);
        if (Number(pending.rows[0].candidates) > 0 || Number(pending.rows[0].journals) > 0) throw new ConflictException({ code: "ACCOUNTING_PERIOD_CLOSE_BLOCKED", message: "Posting candidates and journals must be resolved before close" });
      }
      const evidence = target === "PENDING_CLOSE" ? "close_requested_by_user_id=$4" : target === "CLOSED" ? "close_approved_by_user_id=$4" : target === "REOPEN_PENDING" ? "reopen_requested_by_user_id=$4" : target === "REOPENED" ? "reopen_approved_by_user_id=$4" : "";
      const next = await c.query<any>(`UPDATE accounting_periods SET state=$3,${evidence ? `${evidence},` : ""}version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`, evidence ? [auth.tenantId, id, target, auth.userId] : [auth.tenantId, id, target]);
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
  private async allocateJournalNumber(c: PoolClient, tenantId: string, bookId: string, periodId: string) {
    const row = await c.query<any>(`SELECT b.code book_code,f.id fiscal_year_id,f.year_no FROM accounting_books b JOIN accounting_periods p ON p.tenant_id=b.tenant_id AND p.book_id=b.id AND p.id=$3 JOIN accounting_fiscal_years f ON f.tenant_id=p.tenant_id AND f.id=p.fiscal_year_id WHERE b.tenant_id=$1 AND b.id=$2 FOR UPDATE`, [tenantId, bookId, periodId]);
    if (!row.rows[0]) throw new ConflictException({ code: "ACCOUNTING_PERIOD_SCOPE_INVALID" });
    await c.query(`INSERT INTO accounting_journal_number_sequences(tenant_id,book_id,fiscal_year_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, bookId, row.rows[0].fiscal_year_id]);
    const seq = await c.query<any>(`SELECT next_value FROM accounting_journal_number_sequences WHERE tenant_id=$1 AND book_id=$2 AND fiscal_year_id=$3 FOR UPDATE`, [tenantId, bookId, row.rows[0].fiscal_year_id]);
    const value = BigInt(seq.rows[0].next_value);
    await c.query(`UPDATE accounting_journal_number_sequences SET next_value=next_value+1 WHERE tenant_id=$1 AND book_id=$2 AND fiscal_year_id=$3`, [tenantId, bookId, row.rows[0].fiscal_year_id]);
    return `${row.rows[0].book_code}-${row.rows[0].year_no}-${value.toString().padStart(6, "0")}`;
  }
  async postJournal(auth: AccessClaims, id: string, input: any, requestId: string) {
    return this.db.transaction(async (c) => {
      const x = await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [auth.tenantId, id]);
      if (!x.rows[0]) throw new NotFoundException({ code: "JOURNAL_NOT_FOUND" });
      if (input?.version != null && Number(input.version) !== Number(x.rows[0].version)) throw new ConflictException({ code: "VERSION_CONFLICT" });
      if (x.rows[0].state !== "APPROVED") throw new ConflictException({ code: "JOURNAL_STATE_INVALID" });
      const period = await c.query<any>("SELECT * FROM accounting_periods WHERE tenant_id=$1 AND id=$2 AND book_id=$3 FOR UPDATE", [auth.tenantId, x.rows[0].period_id, x.rows[0].book_id]);
      if (!period.rows[0] || !["OPEN", "REOPENED"].includes(period.rows[0].state)) throw new ConflictException({ code: "ACCOUNTING_PERIOD_NOT_POSTABLE" });
      if (x.rows[0].accounting_date < period.rows[0].starts_on || x.rows[0].accounting_date > period.rows[0].ends_on) throw new ConflictException({ code: "ACCOUNTING_DATE_OUTSIDE_PERIOD" });
      const lineTotals = await c.query<any>("SELECT count(*)::int count,coalesce(sum(functional_debit_minor),0)::bigint debit,coalesce(sum(functional_credit_minor),0)::bigint credit FROM accounting_journal_lines WHERE tenant_id=$1 AND journal_id=$2", [auth.tenantId, id]);
      const t = lineTotals.rows[0];
      if (t.count < 2 || BigInt(t.debit) <= 0n || BigInt(t.debit) !== BigInt(t.credit)) throw new BadRequestException({ code: "ACCOUNTING_JOURNAL_NOT_BALANCED" });
      const number = await this.allocateJournalNumber(c, auth.tenantId, x.rows[0].book_id, x.rows[0].period_id);
      const n = await c.query<any>(`UPDATE accounting_journals SET state='POSTED',journal_number=$3,posted_by_user_id=$4,posted_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='APPROVED' RETURNING *`, [auth.tenantId, id, number, auth.userId]);
      if (!n.rows[0]) throw new ConflictException({ code: "JOURNAL_STATE_CONFLICT" });
      await c.query(`INSERT INTO accounting_journal_approval_history(tenant_id,journal_id,from_state,to_state,actor_user_id,reason,fingerprint,request_id) VALUES($1,$2,'APPROVED','POSTED',$3,$4,$5,$6)`, [auth.tenantId, id, auth.userId, input?.reason ?? "post", fingerprint({ id, number }), requestId]);
      await this.audit(c, auth, "accounting.journal_posted", "accounting_journal", id, x.rows[0], n.rows[0], requestId, input?.reason);
      await this.event(c, auth, "accounting.journal.posted", "accounting_journal", id, { journalNumber: number }, requestId);
      if (n.rows[0].reversal_of_journal_id) {
        const original = await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [auth.tenantId, n.rows[0].reversal_of_journal_id]);
        if (original.rows[0]?.state === "POSTED") {
          const reversed = await c.query<any>("UPDATE accounting_journals SET state='REVERSED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='POSTED' RETURNING *", [auth.tenantId, n.rows[0].reversal_of_journal_id]);
          if (reversed.rows[0]) {
            await this.audit(c, auth, "accounting.journal_reversed", "accounting_journal", n.rows[0].reversal_of_journal_id, original.rows[0], reversed.rows[0], requestId, "reversal journal posted");
            await this.event(c, auth, "accounting.journal.reversed", "accounting_journal", n.rows[0].reversal_of_journal_id, { reversalJournalId: id }, requestId);
          }
        }
      }
      return n.rows[0];
    });
  }
  async journalTransition(auth: AccessClaims,id:string,target:string,input:any,requestId:string){return this.db.transaction(async(c)=>{const x=await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!x.rows[0])throw new NotFoundException({code:"JOURNAL_NOT_FOUND"});if(input?.version!=null&&Number(input.version)!==Number(x.rows[0].version))throw new ConflictException({code:"VERSION_CONFLICT"});if(target==="APPROVED"&&x.rows[0].requested_by_user_id===auth.userId)throw new ForbiddenException({code:"JOURNAL_SELF_APPROVAL_DENIED"});const valid:Record<string,string[]|undefined>={PENDING_APPROVAL:["DRAFT"],APPROVED:["PENDING_APPROVAL"],REJECTED:["PENDING_APPROVAL"]};if(!valid[target]?.includes(x.rows[0].state))throw new ConflictException({code:"JOURNAL_STATE_INVALID"});const transitionParams=target==="APPROVED"?[auth.tenantId,id,target,auth.userId]:[auth.tenantId,id,target];const n=await c.query<any>(`UPDATE accounting_journals SET state=$3,${target==="APPROVED"?"approved_by_user_id=$4,":""}version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,transitionParams);await c.query(`INSERT INTO accounting_journal_approval_history(tenant_id,journal_id,from_state,to_state,actor_user_id,reason,fingerprint,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[auth.tenantId,id,x.rows[0].state,target,auth.userId,input?.reason??"state transition",fingerprint({id,target,version:n.rows[0].version}),requestId]);await this.audit(c,auth,`accounting.journal_${target.toLowerCase()}`,"accounting_journal",id,x.rows[0],n.rows[0],requestId,input?.reason);await this.event(c,auth,`accounting.journal.${target.toLowerCase()}`,"accounting_journal",id,{state:target},requestId);return n.rows[0];});}
  async requestJournalReversal(auth: AccessClaims,id:string,input:any,requestId:string){
    const reason=str(input?.reason,"reason");
    return this.db.transaction(async c=>{
      const x=await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);
      if(!x.rows[0]) throw new NotFoundException({code:"JOURNAL_NOT_FOUND"});
      if(x.rows[0].state!=="POSTED") throw new ConflictException({code:"JOURNAL_REVERSAL_NOT_ALLOWED"});
      if(input?.version!=null&&Number(input.version)!==Number(x.rows[0].version)) throw new ConflictException({code:"VERSION_CONFLICT"});
      await c.query(`INSERT INTO accounting_journal_approval_history(tenant_id,journal_id,from_state,to_state,actor_user_id,reason,fingerprint,request_id) VALUES($1,$2,'POSTED','REVERSAL_PENDING',$3,$4,$5,$6)`,[auth.tenantId,id,auth.userId,reason,fingerprint({id,reason,version:x.rows[0].version}),requestId]);
      await this.audit(c,auth,"accounting.journal_reversal_requested","accounting_journal",id,x.rows[0],{state:"REVERSAL_PENDING",reason},requestId,reason);
      await this.event(c,auth,"accounting.journal.reversal_requested","accounting_journal",id,{reason},requestId);
      return {...x.rows[0],reversalRequested:true};
    });
  }
  async approveJournalReversal(auth: AccessClaims,id:string,input:any,requestId:string){
    const reason=str(input?.reason,"reason");
    return this.db.transaction(async c=>{
      const x=await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);
      if(!x.rows[0]) throw new NotFoundException({code:"JOURNAL_NOT_FOUND"});
      if(x.rows[0].state!=="POSTED") throw new ConflictException({code:"JOURNAL_REVERSAL_NOT_ALLOWED"});
      if(x.rows[0].posted_by_user_id===auth.userId) throw new ForbiddenException({code:"JOURNAL_REVERSAL_SELF_APPROVAL_DENIED"});
      const existing=await c.query<any>("SELECT r.* FROM accounting_journal_reversal_links l JOIN accounting_journals r ON r.tenant_id=l.tenant_id AND r.id=l.reversal_journal_id WHERE l.tenant_id=$1 AND l.original_journal_id=$2 FOR UPDATE",[auth.tenantId,id]);
      if(existing.rows[0]) return existing.rows[0];
      const number=await this.allocateJournalNumber(c,auth.tenantId,x.rows[0].book_id,x.rows[0].period_id);
      const reversal=await c.query<any>(`INSERT INTO accounting_journals(tenant_id,book_id,period_id,journal_type,accounting_date,currency,journal_number,source_type,source_id,reversal_of_journal_id,requested_by_user_id,approved_by_user_id,state,evidence_json) VALUES($1,$2,$3,'REVERSAL',$4,$5,$6,'JOURNAL_REVERSAL',$7,$8,$9,$10,'APPROVED',$11) RETURNING *`,[auth.tenantId,x.rows[0].book_id,x.rows[0].period_id,x.rows[0].accounting_date,x.rows[0].currency,number,id,id, x.rows[0].requested_by_user_id,auth.userId,json({reason,originalJournalId:id})]);
      const lines=await c.query<any>("SELECT * FROM accounting_journal_lines WHERE tenant_id=$1 AND journal_id=$2 ORDER BY line_no",[auth.tenantId,id]);
      for(let i=0;i<lines.rows.length;i++){const l=lines.rows[i];await c.query(`INSERT INTO accounting_journal_lines(tenant_id,journal_id,line_no,account_id,debit_minor,credit_minor,functional_debit_minor,functional_credit_minor,currency,exchange_numerator,exchange_denominator,branch_id,cost_center_id,staff_id,vendor_id,customer_id,tax_code_id,source_line_reference,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,[auth.tenantId,reversal.rows[0].id,i+1,l.account_id,l.credit_minor,l.debit_minor,l.functional_credit_minor,l.functional_debit_minor,l.currency,l.exchange_numerator,l.exchange_denominator,l.branch_id,l.cost_center_id,l.staff_id,l.vendor_id,l.customer_id,l.tax_code_id,`REVERSAL:${id}:${l.line_no}`,fingerprint({original:id,line:l.line_no})]);}
      await c.query(`INSERT INTO accounting_journal_reversal_links(tenant_id,original_journal_id,reversal_journal_id,reason,created_by_user_id) VALUES($1,$2,$3,$4,$5)`,[auth.tenantId,id,reversal.rows[0].id,reason,auth.userId]);
      await c.query(`INSERT INTO accounting_journal_approval_history(tenant_id,journal_id,from_state,to_state,actor_user_id,reason,fingerprint,request_id) VALUES($1,$2,'POSTED','REVERSAL_PENDING',$3,$4,$5,$6)`,[auth.tenantId,id,auth.userId,reason,fingerprint({id,reversalId:reversal.rows[0].id}),requestId]);
      await this.audit(c,auth,"accounting.journal_reversal_approved","accounting_journal",id,x.rows[0],reversal.rows[0],requestId,reason);
      await this.event(c,auth,"accounting.journal.reversal_created","accounting_journal",reversal.rows[0].id,{originalJournalId:id},requestId);
      return reversal.rows[0];
    });
  }
  async candidates(auth: AccessClaims, q:any){return (await this.db.query<any>("SELECT * FROM accounting_posting_candidates WHERE tenant_id=$1 AND ($2::uuid IS NULL OR book_id=$2) ORDER BY created_at DESC LIMIT 200",[auth.tenantId,q?.bookId??null])).rows;}
  async taxCodes(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT * FROM accounting_tax_codes WHERE tenant_id=$1 AND book_id=$2 ORDER BY code,effective_from DESC",[auth.tenantId,bookId])).rows;}
  async createTaxCode(auth:AccessClaims,input:any,requestId:string){const bookId=str(input?.bookId,"book_id");await this.book(auth,bookId);const num=BigInt(input?.rateNumerator??0),den=BigInt(input?.rateDenominator??0);if(num<0n||den<=0n)throw new BadRequestException({code:"TAX_RATE_INVALID"});return this.db.transaction(async c=>{const body={...input,rateNumerator:num.toString(),rateDenominator:den.toString()};const r=await c.query<any>(`INSERT INTO accounting_tax_codes(tenant_id,book_id,code,jurisdiction_reference,tax_type,rate_numerator,rate_denominator,inclusive,direction,effective_from,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[auth.tenantId,bookId,str(input?.code,"tax_code"),str(input?.jurisdictionReference,"jurisdiction_reference"),input?.taxType??"VAT",num.toString(),den.toString(),Boolean(input?.inclusive),input?.direction??"OUTPUT",input?.effectiveFrom,fingerprint(body)]);await this.audit(c,auth,"accounting.tax_code_created","accounting_tax_code",r.rows[0].id,null,r.rows[0],requestId);return r.rows[0];});}
  async postingRules(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT r.*,json_agg(v ORDER BY v.version_no DESC) FILTER(WHERE v.id IS NOT NULL) versions FROM accounting_posting_rules r LEFT JOIN accounting_posting_rule_versions v ON v.tenant_id=r.tenant_id AND v.rule_id=r.id WHERE r.tenant_id=$1 AND r.book_id=$2 GROUP BY r.id ORDER BY r.code",[auth.tenantId,bookId])).rows;}
  async openingBalances(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT * FROM accounting_opening_balance_imports WHERE tenant_id=$1 AND book_id=$2 ORDER BY created_at DESC",[auth.tenantId,bookId])).rows;}
  async createOpeningBalance(auth:AccessClaims,input:any,requestId:string){const bookId=str(input?.bookId,"book_id");await this.book(auth,bookId);const rows=input?.rows;if(!Array.isArray(rows)||!rows.length)throw new BadRequestException({code:"OPENING_BALANCE_ROWS_REQUIRED"});const d=rows.reduce((n:any,x:any)=>n+BigInt(x.debitMinor??0),0n),c=rows.reduce((n:any,x:any)=>n+BigInt(x.creditMinor??0),0n);if(d!==c)throw new BadRequestException({code:"OPENING_BALANCE_NOT_BALANCED"});return this.db.transaction(async client=>{const i=await client.query<any>(`INSERT INTO accounting_opening_balance_imports(tenant_id,book_id,cutover_date,currency,file_checksum,state,total_debit_minor,total_credit_minor,created_by_user_id) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8) RETURNING *`,[auth.tenantId,bookId,input.cutoverDate,str(input.currency,"currency").toUpperCase(),input.fileChecksum??fingerprint(rows),d.toString(),c.toString(),auth.userId]);for(let n=0;n<rows.length;n++){const x=rows[n];await client.query(`INSERT INTO accounting_opening_balance_rows(tenant_id,import_id,row_no,account_id,debit_minor,credit_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7)`,[auth.tenantId,i.rows[0].id,n+1,x.accountId,x.debitMinor??0,x.creditMinor??0,str(input.currency,"currency").toUpperCase()]);}await this.audit(client,auth,"accounting.opening_balance_created","accounting_opening_balance_import",i.rows[0].id,null,i.rows[0],requestId);return i.rows[0];});}
  async transitionOpeningBalance(auth:AccessClaims,id:string,target:string,input:any,requestId:string){return this.db.transaction(async c=>{const current=await c.query<any>("SELECT * FROM accounting_opening_balance_imports WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!current.rows[0])throw new NotFoundException({code:"OPENING_BALANCE_NOT_FOUND"});if(target==="APPROVED"&&current.rows[0].created_by_user_id===auth.userId)throw new ForbiddenException({code:"OPENING_BALANCE_SELF_APPROVAL_DENIED"});const valid:any={VALIDATED:["DRAFT"],PENDING_APPROVAL:["VALIDATED"],APPROVED:["PENDING_APPROVAL"],POSTED:["APPROVED"]};if(!valid[target]?.includes(current.rows[0].state))throw new ConflictException({code:"OPENING_BALANCE_STATE_INVALID"});const n=await c.query<any>(`UPDATE accounting_opening_balance_imports SET state=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,[auth.tenantId,id,target,auth.userId]);await this.audit(c,auth,`accounting.opening_balance_${target.toLowerCase()}`,"accounting_opening_balance_import",id,current.rows[0],n.rows[0],requestId,input?.reason);return n.rows[0];});}
  async postOpeningBalance(auth:AccessClaims,id:string,input:any,requestId:string){return this.db.transaction(async c=>{const current=await c.query<any>("SELECT * FROM accounting_opening_balance_imports WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!current.rows[0])throw new NotFoundException({code:"OPENING_BALANCE_NOT_FOUND"});if(current.rows[0].state!=="APPROVED")throw new ConflictException({code:"OPENING_BALANCE_STATE_INVALID"});const rows=await c.query<any>("SELECT * FROM accounting_opening_balance_rows WHERE tenant_id=$1 AND import_id=$2 ORDER BY row_no",[auth.tenantId,id]);const period=await c.query<any>("SELECT * FROM accounting_periods WHERE tenant_id=$1 AND book_id=$2 AND $3::date BETWEEN starts_on AND ends_on AND state IN('OPEN','REOPENED') ORDER BY starts_on LIMIT 1 FOR UPDATE",[auth.tenantId,current.rows[0].book_id,current.rows[0].cutover_date]);if(!period.rows[0])throw new ConflictException({code:"OPENING_BALANCE_PERIOD_NOT_POSTABLE"});const number=await this.allocateJournalNumber(c,auth.tenantId,current.rows[0].book_id,period.rows[0].id);const j=await c.query<any>(`INSERT INTO accounting_journals(tenant_id,book_id,period_id,journal_type,accounting_date,currency,journal_number,requested_by_user_id,approved_by_user_id,state) VALUES($1,$2,$3,'OPENING_BALANCE',$4,$5,$6,$7,$8,'APPROVED') RETURNING *`,[auth.tenantId,current.rows[0].book_id,period.rows[0].id,current.rows[0].cutover_date,current.rows[0].currency,number,current.rows[0].created_by_user_id,current.rows[0].approved_by_user_id]);for(let i=0;i<rows.rows.length;i++){const x=rows.rows[i];await c.query(`INSERT INTO accounting_journal_lines(tenant_id,journal_id,line_no,account_id,debit_minor,credit_minor,functional_debit_minor,functional_credit_minor,currency,exchange_numerator,exchange_denominator) VALUES($1,$2,$3,$4,$5,$6,$5,$6,$7,1,1)`,[auth.tenantId,j.rows[0].id,i+1,x.account_id,x.debit_minor,x.credit_minor,current.rows[0].currency]);}const posted=await c.query<any>(`UPDATE accounting_journals SET state='POSTED',posted_by_user_id=$3,posted_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,[auth.tenantId,j.rows[0].id,auth.userId]);const n=await c.query<any>("UPDATE accounting_opening_balance_imports SET state='POSTED',posted_journal_id=$3,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",[auth.tenantId,id,posted.rows[0].id]);await this.audit(c,auth,"accounting.opening_balance_posted","accounting_opening_balance_import",id,current.rows[0],n.rows[0],requestId,input?.reason);return {...n.rows[0],postedJournal:posted.rows[0]};});}
  async bankImports(auth:AccessClaims,bankAccountId:string){return (await this.db.query<any>("SELECT * FROM accounting_bank_statement_imports WHERE tenant_id=$1 AND bank_account_id=$2 ORDER BY created_at DESC",[auth.tenantId,bankAccountId])).rows;}
  async reconciliations(auth:AccessClaims,bankAccountId:string){return (await this.db.query<any>("SELECT * FROM accounting_bank_reconciliations WHERE tenant_id=$1 AND bank_account_id=$2 ORDER BY created_at DESC",[auth.tenantId,bankAccountId])).rows;}

  /** Bounded, redacted statement-line projection for the reconciliation UI. */
  async statementLines(auth: AccessClaims, bankAccountId: string, limit = 50) {
    this.guard(auth);
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const bank = await this.db.query<any>(
      "SELECT id FROM accounting_bank_accounts WHERE tenant_id=$1 AND id=$2",
      [auth.tenantId, bankAccountId],
    );
    if (!bank.rows[0]) throw new NotFoundException({ code: "BANK_ACCOUNT_NOT_FOUND" });
    const rows = await this.db.query<any>(
      `SELECT id,bank_account_id,import_id,line_no,transaction_date,value_date,
              amount_minor,currency,direction,reference,description,match_state,
              matched_minor,version,created_at
         FROM accounting_bank_statement_lines
        WHERE tenant_id=$1 AND bank_account_id=$2
        ORDER BY transaction_date DESC,line_no DESC
        LIMIT $3`,
      [auth.tenantId, bankAccountId, bounded],
    );
    return rows.rows.map((row) => this.present(row));
  }

  /** Bounded match projection; allocations are represented by a count only. */
  async bankMatches(auth: AccessClaims, query: any = {}) {
    this.guard(auth);
    const bounded = Math.min(Math.max(Number(query?.limit) || 50, 1), 100);
    const rows = await this.db.query<any>(
      `SELECT m.id,m.reconciliation_id,r.bank_account_id,m.match_type,m.state,
              m.total_minor,m.journal_id,m.created_by_user_id,m.confirmed_by_user_id,
              m.created_at,
              (SELECT count(*)::int FROM accounting_bank_match_allocations a
                 WHERE a.tenant_id=m.tenant_id AND a.match_id=m.id) allocation_count
         FROM accounting_bank_matches m
         JOIN accounting_bank_reconciliations r
           ON r.tenant_id=m.tenant_id AND r.id=m.reconciliation_id
        WHERE m.tenant_id=$1
          AND ($2::uuid IS NULL OR r.bank_account_id=$2)
          AND ($3::uuid IS NULL OR m.reconciliation_id=$3)
          AND ($4::text IS NULL OR m.state=$4)
        ORDER BY m.created_at DESC
        LIMIT $5`,
      [auth.tenantId, query?.bankAccountId ?? null, query?.reconciliationId ?? null, query?.status ?? null, bounded],
    );
    return rows.rows.map((row) => this.present(row));
  }

  /**
   * Read-only exception evidence assembled from persisted reconciliation and
   * adjustment-request records. No new exception state or ledger row is made.
   */
  async reconciliationExceptions(auth: AccessClaims, limit = 50) {
    this.guard(auth);
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const [adjustments, reconciliations] = await Promise.all([
      this.db.query<any>(
        `SELECT id,reconciliation_id,amount_minor,reason,state,journal_id,
                requested_by_user_id,approved_by_user_id,version,direction,offset_account_id,accounting_date,updated_at,created_at
           FROM accounting_reconciliation_adjustment_requests
          WHERE tenant_id=$1
          ORDER BY created_at DESC
          LIMIT $2`,
        [auth.tenantId, bounded],
      ),
      this.db.query<any>(
        `SELECT id,bank_account_id,period_id,state,statement_balance_minor,
                ledger_balance_minor,difference_minor,version,created_by_user_id,
                closed_by_user_id,created_at,closed_at
           FROM accounting_bank_reconciliations
          WHERE tenant_id=$1 AND difference_minor<>0
          ORDER BY created_at DESC
          LIMIT $2`,
        [auth.tenantId, bounded],
      ),
    ]);
    return {
      adjustmentRequests: adjustments.rows.map((row) => this.present(row)),
      unreconciledReconciliations: reconciliations.rows.map((row) => this.present(row)),
    };
  }

  async excludeStatementLine(auth: AccessClaims, bankAccountId: string, statementLineId: string, input: unknown, requestId: string, idempotencyKey?: string) {
    const body = accountingStatementLineExcludeSchema.parse(input);
    return this.db.transaction(async (c) => {
      const command = await this.beginCommand(c, auth, "accounting.statement_line.exclude", idempotencyKey, { bankAccountId, statementLineId, ...body });
      if (command.replay !== undefined) return command.replay;
      const context = await this.statementContext(c, auth, bankAccountId, statementLineId);
      const line = context.line;
      if (Number(line.version) !== body.version) throw new ConflictException({ code: "VERSION_CONFLICT" });
      if (line.match_state !== body.expectedMatchState) throw new ConflictException({ code: "ACCOUNTING_STATEMENT_LINE_STATE_INVALID" });
      if (BigInt(line.matched_minor) !== 0n) throw new ConflictException({ code: "ACCOUNTING_STATEMENT_LINE_ALREADY_MATCHED" });
      const allocation = await c.query<any>(
        `SELECT 1 FROM accounting_bank_match_allocations a
          JOIN accounting_bank_matches m ON m.tenant_id=a.tenant_id AND m.id=a.match_id
         WHERE a.tenant_id=$1 AND a.statement_line_id=$2 AND m.state NOT IN('VOIDED','REJECTED') LIMIT 1`,
        [auth.tenantId, statementLineId],
      );
      if (allocation.rows[0]) throw new ConflictException({ code: "ACCOUNTING_STATEMENT_LINE_ACTIVE_ALLOCATION" });
      const next = await c.query<any>(
        `UPDATE accounting_bank_statement_lines
            SET match_state='EXCLUDED',version=version+1
          WHERE tenant_id=$1 AND id=$2 AND version=$3
          RETURNING id,bank_account_id,match_state,matched_minor,version`,
        [auth.tenantId, statementLineId, body.version],
      );
      if (!next.rows[0]) throw new ConflictException({ code: "VERSION_CONFLICT" });
      const before = { id: line.id, bankAccountId: line.bank_account_id, matchState: line.match_state, matchedMinor: String(line.matched_minor), version: line.version };
      const after = { id: next.rows[0].id, bankAccountId: next.rows[0].bank_account_id, matchState: next.rows[0].match_state, matchedMinor: String(next.rows[0].matched_minor), version: next.rows[0].version };
      await this.audit(c, auth, "accounting.statement_line_excluded", "accounting_bank_statement_line", statementLineId, before, after, requestId, body.reason);
      await this.event(c, auth, "accounting.statement_line.excluded", "accounting_bank_statement_line", statementLineId, { bankAccountId, matchState: "EXCLUDED", version: next.rows[0].version }, requestId);
      await this.completeCommand(c, auth, "accounting.statement_line.exclude", command.key, after);
      return after;
    });
  }

  async restoreStatementLine(auth: AccessClaims, bankAccountId: string, statementLineId: string, input: unknown, requestId: string, idempotencyKey?: string) {
    const body = accountingStatementLineRestoreSchema.parse(input);
    return this.db.transaction(async (c) => {
      const command = await this.beginCommand(c, auth, "accounting.statement_line.restore", idempotencyKey, { bankAccountId, statementLineId, ...body });
      if (command.replay !== undefined) return command.replay;
      const context = await this.statementContext(c, auth, bankAccountId, statementLineId);
      const line = context.line;
      if (Number(line.version) !== body.version) throw new ConflictException({ code: "VERSION_CONFLICT" });
      if (line.match_state !== "EXCLUDED") throw new ConflictException({ code: "ACCOUNTING_STATEMENT_LINE_RESTORE_INVALID" });
      const next = await c.query<any>(
        `UPDATE accounting_bank_statement_lines
            SET match_state='UNMATCHED',version=version+1
          WHERE tenant_id=$1 AND id=$2 AND version=$3 AND match_state='EXCLUDED'
          RETURNING id,bank_account_id,match_state,matched_minor,version`,
        [auth.tenantId, statementLineId, body.version],
      );
      if (!next.rows[0]) throw new ConflictException({ code: "VERSION_CONFLICT" });
      const before = { id: line.id, bankAccountId: line.bank_account_id, matchState: line.match_state, matchedMinor: String(line.matched_minor), version: line.version };
      const after = { id: next.rows[0].id, bankAccountId: next.rows[0].bank_account_id, matchState: next.rows[0].match_state, matchedMinor: String(next.rows[0].matched_minor), version: next.rows[0].version };
      await this.audit(c, auth, "accounting.statement_line_restored", "accounting_bank_statement_line", statementLineId, before, after, requestId, body.reason);
      await this.event(c, auth, "accounting.statement_line.restored", "accounting_bank_statement_line", statementLineId, { bankAccountId, matchState: "UNMATCHED", version: next.rows[0].version }, requestId);
      await this.completeCommand(c, auth, "accounting.statement_line.restore", command.key, after);
      return after;
    });
  }

  async createReconciliationAdjustment(auth: AccessClaims, reconciliationId: string, input: unknown, requestId: string, idempotencyKey?: string) {
    const body = accountingReconciliationAdjustmentCreateSchema.parse(input);
    return this.db.transaction(async (c) => {
      const command = await this.beginCommand(c, auth, "accounting.reconciliation_adjustment.create", idempotencyKey, { reconciliationId, ...body });
      if (command.replay !== undefined) return command.replay;
      const reconciliation = await c.query<any>(
        `SELECT r.*,b.account_id AS bank_account_gl_id,b.book_id,b.currency AS bank_currency,ab.functional_currency
           FROM accounting_bank_reconciliations r
           JOIN accounting_bank_accounts b ON b.tenant_id=r.tenant_id AND b.id=r.bank_account_id
           JOIN accounting_books ab ON ab.tenant_id=b.tenant_id AND ab.id=b.book_id
          WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE`,
        [auth.tenantId, reconciliationId],
      );
      if (!reconciliation.rows[0]) throw new NotFoundException({ code: "ACCOUNTING_RECONCILIATION_NOT_FOUND" });
      const r = reconciliation.rows[0];
      if (!["MATCHING", "REVIEW"].includes(r.state)) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_STATE_INVALID" });
      if (!r.period_id) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_PERIOD_REQUIRED" });
      const period = await c.query<any>("SELECT * FROM accounting_periods WHERE tenant_id=$1 AND id=$2 AND book_id=$3 FOR UPDATE", [auth.tenantId, r.period_id, r.book_id]);
      if (!period.rows[0]) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_PERIOD_REQUIRED" });
      if (!["OPEN", "REOPENED"].includes(period.rows[0].state)) throw new ConflictException({ code: "ACCOUNTING_PERIOD_NOT_POSTABLE" });
      if (body.accountingDate < period.rows[0].starts_on || body.accountingDate > period.rows[0].ends_on) throw new ConflictException({ code: "ACCOUNTING_DATE_OUTSIDE_PERIOD" });
      if (String(r.bank_currency).trim() !== String(r.functional_currency).trim()) throw new ConflictException({ code: "ACCOUNTING_ADJUSTMENT_FX_UNSUPPORTED" });
      const offset = await c.query<any>("SELECT * FROM accounting_accounts WHERE tenant_id=$1 AND id=$2 AND book_id=$3 AND active FOR UPDATE", [auth.tenantId, body.offsetAccountId, r.book_id]);
      if (!offset.rows[0]) throw new ConflictException({ code: "ACCOUNTING_ADJUSTMENT_OFFSET_ACCOUNT_INVALID" });
      if (offset.rows[0].id === r.bank_account_gl_id) throw new ConflictException({ code: "ACCOUNTING_ADJUSTMENT_OFFSET_ACCOUNT_INVALID" });
      const row = await c.query<any>(
        `INSERT INTO accounting_reconciliation_adjustment_requests
          (tenant_id,reconciliation_id,amount_minor,reason,state,requested_by_user_id,version,direction,offset_account_id,accounting_date)
         VALUES($1,$2,$3,$4,'DRAFT',$5,1,$6,$7,$8) RETURNING *`,
        [auth.tenantId, reconciliationId, body.amountMinor, body.reason, auth.userId, body.direction, body.offsetAccountId, body.accountingDate],
      );
      await c.query(
        `INSERT INTO accounting_reconciliation_adjustment_history(tenant_id,adjustment_request_id,from_state,to_state,actor_user_id,reason,request_id)
         VALUES($1,$2,NULL,'DRAFT',$3,$4,$5)`,
        [auth.tenantId, row.rows[0].id, auth.userId, body.reason, requestId],
      );
      await this.audit(c, auth, "accounting.reconciliation_adjustment_created", "accounting_reconciliation_adjustment_request", row.rows[0].id, null, row.rows[0], requestId, body.reason);
      await this.event(c, auth, "accounting.reconciliation_adjustment.created", "accounting_reconciliation_adjustment_request", row.rows[0].id, { reconciliationId, state: "DRAFT", version: 1 }, requestId);
      await this.completeCommand(c, auth, "accounting.reconciliation_adjustment.create", command.key, row.rows[0]);
      return row.rows[0];
    });
  }

  private async transitionReconciliationAdjustment(auth: AccessClaims, adjustmentId: string, target: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED", input: unknown, requestId: string, idempotencyKey?: string) {
    const schema = target === "REJECTED" ? accountingReconciliationAdjustmentRejectSchema : target === "CANCELLED" ? accountingReconciliationAdjustmentCancelSchema : target === "APPROVED" ? accountingReconciliationAdjustmentApproveSchema : accountingReconciliationAdjustmentSubmitSchema;
    const actionByTarget = { PENDING_APPROVAL: "submit", APPROVED: "approve", REJECTED: "reject", CANCELLED: "cancel" } as const;
    const eventByTarget = { PENDING_APPROVAL: "submitted", APPROVED: "approved", REJECTED: "rejected", CANCELLED: "cancelled" } as const;
    const action = actionByTarget[target];
    const eventAction = eventByTarget[target];
    const operation = `accounting.reconciliation_adjustment.${action}`;
    const body = schema.parse(input);
    return this.db.transaction(async (c) => {
      const command = await this.beginCommand(c, auth, operation, idempotencyKey, { adjustmentId, ...body });
      if (command.replay !== undefined) return command.replay;
      const context = await this.adjustmentContext(c, auth, adjustmentId);
      const current = context.adjustment;
      if (Number(current.version) !== body.version) throw new ConflictException({ code: "VERSION_CONFLICT" });
      const allowed: Record<string, string[]> = { PENDING_APPROVAL: ["DRAFT"], APPROVED: ["PENDING_APPROVAL"], REJECTED: ["PENDING_APPROVAL"], CANCELLED: ["DRAFT", "PENDING_APPROVAL"] };
      if (!allowed[target]?.includes(current.state)) throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_ADJUSTMENT_STATE_INVALID" });
      if (target === "APPROVED" && current.requested_by_user_id === auth.userId) throw new ForbiddenException({ code: "ACCOUNTING_RECONCILIATION_SELF_APPROVAL_DENIED" });
      const next = await c.query<any>(
        `UPDATE accounting_reconciliation_adjustment_requests
            SET state=$3,approved_by_user_id=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by_user_id END,
                version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND version=$5 RETURNING *`,
        [auth.tenantId, adjustmentId, target, auth.userId, body.version],
      );
      if (!next.rows[0]) throw new ConflictException({ code: "VERSION_CONFLICT" });
      const reason = body.reason ?? `transition to ${target}`;
      await c.query(
        `INSERT INTO accounting_reconciliation_adjustment_history(tenant_id,adjustment_request_id,from_state,to_state,actor_user_id,reason,request_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [auth.tenantId, adjustmentId, current.state, target, auth.userId, reason, requestId],
      );
      await this.audit(c, auth, `accounting.reconciliation_adjustment_${eventAction}`, "accounting_reconciliation_adjustment_request", adjustmentId, current, next.rows[0], requestId, reason);
      await this.event(c, auth, `accounting.reconciliation_adjustment.${eventAction}`, "accounting_reconciliation_adjustment_request", adjustmentId, { state: target, version: next.rows[0].version }, requestId);
      await this.completeCommand(c, auth, operation, command.key, next.rows[0]);
      return next.rows[0];
    });
  }

  async submitReconciliationAdjustment(auth: AccessClaims, id: string, input: unknown, requestId: string, key?: string) { return this.transitionReconciliationAdjustment(auth, id, "PENDING_APPROVAL", input, requestId, key); }
  async approveReconciliationAdjustment(auth: AccessClaims, id: string, input: unknown, requestId: string, key?: string) { return this.transitionReconciliationAdjustment(auth, id, "APPROVED", input, requestId, key); }
  async rejectReconciliationAdjustment(auth: AccessClaims, id: string, input: unknown, requestId: string, key?: string) { return this.transitionReconciliationAdjustment(auth, id, "REJECTED", input, requestId, key); }
  async cancelReconciliationAdjustment(auth: AccessClaims, id: string, input: unknown, requestId: string, key?: string) { return this.transitionReconciliationAdjustment(auth, id, "CANCELLED", input, requestId, key); }

  async postReconciliationAdjustment(auth: AccessClaims, adjustmentId: string, input: unknown, requestId: string, idempotencyKey?: string) {
    const body = accountingReconciliationAdjustmentPostSchema.parse(input);
    return this.db.transaction(async (c) => {
      const command = await this.beginCommand(c, auth, "accounting.reconciliation_adjustment.post", idempotencyKey, { adjustmentId, ...body });
      if (command.replay !== undefined) return command.replay;
      const context = await this.adjustmentContext(c, auth, adjustmentId);
      const { adjustment, reconciliation: r, period } = context;
      if (Number(adjustment.version) !== body.version) throw new ConflictException({ code: "VERSION_CONFLICT" });
      if (adjustment.state !== "APPROVED") throw new ConflictException({ code: "ACCOUNTING_RECONCILIATION_ADJUSTMENT_STATE_INVALID" });
      if (!adjustment.direction || !adjustment.offset_account_id || !adjustment.accounting_date) throw new ConflictException({ code: "ACCOUNTING_ADJUSTMENT_POSTING_DETAILS_MISSING" });
      if (adjustment.accounting_date < period.starts_on || adjustment.accounting_date > period.ends_on) throw new ConflictException({ code: "ACCOUNTING_DATE_OUTSIDE_PERIOD" });
      if (String(r.bank_currency).trim() !== String(r.functional_currency).trim()) throw new ConflictException({ code: "ACCOUNTING_ADJUSTMENT_FX_UNSUPPORTED" });
      const offset = await c.query<any>("SELECT * FROM accounting_accounts WHERE tenant_id=$1 AND id=$2 AND book_id=$3 AND active FOR UPDATE", [auth.tenantId, adjustment.offset_account_id, r.book_id]);
      if (!offset.rows[0] || offset.rows[0].id === r.bank_account_gl_id) throw new ConflictException({ code: "ACCOUNTING_ADJUSTMENT_OFFSET_ACCOUNT_INVALID" });
      const amount = BigInt(adjustment.amount_minor);
      const number = await this.allocateJournalNumber(c, auth.tenantId, r.book_id, r.period_id);
      const generationKey = `accounting-reconciliation-adjustment:${adjustmentId}`;
      const journal = await c.query<any>(
        `INSERT INTO accounting_journals
          (tenant_id,book_id,period_id,journal_type,accounting_date,currency,source_type,source_id,generation_key,requested_by_user_id,approved_by_user_id,state,request_id)
         VALUES($1,$2,$3,'BANK_ADJUSTMENT',$4,$5,'ACCOUNTING_RECONCILIATION_ADJUSTMENT',$6,$7,$8,$9,'APPROVED',$10) RETURNING *`,
        [auth.tenantId, r.book_id, r.period_id, adjustment.accounting_date, r.bank_currency, adjustmentId, generationKey, adjustment.requested_by_user_id, adjustment.approved_by_user_id, requestId],
      );
      const bankDebit = adjustment.direction === "DEBIT" ? amount.toString() : "0";
      const bankCredit = adjustment.direction === "CREDIT" ? amount.toString() : "0";
      const offsetDebit = adjustment.direction === "CREDIT" ? amount.toString() : "0";
      const offsetCredit = adjustment.direction === "DEBIT" ? amount.toString() : "0";
      const lines = [
        { accountId: r.bank_account_gl_id, debit: bankDebit, credit: bankCredit },
        { accountId: adjustment.offset_account_id, debit: offsetDebit, credit: offsetCredit },
      ];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line) continue;
        await c.query(
          `INSERT INTO accounting_journal_lines
            (tenant_id,journal_id,line_no,account_id,debit_minor,credit_minor,functional_debit_minor,functional_credit_minor,currency,exchange_numerator,exchange_denominator,source_line_reference,fingerprint)
           VALUES($1,$2,$3,$4,$5,$6,$5,$6,$7,1,1,$8,$9)`,
          [auth.tenantId, journal.rows[0].id, index + 1, line.accountId, line.debit, line.credit, r.bank_currency, `RECONCILIATION_ADJUSTMENT:${adjustmentId}:${index + 1}`, fingerprint({ adjustmentId, index, accountId: line.accountId, debit: line.debit, credit: line.credit })],
        );
      }
      const postedJournal = await c.query<any>(
        `UPDATE accounting_journals
            SET state='POSTED',journal_number=$3,posted_by_user_id=$4,posted_at=now(),version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND state='APPROVED' RETURNING *`,
        [auth.tenantId, journal.rows[0].id, number, auth.userId],
      );
      if (!postedJournal.rows[0]) throw new ConflictException({ code: "ACCOUNTING_JOURNAL_STATE_CONFLICT" });
      const delta = adjustment.direction === "DEBIT" ? amount : -amount;
      const nextReconciliation = await c.query<any>(
        `UPDATE accounting_bank_reconciliations
            SET ledger_balance_minor=ledger_balance_minor+$3,
                difference_minor=statement_balance_minor-(ledger_balance_minor+$3),version=version+1
          WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [auth.tenantId, adjustment.reconciliation_id, delta.toString()],
      );
      const nextAdjustment = await c.query<any>(
        `UPDATE accounting_reconciliation_adjustment_requests
            SET state='POSTED',journal_id=$3,version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND state='APPROVED' AND version=$4 RETURNING *`,
        [auth.tenantId, adjustmentId, postedJournal.rows[0].id, body.version],
      );
      if (!nextAdjustment.rows[0]) throw new ConflictException({ code: "VERSION_CONFLICT" });
      await c.query(
        `INSERT INTO accounting_reconciliation_adjustment_history(tenant_id,adjustment_request_id,from_state,to_state,actor_user_id,reason,request_id)
         VALUES($1,$2,'APPROVED','POSTED',$3,$4,$5)`,
        [auth.tenantId, adjustmentId, auth.userId, body.reason ?? "post", requestId],
      );
      await this.audit(c, auth, "accounting.reconciliation_adjustment_posted", "accounting_reconciliation_adjustment_request", adjustmentId, adjustment, nextAdjustment.rows[0], requestId, body.reason);
      await this.event(c, auth, "accounting.reconciliation_adjustment.posted", "accounting_reconciliation_adjustment_request", adjustmentId, { journalId: postedJournal.rows[0].id, reconciliationId: adjustment.reconciliation_id, version: nextAdjustment.rows[0].version }, requestId);
      const response = { adjustment: nextAdjustment.rows[0], journal: postedJournal.rows[0], reconciliation: nextReconciliation.rows[0] };
      await this.completeCommand(c, auth, "accounting.reconciliation_adjustment.post", command.key, response);
      return response;
    });
  }
  async statementSnapshots(auth:AccessClaims,bookId:string){return (await this.db.query<any>("SELECT * FROM accounting_statement_snapshots WHERE tenant_id=$1 AND book_id=$2 ORDER BY created_at DESC",[auth.tenantId,bookId])).rows;}
  async trialBalance(auth:AccessClaims, q:any){const bookId=str(q?.bookId,"book_id");await this.book(auth,bookId);const params=[auth.tenantId,bookId,q?.periodId??null];return (await this.db.query<any>(`WITH bounds AS (SELECT starts_on,ends_on FROM accounting_periods WHERE tenant_id=$1 AND book_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY starts_on DESC LIMIT 1), lines AS (SELECT l.account_id,a.code,a.name,a.account_type,a.control_class,j.accounting_date,l.functional_debit_minor,l.functional_credit_minor FROM accounting_journal_lines l JOIN accounting_journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id JOIN accounting_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id WHERE l.tenant_id=$1 AND j.state='POSTED' AND j.book_id=$2) SELECT account_id,code,name,account_type,control_class,coalesce(sum(functional_debit_minor) FILTER(WHERE accounting_date<(SELECT starts_on FROM bounds)),0)::bigint opening_debit_minor,coalesce(sum(functional_credit_minor) FILTER(WHERE accounting_date<(SELECT starts_on FROM bounds)),0)::bigint opening_credit_minor,coalesce(sum(functional_debit_minor) FILTER(WHERE accounting_date BETWEEN (SELECT starts_on FROM bounds) AND (SELECT ends_on FROM bounds)),0)::bigint period_debit_minor,coalesce(sum(functional_credit_minor) FILTER(WHERE accounting_date BETWEEN (SELECT starts_on FROM bounds) AND (SELECT ends_on FROM bounds)),0)::bigint period_credit_minor,coalesce(sum(functional_debit_minor),0)::bigint closing_debit_minor,coalesce(sum(functional_credit_minor),0)::bigint closing_credit_minor,coalesce(sum(functional_debit_minor-functional_credit_minor),0)::bigint balance_minor FROM lines GROUP BY account_id,code,name,account_type,control_class ORDER BY code`,params)).rows;}
  async generalLedger(auth:AccessClaims,q:any){const bookId=str(q?.bookId,"book_id");await this.book(auth,bookId);const params=[auth.tenantId,bookId,q?.accountId??null];return (await this.db.query<any>(`SELECT j.id,j.journal_number,j.accounting_date,j.journal_type,l.line_no,l.account_id,a.code,a.name,l.debit_minor,l.credit_minor,l.currency FROM accounting_journal_lines l JOIN accounting_journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id JOIN accounting_accounts a ON a.id=l.account_id WHERE l.tenant_id=$1 AND j.state='POSTED' AND j.book_id=$2 AND ($3::uuid IS NULL OR l.account_id=$3) ORDER BY j.accounting_date,j.created_at,l.line_no LIMIT 5000`,params)).rows;}
  async reports(auth:AccessClaims,q:any){return {trialBalance:await this.trialBalance(auth,q),generalLedger:await this.generalLedger(auth,q),generatedAt:new Date().toISOString(),source:"POSTED_JOURNALS"};}
  async profitAndLoss(auth:AccessClaims,q:any){const rows=await this.trialBalance(auth,q);const revenue=rows.filter((x:any)=>x.account_type==="REVENUE").reduce((n:any,x:any)=>n+BigInt(x.period_credit_minor)-BigInt(x.period_debit_minor),0n);const contraRevenue=rows.filter((x:any)=>x.account_type==="CONTRA_REVENUE").reduce((n:any,x:any)=>n+BigInt(x.period_debit_minor)-BigInt(x.period_credit_minor),0n);const cogs=rows.filter((x:any)=>x.account_type==="EXPENSE"&&x.control_class==="COGS").reduce((n:any,x:any)=>n+BigInt(x.period_debit_minor)-BigInt(x.period_credit_minor),0n);const operating=rows.filter((x:any)=>x.account_type==="EXPENSE"&&x.control_class!=="COGS").reduce((n:any,x:any)=>n+BigInt(x.period_debit_minor)-BigInt(x.period_credit_minor),0n);const gross=revenue-contraRevenue-cogs;return {rows,totals:{revenue:revenue.toString(),contraRevenue:contraRevenue.toString(),cogs:cogs.toString(),grossProfit:gross.toString(),operatingExpenses:operating.toString(),operatingProfit:(gross-operating).toString()}};}
  async balanceSheet(auth:AccessClaims,q:any){const rows=await this.trialBalance(auth,q);const earnings=await this.profitAndLoss(auth,q);const assets=rows.filter((x:any)=>["ASSET","CONTRA_ASSET"].includes(x.account_type)).reduce((n:any,x:any)=>n+BigInt(x.balance_minor),0n);const liabilities=rows.filter((x:any)=>["LIABILITY","CONTRA_LIABILITY"].includes(x.account_type)).reduce((n:any,x:any)=>n-BigInt(x.balance_minor),0n);const equity=rows.filter((x:any)=>x.account_type==="EQUITY").reduce((n:any,x:any)=>n-BigInt(x.balance_minor),0n)+BigInt(earnings.totals.operatingProfit);return {rows,totals:{assets:assets.toString(),liabilities:liabilities.toString(),equity:equity.toString(),balanced:(assets===liabilities+equity)}};}
  async openItems(auth:AccessClaims,q:any){return (await this.db.query<any>("SELECT * FROM accounting_open_items WHERE tenant_id=$1 AND ($2::uuid IS NULL OR book_id=$2) ORDER BY due_on",[auth.tenantId,q?.bookId??null])).rows;}
  async allocateOpenItem(auth:AccessClaims,id:string,input:any,requestId:string){
    const value=BigInt(input?.amountMinor??0); if(value<=0n) throw new BadRequestException({code:"ALLOCATION_AMOUNT_INVALID"});
    const settlementJournalId=str(input?.settlementJournalId,"settlement_journal_id");
    return this.db.transaction(async c=>{
      const x=await c.query<any>("SELECT * FROM accounting_open_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);
      if(!x.rows[0]) throw new NotFoundException({code:"OPEN_ITEM_NOT_FOUND"});
      const journal=await c.query<any>("SELECT * FROM accounting_journals WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,settlementJournalId]);
      if(!journal.rows[0]||journal.rows[0].book_id!==x.rows[0].book_id||journal.rows[0].state!=="POSTED"||journal.rows[0].currency!==x.rows[0].currency) throw new ConflictException({code:"SETTLEMENT_JOURNAL_NOT_POSTED"});
      const remaining=BigInt(x.rows[0].original_minor)-BigInt(x.rows[0].settled_minor); if(value>remaining) throw new ConflictException({code:"OPEN_ITEM_ALLOCATION_EXCEEDS_BALANCE"});
      await c.query("UPDATE accounting_open_items SET settled_minor=settled_minor+$3,state=CASE WHEN settled_minor+$3=original_minor THEN 'SETTLED' ELSE 'PARTIALLY_SETTLED' END,version=version+1 WHERE tenant_id=$1 AND id=$2",[auth.tenantId,id,value.toString()]);
      const a=await c.query<any>(`INSERT INTO accounting_open_item_allocations(tenant_id,open_item_id,settlement_journal_id,amount_minor) VALUES($1,$2,$3,$4) RETURNING *`,[auth.tenantId,id,settlementJournalId,value.toString()]);
      await this.audit(c,auth,"accounting.open_item_allocated","accounting_open_item",id,x.rows[0],a.rows[0],requestId); return a.rows[0];
    });
  }
  async bankAccounts(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT * FROM accounting_bank_accounts WHERE tenant_id=$1 AND book_id=$2",[auth.tenantId,bookId])).rows;}

  async createSourcePosting(auth:AccessClaims,input:any,requestId:string,key?:string){
    const bookId=str(input?.bookId,"book_id"); await this.book(auth,bookId);
    const sourceType=str(input?.sourceType,"source_type").toUpperCase();
    const supported=["POS_SALE","PAYMENT","REFUND","GIFT_CARD","CUSTOMER_CREDIT","INVENTORY","PAYROLL","TIP","PLATFORM_SUBSCRIPTION_EXPENSE"];
    if(!supported.includes(sourceType)) throw new BadRequestException({code:"SOURCE_TYPE_UNSUPPORTED"});
    const sourceId=str(input?.sourceId,"source_id"); const eventType=str(input?.eventType??sourceType,"event_type");
    const lines=input?.lines; if(!Array.isArray(lines)||lines.length<2) throw new BadRequestException({code:"SOURCE_LINES_REQUIRED"});
    const debit=lines.reduce((n:any,l:any)=>n+BigInt(l.debitMinor??0),0n),credit=lines.reduce((n:any,l:any)=>n+BigInt(l.creditMinor??0),0n);
    if(debit<=0n||debit!==credit) throw new BadRequestException({code:"SOURCE_NOT_BALANCED"});
    const payload={...input,lines:lines.map((l:any)=>({...l,debitMinor:String(l.debitMinor??0),creditMinor:String(l.creditMinor??0)}))};
    const sourceFingerprint=fingerprint({sourceType,sourceId,eventType,payload}); const generationKey=String(input?.generationKey??`${sourceType}:${sourceId}:${eventType}`);
    return this.db.transaction(async c=>{
      if(key){const fp=fingerprint({bookId,sourceType,sourceId,eventType,payload});const ins=await c.query<any>(`INSERT INTO accounting_command_idempotency(tenant_id,operation,idempotency_key,request_fingerprint,state) VALUES($1,'accounting.source_posting',$2,$3,'PROCESSING') ON CONFLICT DO NOTHING RETURNING id`,[auth.tenantId,key,fp]);if(!ins.rows[0]){const prior=await c.query<any>("SELECT * FROM accounting_command_idempotency WHERE tenant_id=$1 AND operation='accounting.source_posting' AND idempotency_key=$2 FOR UPDATE",[auth.tenantId,key]);if(prior.rows[0]?.request_fingerprint!==fp)throw new ConflictException({code:"IDEMPOTENCY_KEY_REUSED"});if(prior.rows[0]?.response_json)return prior.rows[0].response_json;throw new ConflictException({code:"IDEMPOTENCY_REQUEST_IN_PROGRESS"});}}
      const old=await c.query<any>("SELECT * FROM accounting_posting_candidates WHERE tenant_id=$1 AND book_id=$2 AND source_type=$3 AND source_id=$4 AND generation_key=$5 FOR UPDATE",[auth.tenantId,bookId,sourceType,sourceId,generationKey]);
      if(old.rows[0]){if(old.rows[0].source_fingerprint!==sourceFingerprint)throw new ConflictException({code:"SOURCE_EVENT_DUPLICATE"});if(key)await c.query("UPDATE accounting_command_idempotency SET state='COMPLETED',response_json=$3,completed_at=now() WHERE tenant_id=$1 AND operation='accounting.source_posting' AND idempotency_key=$2",[auth.tenantId,key,json(old.rows[0])]);return old.rows[0];}
      const periodId=str(input?.periodId,"period_id");
      const p=await c.query<any>("SELECT id,state FROM accounting_periods WHERE tenant_id=$1 AND book_id=$2 AND id=$3",[auth.tenantId,bookId,periodId]);
      if(!p.rows[0])throw new ConflictException({code:"ACCOUNTING_PERIOD_SCOPE_INVALID"});
      const row=await c.query<any>(`INSERT INTO accounting_posting_candidates(tenant_id,book_id,period_id,source_type,source_id,source_event_type,source_payload_json,source_fingerprint,generation_key,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING') RETURNING *`,[auth.tenantId,bookId,periodId,sourceType,sourceId,eventType,json(payload),sourceFingerprint,generationKey]);
      await c.query(`INSERT INTO accounting_source_posting_history(tenant_id,candidate_id,to_state,source_fingerprint,request_id) VALUES($1,$2,'PENDING',$3,$4)`,[auth.tenantId,row.rows[0].id,sourceFingerprint,requestId]);
      await this.audit(c,auth,"accounting.source_posting_created","accounting_posting_candidate",row.rows[0].id,null,row.rows[0],requestId);
      await this.event(c,auth,"accounting.source_posting.created","accounting_posting_candidate",row.rows[0].id,{sourceType,eventType,refetch:true},requestId);
      if(key)await c.query("UPDATE accounting_command_idempotency SET state='COMPLETED',response_json=$3,completed_at=now() WHERE tenant_id=$1 AND operation='accounting.source_posting' AND idempotency_key=$2",[auth.tenantId,key,json(row.rows[0])]);
      return row.rows[0];
    });
  }

  async sourceMappings(auth:AccessClaims,bookId:string){await this.book(auth,bookId);return (await this.db.query<any>("SELECT * FROM accounting_source_adapter_mappings WHERE tenant_id=$1 AND book_id=$2 ORDER BY source_type,event_type,version_no DESC",[auth.tenantId,bookId])).rows;}
  async createSourceMapping(auth:AccessClaims,input:any,requestId:string){const bookId=str(input?.bookId,"book_id"),sourceType=str(input?.sourceType,"source_type").toUpperCase(),eventType=str(input?.eventType??sourceType,"event_type"),mapping=input?.mapping??input?.mappingJson??{};await this.book(auth,bookId);if(!mapping||!Array.isArray(mapping.lines)||mapping.lines.length<2)throw new BadRequestException({code:"SOURCE_MAPPING_LINES_REQUIRED"});const debit=mapping.lines.reduce((n:any,l:any)=>n+BigInt(l.debitMinor??0),0n),credit=mapping.lines.reduce((n:any,l:any)=>n+BigInt(l.creditMinor??0),0n);if(debit<=0n||debit!==credit)throw new BadRequestException({code:"SOURCE_MAPPING_NOT_BALANCED"});return this.db.transaction(async c=>{const current=await c.query<any>("SELECT coalesce(max(version_no),0)::int version_no FROM accounting_source_adapter_mappings WHERE tenant_id=$1 AND book_id=$2 AND source_type=$3 AND event_type=$4",[auth.tenantId,bookId,sourceType,eventType]);const versionNo=Number(input?.versionNo??current.rows[0].version_no+1);await c.query("UPDATE accounting_source_adapter_mappings SET state='SUPERSEDED',effective_to=now() WHERE tenant_id=$1 AND book_id=$2 AND source_type=$3 AND event_type=$4 AND state='ACTIVE'",[auth.tenantId,bookId,sourceType,eventType]);const row=await c.query<any>(`INSERT INTO accounting_source_adapter_mappings(tenant_id,book_id,source_type,event_type,version_no,mapping_json,fingerprint,state,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8) RETURNING *`,[auth.tenantId,bookId,sourceType,eventType,versionNo,json(mapping),fingerprint({sourceType,eventType,versionNo,mapping}),auth.userId]);await this.audit(c,auth,"accounting.source_mapping_created","accounting_source_adapter_mapping",row.rows[0].id,null,row.rows[0],requestId);await this.event(c,auth,"accounting.source_mapping.updated","accounting_source_adapter_mapping",row.rows[0].id,{sourceType,eventType,versionNo,refetch:true},requestId);return row.rows[0];});}

  async createBankAccount(auth:AccessClaims,input:any,requestId:string,key?:string){
    const bookId=str(input?.bookId,"book_id"),accountId=str(input?.accountId,"account_id"); await this.book(auth,bookId);
    const currency=str(input?.currency,"currency").toUpperCase();
    return this.db.transaction(async c=>{const fp=fingerprint({bookId,accountId,bankName:input?.bankName,accountReferenceRedacted:input?.accountReferenceRedacted??input?.accountReference,currency});if(key){const ins=await c.query<any>(`INSERT INTO accounting_command_idempotency(tenant_id,operation,idempotency_key,request_fingerprint,state) VALUES($1,'accounting.bank_account',$2,$3,'PROCESSING') ON CONFLICT DO NOTHING RETURNING id`,[auth.tenantId,key,fp]);if(!ins.rows[0]){const prior=await c.query<any>("SELECT * FROM accounting_command_idempotency WHERE tenant_id=$1 AND operation='accounting.bank_account' AND idempotency_key=$2 FOR UPDATE",[auth.tenantId,key]);if(prior.rows[0]?.request_fingerprint!==fp)throw new ConflictException({code:"IDEMPOTENCY_KEY_REUSED"});if(prior.rows[0]?.response_json)return prior.rows[0].response_json;throw new ConflictException({code:"IDEMPOTENCY_REQUEST_IN_PROGRESS"});}}const account=await c.query<any>("SELECT id FROM accounting_accounts WHERE tenant_id=$1 AND book_id=$2 AND id=$3 AND active",[auth.tenantId,bookId,accountId]);if(!account.rows[0])throw new ConflictException({code:"ACCOUNT_SCOPE_INVALID"});const row=await c.query<any>(`INSERT INTO accounting_bank_accounts(tenant_id,book_id,account_id,bank_name,account_reference_redacted,currency) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[auth.tenantId,bookId,accountId,str(input?.bankName,"bank_name"),str(input?.accountReferenceRedacted??input?.accountReference,"account_reference"),currency]);await this.audit(c,auth,"accounting.bank_account_created","accounting_bank_account",row.rows[0].id,null,row.rows[0],requestId);if(key)await c.query("UPDATE accounting_command_idempotency SET state='COMPLETED',response_json=$3,completed_at=now() WHERE tenant_id=$1 AND operation='accounting.bank_account' AND idempotency_key=$2",[auth.tenantId,key,json(row.rows[0])]);return row.rows[0];});
  }

  async importBankStatement(auth:AccessClaims,input:any,requestId:string,key?:string){
    const bankAccountId=str(input?.bankAccountId,"bank_account_id"),format=String(input?.format??"CSV").toUpperCase();
    if(format!=="CSV")throw new BadRequestException({code:"BANK_IMPORT_FORMAT_UNSUPPORTED"});
    const csv=String(input?.csv??""); const checksum=String(input?.fileChecksum??fingerprint(csv));
    const parsed=input?.lines??csv.split(/\r?\n/).filter(Boolean).slice(1).map((line:string,index:number)=>{const [date,amount,currency,reference,description,direction]=line.split(",").map((x:string)=>x.trim());return {lineNo:index+1,transactionDate:date,amountMinor:amount,currency,reference,description,direction:direction??(Number(amount)>=0?"CREDIT":"DEBIT")};});
    if(!Array.isArray(parsed)||!parsed.length)throw new BadRequestException({code:"BANK_STATEMENT_LINES_REQUIRED"});
    return this.db.transaction(async c=>{const bank=await c.query<any>("SELECT * FROM accounting_bank_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,bankAccountId]);if(!bank.rows[0])throw new NotFoundException({code:"BANK_ACCOUNT_NOT_FOUND"});const requestFp=fingerprint({bankAccountId,format,checksum});if(key){const ins=await c.query<any>(`INSERT INTO accounting_command_idempotency(tenant_id,operation,idempotency_key,request_fingerprint,state) VALUES($1,'accounting.bank_import',$2,$3,'PROCESSING') ON CONFLICT DO NOTHING RETURNING id`,[auth.tenantId,key,requestFp]);if(!ins.rows[0]){const prior=await c.query<any>("SELECT * FROM accounting_command_idempotency WHERE tenant_id=$1 AND operation='accounting.bank_import' AND idempotency_key=$2 FOR UPDATE",[auth.tenantId,key]);if(prior.rows[0]?.request_fingerprint!==requestFp)throw new ConflictException({code:"IDEMPOTENCY_KEY_REUSED"});if(prior.rows[0]?.response_json)return prior.rows[0].response_json;throw new ConflictException({code:"IDEMPOTENCY_REQUEST_IN_PROGRESS"});}}const existing=await c.query<any>("SELECT * FROM accounting_bank_statement_imports WHERE tenant_id=$1 AND bank_account_id=$2 AND file_checksum=$3",[auth.tenantId,bankAccountId,checksum]);if(existing.rows[0])return existing.rows[0];const imp=await c.query<any>(`INSERT INTO accounting_bank_statement_imports(tenant_id,bank_account_id,format,file_checksum,state,imported_by_user_id) VALUES($1,$2,$3,$4,'READY',$5) RETURNING *`,[auth.tenantId,bankAccountId,format,checksum,auth.userId]);for(const line of parsed){const amount=BigInt(line.amountMinor);const direction=String(line.direction??(amount>=0n?"CREDIT":"DEBIT")).toUpperCase();if(!["CREDIT","DEBIT"].includes(direction)||!line.transactionDate)throw new BadRequestException({code:"BANK_STATEMENT_LINE_INVALID"});const fp=fingerprint({date:line.transactionDate,amount:String(amount),currency:String(line.currency??bank.rows[0].currency).toUpperCase(),reference:line.reference??"",description:line.description??""});await c.query(`INSERT INTO accounting_bank_statement_lines(tenant_id,import_id,bank_account_id,line_no,transaction_date,amount_minor,currency,direction,reference,description,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[auth.tenantId,imp.rows[0].id,bankAccountId,line.lineNo,line.transactionDate,amount.toString(),String(line.currency??bank.rows[0].currency).toUpperCase(),direction,line.reference??null,line.description??null,fp]);}await this.audit(c,auth,"accounting.bank_statement_imported","accounting_bank_statement_import",imp.rows[0].id,null,imp.rows[0],requestId);await this.event(c,auth,"accounting.bank_statement.imported","accounting_bank_statement_import",imp.rows[0].id,{refetch:true},requestId);if(key)await c.query("UPDATE accounting_command_idempotency SET state='COMPLETED',response_json=$3,completed_at=now() WHERE tenant_id=$1 AND operation='accounting.bank_import' AND idempotency_key=$2",[auth.tenantId,key,json(imp.rows[0])]);return imp.rows[0];});
  }

  async createBankMatch(auth:AccessClaims,input:any,requestId:string,key?:string){
    const reconciliationId=str(input?.reconciliationId,"reconciliation_id"),allocations=input?.allocations; if(!Array.isArray(allocations)||!allocations.length)throw new BadRequestException({code:"BANK_MATCH_ALLOCATIONS_REQUIRED"});
    return this.db.transaction(async c=>{const r=await c.query<any>("SELECT * FROM accounting_bank_reconciliations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,reconciliationId]);if(!r.rows[0]||["CLOSED","VOIDED"].includes(r.rows[0].state))throw new ConflictException({code:"ACCOUNTING_RECONCILIATION_IMMUTABLE"});const requestFp=fingerprint({reconciliationId,matchType:input?.matchType,totalMinor:input?.totalMinor,journalId:input?.journalId,allocations});if(key){const ins=await c.query<any>(`INSERT INTO accounting_command_idempotency(tenant_id,operation,idempotency_key,request_fingerprint,state) VALUES($1,'accounting.bank_match',$2,$3,'PROCESSING') ON CONFLICT DO NOTHING RETURNING id`,[auth.tenantId,key,requestFp]);if(!ins.rows[0]){const prior=await c.query<any>("SELECT * FROM accounting_command_idempotency WHERE tenant_id=$1 AND operation='accounting.bank_match' AND idempotency_key=$2 FOR UPDATE",[auth.tenantId,key]);if(prior.rows[0]?.request_fingerprint!==requestFp)throw new ConflictException({code:"IDEMPOTENCY_KEY_REUSED"});if(prior.rows[0]?.response_json)return prior.rows[0].response_json;throw new ConflictException({code:"IDEMPOTENCY_REQUEST_IN_PROGRESS"});}}const m=await c.query<any>(`INSERT INTO accounting_bank_matches(tenant_id,reconciliation_id,match_type,state,total_minor,journal_id,created_by_user_id) VALUES($1,$2,$3,'SUGGESTED',$4,$5,$6) RETURNING *`,[auth.tenantId,reconciliationId,input?.matchType??"ONE_TO_ONE",String(input?.totalMinor??allocations.reduce((n:any,a:any)=>n+BigInt(a.amountMinor),0n)),input?.journalId??null,auth.userId]);for(const a of allocations){const line=await c.query<any>("SELECT * FROM accounting_bank_statement_lines WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,a.statementLineId]);if(!line.rows[0]||line.rows[0].bank_account_id!==r.rows[0].bank_account_id||line.rows[0].currency!==r.rows[0].currency)throw new ConflictException({code:"ACCOUNTING_BANK_STATEMENT_SCOPE_INVALID"});if(!["UNMATCHED","SUGGESTED"].includes(line.rows[0].match_state))throw new ConflictException({code:"ACCOUNTING_STATEMENT_LINE_STATE_INVALID"});const requested=BigInt(a.amountMinor);const capacity=(line.rows[0].amount_minor<0?-BigInt(line.rows[0].amount_minor):BigInt(line.rows[0].amount_minor))-BigInt(line.rows[0].matched_minor);if(requested<=0n||requested>capacity)throw new ConflictException({code:"ACCOUNTING_BANK_MATCH_AMOUNT_INVALID"});await c.query(`INSERT INTO accounting_bank_match_allocations(tenant_id,match_id,statement_line_id,amount_minor) VALUES($1,$2,$3,$4)`,[auth.tenantId,m.rows[0].id,a.statementLineId,String(a.amountMinor)]);}await this.audit(c,auth,"accounting.bank_match_created","accounting_bank_match",m.rows[0].id,null,m.rows[0],requestId);if(key)await c.query("UPDATE accounting_command_idempotency SET state='COMPLETED',response_json=$3,completed_at=now() WHERE tenant_id=$1 AND operation='accounting.bank_match' AND idempotency_key=$2",[auth.tenantId,key,json(m.rows[0])]);return m.rows[0];});
  }

  async transitionBankMatch(auth:AccessClaims,id:string,target:string,input:any,requestId:string){return this.db.transaction(async c=>{const m=await c.query<any>("SELECT * FROM accounting_bank_matches WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!m.rows[0])throw new NotFoundException({code:"BANK_MATCH_NOT_FOUND"});const r=await c.query<any>("SELECT * FROM accounting_bank_reconciliations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,m.rows[0].reconciliation_id]);if(["CLOSED","VOIDED"].includes(r.rows[0].state))throw new ConflictException({code:"ACCOUNTING_RECONCILIATION_IMMUTABLE"});if(target==="MATCHED"&&m.rows[0].state!=="SUGGESTED")throw new ConflictException({code:"BANK_MATCH_STATE_INVALID"});if(target==="VOIDED"&&m.rows[0].state!=="MATCHED")throw new ConflictException({code:"BANK_MATCH_STATE_INVALID"});const n=await c.query<any>("UPDATE accounting_bank_matches SET state=$3,confirmed_by_user_id=CASE WHEN $3='MATCHED' THEN $4 ELSE confirmed_by_user_id END WHERE tenant_id=$1 AND id=$2 RETURNING *",[auth.tenantId,id,target,auth.userId]);const alloc=await c.query<any>("SELECT statement_line_id,amount_minor FROM accounting_bank_match_allocations WHERE tenant_id=$1 AND match_id=$2",[auth.tenantId,id]);for(const a of alloc.rows){const line=await c.query<any>("SELECT * FROM accounting_bank_statement_lines WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,a.statement_line_id]);if(!line.rows[0])throw new NotFoundException({code:"BANK_STATEMENT_LINE_NOT_FOUND"});const delta=target==="MATCHED"?BigInt(a.amount_minor):-BigInt(a.amount_minor);const nextMatched=BigInt(line.rows[0].matched_minor)+delta;if(nextMatched<0n||nextMatched>BigInt(line.rows[0].amount_minor<0? -BigInt(line.rows[0].amount_minor):BigInt(line.rows[0].amount_minor)))throw new ConflictException({code:"ACCOUNTING_BANK_MATCH_AMOUNT_INVALID"});const nextState=nextMatched===0n?"UNMATCHED":nextMatched===BigInt(line.rows[0].amount_minor<0? -BigInt(line.rows[0].amount_minor):BigInt(line.rows[0].amount_minor))?"MATCHED":"PARTIALLY_MATCHED";if(target==="MATCHED"&&["EXCLUDED","DISPUTED"].includes(line.rows[0].match_state))throw new ConflictException({code:"ACCOUNTING_STATEMENT_LINE_STATE_INVALID"});await c.query("UPDATE accounting_bank_statement_lines SET matched_minor=$3,match_state=$4,version=version+1 WHERE tenant_id=$1 AND id=$2",[auth.tenantId,a.statement_line_id,nextMatched.toString(),nextState]);}await this.audit(c,auth,`accounting.bank_match_${target.toLowerCase()}`,"accounting_bank_match",id,m.rows[0],n.rows[0],requestId,input?.reason);return n.rows[0];});}

  async createBankReconciliation(auth:AccessClaims,input:any,requestId:string){const bankAccountId=str(input?.bankAccountId,"bank_account_id");return this.db.transaction(async c=>{const b=await c.query<any>("SELECT * FROM accounting_bank_accounts WHERE tenant_id=$1 AND id=$2",[auth.tenantId,bankAccountId]);if(!b.rows[0])throw new NotFoundException({code:"BANK_ACCOUNT_NOT_FOUND"});const s=BigInt(input?.statementBalanceMinor??0),l=BigInt(input?.ledgerBalanceMinor??0);const row=await c.query<any>(`INSERT INTO accounting_bank_reconciliations(tenant_id,bank_account_id,period_id,state,statement_balance_minor,ledger_balance_minor,difference_minor,created_by_user_id) VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7) RETURNING *`,[auth.tenantId,bankAccountId,input?.periodId??null,s.toString(),l.toString(),(s-l).toString(),auth.userId]);await this.audit(c,auth,"accounting.bank_reconciliation_created","accounting_bank_reconciliation",row.rows[0].id,null,row.rows[0],requestId);return row.rows[0];});}

  async transitionBankReconciliation(auth:AccessClaims,id:string,target:string,input:any,requestId:string){return this.db.transaction(async c=>{const current=await c.query<any>("SELECT * FROM accounting_bank_reconciliations WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!current.rows[0])throw new NotFoundException({code:"BANK_RECONCILIATION_NOT_FOUND"});if(target==="CLOSED"&&current.rows[0].difference_minor!==0)throw new ConflictException({code:"BANK_RECONCILIATION_DIFFERENCE_UNEXPLAINED"});if(target==="VOIDED"&&current.rows[0].void_requested_by_user_id===auth.userId)throw new ForbiddenException({code:"BANK_RECONCILIATION_SELF_APPROVAL_DENIED"});const allowed:any={MATCHING:["DRAFT"],REVIEW:["MATCHING"],RECONCILED:["REVIEW"],CLOSED:["RECONCILED"],VOID_PENDING:["CLOSED"],VOIDED:["VOID_PENDING"]};if(!allowed[target]?.includes(current.rows[0].state))throw new ConflictException({code:"BANK_RECONCILIATION_STATE_INVALID"});const fields=target==="VOID_PENDING"?"void_requested_by_user_id=$4":target==="VOIDED"?"void_approved_by_user_id=$4":"";const next=await c.query<any>(`UPDATE accounting_bank_reconciliations SET state=$3,${fields?fields+",":""}closed_by_user_id=CASE WHEN $3='CLOSED' THEN $4 ELSE closed_by_user_id END,closed_at=CASE WHEN $3='CLOSED' THEN now() ELSE closed_at END,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *`,[auth.tenantId,id,target,auth.userId]);await c.query(`INSERT INTO accounting_bank_reconciliation_history(tenant_id,reconciliation_id,from_state,to_state,actor_user_id,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[auth.tenantId,id,current.rows[0].state,target,auth.userId,input?.reason??"state transition",requestId]);await this.audit(c,auth,`accounting.bank_reconciliation_${target.toLowerCase()}`,"accounting_bank_reconciliation",id,current.rows[0],next.rows[0],requestId,input?.reason);return next.rows[0];});}

  async generateStatementSnapshot(auth:AccessClaims,input:any,requestId:string){const bookId=str(input?.bookId,"book_id"),periodId=str(input?.periodId,"period_id"),type=String(input?.statementType??"TRIAL_BALANCE").toUpperCase();await this.book(auth,bookId);return this.db.transaction(async c=>{const d=await c.query<any>("SELECT * FROM accounting_statement_definitions WHERE tenant_id=$1 AND book_id=$2 AND statement_type=$3 AND active ORDER BY version DESC LIMIT 1",[auth.tenantId,bookId,type]);if(!d.rows[0])throw new ConflictException({code:"STATEMENT_DEFINITION_NOT_FOUND"});const report=type==="TRIAL_BALANCE"?await this.trialBalance(auth,{bookId,periodId}):type==="PROFIT_AND_LOSS"?await this.profitAndLoss(auth,{bookId,periodId}):await this.balanceSheet(auth,{bookId,periodId});const totals={statementType:type,periodId,rows:report};const checksum=fingerprint(totals);const s=await c.query<any>(`INSERT INTO accounting_statement_snapshots(tenant_id,book_id,period_id,definition_id,state,cutoff_at,mapping_fingerprint,source_fingerprint,totals_json,checksum,generated_by_user_id) VALUES($1,$2,$3,$4,'GENERATED',now(),$5,$6,$7,$8,$9) ON CONFLICT(book_id,definition_id,period_id,checksum) DO UPDATE SET state='GENERATED' RETURNING *`,[auth.tenantId,bookId,periodId,d.rows[0].id,fingerprint(d.rows[0].definition_json),fingerprint(report),json(totals),checksum,auth.userId]);await this.audit(c,auth,"accounting.statement_generated","accounting_statement_snapshot",s.rows[0].id,null,s.rows[0],requestId);return s.rows[0];});}

  async transitionStatementSnapshot(auth:AccessClaims,id:string,target:string,input:any,requestId:string){return this.db.transaction(async c=>{const x=await c.query<any>("SELECT * FROM accounting_statement_snapshots WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[auth.tenantId,id]);if(!x.rows[0])throw new NotFoundException({code:"STATEMENT_SNAPSHOT_NOT_FOUND"});if(target==="APPROVED"&&x.rows[0].generated_by_user_id===auth.userId)throw new ForbiddenException({code:"STATEMENT_SELF_APPROVAL_DENIED"});const allowed:any={APPROVED:["GENERATED"],FINAL:["APPROVED"]};if(!allowed[target]?.includes(x.rows[0].state))throw new ConflictException({code:"STATEMENT_STATE_INVALID"});const n=await c.query<any>(`UPDATE accounting_statement_snapshots SET state=$3,approved_by_user_id=CASE WHEN $3 IN('APPROVED','FINAL') THEN $4 ELSE approved_by_user_id END WHERE tenant_id=$1 AND id=$2 RETURNING *`,[auth.tenantId,id,target,auth.userId]);await this.audit(c,auth,`accounting.statement_${target.toLowerCase()}`,"accounting_statement_snapshot",id,x.rows[0],n.rows[0],requestId,input?.reason);return n.rows[0];});}
}
