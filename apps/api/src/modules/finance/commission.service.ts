/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  commissionAdjustmentSchema,
  commissionPeriodCommandSchema,
  commissionPeriodSchema,
  commissionRuleSchema,
  refundDecisionSchema,
} from "@nailsoft/validation";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "../pos/financial-evidence.service.js";

@Injectable()
export class CommissionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
  ) {}

  async rules(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    return (
      await this.db.query<any>(
        `SELECT * FROM commission_rules WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($2::uuid[]))
       AND ($3::text IS NULL OR status=$3) ORDER BY status,effective_from DESC,priority DESC,id`,
        [auth.tenantId, branches, query?.status ?? null],
      )
    ).rows.map(ruleView);
  }
  async rule(auth: AccessClaims, id: string) {
    this.assertTenant(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM commission_rules WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row || (row.branch_id && !this.branchAllowed(auth, row.branch_id)))
      throw new NotFoundException({
        code: "COMMISSION_RULE_NOT_FOUND",
        message: "Commission rule not found",
      });
    return ruleView(row);
  }
  async createRule(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    this.assertTenant(auth);
    const body = commissionRuleSchema.parse(input);
    if (body.branchId) this.assertBranch(auth, body.branchId);
    return this.db
      .transaction(async (client) => {
        // GiST exclusion checks can choose a deadlock victim when two
        // overlapping rules are inserted at exactly the same time. Serialize
        // only the normalized scope/priority so the loser deterministically
        // reaches the exclusion constraint and maps to the domain conflict.
        const normalizedScope = [
          auth.tenantId,
          body.branchId ?? "*",
          body.staffId ?? "*",
          body.serviceId ?? "*",
          String(body.priority),
        ].join(":");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`commission-rule:${normalizedScope}`],
        );
        return this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "commission.rule.create",
          key,
          request: body,
          work: async () => {
            const row = (
              await client.query<any>(
                `INSERT INTO commission_rules(tenant_id,branch_id,staff_id,service_id,rule_code,rule_type,base_mode,percent_basis_points,fixed_minor,currency,
             priority,policy_json,effective_from,effective_to,status,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',$15) RETURNING *`,
                [
                  auth.tenantId,
                  body.branchId ?? null,
                  body.staffId ?? null,
                  body.serviceId ?? null,
                  body.ruleCode,
                  body.ruleType,
                  body.baseMode,
                  body.percentBasisPoints ?? null,
                  body.fixedMinor ?? null,
                  body.currency ?? null,
                  body.priority,
                  JSON.stringify(body.policy),
                  body.effectiveFrom,
                  body.effectiveTo ?? null,
                  auth.userId,
                ],
              )
            ).rows[0];
            await this.event(
              client,
              auth,
              row,
              "commission.rule_created",
              requestId,
              key,
            );
            return ruleView(row);
          },
        });
      })
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  async supersedeRule(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    await this.rule(auth, id);
    const body = commissionRuleSchema.parse(input);
    if (body.branchId) this.assertBranch(auth, body.branchId);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "commission.rule.supersede",
          key,
          request: { id, ...body },
          work: async () => {
            const old = (
              await client.query<any>(
                "SELECT * FROM commission_rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (old.status !== "ACTIVE")
              throw new ConflictException({
                code: "COMMISSION_RULE_STATUS_INVALID",
                message: "Only active rule may be superseded",
              });
            if (new Date(body.effectiveFrom) <= new Date(old.effective_from))
              throw new ConflictException({
                code: "COMMISSION_RULE_RANGE_INVALID",
                message:
                  "A superseding rule must start after the current rule starts",
              });
            const sameScope =
              (body.branchId ?? null) === old.branch_id &&
              (body.staffId ?? null) === old.staff_id &&
              (body.serviceId ?? null) === old.service_id &&
              body.priority === old.priority;
            if (!sameScope)
              throw new ConflictException({
                code: "COMMISSION_RULE_SCOPE_MISMATCH",
                message:
                  "A superseding rule must retain normalized scope and priority",
              });
            await client.query(
              "UPDATE commission_rules SET status='INACTIVE',effective_to=LEAST(COALESCE(effective_to,$3),$3) WHERE tenant_id=$1 AND id=$2",
              [auth.tenantId, id, body.effectiveFrom],
            );
            const row = (
              await client.query<any>(
                `INSERT INTO commission_rules(tenant_id,branch_id,staff_id,service_id,rule_code,rule_type,base_mode,percent_basis_points,fixed_minor,currency,
             priority,policy_json,effective_from,effective_to,status,created_by_user_id,supersedes_rule_id,version)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',$15,$16,$17) RETURNING *`,
                [
                  auth.tenantId,
                  body.branchId ?? null,
                  body.staffId ?? null,
                  body.serviceId ?? null,
                  body.ruleCode,
                  body.ruleType,
                  body.baseMode,
                  body.percentBasisPoints ?? null,
                  body.fixedMinor ?? null,
                  body.currency ?? null,
                  body.priority,
                  JSON.stringify(body.policy),
                  body.effectiveFrom,
                  body.effectiveTo ?? null,
                  auth.userId,
                  id,
                  Number(old.version) + 1,
                ],
              )
            ).rows[0];
            await this.event(
              client,
              auth,
              row,
              "commission.rule_superseded",
              requestId,
              key,
            );
            return ruleView(row);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  async deactivateRule(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = refundDecisionSchema.parse(input);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "commission.rule.deactivate",
          key,
          request: { id, ...body },
          work: async () => {
            const row = (
              await client.query<any>(
                "UPDATE commission_rules SET status='INACTIVE',effective_to=COALESCE(effective_to,now()) WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status='ACTIVE' RETURNING *",
                [auth.tenantId, id, body.version],
              )
            ).rows[0];
            if (!row)
              throw new ConflictException({
                code: "COMMISSION_RULE_VERSION_CONFLICT",
                message: "Rule changed or is inactive",
              });
            await this.event(
              client,
              auth,
              row,
              "commission.rule_deactivated",
              requestId,
              key,
            );
            return ruleView(row);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }

  async entries(auth: AccessClaims, query: any, own = false) {
    this.assertTenant(auth);
    const staffId = own ? auth.ownStaffId : query?.staffId;
    if (own && !staffId)
      throw new ForbiddenException({
        code: "STAFF_SCOPE_REQUIRED",
        message: "Staff profile is required",
      });
    const branches =
      auth.roles.includes("SALON_OWNER") || own ? null : auth.branchIds;
    return (
      await this.db.query<any>(
        `SELECT e.*,sp.display_name FROM commission_entries e JOIN staff_profiles sp ON sp.tenant_id=e.tenant_id AND sp.id=e.staff_id
       WHERE e.tenant_id=$1 AND ($2::uuid[] IS NULL OR e.branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR e.staff_id=$3)
         AND ($4::date IS NULL OR e.business_date>=$4) AND ($5::date IS NULL OR e.business_date<=$5)
       ORDER BY e.business_date DESC,e.created_at DESC,e.id LIMIT 500`,
        [
          auth.tenantId,
          branches,
          staffId ?? null,
          query?.from ?? null,
          query?.to ?? null,
        ],
      )
    ).rows.map(entryView);
  }
  async ownTips(auth: AccessClaims) {
    this.assertTenant(auth);
    if (!auth.ownStaffId)
      throw new ForbiddenException({
        code: "STAFF_SCOPE_REQUIRED",
        message: "Staff profile is required",
      });
    const summary = (
      await this.db.query<any>(
        "SELECT * FROM staff_net_tip WHERE tenant_id=$1 AND staff_id=$2",
        [auth.tenantId, auth.ownStaffId],
      )
    ).rows[0];
    const history = (
      await this.db.query<any>(
        `SELECT rta.amount_minor,r.refund_reference,r.completed_at FROM refund_tip_allocations rta
       JOIN refund_items ri ON ri.tenant_id=rta.tenant_id AND ri.id=rta.refund_item_id
       JOIN refunds r ON r.tenant_id=ri.tenant_id AND r.id=ri.refund_id
       WHERE rta.tenant_id=$1 AND rta.staff_id=$2 AND r.status='COMPLETED' ORDER BY r.completed_at DESC,rta.id`,
        [auth.tenantId, auth.ownStaffId],
      )
    ).rows;
    return {
      staffId: auth.ownStaffId,
      grossTipMinor: Number(summary?.gross_tip_minor ?? 0),
      refundedTipMinor: Number(summary?.refunded_tip_minor ?? 0),
      netTipMinor: Number(summary?.net_tip_minor ?? 0),
      refundHistory: history.map((x) => ({
        amountMinor: Number(x.amount_minor),
        refundReference: x.refund_reference,
        completedAt: x.completed_at,
      })),
    };
  }
  async entry(auth: AccessClaims, id: string) {
    this.assertTenant(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM commission_entries WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (
      !row ||
      !this.branchAllowed(auth, row.branch_id) ||
      (auth.roles.includes("NAIL_TECHNICIAN") &&
        row.staff_id !== auth.ownStaffId)
    )
      throw new NotFoundException({
        code: "COMMISSION_ENTRY_NOT_FOUND",
        message: "Commission entry not found",
      });
    return entryView(row);
  }

  async periods(auth: AccessClaims) {
    this.assertTenant(auth);
    return (
      await this.db.query<any>(
        "SELECT * FROM commission_periods WHERE tenant_id=$1 ORDER BY start_date DESC,id",
        [auth.tenantId],
      )
    ).rows.map(periodView);
  }
  async period(auth: AccessClaims, id: string) {
    this.assertTenant(auth);
    const row = (
      await this.db.query<any>(
        "SELECT * FROM commission_periods WHERE tenant_id=$1 AND id=$2",
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "COMMISSION_PERIOD_NOT_FOUND",
        message: "Commission period not found",
      });
    return { ...periodView(row), statements: await this.statements(auth, id) };
  }
  async createPeriod(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = commissionPeriodSchema.parse(input);
    this.assertTenant(auth);
    if (body.endDate < body.startDate)
      throw new ConflictException({
        code: "COMMISSION_PERIOD_RANGE_INVALID",
        message: "endDate must not precede startDate",
      });
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "commission.period.create",
          key,
          request: body,
          work: async () => {
            const row = (
              await client.query<any>(
                "INSERT INTO commission_periods(tenant_id,code,start_date,end_date,currency) VALUES($1,$2,$3,$4,$5) RETURNING *",
                [
                  auth.tenantId,
                  body.code,
                  body.startDate,
                  body.endDate,
                  body.currency,
                ],
              )
            ).rows[0];
            await this.event(
              client,
              auth,
              row,
              "commission.period_created",
              requestId,
              key,
            );
            return periodView(row);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  startReview(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    return this.periodTransition(
      auth,
      id,
      input,
      "OPEN",
      "REVIEW",
      "commission.period_review_started",
      key,
      requestId,
    );
  }
  reopenReview(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    return this.periodTransition(
      auth,
      id,
      input,
      "REVIEW",
      "OPEN",
      "commission.period_reopened",
      key,
      requestId,
    );
  }
  async lock(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = commissionPeriodCommandSchema.parse(input);
    this.assertTenant(auth);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "commission.period.lock",
          key,
          request: { id, ...body },
          work: async () => {
            const period = (
              await client.query<any>(
                "SELECT * FROM commission_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (
              !period ||
              period.status !== "REVIEW" ||
              Number(period.version) !== body.version
            )
              throw new ConflictException({
                code: "COMMISSION_PERIOD_LOCK_CONFLICT",
                message: "Period must be current REVIEW version",
              });
            const currencyMismatch = await client.query(
              `SELECT 1 FROM commission_entries
               WHERE tenant_id=$1 AND currency<>$2
                 AND (period_id=$3 OR (period_id IS NULL AND business_date BETWEEN $4 AND $5))
               LIMIT 1`,
              [
                auth.tenantId,
                period.currency,
                id,
                period.start_date,
                period.end_date,
              ],
            );
            if (currencyMismatch.rowCount)
              throw new ConflictException({
                code: "COMMISSION_CURRENCY_MISMATCH",
                message: "Every entry in a locked period must use its currency",
              });
            const unresolved = await client.query(
              `SELECT 1 FROM commission_generation_conflicts c
               JOIN invoices i ON i.tenant_id=c.tenant_id AND i.id=c.invoice_id
               JOIN branches b ON b.tenant_id=i.tenant_id AND b.id=i.branch_id
               WHERE c.tenant_id=$1 AND c.status='OPEN'
                 AND (i.issued_at AT TIME ZONE b.timezone)::date BETWEEN $2 AND $3
               LIMIT 1`,
              [auth.tenantId, period.start_date, period.end_date],
            );
            if (unresolved.rowCount)
              throw new ConflictException({
                code: "COMMISSION_UNRESOLVED_CONFLICT",
                message: "Resolve commission conflicts before lock",
              });
            const unassignedAdjustment = await client.query(
              `SELECT 1 FROM commission_adjustment_requests a
               WHERE a.tenant_id=$1 AND (a.target_period_id=$2 OR a.posting_period_id=$2)
                 AND (
                   a.status='PENDING' OR
                   (a.status='APPROVED' AND NOT EXISTS(
                     SELECT 1 FROM commission_entries e
                     WHERE e.tenant_id=a.tenant_id AND e.adjustment_request_id=a.id
                   ))
                 ) LIMIT 1`,
              [auth.tenantId, id],
            );
            if (unassignedAdjustment.rowCount)
              throw new ConflictException({
                code: "COMMISSION_ADJUSTMENT_UNRESOLVED",
                message:
                  "Resolve relevant adjustments and post every approval before lock",
              });
            const missingRefundReversal = await client.query(
              `SELECT 1 FROM commission_entries earning
               JOIN refunds r ON r.tenant_id=earning.tenant_id AND r.invoice_id=earning.invoice_id AND r.status='COMPLETED'
               JOIN refund_items ri ON ri.tenant_id=r.tenant_id AND ri.refund_id=r.id
                 AND ri.invoice_line_id=earning.invoice_line_id AND ri.taxable_refund_minor>0
               WHERE earning.tenant_id=$1 AND earning.entry_type='EARNING'
                 AND earning.business_date BETWEEN $2 AND $3
                 AND NOT EXISTS(
                   SELECT 1 FROM commission_entries reversal
                   WHERE reversal.tenant_id=earning.tenant_id
                     AND reversal.original_entry_id=earning.id AND reversal.refund_id=r.id
                     AND reversal.entry_type IN('REFUND_REVERSAL','LOCKED_PERIOD_REFUND_ADJUSTMENT')
                 ) LIMIT 1`,
              [auth.tenantId, period.start_date, period.end_date],
            );
            if (missingRefundReversal.rowCount)
              throw new ConflictException({
                code: "COMMISSION_REFUND_REVERSAL_MISSING",
                message:
                  "A relevant completed refund lacks commission reversal",
              });
            await client.query(
              "UPDATE commission_entries SET period_id=$2,status='LOCKED' WHERE tenant_id=$1 AND period_id IS NULL AND business_date BETWEEN $3 AND $4",
              [auth.tenantId, id, period.start_date, period.end_date],
            );
            const rows = (
              await client.query<any>(
                `SELECT staff_id,currency,COALESCE(sum(commission_minor) FILTER(WHERE entry_type='EARNING'),0) earning,
             COALESCE(sum(commission_minor) FILTER(WHERE entry_type IN('REFUND_REVERSAL','LOCKED_PERIOD_REFUND_ADJUSTMENT')),0) refund,
             COALESCE(sum(commission_minor) FILTER(WHERE entry_type='MANUAL_ADJUSTMENT'),0) adjustment,COALESCE(sum(commission_minor),0) payable
           FROM commission_entries WHERE tenant_id=$1 AND period_id=$2 GROUP BY staff_id,currency ORDER BY staff_id`,
                [auth.tenantId, id],
              )
            ).rows;
            const canonicalRows = rows.map((row: any) => ({
              staffId: row.staff_id,
              currency: row.currency,
              earningMinor: String(row.earning),
              refundReversalMinor: String(row.refund),
              manualAdjustmentMinor: String(row.adjustment),
              payableMinor: String(row.payable),
            }));
            const hash = createHash("sha256")
              .update(canonicalJson(canonicalRows))
              .digest("hex");
            for (const [index, row] of rows.entries())
              await client.query(
                `INSERT INTO commission_period_staff_snapshots(tenant_id,period_id,staff_id,currency,earning_minor,refund_reversal_minor,manual_adjustment_minor,payable_minor,detail_hash)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                  auth.tenantId,
                  id,
                  row.staff_id,
                  row.currency,
                  row.earning,
                  row.refund,
                  row.adjustment,
                  row.payable,
                  createHash("sha256")
                    .update(canonicalJson(canonicalRows[index]))
                    .digest("hex"),
                ],
              );
            const totals = rows.reduce(
              (x: any, row: any) => ({
                earningMinor: x.earningMinor + BigInt(row.earning),
                refundReversalMinor: x.refundReversalMinor + BigInt(row.refund),
                adjustmentMinor: x.adjustmentMinor + BigInt(row.adjustment),
                payableMinor: x.payableMinor + BigInt(row.payable),
              }),
              {
                earningMinor: 0n,
                refundReversalMinor: 0n,
                adjustmentMinor: 0n,
                payableMinor: 0n,
              },
            );
            const totalsSnapshot = {
              schemaVersion: 1,
              formulaVersion: "SPRINT7_COMMISSION_V1",
              currency: period.currency,
              earningMinor: totals.earningMinor.toString(),
              refundReversalMinor: totals.refundReversalMinor.toString(),
              adjustmentMinor: totals.adjustmentMinor.toString(),
              payableMinor: totals.payableMinor.toString(),
            };
            const updated = (
              await client.query<any>(
                `UPDATE commission_periods SET status='LOCKED',totals_snapshot_json=$3,integrity_hash=$4,locked_at=now(),locked_by_user_id=$5,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2 RETURNING *`,
                [
                  auth.tenantId,
                  id,
                  JSON.stringify(totalsSnapshot),
                  hash,
                  auth.userId,
                ],
              )
            ).rows[0];
            await this.event(
              client,
              auth,
              updated,
              "commission.period_locked",
              requestId,
              key,
            );
            return periodView(updated);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  async statements(auth: AccessClaims, periodId: string) {
    await this.ensurePeriod(auth, periodId);
    return (
      await this.db.query<any>(
        `SELECT s.*,sp.display_name FROM commission_period_staff_snapshots s JOIN staff_profiles sp ON sp.tenant_id=s.tenant_id AND sp.id=s.staff_id
       WHERE s.tenant_id=$1 AND s.period_id=$2 ORDER BY sp.display_name,s.staff_id`,
        [auth.tenantId, periodId],
      )
    ).rows.map(snapshotView);
  }
  async statement(
    auth: AccessClaims,
    periodId: string,
    staffId: string,
    own = false,
  ) {
    if (own && staffId !== auth.ownStaffId)
      throw new ForbiddenException({
        code: "COMMISSION_OWN_SCOPE_REQUIRED",
        message: "Only own statement is available",
      });
    await this.ensurePeriod(auth, periodId);
    const snapshot = (
      await this.db.query<any>(
        "SELECT * FROM commission_period_staff_snapshots WHERE tenant_id=$1 AND period_id=$2 AND staff_id=$3",
        [auth.tenantId, periodId, staffId],
      )
    ).rows[0];
    if (!snapshot)
      throw new NotFoundException({
        code: "COMMISSION_STATEMENT_NOT_FOUND",
        message: "Statement not found",
      });
    const entries = (
      await this.db.query<any>(
        `SELECT e.*,sp.display_name FROM commission_entries e
         JOIN staff_profiles sp ON sp.tenant_id=e.tenant_id AND sp.id=e.staff_id
         WHERE e.tenant_id=$1 AND e.period_id=$2 AND e.staff_id=$3
         ORDER BY e.business_date,e.created_at,e.id`,
        [auth.tenantId, periodId, staffId],
      )
    ).rows;
    const payable = entries.reduce(
      (sum, entry) => sum + BigInt(entry.commission_minor),
      0n,
    );
    if (payable !== BigInt(snapshot.payable_minor))
      throw new ConflictException({
        code: "COMMISSION_STATEMENT_INTEGRITY_MISMATCH",
        message: "Statement entries do not equal locked payable snapshot",
      });
    return {
      ...snapshotView(snapshot),
      entries: entries.map(entryView),
    };
  }

  async adjustments(auth: AccessClaims) {
    this.assertTenant(auth);
    return (
      await this.db.query<any>(
        "SELECT * FROM commission_adjustment_requests WHERE tenant_id=$1 ORDER BY created_at DESC,id",
        [auth.tenantId],
      )
    ).rows.map(adjustmentView);
  }
  async createAdjustment(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = commissionAdjustmentSchema.parse(input);
    this.assertTenant(auth);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "commission.adjustment.create",
          key,
          request: body,
          work: async () => {
            const target = (
              await client.query<any>(
                "SELECT * FROM commission_periods WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, body.targetPeriodId],
              )
            ).rows[0];
            if (!target)
              throw new NotFoundException({
                code: "COMMISSION_PERIOD_NOT_FOUND",
                message: "Target period not found",
              });
            if (target.currency !== body.currency)
              throw new ConflictException({
                code: "COMMISSION_CURRENCY_MISMATCH",
                message: "Adjustment currency must match target period",
              });
            if (target.status === "LOCKED" && !body.postingPeriodId)
              throw new ConflictException({
                code: "LOCKED_PERIOD_POSTING_PERIOD_REQUIRED",
                message: "Locked-period adjustment requires a posting period",
              });
            const postingId = body.postingPeriodId ?? body.targetPeriodId;
            const posting = (
              await client.query<any>(
                "SELECT * FROM commission_periods WHERE tenant_id=$1 AND id=$2",
                [auth.tenantId, postingId],
              )
            ).rows[0];
            if (!posting || posting.status !== "OPEN")
              throw new ConflictException({
                code: "COMMISSION_POSTING_PERIOD_NOT_OPEN",
                message: "Adjustment posting period must be explicitly open",
              });
            if (posting.currency !== body.currency)
              throw new ConflictException({
                code: "COMMISSION_CURRENCY_MISMATCH",
                message: "Adjustment currency must match posting period",
              });
            if (
              !(
                await client.query(
                  "SELECT 1 FROM staff_profiles WHERE tenant_id=$1 AND id=$2",
                  [auth.tenantId, body.staffId],
                )
              ).rowCount
            )
              throw new NotFoundException({
                code: "STAFF_NOT_FOUND",
                message: "Staff not found",
              });
            const row = (
              await client.query<any>(
                `INSERT INTO commission_adjustment_requests(tenant_id,staff_id,target_period_id,posting_period_id,amount_minor,currency,reason_code,note,requested_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [
                  auth.tenantId,
                  body.staffId,
                  body.targetPeriodId,
                  body.postingPeriodId ?? null,
                  body.amountMinor,
                  body.currency,
                  body.reasonCode,
                  body.note,
                  auth.userId,
                ],
              )
            ).rows[0];
            await this.event(
              client,
              auth,
              row,
              "commission.adjustment_requested",
              requestId,
              key,
            );
            return adjustmentView(row);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  decideAdjustment(
    auth: AccessClaims,
    id: string,
    input: unknown,
    approve: boolean,
    key: string,
    requestId: string,
  ) {
    const body = refundDecisionSchema.parse(input);
    this.assertTenant(auth);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: `commission.adjustment.${approve ? "approve" : "reject"}`,
          key,
          request: { id, ...body },
          work: async () => {
            const row = (
              await client.query<any>(
                "SELECT * FROM commission_adjustment_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (
              !row ||
              row.status !== "PENDING" ||
              Number(row.version) !== body.version
            )
              throw new ConflictException({
                code: "COMMISSION_ADJUSTMENT_CONFLICT",
                message: "Adjustment is not current and pending",
              });
            if (row.requested_by_user_id === auth.userId)
              throw new ForbiddenException({
                code: "COMMISSION_DUAL_CONTROL_REQUIRED",
                message: "Requester cannot decide own adjustment",
              });
            if (approve) {
              const postingId = row.posting_period_id ?? row.target_period_id;
              const period = (
                await client.query<any>(
                  "SELECT * FROM commission_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                  [auth.tenantId, postingId],
                )
              ).rows[0];
              if (!period || period.status !== "OPEN")
                throw new ConflictException({
                  code: "COMMISSION_POSTING_PERIOD_NOT_OPEN",
                  message: "Posting period must be open",
                });
              if (period.currency !== row.currency)
                throw new ConflictException({
                  code: "COMMISSION_CURRENCY_MISMATCH",
                  message: "Adjustment currency must match posting period",
                });
              const branch = (
                await client.query<any>(
                  `SELECT branch_id FROM staff_branch_assignments
                   WHERE tenant_id=$1 AND staff_id=$2 AND status='ACTIVE'
                     AND effective_from<=CURRENT_DATE
                     AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)
                   ORDER BY is_primary DESC,effective_from DESC,id LIMIT 1`,
                  [auth.tenantId, row.staff_id],
                )
              ).rows[0];
              if (!branch)
                throw new ConflictException({
                  code: "COMMISSION_ADJUSTMENT_BRANCH_REQUIRED",
                  message: "Staff requires an active branch assignment",
                });
              const entry = (
                await client.query<any>(
                  `INSERT INTO commission_entries(tenant_id,branch_id,staff_id,invoice_id,adjustment_request_id,entry_type,business_date,currency,base_minor,commission_minor,
                   contribution_basis_json,rule_snapshot_json,source_snapshot_json,generation_key,status,period_id)
                 VALUES($1,$2,$3,NULL,$4,'MANUAL_ADJUSTMENT',$5,$6,0,$7,'{}','{}',$8,$9,'REVIEWED',NULL)
                 RETURNING id`,
                  [
                    auth.tenantId,
                    branch.branch_id,
                    row.staff_id,
                    id,
                    period.start_date,
                    row.currency,
                    row.amount_minor,
                    JSON.stringify({
                      adjustmentRequestId: id,
                      targetPeriodId: row.target_period_id,
                      postingPeriodId: postingId,
                    }),
                    `adjustment:${id}`,
                  ],
                )
              ).rows[0];
              if (!entry)
                throw new ConflictException({
                  code: "COMMISSION_ADJUSTMENT_ENTRY_REQUIRED",
                  message: "Approval did not create a commission entry",
                });
            }
            const status = approve ? "APPROVED" : "REJECTED";
            const updated = (
              await client.query<any>(
                "UPDATE commission_adjustment_requests SET status=$3,decided_by_user_id=$4,decision_reason=$5,decided_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 AND status='PENDING' RETURNING *",
                [auth.tenantId, id, status, auth.userId, body.reason],
              )
            ).rows[0];
            await this.event(
              client,
              auth,
              updated,
              approve
                ? "commission.adjustment_approved"
                : "commission.adjustment_rejected",
              requestId,
              key,
            );
            return adjustmentView(updated);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }

  cancelAdjustment(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = refundDecisionSchema.parse(input);
    this.assertTenant(auth);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "commission.adjustment.cancel",
          key,
          request: { id, ...body },
          work: async () => {
            const row = (
              await client.query<any>(
                "SELECT * FROM commission_adjustment_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
                [auth.tenantId, id],
              )
            ).rows[0];
            if (
              !row ||
              row.status !== "PENDING" ||
              Number(row.version) !== body.version
            )
              throw new ConflictException({
                code: "COMMISSION_ADJUSTMENT_CONFLICT",
                message: "Adjustment is not current and pending",
              });
            if (row.requested_by_user_id !== auth.userId)
              throw new ForbiddenException({
                code: "COMMISSION_ADJUSTMENT_CANCEL_DENIED",
                message: "Only the requester can cancel a pending adjustment",
              });
            const updated = (
              await client.query<any>(
                "UPDATE commission_adjustment_requests SET status='CANCELLED',decision_reason=$3,decided_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [auth.tenantId, id, body.reason],
              )
            ).rows[0];
            await this.event(
              client,
              auth,
              updated,
              "commission.adjustment_cancelled",
              requestId,
              key,
            );
            return adjustmentView(updated);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }

  private periodTransition(
    auth: AccessClaims,
    id: string,
    input: unknown,
    from: string,
    to: string,
    event: string,
    key: string,
    requestId: string,
  ) {
    const body = commissionPeriodCommandSchema.parse(input);
    this.assertTenant(auth);
    return this.db
      .transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: event,
          key,
          request: { id, ...body },
          work: async () => {
            const row = (
              await client.query<any>(
                `UPDATE commission_periods SET status=$4,review_started_at=CASE WHEN $4='REVIEW' THEN now() ELSE review_started_at END,
             review_started_by_user_id=CASE WHEN $4='REVIEW' THEN $5 ELSE review_started_by_user_id END,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status=$6 RETURNING *`,
                [auth.tenantId, id, body.version, to, auth.userId, from],
              )
            ).rows[0];
            if (!row)
              throw new ConflictException({
                code: "COMMISSION_PERIOD_VERSION_CONFLICT",
                message: "Period state/version conflict",
              });
            await this.event(client, auth, row, event, requestId, key);
            return periodView(row);
          },
        }),
      )
      .then((x) => ({ ...x.data, idempotencyReplayed: x.replayed }));
  }
  private async ensurePeriod(auth: AccessClaims, id: string) {
    const p = await this.periods(auth);
    if (!p.some((x) => x.id === id))
      throw new NotFoundException({
        code: "COMMISSION_PERIOD_NOT_FOUND",
        message: "Period not found",
      });
  }
  private async event(
    client: any,
    auth: AccessClaims,
    row: any,
    event: string,
    requestId: string,
    key: string,
  ) {
    const branchId =
      row.branch_id ??
      auth.branchIds[0] ??
      (
        await client.query(
          "SELECT id FROM branches WHERE tenant_id=$1 ORDER BY code,id LIMIT 1",
          [auth.tenantId],
        )
      ).rows[0]?.id;
    if (!branchId)
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "Financial evidence requires a tenant branch",
      });
    return this.evidence.record(client, {
      auth,
      branchId,
      event,
      aggregateType: event.startsWith("commission.period")
        ? "commission_period"
        : event.startsWith("commission.rule")
          ? "commission_rule"
          : "commission_adjustment",
      aggregateId: row.id,
      aggregateVersion: Number(row.version ?? 1),
      requestId,
      currency: row.currency ?? "VND",
      idempotencyKey: key,
      payload: { status: row.status },
    });
  }
  private assertTenant(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support Access Grant is required",
      });
  }
  private branchAllowed(auth: AccessClaims, id: string) {
    return auth.roles.includes("SALON_OWNER") || auth.branchIds.includes(id);
  }
  private assertBranch(auth: AccessClaims, id: string) {
    if (!this.branchAllowed(auth, id))
      throw new NotFoundException({
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
      });
  }
}

const ruleView = (r: any) => ({
  id: r.id,
  branchId: r.branch_id,
  staffId: r.staff_id,
  serviceId: r.service_id,
  ruleCode: r.rule_code,
  ruleType: r.rule_type,
  baseMode: r.base_mode,
  percentBasisPoints: r.percent_basis_points,
  fixedMinor: r.fixed_minor === null ? null : Number(r.fixed_minor),
  currency: r.currency,
  priority: r.priority,
  policy: r.policy_json,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  status: r.status,
  version: Number(r.version),
});
const entryView = (r: any) => ({
  id: r.id,
  branchId: r.branch_id,
  staffId: r.staff_id,
  staffName: r.display_name,
  invoiceId: r.invoice_id,
  invoiceLineId: r.invoice_line_id,
  serviceSessionId: r.service_session_id,
  originalEntryId: r.original_entry_id,
  refundId: r.refund_id,
  entryType: r.entry_type,
  businessDate: r.business_date,
  currency: r.currency,
  baseMinor: Number(r.base_minor),
  commissionMinor: Number(r.commission_minor),
  contributionBasis: r.contribution_basis_json,
  ruleSnapshot: r.rule_snapshot_json,
  status: r.status,
  periodId: r.period_id,
});
const periodView = (r: any) => ({
  id: r.id,
  code: r.code,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  currency: r.currency,
  totals: r.totals_snapshot_json,
  integrityHash: r.integrity_hash,
  reviewStartedAt: r.review_started_at,
  lockedAt: r.locked_at,
  version: Number(r.version),
});
const snapshotView = (r: any) => ({
  id: r.id,
  periodId: r.period_id,
  staffId: r.staff_id,
  staffName: r.display_name,
  currency: r.currency,
  earningMinor: Number(r.earning_minor),
  refundReversalMinor: Number(r.refund_reversal_minor),
  manualAdjustmentMinor: Number(r.manual_adjustment_minor),
  payableMinor: Number(r.payable_minor),
  detailHash: r.detail_hash,
});
const adjustmentView = (r: any) => ({
  id: r.id,
  staffId: r.staff_id,
  targetPeriodId: r.target_period_id,
  postingPeriodId: r.posting_period_id,
  amountMinor: Number(r.amount_minor),
  currency: r.currency,
  reasonCode: r.reason_code,
  note: r.note,
  status: r.status,
  version: Number(r.version),
  requestedByUserId: r.requested_by_user_id,
  decidedByUserId: r.decided_by_user_id,
  decisionReason: r.decision_reason,
  createdAt: r.created_at,
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
