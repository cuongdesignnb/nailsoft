/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import {
  cashCloseSchema,
  cashDeclareSchema,
  cashMovementSchema,
  cashSessionOpenSchema,
  cashSessionVersionSchema,
} from "@nailsoft/validation";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import { FinancialEvidenceService } from "./financial-evidence.service.js";
import { minorNumber } from "./pos-pricing.service.js";

@Injectable()
export class CashSessionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
    @Inject(FinancialEvidenceService)
    private readonly evidence: FinancialEvidenceService,
  ) {}

  async registers(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const rows = (
      await this.db.query<any>(
        `SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'currency',d.currency,'status',d.status) ORDER BY d.code) FROM cash_drawers d WHERE d.tenant_id=r.tenant_id AND d.register_id=r.id),'[]'::jsonb) drawers
           FROM pos_registers r WHERE r.tenant_id=$1 AND ($2::uuid[] IS NULL OR r.branch_id=ANY($2::uuid[]))
             AND ($3::uuid IS NULL OR r.branch_id=$3) ORDER BY r.code`,
        [auth.tenantId, branches, query?.branchId ?? null],
      )
    ).rows;
    if (query?.branchId) this.assertBranch(auth, query.branchId);
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      code: row.code,
      name: row.name,
      status: row.status,
      deviceBindingRequired: row.device_binding_required,
      version: Number(row.version),
      drawers: row.drawers,
    }));
  }

  async list(auth: AccessClaims, query: any) {
    this.assertTenant(auth);
    const branches = auth.roles.includes("SALON_OWNER") ? null : auth.branchIds;
    const values: unknown[] = [auth.tenantId, branches];
    let where = "($2::uuid[] IS NULL OR cs.branch_id=ANY($2::uuid[]))";
    if (query?.branchId) {
      this.assertBranch(auth, query.branchId);
      values.push(query.branchId);
      where += ` AND cs.branch_id=$${values.length}`;
    }
    if (query?.status) {
      values.push(query.status);
      where += ` AND cs.status=$${values.length}`;
    }
    if (auth.roles.includes("CASHIER") && !this.manager(auth)) {
      values.push(auth.userId);
      where += ` AND cs.cashier_user_id=$${values.length}`;
    }
    return (
      await this.db.query<any>(
        `SELECT cs.*,r.code register_code,d.code drawer_code FROM cash_sessions cs JOIN pos_registers r ON r.tenant_id=cs.tenant_id AND r.id=cs.register_id JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id WHERE cs.tenant_id=$1 AND ${where} ORDER BY opened_at DESC,id LIMIT 200`,
        values,
      )
    ).rows.map(sessionView);
  }

  async detail(auth: AccessClaims, id: string) {
    const session = await this.session(auth, id);
    return { ...session, movements: await this.movements(auth, id) };
  }

  async movements(auth: AccessClaims, id: string) {
    await this.session(auth, id);
    return (
      await this.db.query<any>(
        "SELECT * FROM cash_movements WHERE tenant_id=$1 AND cash_session_id=$2 ORDER BY occurred_at,id",
        [auth.tenantId, id],
      )
    ).rows.map(movementView);
  }

  async open(
    auth: AccessClaims,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashSessionOpenSchema.parse(input);
    this.assertTenant(auth);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command: "cash_session.open",
          key,
          request: body,
          work: async () => {
            const register = (
              await client.query<any>(
                `SELECT r.*,b.status branch_status,b.timezone,bs.currency,bs.tax_policy_json FROM pos_registers r JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id JOIN branch_settings bs ON bs.tenant_id=r.tenant_id AND bs.branch_id=r.branch_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r`,
                [auth.tenantId, body.registerId],
              )
            ).rows[0];
            if (!register || register.status !== "ACTIVE")
              throw new NotFoundException({
                code: "CASH_REGISTER_NOT_FOUND",
                message: "Active register not found",
              });
            this.assertBranch(auth, register.branch_id);
            if (register.branch_status !== "ACTIVE")
              throw new ConflictException({
                code: "FINANCIAL_BRANCH_INACTIVE",
                message: "Branch is inactive",
              });
            const drawer = (
              await client.query<any>(
                "SELECT * FROM cash_drawers WHERE tenant_id=$1 AND id=$2 AND register_id=$3 FOR UPDATE",
                [auth.tenantId, body.cashDrawerId, body.registerId],
              )
            ).rows[0];
            if (!drawer || drawer.status !== "ACTIVE")
              throw new NotFoundException({
                code: "CASH_DRAWER_NOT_FOUND",
                message: "Active cash drawer not found",
              });
            if (drawer.currency !== register.currency)
              throw new ConflictException({
                code: "CASH_SESSION_CURRENCY_MISMATCH",
                message: "Drawer currency differs from branch currency",
              });
            if (register.device_binding_required) {
              if (!body.deviceId)
                throw new ForbiddenException({
                  code: "FINANCIAL_PERMISSION_DENIED",
                  message: "Register requires a bound device",
                });
              const binding = await client.query(
                "SELECT 1 FROM pos_register_device_bindings WHERE tenant_id=$1 AND register_id=$2 AND device_id=$3 AND status='ACTIVE'",
                [auth.tenantId, body.registerId, body.deviceId],
              );
              if (!binding.rowCount)
                throw new ForbiddenException({
                  code: "FINANCIAL_PERMISSION_DENIED",
                  message: "Device is not bound to this register",
                });
            }
            const opening = BigInt(body.openingFloatMinor);
            const threshold = BigInt(
              register.tax_policy_json?.cashVarianceThresholdMinor ?? 5000,
            );
            const businessDate = DateTime.now()
              .setZone(register.timezone)
              .toISODate()!;
            let row: any;
            try {
              row = (
                await client.query<any>(
                  `INSERT INTO cash_sessions(tenant_id,branch_id,register_id,cash_drawer_id,cashier_user_id,business_date,timezone,status,opening_float_minor,expected_cash_minor,variance_threshold_minor) VALUES($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$8,$9) RETURNING *`,
                  [
                    auth.tenantId,
                    register.branch_id,
                    body.registerId,
                    body.cashDrawerId,
                    auth.userId,
                    businessDate,
                    register.timezone,
                    opening.toString(),
                    threshold.toString(),
                  ],
                )
              ).rows[0];
            } catch (error: any) {
              if (error?.code === "23505")
                throw new ConflictException({
                  code: "CASH_SESSION_ALREADY_OPEN",
                  message:
                    "Drawer or cashier already has an active cash session",
                });
              throw error;
            }
            row.currency = drawer.currency;
            if (opening > 0n)
              await client.query(
                `INSERT INTO cash_movements(tenant_id,branch_id,cash_session_id,movement_type,direction,amount_minor,currency,reason_code,actor_user_id,request_id) VALUES($1,$2,$3,'OPENING_FLOAT','IN',$4,$5,'OPEN_SESSION',$6,$7)`,
                [
                  auth.tenantId,
                  register.branch_id,
                  row.id,
                  opening.toString(),
                  drawer.currency,
                  auth.userId,
                  requestId,
                ],
              );
            await this.record(
              client,
              auth,
              row,
              "cash_session.opened",
              requestId,
              key,
              opening,
              { businessDate },
            );
            return sessionView(row);
          },
        }),
      )
    ).data;
  }

  async move(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashMovementSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.move_cash",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "OPEN") throw state();
        const policy = session.tax_policy_json ?? {};
        if (
          BigInt(body.amountMinor) >
            BigInt(policy.cashMovementApprovalThresholdMinor ?? 100000) &&
          !this.manager(auth)
        )
          throw new ForbiddenException({
            code: "FINANCIAL_PERMISSION_DENIED",
            message: "Manager approval is required for this cash movement",
          });
        const direction = body.movementType === "CASH_IN" ? "IN" : "OUT";
        if (
          direction === "OUT" &&
          BigInt(body.amountMinor) > BigInt(session.expected_cash_minor)
        )
          throw new ConflictException({
            code: "CASH_MOVEMENT_INVALID",
            message: "Cash movement cannot make expected cash negative",
          });
        const movement = (
          await client.query<any>(
            `INSERT INTO cash_movements(tenant_id,branch_id,cash_session_id,movement_type,direction,amount_minor,currency,reason_code,note,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
              auth.tenantId,
              session.branch_id,
              id,
              body.movementType,
              direction,
              body.amountMinor,
              session.currency,
              body.reasonCode,
              body.note ?? null,
              auth.userId,
              requestId,
            ],
          )
        ).rows[0];
        const updated = await this.refreshExpected(client, auth, id);
        await this.record(
          client,
          auth,
          updated,
          "cash_movement.created",
          requestId,
          key,
          BigInt(body.amountMinor),
          {
            movementId: movement.id,
            movementType: body.movementType,
            direction,
            reasonCode: body.reasonCode,
          },
        );
        return {
          session: sessionView(updated),
          movement: movementView(movement),
        };
      },
    );
  }

  async beginClosing(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashSessionVersionSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.begin_close",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "OPEN") throw state();
        const pending = await client.query(
          `SELECT 1 FROM payments WHERE tenant_id=$1 AND cash_session_id=$2 AND status IN ('PENDING','AUTHORIZED') LIMIT 1`,
          [auth.tenantId, id],
        );
        if (pending.rowCount)
          throw new ConflictException({
            code: "CASH_SESSION_STATUS_INVALID",
            message: "Pending payment prevents closing",
          });
        await this.refreshExpected(client, auth, id);
        const updated = {
          ...(
            await client.query<any>(
              "UPDATE cash_sessions SET status='CLOSING',closing_started_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [auth.tenantId, id],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.closing_started",
          requestId,
          key,
        );
        return sessionView(updated);
      },
    );
  }

  async declare(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashDeclareSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.declare",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "CLOSING") throw state();
        if (body.denominations) {
          const counted = body.denominations.reduce(
            (total, row) =>
              total + BigInt(row.denominationMinor) * BigInt(row.count),
            0n,
          );
          if (counted !== BigInt(body.declaredCashMinor))
            throw new ConflictException({
              code: "CASH_SESSION_COUNT_MISMATCH",
              message: "Denomination count does not equal declared cash",
            });
        }
        const expected = BigInt(session.expected_cash_minor);
        const declared = BigInt(body.declaredCashMinor);
        const updated = {
          ...(
            await client.query<any>(
              "UPDATE cash_sessions SET declared_cash_minor=$3,variance_minor=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [
                auth.tenantId,
                id,
                declared.toString(),
                (declared - expected).toString(),
              ],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.declared",
          requestId,
          key,
          declared,
          { denominationCount: body.denominations?.length ?? 0 },
        );
        return sessionView(updated);
      },
    );
  }

  async reopen(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashSessionVersionSchema.parse(input);
    if (!this.manager(auth))
      throw new ForbiddenException({
        code: "FINANCIAL_PERMISSION_DENIED",
        message: "Manager permission is required",
      });
    return this.command(
      auth,
      id,
      "cash_session.reopen",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "CLOSING") throw state();
        const updated = {
          ...(
            await client.query<any>(
              "UPDATE cash_sessions SET status='OPEN',closing_started_at=NULL,declared_cash_minor=NULL,variance_minor=NULL,variance_reason=NULL,variance_approved_by_user_id=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [auth.tenantId, id],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.reopened",
          requestId,
          key,
        );
        return sessionView(updated);
      },
    );
  }

  async close(
    auth: AccessClaims,
    id: string,
    input: unknown,
    key: string,
    requestId: string,
  ) {
    const body = cashCloseSchema.parse(input);
    return this.command(
      auth,
      id,
      "cash_session.close",
      key,
      body,
      requestId,
      async (client, session) => {
        this.assertVersion(session, body.version);
        if (session.status !== "CLOSING" || session.declared_cash_minor == null)
          throw state();
        session = await this.refreshExpected(client, auth, id);
        const variance =
          BigInt(session.declared_cash_minor) -
          BigInt(session.expected_cash_minor);
        const high = abs(variance) > BigInt(session.variance_threshold_minor);
        if (
          high &&
          (!this.manager(auth) || !body.approveVariance || !body.varianceReason)
        )
          throw new ConflictException({
            code: "CASH_SESSION_VARIANCE_APPROVAL_REQUIRED",
            message:
              "Manager approval and reason are required for high variance",
          });
        if (high && session.cashier_user_id === auth.userId)
          throw new ForbiddenException({
            code: "FINANCIAL_PERMISSION_DENIED",
            message: "Cashier cannot approve an own high variance",
          });
        const updated = {
          ...(
            await client.query<any>(
              `UPDATE cash_sessions SET status='CLOSED',variance_minor=$3,variance_reason=$4,variance_approved_by_user_id=$5,closed_at=now(),closed_by_user_id=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
              [
                auth.tenantId,
                id,
                variance.toString(),
                body.varianceReason ?? null,
                high ? auth.userId : null,
                auth.userId,
              ],
            )
          ).rows[0],
          currency: session.currency,
        };
        await this.record(
          client,
          auth,
          updated,
          "cash_session.closed",
          requestId,
          key,
          BigInt(updated.declared_cash_minor),
          { varianceMinor: variance.toString(), varianceApproved: high },
        );
        return sessionView(updated);
      },
    );
  }

  private async command<T>(
    auth: AccessClaims,
    id: string,
    command: string,
    key: string,
    request: unknown,
    requestId: string,
    work: (client: PoolClient, session: any) => Promise<T>,
  ) {
    this.assertTenant(auth);
    return (
      await this.db.transaction((client) =>
        this.idem.execute(client, {
          tenantId: auth.tenantId,
          actorScope: `user:${auth.userId}`,
          command,
          key,
          request: { id, ...(request as any) },
          work: async () =>
            work(client, await this.lockSession(client, auth, id)),
        }),
      )
    ).data;
  }
  private async lockSession(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
  ) {
    const row = (
      await client.query<any>(
        `SELECT cs.*,d.currency,b.status branch_status,bs.tax_policy_json FROM cash_sessions cs JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id JOIN branches b ON b.tenant_id=cs.tenant_id AND b.id=cs.branch_id JOIN branch_settings bs ON bs.tenant_id=cs.tenant_id AND bs.branch_id=cs.branch_id WHERE cs.tenant_id=$1 AND cs.id=$2 FOR UPDATE OF cs`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
    this.assertBranch(auth, row.branch_id);
    this.assertOwn(auth, row);
    if (row.branch_status !== "ACTIVE")
      throw new ConflictException({
        code: "FINANCIAL_BRANCH_INACTIVE",
        message: "Branch is inactive",
      });
    return row;
  }
  private async session(auth: AccessClaims, id: string) {
    this.assertTenant(auth);
    const row = (
      await this.db.query<any>(
        `SELECT cs.*,d.currency,r.code register_code,d.code drawer_code FROM cash_sessions cs JOIN cash_drawers d ON d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id JOIN pos_registers r ON r.tenant_id=cs.tenant_id AND r.id=cs.register_id WHERE cs.tenant_id=$1 AND cs.id=$2`,
        [auth.tenantId, id],
      )
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
    this.assertBranch(auth, row.branch_id);
    this.assertOwn(auth, row);
    return sessionView(row);
  }
  private async refreshExpected(
    client: PoolClient,
    auth: AccessClaims,
    id: string,
  ) {
    return (
      (
        await client.query<any>(
          `UPDATE cash_sessions cs SET expected_cash_minor=COALESCE(m.expected,0),version=version+1,updated_at=now() FROM (SELECT cash_session_id,sum(CASE WHEN direction='IN' THEN amount_minor ELSE -amount_minor END) expected FROM cash_movements WHERE tenant_id=$1 AND cash_session_id=$2 GROUP BY cash_session_id)m WHERE cs.tenant_id=$1 AND cs.id=$2 AND cs.id=m.cash_session_id RETURNING cs.*,(SELECT currency FROM cash_drawers d WHERE d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id) currency`,
          [auth.tenantId, id],
        )
      ).rows[0] ??
      (
        await client.query<any>(
          "SELECT cs.*,(SELECT currency FROM cash_drawers d WHERE d.tenant_id=cs.tenant_id AND d.id=cs.cash_drawer_id) currency FROM cash_sessions cs WHERE tenant_id=$1 AND id=$2",
          [auth.tenantId, id],
        )
      ).rows[0]
    );
  }
  private async record(
    client: PoolClient,
    auth: AccessClaims,
    session: any,
    event: string,
    requestId: string,
    key: string,
    amount?: bigint,
    payload: Record<string, unknown> = {},
  ) {
    await this.evidence.record(client, {
      auth,
      branchId: session.branch_id,
      event,
      aggregateType: "cash_session",
      aggregateId: session.id,
      aggregateVersion: Number(session.version),
      requestId,
      currency: session.currency,
      amountMinor: amount,
      registerId: session.register_id,
      idempotencyKey: key,
      payload: {
        cashSessionId: session.id,
        status: session.status,
        ...payload,
      },
    });
  }
  private assertTenant(auth: AccessClaims) {
    if (auth.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_TENANT_ACCESS_DENIED",
        message: "Support Access Grant is required",
      });
  }
  private assertBranch(auth: AccessClaims, id: string) {
    if (!auth.roles.includes("SALON_OWNER") && !auth.branchIds.includes(id))
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
  }
  private assertOwn(auth: AccessClaims, row: any) {
    if (
      auth.roles.includes("CASHIER") &&
      !this.manager(auth) &&
      row.cashier_user_id !== auth.userId
    )
      throw new NotFoundException({
        code: "CASH_SESSION_NOT_FOUND",
        message: "Cash session not found",
      });
  }
  private manager(auth: AccessClaims) {
    return auth.roles.some(
      (role) => role === "SALON_OWNER" || role === "BRANCH_MANAGER",
    );
  }
  private assertVersion(row: any, version: number) {
    if (Number(row.version) !== version)
      throw new ConflictException({
        code: "VERSION_CONFLICT",
        message: "Cash session version changed",
      });
  }
}

const state = () =>
  new ConflictException({
    code: "CASH_SESSION_STATUS_INVALID",
    message: "Cash session state does not allow this command",
  });
const abs = (value: bigint) => (value < 0n ? -value : value);
function sessionView(row: any) {
  return {
    id: row.id,
    branchId: row.branch_id,
    registerId: row.register_id,
    registerCode: row.register_code,
    cashDrawerId: row.cash_drawer_id,
    drawerCode: row.drawer_code,
    cashierUserId: row.cashier_user_id,
    businessDate: row.business_date,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status,
    openedAt: row.opened_at,
    openingFloatMinor: minorNumber(row.opening_float_minor),
    expectedCashMinor: minorNumber(row.expected_cash_minor),
    declaredCashMinor:
      row.declared_cash_minor == null
        ? null
        : minorNumber(row.declared_cash_minor),
    varianceMinor:
      row.variance_minor == null ? null : Number(row.variance_minor),
    varianceThresholdMinor: minorNumber(row.variance_threshold_minor),
    varianceReason: row.variance_reason,
    varianceApprovedByUserId: row.variance_approved_by_user_id,
    closingStartedAt: row.closing_started_at,
    closedAt: row.closed_at,
    version: Number(row.version),
  };
}
function movementView(row: any) {
  return {
    id: row.id,
    cashSessionId: row.cash_session_id,
    movementType: row.movement_type,
    direction: row.direction,
    amountMinor: minorNumber(row.amount_minor),
    currency: row.currency,
    relatedPaymentId: row.related_payment_id,
    reasonCode: row.reason_code,
    note: row.note,
    occurredAt: row.occurred_at,
  };
}
