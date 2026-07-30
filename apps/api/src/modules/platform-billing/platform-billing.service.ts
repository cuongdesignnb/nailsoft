/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../infrastructure/database.service.js";
import { BookingIdempotencyService } from "../booking/booking-idempotency.service.js";
import type { AccessClaims } from "../identity/auth.types.js";
import {
  accessModeAllowsWrite,
  fingerprint,
  prorateMinor,
  refundableMinor,
  stablePlatformPaymentKey,
} from "./platform-billing-domain.js";

@Injectable()
export class PlatformBillingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(BookingIdempotencyService)
    private readonly idem: BookingIdempotencyService,
  ) {}

  private tenantOwner(a: AccessClaims) {
    if (
      !a.tenantId ||
      !a.roles.includes("SALON_OWNER") ||
      a.roles.includes("PLATFORM_SUPER_ADMIN")
    )
      throw new ForbiddenException({
        code: "TENANT_BILLING_ACCESS_DENIED",
        message: "Tenant Owner access required",
      });
  }
  private platform(a: AccessClaims) {
    if (!a.roles.includes("PLATFORM_SUPER_ADMIN"))
      throw new ForbiddenException({
        code: "PLATFORM_ACCESS_DENIED",
        message: "Platform role required",
      });
  }
  private actor(a: AccessClaims, platform: boolean) {
    if (platform) this.platform(a);
    else this.tenantOwner(a);
  }
  private view(row: any) {
    return row
      ? Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
            value,
          ]),
        )
      : row;
  }
  private async command<T>(
    a: AccessClaims,
    targetTenantId: string,
    key: string,
    name: string,
    request: unknown,
    work: (c: PoolClient) => Promise<T>,
  ) {
    return this.db
      .transaction((c) =>
        this.idem.execute(c, {
          tenantId: targetTenantId,
          actorScope: `user:${a.userId}`,
          command: name,
          key,
          request,
          work: () => work(c),
        }),
      )
      .then((result) => ({
        ...(result.data as any),
        idempotencyReplayed: result.replayed,
      }));
  }
  private async emit(
    c: PoolClient,
    a: AccessClaims,
    tenantId: string,
    event: string,
    entity: string,
    id: string,
    requestId: string,
    before: any,
    after: any,
    reason?: string,
    key?: string,
  ) {
    await c.query(
      `INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,reason,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId,
        a.userId,
        event,
        entity,
        id,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        reason ?? null,
        requestId,
      ],
    );
    await c.query(
      `INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,metadata_json)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        tenantId,
        event,
        entity,
        id,
        JSON.stringify({ id, refetch: true }),
        JSON.stringify({ type: "USER", id: a.userId }),
        JSON.stringify({
          schemaVersion: 1,
          idempotencyKeyHash: key ? this.idem.subject(key) : null,
        }),
      ],
    );
  }
  private required(value: any, name: string) {
    if (value === undefined || value === null || value === "")
      throw new ConflictException({
        code: "VALIDATION_FAILED",
        message: `${name} is required`,
      });
    return String(value);
  }
  private async one(
    c: PoolClient,
    sql: string,
    values: unknown[],
    code: string,
  ) {
    const row = (await c.query<any>(sql, values)).rows[0];
    if (!row)
      throw new NotFoundException({ code, message: code.replaceAll("_", " ") });
    return row;
  }

  async tenantAccount(a: AccessClaims) {
    this.tenantOwner(a);
    return this.view(
      (
        await this.db.query(
          "SELECT * FROM platform_billing_accounts WHERE tenant_id=$1",
          [a.tenantId],
        )
      ).rows[0],
    );
  }
  async updateTenantAccount(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.tenantOwner(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "tenant.billing.account.update",
      body,
      async (c) => {
        const before = await this.one(
          c,
          "SELECT * FROM platform_billing_accounts WHERE tenant_id=$1 FOR UPDATE",
          [a.tenantId],
          "BILLING_ACCOUNT_INCOMPLETE",
        );
        const row = (
          await c.query<any>(
            `UPDATE platform_billing_accounts SET legal_name=COALESCE($2,legal_name),billing_email=COALESCE($3,billing_email),billing_contact_name=COALESCE($4,billing_contact_name),
        billing_address_redacted_json=COALESCE($5,billing_address_redacted_json),locale=COALESCE($6,locale),timezone=COALESCE($7,timezone),version=version+1,updated_at=now() WHERE tenant_id=$1 RETURNING *`,
            [
              a.tenantId,
              body.legalName,
              body.billingEmail,
              body.billingContactName,
              body.billingAddressRedactedJson
                ? JSON.stringify(body.billingAddressRedactedJson)
                : null,
              body.locale,
              body.timezone,
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          a.tenantId,
          "platform.billing_account.updated",
          "platform_billing_account",
          row.id,
          requestId,
          before,
          row,
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }
  async publicPlans(a: AccessClaims) {
    this.tenantOwner(a);
    return (
      await this.db
        .query<any>(`SELECT p.id,p.code,p.name,v.id plan_version_id,pr.id price_id,pr.billing_interval,pr.unit_amount_minor,pr.currency
    FROM platform_plans p JOIN platform_plan_versions v ON v.plan_id=p.id AND v.status='ACTIVE' JOIN platform_prices pr ON pr.plan_version_id=v.id AND pr.status='ACTIVE'
    WHERE p.status='PUBLISHED' AND p.legacy_only=false ORDER BY pr.unit_amount_minor`)
    ).rows.map((x) => this.view(x));
  }
  async tenantSubscription(a: AccessClaims) {
    this.tenantOwner(a);
    return this.view(
      (
        await this.db.query<any>(
          `SELECT s.*,p.code plan_code,p.name plan_name FROM platform_subscriptions s JOIN platform_plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 ORDER BY s.created_at DESC LIMIT 1`,
          [a.tenantId],
        )
      ).rows[0],
    );
  }
  async tenantEntitlements(a: AccessClaims) {
    this.tenantOwner(a);
    return (
      await this.db.query<any>(
        "SELECT * FROM platform_entitlement_projections WHERE tenant_id=$1 ORDER BY entitlement_code",
        [a.tenantId],
      )
    ).rows.map((x) => this.view(x));
  }
  async tenantUsage(a: AccessClaims) {
    this.tenantOwner(a);
    return (
      await this.db.query<any>(
        `SELECT u.*,m.code meter_code,m.unit FROM platform_usage_aggregates u JOIN platform_usage_meter_definitions m ON m.id=u.meter_id WHERE tenant_id=$1 ORDER BY period_start DESC`,
        [a.tenantId],
      )
    ).rows.map((x) => this.view(x));
  }
  async tenantInvoices(a: AccessClaims, id?: string) {
    this.tenantOwner(a);
    const r = await this.db.query<any>(
      `SELECT * FROM platform_invoices WHERE tenant_id=$1 ${id ? "AND id=$2" : ""} ORDER BY created_at DESC`,
      id ? [a.tenantId, id] : [a.tenantId],
    );
    return id ? this.view(r.rows[0]) : r.rows.map((x) => this.view(x));
  }
  async tenantPaymentMethods(a: AccessClaims) {
    this.tenantOwner(a);
    return (
      await this.db.query<any>(
        "SELECT id,provider,method_type,display_json,status,created_at FROM platform_payment_methods WHERE tenant_id=$1 ORDER BY created_at DESC",
        [a.tenantId],
      )
    ).rows.map((x) => this.view(x));
  }
  async addPaymentMethod(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.tenantOwner(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "tenant.billing.payment_method.add",
      body,
      async (c) => {
        const account = await this.one(
          c,
          "SELECT * FROM platform_billing_accounts WHERE tenant_id=$1 FOR UPDATE",
          [a.tenantId],
          "BILLING_ACCOUNT_INCOMPLETE",
        );
        const row = (
          await c.query<any>(
            `INSERT INTO platform_payment_methods(tenant_id,billing_account_id,provider,provider_reference,method_type,display_json,status)
        VALUES($1,$2,$3,$4,$5,$6,'ACTIVE') RETURNING *`,
            [
              a.tenantId,
              account.id,
              this.required(body.provider, "provider"),
              this.required(body.providerReference, "providerReference"),
              this.required(body.methodType, "methodType"),
              JSON.stringify(body.display ?? {}),
            ],
          )
        ).rows[0];
        await c.query(
          "UPDATE platform_billing_accounts SET default_payment_method_id=COALESCE(default_payment_method_id,$2),version=version+1 WHERE id=$1",
          [account.id, row.id],
        );
        await this.emit(
          c,
          a,
          a.tenantId,
          "platform.payment_method.attached",
          "platform_payment_method",
          row.id,
          requestId,
          null,
          { id: row.id, methodType: row.method_type },
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }

  async startTrial(a: AccessClaims, body: any, key: string, requestId: string) {
    this.tenantOwner(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "platform.subscription.start_trial",
      body,
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `trial:${a.tenantId}`,
        ]);
        if (
          (
            await c.query(
              "SELECT 1 FROM platform_subscriptions WHERE tenant_id=$1 AND trial_started_at IS NOT NULL",
              [a.tenantId],
            )
          ).rowCount
        )
          throw new ConflictException({
            code: "TRIAL_ALREADY_USED",
            message: "Trial already used",
          });
        const plan = await this.one(
          c,
          `SELECT p.*,v.id plan_version_id,pr.id price_id,pr.unit_amount_minor,pr.currency FROM platform_plans p JOIN platform_plan_versions v ON v.plan_id=p.id AND v.status='ACTIVE' JOIN platform_prices pr ON pr.plan_version_id=v.id AND pr.status='ACTIVE' WHERE p.id=$1 AND p.legacy_only=false`,
          [body.planId],
          "PLATFORM_PLAN_NOT_FOUND",
        );
        const account = await this.one(
          c,
          "SELECT * FROM platform_billing_accounts WHERE tenant_id=$1 FOR UPDATE",
          [a.tenantId],
          "BILLING_ACCOUNT_INCOMPLETE",
        );
        const old = (
          await c.query<any>(
            "SELECT * FROM platform_subscriptions WHERE tenant_id=$1 AND status NOT IN('CANCELLED','TERMINATED') FOR UPDATE",
            [a.tenantId],
          )
        ).rows[0];
        if (old?.collection_mode === "DISABLED")
          await c.query(
            "UPDATE platform_subscriptions SET status='CANCELLED',cancelled_at=now(),version=version+1 WHERE id=$1",
            [old.id],
          );
        else if (old)
          throw new ConflictException({
            code: "SUBSCRIPTION_STATUS_INVALID",
            message: "A live subscription already exists",
          });
        const days = Math.max(1, Math.min(30, Number(body.trialDays ?? 14))),
          start = new Date(),
          end = new Date(start.getTime() + days * 86400000);
        const row = (
          await c.query<any>(
            `INSERT INTO platform_subscriptions(tenant_id,billing_account_id,product_id,plan_id,plan_version_id,status,collection_mode,current_period_start,current_period_end,trial_started_at,trial_ends_at)
        VALUES($1,$2,$3,$4,$5,'TRIALING',$6,$7,$8,$7,$8) RETURNING *`,
            [
              a.tenantId,
              account.id,
              plan.product_id,
              plan.id,
              plan.plan_version_id,
              body.collectionMode ?? "MANUAL_INVOICE",
              start,
              end,
            ],
          )
        ).rows[0];
        await this.createPeriod(c, row, plan);
        await this.rebuildEntitlements(
          c,
          a.tenantId,
          row.id,
          row.plan_version_id,
        );
        await this.history(
          c,
          a,
          row,
          null,
          "TRIALING",
          requestId,
          "Owner started trial",
        );
        await this.emit(
          c,
          a,
          a.tenantId,
          "platform.subscription_created",
          "platform_subscription",
          row.id,
          requestId,
          null,
          row,
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }
  private async createPeriod(c: PoolClient, s: any, plan: any) {
    await c.query(
      `INSERT INTO platform_subscription_periods(tenant_id,subscription_id,period_start,period_end,billing_timezone,plan_version_id,price_snapshot_json,entitlement_snapshot_json,quota_snapshot_json,fingerprint)
      SELECT $1,$2,$3,$4,a.timezone,$5,$6,v.entitlement_snapshot_json,v.quota_snapshot_json,$7 FROM platform_billing_accounts a CROSS JOIN platform_plan_versions v WHERE a.id=$8 AND v.id=$5`,
      [
        s.tenant_id,
        s.id,
        s.current_period_start,
        s.current_period_end,
        s.plan_version_id,
        JSON.stringify({
          priceId: plan.price_id,
          unitAmountMinor: String(plan.unit_amount_minor),
          currency: plan.currency,
        }),
        fingerprint({
          subscriptionId: s.id,
          start: s.current_period_start,
          planVersionId: s.plan_version_id,
        }),
        s.billing_account_id,
      ],
    );
    if (plan.price_id)
      await c.query(
        "INSERT INTO platform_subscription_items(tenant_id,subscription_id,price_id,quantity,starts_at) VALUES($1,$2,$3,1,$4)",
        [s.tenant_id, s.id, plan.price_id, s.current_period_start],
      );
  }
  private async rebuildEntitlements(
    c: PoolClient,
    tenantId: string,
    subscriptionId: string,
    versionId: string,
  ) {
    await c.query(
      `INSERT INTO platform_entitlement_projections(tenant_id,entitlement_code,enabled,quota_limit,unlimited,source_type,source_id,fingerprint)
      SELECT $1::uuid,e.entitlement_code,e.enabled,e.quota_limit,e.unlimited,'PLAN_VERSION',$2::uuid,encode(digest($1::text||':'||e.entitlement_code||':'||$3::text,'sha256'),'hex')
      FROM platform_plan_entitlements e WHERE e.plan_version_id=$3::uuid ON CONFLICT(tenant_id,entitlement_code) DO UPDATE SET enabled=excluded.enabled,quota_limit=excluded.quota_limit,unlimited=excluded.unlimited,source_type=excluded.source_type,source_id=excluded.source_id,version=platform_entitlement_projections.version+1,fingerprint=excluded.fingerprint,rebuilt_at=now()`,
      [tenantId, subscriptionId, versionId],
    );
  }
  private async history(
    c: PoolClient,
    a: AccessClaims,
    s: any,
    from: string | null,
    to: string,
    requestId: string,
    reason: string,
  ) {
    await c.query(
      `INSERT INTO platform_subscription_history(tenant_id,subscription_id,from_status,to_status,actor_user_id,reason,request_id,snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        s.tenant_id,
        s.id,
        from,
        to,
        a.userId,
        reason,
        requestId,
        JSON.stringify(s),
      ],
    );
  }
  async changePlan(
    a: AccessClaims,
    subscriptionId: string,
    body: any,
    key: string,
    requestId: string,
    platform = false,
  ) {
    this.actor(a, platform);
    const target = platform
      ? this.required(body.tenantId, "tenantId")
      : a.tenantId;
    return this.command(
      a,
      target,
      key,
      "platform.subscription.change_plan",
      { subscriptionId, ...body },
      async (c) => {
        const s = await this.one(
          c,
          "SELECT * FROM platform_subscriptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [target, subscriptionId],
          "SUBSCRIPTION_NOT_FOUND",
        );
        if (Number(body.version) !== s.version)
          throw new ConflictException({
            code: "SUBSCRIPTION_VERSION_CONFLICT",
            message: "Subscription version changed",
          });
        const plan = await this.one(
          c,
          `SELECT p.*,v.id plan_version_id,pr.id price_id,pr.unit_amount_minor,pr.currency FROM platform_plans p JOIN platform_plan_versions v ON v.plan_id=p.id AND v.status='ACTIVE' JOIN platform_prices pr ON pr.plan_version_id=v.id AND pr.status='ACTIVE' WHERE p.id=$1 AND p.legacy_only=false`,
          [body.planId],
          "PLATFORM_PLAN_NOT_FOUND",
        );
        const current = (
          await c.query<any>(
            `SELECT pr.* FROM platform_subscription_items i JOIN platform_prices pr ON pr.id=i.price_id WHERE i.subscription_id=$1 AND i.status='ACTIVE' ORDER BY i.created_at DESC LIMIT 1`,
            [s.id],
          )
        ).rows[0];
        if (current && current.currency !== plan.currency)
          throw new ConflictException({
            code: "PLATFORM_CURRENCY_MISMATCH",
            message: "Plan currency mismatch",
          });
        const immediate = (body.effectiveMode ?? "NEXT_PERIOD") === "IMMEDIATE",
          now = new Date();
        let proration = 0n;
        if (immediate) {
          const remaining = BigInt(
              Math.max(
                0,
                Math.floor(
                  (new Date(s.current_period_end).getTime() - now.getTime()) /
                    1000,
                ),
              ),
            ),
            total = BigInt(
              Math.max(
                1,
                Math.floor(
                  (new Date(s.current_period_end).getTime() -
                    new Date(s.current_period_start).getTime()) /
                    1000,
                ),
              ),
            );
          proration = prorateMinor(
            BigInt(plan.unit_amount_minor) -
              BigInt(current?.unit_amount_minor ?? 0),
            remaining,
            total,
          );
        }
        const change = (
          await c.query<any>(
            `INSERT INTO platform_subscription_changes(tenant_id,subscription_id,change_type,effective_mode,from_plan_version_id,to_plan_version_id,proration_minor,currency,effective_at,status,evidence_json,applied_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [
              target,
              s.id,
              body.changeType ?? (proration >= 0n ? "UPGRADE" : "DOWNGRADE"),
              immediate ? "IMMEDIATE" : "NEXT_PERIOD",
              s.plan_version_id,
              plan.plan_version_id,
              proration.toString(),
              plan.currency,
              immediate ? now : s.current_period_end,
              immediate ? "APPLIED" : "PENDING",
              JSON.stringify({
                rounding: "HALF_UP",
                remainingSecondsExact: true,
              }),
              immediate ? now : null,
            ],
          )
        ).rows[0];
        if (immediate) {
          await c.query(
            "UPDATE platform_subscription_items SET status='CANCELLED',ends_at=now() WHERE subscription_id=$1 AND status='ACTIVE'",
            [s.id],
          );
          await c.query(
            "INSERT INTO platform_subscription_items(tenant_id,subscription_id,price_id,quantity,starts_at) VALUES($1,$2,$3,$4,now())",
            [target, s.id, plan.price_id, body.quantity ?? 1],
          );
          const updatedSubscription = (
            await c.query<any>(
              `UPDATE platform_subscriptions
             SET plan_id=$2,
                 plan_version_id=$3,
                 status=CASE WHEN status='TRIALING' THEN 'ACTIVE' ELSE status END,
                 version=version+1,
                 updated_at=now()
             WHERE id=$1
             RETURNING *`,
              [s.id, plan.id, plan.plan_version_id],
            )
          ).rows[0];
          if (s.status === "TRIALING")
            await this.history(
              c,
              a,
              updatedSubscription,
              "TRIALING",
              "ACTIVE",
              requestId,
              "Tenant Owner converted trial through immediate paid plan change",
            );
          await this.rebuildEntitlements(c, target, s.id, plan.plan_version_id);
          if (proration < 0n)
            await c.query(
              `INSERT INTO platform_billing_credit_ledger(tenant_id,billing_account_id,entry_type,amount_minor,currency,source_type,source_id,evidence_json,created_by_user_id) VALUES($1,$2,'PRORATION_CREDIT',$3,$4,'SUBSCRIPTION_CHANGE',$5,$6,$7)`,
              [
                target,
                s.billing_account_id,
                (-proration).toString(),
                plan.currency,
                change.id,
                JSON.stringify({ calculation: "exact-rational" }),
                a.userId,
              ],
            );
        }
        await this.emit(
          c,
          a,
          target,
          "platform.subscription_changed",
          "platform_subscription",
          s.id,
          requestId,
          s,
          {
            ...s,
            plan_version_id: plan.plan_version_id,
            proration_minor: proration.toString(),
          },
          body.reason,
          key,
        );
        return this.view({ ...change, proration_minor: proration.toString() });
      },
    );
  }
  async cancel(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
    platform = false,
  ) {
    this.actor(a, platform);
    const tenant = platform
      ? this.required(body.tenantId, "tenantId")
      : a.tenantId;
    return this.subscriptionStatus(
      a,
      tenant,
      id,
      body,
      key,
      requestId,
      body.immediate ? "CANCELLED" : "CANCEL_AT_PERIOD_END",
      "platform.subscription_cancelled",
    );
  }
  async reactivate(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
    platform = false,
  ) {
    this.actor(a, platform);
    const tenant = platform
      ? this.required(body.tenantId, "tenantId")
      : a.tenantId;
    return this.subscriptionStatus(
      a,
      tenant,
      id,
      body,
      key,
      requestId,
      "ACTIVE",
      "platform.subscription_reactivated",
    );
  }
  private async subscriptionStatus(
    a: AccessClaims,
    tenant: string,
    id: string,
    body: any,
    key: string,
    requestId: string,
    status: string,
    event: string,
  ) {
    return this.command(a, tenant, key, event, body, async (c) => {
      const row = await this.one(
        c,
        "SELECT * FROM platform_subscriptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tenant, id],
        "SUBSCRIPTION_NOT_FOUND",
      );
      if (Number(body.version) !== row.version)
        throw new ConflictException({
          code: "SUBSCRIPTION_VERSION_CONFLICT",
          message: "Subscription version changed",
        });
      const after = (
        await c.query<any>(
          `UPDATE platform_subscriptions SET status=$3,cancel_at_period_end=$3='CANCEL_AT_PERIOD_END',cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [tenant, id, status],
        )
      ).rows[0];
      await this.history(
        c,
        a,
        after,
        row.status,
        status,
        requestId,
        body.reason ?? event,
      );
      await this.emit(
        c,
        a,
        tenant,
        event,
        "platform_subscription",
        id,
        requestId,
        row,
        after,
        body.reason,
        key,
      );
      return this.view(after);
    });
  }

  async platformPlans(a: AccessClaims) {
    this.platform(a);
    return (
      await this.db.query<any>(
        `SELECT p.*,json_agg(v ORDER BY v.version_no) versions FROM platform_plans p LEFT JOIN platform_plan_versions v ON v.plan_id=p.id GROUP BY p.id ORDER BY p.created_at`,
      )
    ).rows.map((x) => this.view(x));
  }
  async createPlan(a: AccessClaims, body: any, key: string, requestId: string) {
    this.platform(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "platform.plan.create",
      body,
      async (c) => {
        const product = (
          await c.query<any>(
            "SELECT id FROM platform_products WHERE code='NAILSOFT'",
          )
        ).rows[0];
        const row = (
          await c.query<any>(
            "INSERT INTO platform_plans(product_id,code,name,status,legacy_only) VALUES($1,$2,$3,'DRAFT',false) RETURNING *",
            [
              product.id,
              this.required(body.code, "code"),
              this.required(body.name, "name"),
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          a.tenantId,
          "platform.plan.created",
          "platform_plan",
          row.id,
          requestId,
          null,
          row,
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }
  async createPlanVersion(
    a: AccessClaims,
    planId: string,
    body: any,
    key: string,
    _requestId: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "platform.plan.version.create",
      body,
      async (c) => {
        await this.one(
          c,
          "SELECT * FROM platform_plans WHERE id=$1 FOR UPDATE",
          [planId],
          "PLATFORM_PLAN_NOT_FOUND",
        );
        const no = (
          await c.query<any>(
            "SELECT COALESCE(max(version_no),0)+1 n FROM platform_plan_versions WHERE plan_id=$1",
            [planId],
          )
        ).rows[0].n;
        const row = (
          await c.query<any>(
            `INSERT INTO platform_plan_versions(plan_id,version_no,status,entitlement_snapshot_json,quota_snapshot_json,fingerprint) VALUES($1,$2,'DRAFT',$3,$4,$5) RETURNING *`,
            [
              planId,
              no,
              JSON.stringify(body.entitlements ?? {}),
              JSON.stringify(body.quotas ?? {}),
              fingerprint(body),
            ],
          )
        ).rows[0];
        return this.view(row);
      },
    );
  }
  async publishPlanVersion(
    a: AccessClaims,
    planId: string,
    versionId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "platform.plan.publish",
      body,
      async (c) => {
        const row = await this.one(
          c,
          "SELECT * FROM platform_plan_versions WHERE id=$1 AND plan_id=$2 FOR UPDATE",
          [versionId, planId],
          "PLATFORM_PLAN_NOT_FOUND",
        );
        if (row.status !== "DRAFT")
          throw new ConflictException({
            code: "PLATFORM_PLAN_STATUS_INVALID",
            message: "Only draft version can publish",
          });
        const after = (
          await c.query<any>(
            "UPDATE platform_plan_versions SET status='ACTIVE',activated_at=now() WHERE id=$1 RETURNING *",
            [versionId],
          )
        ).rows[0];
        await c.query(
          "UPDATE platform_plan_versions SET status='SUPERSEDED' WHERE plan_id=$1 AND id<>$2 AND status='ACTIVE'",
          [planId, versionId],
        );
        await c.query(
          "UPDATE platform_plans SET status='PUBLISHED',version=version+1,updated_at=now() WHERE id=$1",
          [planId],
        );
        await this.emit(
          c,
          a,
          a.tenantId,
          "platform.plan_published",
          "platform_plan_version",
          versionId,
          requestId,
          row,
          after,
          body.reason,
          key,
        );
        return this.view(after);
      },
    );
  }
  async prices(a: AccessClaims) {
    this.platform(a);
    return (
      await this.db.query<any>(
        "SELECT * FROM platform_prices ORDER BY created_at DESC",
      )
    ).rows.map((x) => this.view(x));
  }
  async createPrice(
    a: AccessClaims,
    body: any,
    key: string,
    _requestId: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "platform.price.create",
      body,
      async (c) => {
        const row = (
          await c.query<any>(
            `INSERT INTO platform_prices(plan_version_id,code,price_type,billing_interval,interval_count,unit_amount_minor,currency,status,meter_code,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9) RETURNING *`,
            [
              this.required(body.planVersionId, "planVersionId"),
              this.required(body.code, "code"),
              body.priceType ?? "FLAT",
              body.billingInterval ?? "MONTHLY",
              body.intervalCount ?? 1,
              this.required(body.unitAmountMinor, "unitAmountMinor"),
              this.required(body.currency, "currency"),
              body.meterCode ?? null,
              fingerprint(body),
            ],
          )
        ).rows[0];
        return this.view(row);
      },
    );
  }
  async activatePrice(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      a.tenantId,
      key,
      "platform.price.activate",
      body,
      async (c) => {
        const row = await this.one(
          c,
          "SELECT * FROM platform_prices WHERE id=$1 FOR UPDATE",
          [id],
          "PLATFORM_PRICE_NOT_FOUND",
        );
        if (row.status !== "DRAFT")
          throw new ConflictException({
            code: "PLATFORM_PRICE_IMMUTABLE",
            message: "Only draft price can activate",
          });
        const after = (
          await c.query<any>(
            "UPDATE platform_prices SET status='ACTIVE',activated_at=now() WHERE id=$1 RETURNING *",
            [id],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          a.tenantId,
          "platform.price_activated",
          "platform_price",
          id,
          requestId,
          row,
          after,
          body.reason,
          key,
        );
        return this.view(after);
      },
    );
  }
  async platformTenants(a: AccessClaims, id?: string) {
    this.platform(a);
    const r = await this.db.query<any>(
      `SELECT t.id,t.name,t.slug,t.status,t.lifecycle_status,t.access_mode,a.state billing_state,a.collection_mode,s.id subscription_id,s.status subscription_status,p.code plan_code FROM tenants t LEFT JOIN platform_billing_accounts a ON a.tenant_id=t.id LEFT JOIN platform_subscriptions s ON s.tenant_id=t.id AND s.status NOT IN('CANCELLED','TERMINATED') LEFT JOIN platform_plans p ON p.id=s.plan_id ${id ? "WHERE t.id=$1" : ""} ORDER BY t.created_at`,
      id ? [id] : [],
    );
    return id ? this.view(r.rows[0]) : r.rows.map((x) => this.view(x));
  }

  async listInvoices(a: AccessClaims) {
    this.platform(a);
    return (
      await this.db.query<any>(
        "SELECT * FROM platform_invoices ORDER BY created_at DESC",
      )
    ).rows.map((x) => this.view(x));
  }
  async createInvoice(
    a: AccessClaims,
    body: any,
    key: string,
    _requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.invoice.create",
      body,
      async (c) => {
        const account = await this.one(
          c,
          "SELECT * FROM platform_billing_accounts WHERE tenant_id=$1",
          [tenant],
          "BILLING_ACCOUNT_INCOMPLETE",
        );
        if (account.collection_mode === "DISABLED")
          throw new ConflictException({
            code: "PLATFORM_INVOICE_STATUS_INVALID",
            message: "Disabled collection cannot create payable invoice",
          });
        const row = (
          await c.query<any>(
            `INSERT INTO platform_invoices(tenant_id,billing_account_id,subscription_id,subscription_period_id,currency,status) VALUES($1,$2,$3,$4,$5,'DRAFT') RETURNING *`,
            [
              tenant,
              account.id,
              body.subscriptionId ?? null,
              body.subscriptionPeriodId ?? null,
              body.currency ?? account.currency,
            ],
          )
        ).rows[0];
        return this.view(row);
      },
    );
  }
  async calculateInvoice(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    _requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.invoice.calculate",
      body,
      async (c) => {
        const invoice = await this.one(
          c,
          "SELECT * FROM platform_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, id],
          "PLATFORM_INVOICE_NOT_FOUND",
        );
        if (invoice.status !== "DRAFT")
          throw new ConflictException({
            code: "PLATFORM_INVOICE_STATUS_INVALID",
            message: "Only draft invoice can calculate",
          });
        await c.query(
          "DELETE FROM platform_invoice_lines WHERE invoice_id=$1",
          [id],
        );
        const items = (
          await c.query<any>(
            `SELECT i.*,p.unit_amount_minor,p.price_type,p.code FROM platform_subscription_items i JOIN platform_prices p ON p.id=i.price_id WHERE i.subscription_id=$1 AND i.status='ACTIVE'`,
            [invoice.subscription_id],
          )
        ).rows;
        for (const item of items)
          await c.query(
            `INSERT INTO platform_invoice_lines(tenant_id,invoice_id,line_type,description,quantity,unit_amount_minor,total_minor,source_type,source_id,snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$5*$6,'SUBSCRIPTION_ITEM',$7,$8)`,
            [
              tenant,
              id,
              item.price_type === "FLAT"
                ? "BASE_PLAN"
                : item.price_type === "METERED"
                  ? "METERED_USAGE"
                  : "ADD_ON",
              item.code,
              item.quantity,
              item.unit_amount_minor,
              item.id,
              JSON.stringify({ priceId: item.price_id }),
            ],
          );
        if (body.manualAdjustmentMinor)
          await c.query(
            `INSERT INTO platform_invoice_lines(tenant_id,invoice_id,line_type,description,quantity,unit_amount_minor,total_minor,snapshot_json) VALUES($1,$2,'MANUAL_ADJUSTMENT',$3,1,$4,$4,$5)`,
            [
              tenant,
              id,
              this.required(body.adjustmentReason, "adjustmentReason"),
              body.manualAdjustmentMinor,
              JSON.stringify({ evidence: body.evidence }),
            ],
          );
        const total = (
          await c.query<any>(
            "SELECT COALESCE(sum(total_minor),0) total FROM platform_invoice_lines WHERE invoice_id=$1",
            [id],
          )
        ).rows[0].total;
        const after = (
          await c.query<any>(
            "UPDATE platform_invoices SET subtotal_minor=$2,total_minor=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, total],
          )
        ).rows[0];
        return this.view(after);
      },
    );
  }
  async finalizeInvoice(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.invoice.finalize",
      body,
      async (c) => {
        const invoice = await this.one(
          c,
          "SELECT * FROM platform_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, id],
          "PLATFORM_INVOICE_NOT_FOUND",
        );
        if (invoice.status !== "DRAFT")
          throw new ConflictException({
            code: "PLATFORM_INVOICE_STATUS_INVALID",
            message: "Only draft invoice can finalize",
          });
        const sum = (
          await c.query<any>(
            "SELECT COALESCE(sum(total_minor),0) total FROM platform_invoice_lines WHERE invoice_id=$1",
            [id],
          )
        ).rows[0].total;
        if (BigInt(sum) !== BigInt(invoice.total_minor))
          throw new ConflictException({
            code: "PLATFORM_INVOICE_TOTAL_MISMATCH",
            message: "Invoice lines do not match total",
          });
        const account = await this.one(
          c,
          "SELECT * FROM platform_billing_accounts WHERE id=$1 FOR UPDATE",
          [invoice.billing_account_id],
          "BILLING_ACCOUNT_INCOMPLETE",
        );
        if (
          account.collection_mode === "DISABLED" &&
          BigInt(invoice.total_minor) > 0n
        )
          throw new ConflictException({
            code: "PLATFORM_INVOICE_STATUS_INVALID",
            message: "Legacy disabled account cannot be charged",
          });
        const seq = (
          await c.query<any>(
            "UPDATE platform_invoice_number_sequences SET next_value=next_value+1,version=version+1 WHERE billing_account_id=$1 RETURNING next_value-1 value",
            [account.id],
          )
        ).rows[0].value;
        const number = `${account.invoice_prefix}-${String(seq).padStart(8, "0")}`;
        const fp = fingerprint({
          id,
          number,
          total: String(invoice.total_minor),
          currency: invoice.currency,
          lines: sum,
        });
        const after = (
          await c.query<any>(
            "UPDATE platform_invoices SET invoice_number=$2,status=CASE WHEN total_minor=0 THEN 'PAID' ELSE 'OPEN' END,due_at=now()+interval '14 days',finalized_at=now(),fingerprint=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, number, fp],
          )
        ).rows[0];
        if (invoice.subscription_period_id)
          await c.query(
            "UPDATE platform_subscription_periods SET invoice_id=$2,locked_at=now() WHERE id=$1",
            [invoice.subscription_period_id, id],
          );
        await this.emit(
          c,
          a,
          tenant,
          "platform.invoice_finalized",
          "platform_invoice",
          id,
          requestId,
          invoice,
          after,
          body.reason,
          key,
        );
        return this.view(after);
      },
    );
  }
  async voidInvoice(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.invoice.void",
      body,
      async (c) => {
        const invoice = await this.one(
          c,
          "SELECT * FROM platform_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, id],
          "PLATFORM_INVOICE_NOT_FOUND",
        );
        if (
          !["OPEN", "PAST_DUE"].includes(invoice.status) ||
          BigInt(invoice.paid_minor) > 0n
        )
          throw new ConflictException({
            code: "PLATFORM_INVOICE_STATUS_INVALID",
            message: "Paid invoice cannot be voided",
          });
        const after = (
          await c.query<any>(
            "UPDATE platform_invoices SET status='VOID',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          tenant,
          "platform.invoice_voided",
          "platform_invoice",
          id,
          requestId,
          invoice,
          after,
          this.required(body.reason, "reason"),
          key,
        );
        return this.view(after);
      },
    );
  }
  async createCreditNote(
    a: AccessClaims,
    invoiceId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.credit_note.create",
      body,
      async (c) => {
        const invoice = await this.one(
          c,
          "SELECT * FROM platform_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, invoiceId],
          "PLATFORM_INVOICE_NOT_FOUND",
        );
        if (!["OPEN", "PARTIALLY_PAID", "PAST_DUE"].includes(invoice.status))
          throw new ConflictException({
            code: "PLATFORM_INVOICE_STATUS_INVALID",
            message: "Manual payment requires an open invoice",
          });
        const amount = BigInt(this.required(body.amountMinor, "amountMinor"));
        if (amount <= 0n || amount > BigInt(invoice.total_minor))
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_AMOUNT_MISMATCH",
            message: "Credit amount invalid",
          });
        const row = (
          await c.query<any>(
            `INSERT INTO platform_credit_notes(tenant_id,invoice_id,number,status,currency,total_minor,reason,evidence_json,finalized_at,fingerprint,created_by_user_id,approved_by_user_id) VALUES($1,$2,$3,'FINALIZED',$4,$5,$6,$7,now(),$8,$9,$10) RETURNING *`,
            [
              tenant,
              invoiceId,
              `CN-${Date.now()}`,
              invoice.currency,
              amount.toString(),
              this.required(body.reason, "reason"),
              JSON.stringify(body.evidence ?? {}),
              fingerprint(body),
              a.userId,
              body.approvedByUserId,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO platform_credit_note_lines(tenant_id,credit_note_id,description,amount_minor) VALUES($1,$2,$3,$4)",
          [tenant, row.id, body.reason, amount.toString()],
        );
        await c.query(
          `INSERT INTO platform_billing_credit_ledger(tenant_id,billing_account_id,entry_type,amount_minor,currency,source_type,source_id,evidence_json,created_by_user_id) VALUES($1,$2,'CREDIT_NOTE',$3,$4,'CREDIT_NOTE',$5,$6,$7)`,
          [
            tenant,
            invoice.billing_account_id,
            amount.toString(),
            invoice.currency,
            row.id,
            JSON.stringify(body.evidence ?? {}),
            a.userId,
          ],
        );
        await this.emit(
          c,
          a,
          tenant,
          "platform.credit_note_finalized",
          "platform_credit_note",
          row.id,
          requestId,
          null,
          row,
          body.reason,
          key,
        );
        return this.view(row);
      },
    );
  }

  async paymentIntents(a: AccessClaims) {
    this.platform(a);
    return (
      await this.db.query<any>(
        "SELECT * FROM platform_payment_intents ORDER BY created_at DESC",
      )
    ).rows.map((x) => this.view(x));
  }
  async createPaymentIntent(
    a: AccessClaims,
    body: any,
    key: string,
    _requestId: string,
    tenantOwner = false,
  ) {
    this.actor(a, !tenantOwner);
    const tenant = tenantOwner
      ? a.tenantId
      : this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.payment_intent.create",
      body,
      async (c) => {
        const invoice = await this.one(
          c,
          "SELECT * FROM platform_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, body.invoiceId],
          "PLATFORM_INVOICE_NOT_FOUND",
        );
        if (!["OPEN", "PARTIALLY_PAID", "PAST_DUE"].includes(invoice.status))
          throw new ConflictException({
            code: "PLATFORM_INVOICE_STATUS_INVALID",
            message: "Invoice cannot be paid",
          });
        const amount = BigInt(
          body.amountMinor ??
            BigInt(invoice.total_minor) - BigInt(invoice.paid_minor),
        );
        if (
          amount <= 0n ||
          amount > BigInt(invoice.total_minor) - BigInt(invoice.paid_minor)
        )
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_AMOUNT_MISMATCH",
            message: "Payment amount invalid",
          });
        const id = (await c.query<any>("SELECT gen_random_uuid() id")).rows[0]
            .id,
          keyValue = stablePlatformPaymentKey(tenant, invoice.id, id);
        const row = (
          await c.query<any>(
            `INSERT INTO platform_payment_intents(id,tenant_id,invoice_id,payment_method_id,amount_minor,currency,status,provider,provider_key) VALUES($1,$2,$3,$4,$5,$6,'REQUIRES_CONFIRMATION',$7,$8) RETURNING *`,
            [
              id,
              tenant,
              invoice.id,
              body.paymentMethodId ?? null,
              amount.toString(),
              invoice.currency,
              body.provider ?? "FAKE",
              keyValue,
            ],
          )
        ).rows[0];
        return this.view(row);
      },
    );
  }
  async confirmPayment(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.payment.confirm",
      body,
      async (c) => {
        const intent = await this.one(
          c,
          "SELECT * FROM platform_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, id],
          "PLATFORM_PAYMENT_NOT_FOUND",
        );
        if (intent.status === "UNKNOWN")
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_OUTCOME_UNKNOWN",
            message: "Reconcile unknown payment before retry",
          });
        if (intent.status === "SUCCEEDED") return this.view(intent);
        if (!["REQUIRES_CONFIRMATION", "FAILED"].includes(intent.status))
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_STATUS_INVALID",
            message: "Payment cannot be confirmed",
          });
        if (
          (intent.provider === "FAKE" &&
            process.env.NODE_ENV === "production") ||
          (intent.provider !== "FAKE" && !process.env.PLATFORM_BILLING_PROVIDER)
        )
          throw new ConflictException({
            code: "PLATFORM_BILLING_PROVIDER_NOT_CONFIGURED",
            message: "Production platform billing provider is not configured",
          });
        const status = body.simulateOutcome ?? "SUCCEEDED";
        const attempt = (
          await c.query<any>(
            "SELECT COALESCE(max(attempt_no),0)+1 n FROM platform_payment_attempts WHERE payment_intent_id=$1",
            [id],
          )
        ).rows[0].n;
        await c.query(
          `INSERT INTO platform_payment_attempts(tenant_id,payment_intent_id,attempt_no,request_json,response_redacted_json,outcome,finished_at) VALUES($1,$2,$3,$4,$5,$6,now())`,
          [
            tenant,
            id,
            attempt,
            JSON.stringify({ providerKey: intent.provider_key }),
            JSON.stringify({ simulated: intent.provider === "FAKE" }),
            status,
          ],
        );
        const after = (
          await c.query<any>(
            "UPDATE platform_payment_intents SET status=$2,provider_reference=COALESCE(provider_reference,$3),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, status, body.providerReference ?? `fake_${id}`],
          )
        ).rows[0];
        if (status === "SUCCEEDED") await this.applyPayment(c, intent);
        await this.emit(
          c,
          a,
          tenant,
          status === "SUCCEEDED"
            ? "platform.payment_succeeded"
            : status === "UNKNOWN"
              ? "platform.payment_unknown"
              : "platform.payment_failed",
          "platform_payment_intent",
          id,
          requestId,
          intent,
          after,
          undefined,
          key,
        );
        return this.view(after);
      },
    );
  }
  private async applyPayment(c: PoolClient, intent: any) {
    const invoice = await this.one(
      c,
      "SELECT * FROM platform_invoices WHERE id=$1 FOR UPDATE",
      [intent.invoice_id],
      "PLATFORM_INVOICE_NOT_FOUND",
    );
    const paid = BigInt(invoice.paid_minor) + BigInt(intent.amount_minor),
      status = paid >= BigInt(invoice.total_minor) ? "PAID" : "PARTIALLY_PAID";
    await c.query(
      "UPDATE platform_invoices SET paid_minor=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1",
      [invoice.id, paid.toString(), status],
    );
    if (status === "PAID") {
      await c.query(
        "UPDATE tenants SET access_mode='FULL',lifecycle_status='ACTIVE',lifecycle_version=lifecycle_version+1,updated_at=now() WHERE id=$1 AND access_mode IN('GRACE','READ_ONLY','BILLING_ONLY','SUSPENDED')",
        [invoice.tenant_id],
      );
      await c.query(
        "UPDATE platform_subscriptions SET status='ACTIVE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND status IN('PAST_DUE','GRACE','READ_ONLY','SUSPENDED')",
        [invoice.tenant_id],
      );
    }
  }
  async reconcilePayment(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.payment.reconcile",
      body,
      async (c) => {
        const intent = await this.one(
          c,
          "SELECT * FROM platform_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, id],
          "PLATFORM_PAYMENT_NOT_FOUND",
        );
        if (intent.status !== "UNKNOWN")
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_STATUS_INVALID",
            message: "Only UNKNOWN requires reconciliation",
          });
        const observed = this.required(body.observedStatus, "observedStatus");
        if (!["SUCCEEDED", "FAILED", "MANUAL_REVIEW"].includes(observed))
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_STATUS_INVALID",
            message: "Invalid reconciliation outcome",
          });
        await c.query(
          `INSERT INTO platform_payment_reconciliations(tenant_id,payment_intent_id,expected_status,observed_status,provider_evidence_json,outcome,reconciled_by_user_id) VALUES($1,$2,'UNKNOWN',$3,$4,$5,$6)`,
          [
            tenant,
            id,
            observed,
            JSON.stringify(body.providerEvidence ?? {}),
            observed === "MANUAL_REVIEW" ? "MANUAL_REVIEW" : "MATCHED",
            a.userId,
          ],
        );
        const after = (
          await c.query<any>(
            "UPDATE platform_payment_intents SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, observed],
          )
        ).rows[0];
        if (observed === "SUCCEEDED") await this.applyPayment(c, intent);
        await this.emit(
          c,
          a,
          tenant,
          "platform.payment_reconciled",
          "platform_payment_intent",
          id,
          requestId,
          intent,
          after,
          body.reason,
          key,
        );
        return this.view(after);
      },
    );
  }
  async manualPayment(
    a: AccessClaims,
    invoiceId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId"),
      evidence = this.required(body.evidenceReference, "evidenceReference"),
      approver = this.required(body.approvedByUserId, "approvedByUserId");
    if (approver === a.userId)
      throw new ForbiddenException({
        code: "SUPPORT_SELF_APPROVAL_DENIED",
        message: "Manual payment requires independent approver",
      });
    return this.command(
      a,
      tenant,
      key,
      "platform.payment.manual_record",
      body,
      async (c) => {
        const approval = await c.query(
          `SELECT 1 FROM users u
           JOIN tenant_memberships m ON m.user_id=u.id AND m.status='ACTIVE'
           JOIN membership_roles mr ON mr.membership_id=m.id
           JOIN role_permissions rp ON rp.role=mr.role
           WHERE u.id=$1 AND u.status='ACTIVE' AND rp.permission_code='platform.payment.manual_record'
           LIMIT 1`,
          [approver],
        );
        if (!approval.rowCount)
          throw new ForbiddenException({
            code: "PLATFORM_PAYMENT_EVIDENCE_REQUIRED",
            message: "Independent active billing approver is required",
          });
        const invoice = await this.one(
          c,
          "SELECT * FROM platform_invoices WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, invoiceId],
          "PLATFORM_INVOICE_NOT_FOUND",
        );
        const amount = BigInt(this.required(body.amountMinor, "amountMinor"));
        if (body.currency !== invoice.currency)
          throw new ConflictException({
            code: "PLATFORM_CURRENCY_MISMATCH",
            message: "Payment currency mismatch",
          });
        const evidenceHash = fingerprint(evidence),
          id = (await c.query<any>("SELECT gen_random_uuid() id")).rows[0].id;
        if (
          (
            await c.query(
              "SELECT 1 FROM platform_payment_intents WHERE evidence_hash=$1",
              [evidenceHash],
            )
          ).rowCount
        )
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_EVIDENCE_REQUIRED",
            message: "Manual payment evidence was already consumed",
          });
        const row = (
          await c.query<any>(
            `INSERT INTO platform_payment_intents(id,tenant_id,invoice_id,amount_minor,currency,status,provider,provider_key,evidence_hash,provider_reference) VALUES($1,$2,$3,$4,$5,'SUCCEEDED','MANUAL',$6,$7,$8) RETURNING *`,
            [
              id,
              tenant,
              invoiceId,
              amount.toString(),
              invoice.currency,
              stablePlatformPaymentKey(tenant, invoiceId, id),
              evidenceHash,
              evidence,
            ],
          )
        ).rows[0];
        await this.applyPayment(c, row);
        if (amount > BigInt(invoice.total_minor) - BigInt(invoice.paid_minor))
          await c.query(
            `INSERT INTO platform_billing_credit_ledger(tenant_id,billing_account_id,entry_type,amount_minor,currency,source_type,source_id,evidence_json,created_by_user_id) VALUES($1,$2,'OVERPAYMENT',$3,$4,'MANUAL_PAYMENT',$5,$6,$7)`,
            [
              tenant,
              invoice.billing_account_id,
              (
                amount -
                (BigInt(invoice.total_minor) - BigInt(invoice.paid_minor))
              ).toString(),
              invoice.currency,
              row.id,
              JSON.stringify({
                evidenceReference: evidence,
                approvedByUserId: approver,
              }),
              a.userId,
            ],
          );
        await this.emit(
          c,
          a,
          tenant,
          "platform.payment_succeeded",
          "platform_payment_intent",
          id,
          requestId,
          null,
          row,
          body.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async refund(
    a: AccessClaims,
    paymentId: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.payment.refund",
      body,
      async (c) => {
        const payment = await this.one(
          c,
          "SELECT * FROM platform_payment_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, paymentId],
          "PLATFORM_PAYMENT_NOT_FOUND",
        );
        if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status))
          throw new ConflictException({
            code: "PLATFORM_PAYMENT_STATUS_INVALID",
            message: "Payment is not refundable",
          });
        const previous = (
            await c.query<any>(
              "SELECT COALESCE(sum(amount_minor),0) n FROM platform_refunds WHERE payment_intent_id=$1 AND status IN('APPROVED','PROCESSING','SUCCEEDED','UNKNOWN')",
              [paymentId],
            )
          ).rows[0].n,
          available = refundableMinor(
            BigInt(payment.amount_minor),
            BigInt(previous),
          ),
          amount = BigInt(this.required(body.amountMinor, "amountMinor"));
        if (amount <= 0n || amount > available)
          throw new ConflictException({
            code: "PLATFORM_REFUND_EXCEEDS_PAID_AMOUNT",
            message: "Refund exceeds refundable amount",
          });
        if (body.approvedByUserId === a.userId)
          throw new ForbiddenException({
            code: "SUPPORT_SELF_APPROVAL_DENIED",
            message: "Refund requires independent approval",
          });
        const id = (await c.query<any>("SELECT gen_random_uuid() id")).rows[0]
            .id,
          row = (
            await c.query<any>(
              `INSERT INTO platform_refunds(id,tenant_id,payment_intent_id,amount_minor,currency,status,reason,evidence_json,provider_key,requested_by_user_id,approved_by_user_id) VALUES($1,$2,$3,$4,$5,'APPROVED',$6,$7,$8,$9,$10) RETURNING *`,
              [
                id,
                tenant,
                paymentId,
                amount.toString(),
                payment.currency,
                this.required(body.reason, "reason"),
                JSON.stringify(body.evidence ?? {}),
                `platform-refund:${tenant}:${paymentId}:${id}`,
                a.userId,
                this.required(body.approvedByUserId, "approvedByUserId"),
              ],
            )
          ).rows[0];
        await this.emit(
          c,
          a,
          tenant,
          "platform.refund_requested",
          "platform_refund",
          id,
          requestId,
          null,
          row,
          body.reason,
          key,
        );
        return this.view(row);
      },
    );
  }

  async recordUsage(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "platform.usage.record",
      body,
      async (c) => {
        const meter = await this.one(
          c,
          "SELECT * FROM platform_usage_meter_definitions WHERE code=$1 AND active=true",
          [body.meterCode],
          "USAGE_METER_NOT_FOUND",
        );
        const sourceFingerprint = fingerprint({
          sourceType: body.sourceType,
          sourceId: body.sourceId,
          meterCode: body.meterCode,
        });
        const row = (
          await c.query<any>(
            `INSERT INTO platform_usage_events(tenant_id,meter_id,source_type,source_id,source_fingerprint,quantity,occurred_at,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,meter_id,source_fingerprint) DO UPDATE SET source_fingerprint=excluded.source_fingerprint RETURNING *`,
            [
              tenant,
              meter.id,
              this.required(body.sourceType, "sourceType"),
              this.required(body.sourceId, "sourceId"),
              sourceFingerprint,
              this.required(body.quantity, "quantity"),
              body.occurredAt ?? new Date(),
              JSON.stringify(body.metadata ?? {}),
            ],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          tenant,
          "platform.usage_recorded",
          "platform_usage_event",
          row.id,
          requestId,
          null,
          { id: row.id, meterCode: body.meterCode, quantity: row.quantity },
          undefined,
          key,
        );
        return this.view(row);
      },
    );
  }
  async usageAggregates(a: AccessClaims, tenant: string) {
    this.platform(a);
    return (
      await this.db.query<any>(
        `SELECT u.*,m.code meter_code FROM platform_usage_aggregates u JOIN platform_usage_meter_definitions m ON m.id=u.meter_id WHERE u.tenant_id=$1 ORDER BY period_start DESC`,
        [tenant],
      )
    ).rows.map((x) => this.view(x));
  }
  async correctUsage(
    a: AccessClaims,
    tenant: string,
    body: any,
    key: string,
    _requestId: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      tenant,
      key,
      "platform.usage.correct",
      body,
      async (c) => {
        const event = await this.one(
          c,
          "SELECT * FROM platform_usage_events WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenant, body.usageEventId],
          "USAGE_EVENT_NOT_FOUND",
        );
        const row = (
          await c.query<any>(
            `INSERT INTO platform_usage_corrections(tenant_id,usage_event_id,delta_quantity,reason,ticket_reference,approved_by_user_id,apply_mode,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              tenant,
              event.id,
              this.required(body.deltaQuantity, "deltaQuantity"),
              this.required(body.reason, "reason"),
              this.required(body.ticketReference, "ticketReference"),
              this.required(body.approvedByUserId, "approvedByUserId"),
              body.applyMode ?? "NEXT_PERIOD",
              a.userId,
            ],
          )
        ).rows[0];
        await c.query(
          "UPDATE platform_usage_events SET status='CORRECTED' WHERE id=$1 AND status<>'BILLED'",
          [event.id],
        );
        return this.view(row);
      },
    );
  }
  async reserveQuota(
    a: AccessClaims,
    tenant: string,
    code: string,
    resourceType: string,
    resourceId: string | undefined,
    key: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      tenant,
      key,
      "platform.quota.reserve",
      { code, resourceType, resourceId },
      async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `quota:${tenant}:${code}`,
        ]);
        const p = await this.one(
          c,
          "SELECT * FROM platform_entitlement_projections WHERE tenant_id=$1 AND entitlement_code=$2 FOR UPDATE",
          [tenant, code],
          "ENTITLEMENT_DENIED",
        );
        if (!p.unlimited) {
          const used = (
            await c.query<any>(
              "SELECT COALESCE(sum(quantity),0) n FROM platform_quota_reservations WHERE tenant_id=$1 AND entitlement_code=$2 AND status IN('HELD','COMMITTED') AND expires_at>now()",
              [tenant, code],
            )
          ).rows[0].n;
          if (BigInt(used) >= BigInt(p.quota_limit ?? 0))
            throw new ConflictException({
              code: "ENTITLEMENT_QUOTA_EXCEEDED",
              message: "Entitlement quota exceeded",
            });
        }
        const row = (
          await c.query<any>(
            `INSERT INTO platform_quota_reservations(tenant_id,entitlement_code,resource_type,resource_id,idempotency_fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes') RETURNING *`,
            [
              tenant,
              code,
              resourceType,
              resourceId ?? null,
              fingerprint({ tenant, code, resourceType, resourceId, key }),
            ],
          )
        ).rows[0];
        return this.view(row);
      },
    );
  }
  async providerEvent(
    a: AccessClaims,
    body: any,
    signature: string,
    key: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId"),
      secret = process.env.PLATFORM_BILLING_WEBHOOK_SECRET;
    if (process.env.NODE_ENV === "production" && !secret)
      throw new ConflictException({
        code: "PLATFORM_BILLING_PROVIDER_NOT_CONFIGURED",
        message: "Webhook verification is not configured",
      });
    if (
      secret &&
      signature !== fingerprint({ secret, eventId: body.providerEventId })
    )
      throw new ForbiddenException({
        code: "PLATFORM_PROVIDER_SIGNATURE_INVALID",
        message: "Provider signature invalid",
      });
    return this.command(
      a,
      tenant,
      key,
      "platform.provider_event.record",
      body,
      async (c) => {
        const row = (
          await c.query<any>(
            `INSERT INTO platform_payment_provider_events(provider,provider_event_id,signature_fingerprint,payload_redacted_json) VALUES($1,$2,$3,$4) ON CONFLICT(provider,provider_event_id) DO UPDATE SET provider_event_id=excluded.provider_event_id RETURNING *`,
            [
              this.required(body.provider, "provider"),
              this.required(body.providerEventId, "providerEventId"),
              fingerprint(signature),
              JSON.stringify({
                paymentIntentId: body.paymentIntentId,
                status: body.status,
              }),
            ],
          )
        ).rows[0];
        return this.view(row);
      },
    );
  }
  async overrideEntitlement(
    a: AccessClaims,
    tenant: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      tenant,
      key,
      "platform.entitlement.override",
      body,
      async (c) => {
        const expires = new Date(body.expiresAt);
        if (!(expires > new Date()))
          throw new ConflictException({
            code: "VALIDATION_FAILED",
            message: "Override expiry must be in the future",
          });
        const row = (
          await c.query<any>(
            `INSERT INTO platform_entitlement_overrides(tenant_id,entitlement_code,enabled,quota_limit,unlimited,reason,ticket_reference,starts_at,expires_at,approved_by_user_id,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),$9,$10,$11) RETURNING *`,
            [
              tenant,
              this.required(body.entitlementCode, "entitlementCode"),
              body.enabled ?? null,
              body.quotaLimit ?? null,
              body.unlimited ?? false,
              this.required(body.reason, "reason"),
              this.required(body.ticketReference, "ticketReference"),
              body.startsAt ?? null,
              expires,
              this.required(body.approvedByUserId, "approvedByUserId"),
              a.userId,
            ],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO platform_entitlement_projections(tenant_id,entitlement_code,enabled,quota_limit,unlimited,source_type,source_id,fingerprint) VALUES($1,$2,$3,$4,$5,'EMERGENCY_OVERRIDE',$6,$7) ON CONFLICT(tenant_id,entitlement_code) DO UPDATE SET enabled=excluded.enabled,quota_limit=excluded.quota_limit,unlimited=excluded.unlimited,source_type=excluded.source_type,source_id=excluded.source_id,version=platform_entitlement_projections.version+1,fingerprint=excluded.fingerprint,rebuilt_at=now()`,
          [
            tenant,
            row.entitlement_code,
            row.enabled,
            row.quota_limit,
            row.unlimited,
            row.id,
            fingerprint(row),
          ],
        );
        await this.emit(
          c,
          a,
          tenant,
          "platform.entitlement_override_created",
          "platform_entitlement_override",
          row.id,
          requestId,
          null,
          row,
          row.reason,
          key,
        );
        return this.view(row);
      },
    );
  }
  async revokeOverride(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    _requestId: string,
  ) {
    this.platform(a);
    const found = (
      await this.db.query<any>(
        "SELECT tenant_id FROM platform_entitlement_overrides WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!found)
      throw new NotFoundException({
        code: "ENTITLEMENT_DENIED",
        message: "Override not found",
      });
    return this.command(
      a,
      found.tenant_id,
      key,
      "platform.entitlement.override.revoke",
      body,
      async (c) => {
        const row = await this.one(
          c,
          "SELECT * FROM platform_entitlement_overrides WHERE id=$1 FOR UPDATE",
          [id],
          "ENTITLEMENT_DENIED",
        );
        if (row.revoked_at) return this.view(row);
        const after = (
          await c.query<any>(
            "UPDATE platform_entitlement_overrides SET revoked_at=now(),revoked_by_user_id=$2 WHERE id=$1 RETURNING *",
            [id, a.userId],
          )
        ).rows[0];
        const s = (
          await c.query<any>(
            "SELECT id,plan_version_id FROM platform_subscriptions WHERE tenant_id=$1 AND status NOT IN('CANCELLED','TERMINATED') ORDER BY created_at DESC LIMIT 1",
            [row.tenant_id],
          )
        ).rows[0];
        if (s)
          await this.rebuildEntitlements(
            c,
            row.tenant_id,
            s.id,
            s.plan_version_id,
          );
        return this.view(after);
      },
    );
  }

  async setAccessMode(
    a: AccessClaims,
    tenant: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    return this.command(
      a,
      tenant,
      key,
      "tenant.access_mode.change",
      body,
      async (c) => {
        const row = await this.one(
          c,
          "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
          [tenant],
          "TENANT_NOT_FOUND",
        );
        const mode = this.required(body.accessMode, "accessMode");
        if (
          ![
            "FULL",
            "GRACE",
            "READ_ONLY",
            "BILLING_ONLY",
            "SUSPENDED",
            "TERMINATED",
          ].includes(mode)
        )
          throw new ConflictException({
            code: "VALIDATION_FAILED",
            message: "Invalid access mode",
          });
        const after = (
          await c.query<any>(
            "UPDATE tenants SET access_mode=$2,lifecycle_status=CASE $2 WHEN 'FULL' THEN 'ACTIVE' WHEN 'BILLING_ONLY' THEN 'SUSPENDED' ELSE $2 END,lifecycle_version=lifecycle_version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [tenant, mode],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO tenant_access_mode_history(tenant_id,from_mode,to_mode,reason,source_type,source_id,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            tenant,
            row.access_mode,
            mode,
            this.required(body.reason, "reason"),
            body.sourceType ?? "PLATFORM_OPERATION",
            body.sourceId ?? null,
            a.userId,
            requestId,
          ],
        );
        await this.emit(
          c,
          a,
          tenant,
          "tenant.access_mode_changed",
          "tenant",
          tenant,
          requestId,
          row,
          after,
          body.reason,
          key,
        );
        return this.view(after);
      },
    );
  }
  async assertTenantWrite(tenantId: string, capability: string) {
    const row = (
      await this.db.query<any>("SELECT access_mode FROM tenants WHERE id=$1", [
        tenantId,
      ])
    ).rows[0];
    if (!row)
      throw new NotFoundException({
        code: "TENANT_NOT_FOUND",
        message: "Tenant not found",
      });
    if (!accessModeAllowsWrite(row.access_mode, capability as any))
      throw new ForbiddenException({
        code:
          row.access_mode === "TERMINATED"
            ? "TENANT_TERMINATED"
            : row.access_mode === "SUSPENDED"
              ? "TENANT_SUSPENDED"
              : "TENANT_READ_ONLY",
        message: "Tenant access mode blocks this write",
      });
  }
  async assertEntitlement(tenantId: string, code: string) {
    const row = (
      await this.db.query<any>(
        "SELECT * FROM platform_entitlement_projections WHERE tenant_id=$1 AND entitlement_code=$2",
        [tenantId, code],
      )
    ).rows[0];
    if (!row || row.enabled === false)
      throw new ForbiddenException({
        code: "ENTITLEMENT_DENIED",
        message: `Entitlement ${code} is disabled`,
      });
    return this.view(row);
  }

  async tenantSupportGrants(a: AccessClaims) {
    this.tenantOwner(a);
    return (
      await this.db.query<any>(
        "SELECT * FROM platform_support_access_grants WHERE tenant_id=$1 ORDER BY created_at DESC",
        [a.tenantId],
      )
    ).rows.map((x) => this.view(x));
  }
  async platformSupportGrants(a: AccessClaims) {
    this.platform(a);
    return (
      await this.db.query<any>(
        "SELECT * FROM platform_support_access_grants ORDER BY created_at DESC",
      )
    ).rows.map((x) => this.view(x));
  }
  async requestSupportGrant(
    a: AccessClaims,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const tenant = this.required(body.tenantId, "tenantId");
    return this.command(
      a,
      tenant,
      key,
      "support.grant.request",
      body,
      async (c) => {
        const row = (
          await c.query<any>(
            `INSERT INTO platform_support_access_grants(tenant_id,support_user_id,ticket_reference,reason,permission_scope_json,branch_scope_json,data_classification_scope_json,expires_at,session_ttl_seconds,requested_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [
              tenant,
              body.supportUserId ?? a.userId,
              this.required(body.ticketReference, "ticketReference"),
              this.required(body.reason, "reason"),
              JSON.stringify(body.permissionScope ?? []),
              JSON.stringify(body.branchScope ?? []),
              JSON.stringify(body.dataClassificationScope ?? []),
              this.required(body.expiresAt, "expiresAt"),
              body.sessionTtlSeconds ?? 1800,
              a.userId,
            ],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO platform_support_access_history(tenant_id,grant_id,to_state,actor_user_id,reason,request_id,snapshot_json) VALUES($1,$2,'REQUESTED',$3,$4,$5,$6)`,
          [
            tenant,
            row.id,
            a.userId,
            row.reason,
            requestId,
            JSON.stringify(row),
          ],
        );
        return this.view(row);
      },
    );
  }
  async decideSupportGrant(
    a: AccessClaims,
    id: string,
    action: "approve" | "deny" | "revoke",
    body: any,
    key: string,
    requestId: string,
    tenantActor = true,
  ) {
    this.actor(a, !tenantActor);
    const found = (
      await this.db.query<any>(
        "SELECT tenant_id FROM platform_support_access_grants WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!found || (tenantActor && found.tenant_id !== a.tenantId))
      throw new NotFoundException({
        code: "SUPPORT_GRANT_NOT_FOUND",
        message: "Support grant not found",
      });
    return this.command(
      a,
      found.tenant_id,
      key,
      `support.grant.${action}`,
      body,
      async (c) => {
        const row = await this.one(
          c,
          "SELECT * FROM platform_support_access_grants WHERE id=$1 FOR UPDATE",
          [id],
          "SUPPORT_GRANT_NOT_FOUND",
        );
        if (action === "approve" && row.support_user_id === a.userId)
          throw new ForbiddenException({
            code: "SUPPORT_SELF_APPROVAL_DENIED",
            message: "Support user cannot self approve",
          });
        const state =
            action === "approve"
              ? "APPROVED"
              : action === "deny"
                ? "DENIED"
                : "REVOKED",
          after = (
            await c.query<any>(
              `UPDATE platform_support_access_grants SET state=$2,tenant_approver_user_id=CASE WHEN $2='APPROVED' THEN $3 ELSE tenant_approver_user_id END,approved_at=CASE WHEN $2='APPROVED' THEN now() ELSE approved_at END,revoked_at=CASE WHEN $2='REVOKED' THEN now() ELSE revoked_at END,version=version+1 WHERE id=$1 RETURNING *`,
              [id, state, a.userId],
            )
          ).rows[0];
        if (state === "REVOKED")
          await c.query(
            "UPDATE platform_support_sessions SET state='REVOKED',ended_at=now() WHERE grant_id=$1 AND state='ACTIVE'",
            [id],
          );
        await c.query(
          `INSERT INTO platform_support_access_history(tenant_id,grant_id,from_state,to_state,actor_user_id,reason,request_id,snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            row.tenant_id,
            id,
            row.state,
            state,
            a.userId,
            body.reason ?? action,
            requestId,
            JSON.stringify(after),
          ],
        );
        await this.emit(
          c,
          a,
          row.tenant_id,
          `support.grant_${action}d`,
          "platform_support_access_grant",
          id,
          requestId,
          row,
          after,
          body.reason,
          key,
        );
        return this.view(after);
      },
    );
  }
  async startSupportSession(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const found = (
      await this.db.query<any>(
        "SELECT tenant_id FROM platform_support_access_grants WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!found)
      throw new NotFoundException({
        code: "SUPPORT_GRANT_NOT_FOUND",
        message: "Support grant not found",
      });
    return this.command(
      a,
      found.tenant_id,
      key,
      "support.session.start",
      body,
      async (c) => {
        const grant = await this.one(
          c,
          "SELECT * FROM platform_support_access_grants WHERE id=$1 FOR UPDATE",
          [id],
          "SUPPORT_GRANT_NOT_FOUND",
        );
        if (
          !["APPROVED", "ACTIVE"].includes(grant.state) ||
          new Date(grant.expires_at) <= new Date()
        )
          throw new ForbiddenException({
            code: "SUPPORT_GRANT_EXPIRED",
            message: "Grant is not active",
          });
        if (grant.support_user_id !== a.userId)
          throw new ForbiddenException({
            code: "SUPPORT_SCOPE_DENIED",
            message: "Grant belongs to another support user",
          });
        const token = crypto.randomUUID() + crypto.randomUUID(),
          hash = this.idem.subject(token),
          expires = new Date(
            Math.min(
              new Date(grant.expires_at).getTime(),
              Date.now() + grant.session_ttl_seconds * 1000,
            ),
          );
        const row = (
          await c.query<any>(
            `INSERT INTO platform_support_sessions(tenant_id,grant_id,support_user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(grant_id,support_user_id) WHERE state='ACTIVE' DO UPDATE SET expires_at=excluded.expires_at,last_seen_at=now() RETURNING *`,
            [grant.tenant_id, id, a.userId, hash, expires],
          )
        ).rows[0];
        await c.query(
          "UPDATE platform_support_access_grants SET state='ACTIVE',version=version+1 WHERE id=$1",
          [id],
        );
        await this.emit(
          c,
          a,
          grant.tenant_id,
          "support.session_started",
          "platform_support_session",
          row.id,
          requestId,
          null,
          { id: row.id, grantId: id, expiresAt: expires },
          undefined,
          key,
        );
        return { ...this.view(row), sessionToken: token };
      },
    );
  }
  async endSupportSession(
    a: AccessClaims,
    id: string,
    body: any,
    key: string,
    requestId: string,
  ) {
    this.platform(a);
    const found = (
      await this.db.query<any>(
        "SELECT tenant_id FROM platform_support_sessions WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!found)
      throw new NotFoundException({
        code: "SUPPORT_GRANT_NOT_FOUND",
        message: "Support session not found",
      });
    return this.command(
      a,
      found.tenant_id,
      key,
      "support.session.end",
      body,
      async (c) => {
        const row = await this.one(
          c,
          "SELECT * FROM platform_support_sessions WHERE id=$1 AND support_user_id=$2 FOR UPDATE",
          [id, a.userId],
          "SUPPORT_GRANT_NOT_FOUND",
        );
        const after = (
          await c.query<any>(
            "UPDATE platform_support_sessions SET state='ENDED',ended_at=now() WHERE id=$1 RETURNING *",
            [id],
          )
        ).rows[0];
        await this.emit(
          c,
          a,
          row.tenant_id,
          "support.session_ended",
          "platform_support_session",
          id,
          requestId,
          row,
          after,
          body.reason,
          key,
        );
        return this.view(after);
      },
    );
  }
  async authorizeSupportSession(
    a: AccessClaims,
    token: string,
    tenantId: string,
    permission: string,
    branchId?: string,
  ) {
    this.platform(a);
    const hash = this.idem.subject(token);
    const row = (
      await this.db.query<any>(
        `SELECT s.*,g.permission_scope_json,g.branch_scope_json,g.data_classification_scope_json FROM platform_support_sessions s JOIN platform_support_access_grants g ON g.id=s.grant_id WHERE s.tenant_id=$1 AND s.support_user_id=$2 AND s.token_hash=$3 AND s.state='ACTIVE' AND s.expires_at>now() AND g.state='ACTIVE' AND g.expires_at>now()`,
        [tenantId, a.userId, hash],
      )
    ).rows[0];
    if (!row)
      throw new ForbiddenException({
        code: "SUPPORT_SCOPE_DENIED",
        message: "Support access unavailable",
      });
    if (!row.permission_scope_json.includes(permission))
      throw new ForbiddenException({
        code: "SUPPORT_SCOPE_DENIED",
        message: "Support permission is outside grant scope",
      });
    if (
      branchId &&
      row.branch_scope_json.length &&
      !row.branch_scope_json.includes(branchId)
    )
      throw new ForbiddenException({
        code: "SUPPORT_SCOPE_DENIED",
        message: "Branch is outside grant scope",
      });
    return {
      grantId: row.grant_id,
      sessionId: row.id,
      expiresAt: row.expires_at,
    };
  }
}
