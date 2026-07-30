/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";

@Injectable()
export class PlatformBillingProcessor implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
    max: 2,
  });
  async run() {
    const values = await Promise.all([
      this.aggregateUsage(),
      this.expireTrials(),
      this.renewSubscriptions(),
      this.materializeDunning(),
      this.advanceDunning(),
      this.expireSupport(),
      this.recoverQuotaReservations(),
      this.processRefunds(),
    ]);
    return values.reduce((sum, value) => sum + value, 0);
  }
  async renewSubscriptions() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const rows = (
        await c.query<any>(
          `SELECT s.*,a.timezone,a.invoice_prefix,a.collection_mode account_collection_mode
           FROM platform_subscriptions s
           JOIN platform_billing_accounts a ON a.id=s.billing_account_id
           WHERE s.status IN('ACTIVE','CANCEL_AT_PERIOD_END')
             AND s.current_period_end<=now()
             AND s.collection_mode<>'DISABLED'
           ORDER BY s.current_period_end,s.id
           FOR UPDATE OF s SKIP LOCKED LIMIT 25`,
        )
      ).rows;
      for (const subscription of rows) {
        if (subscription.status === "CANCEL_AT_PERIOD_END") {
          await c.query(
            `UPDATE platform_subscriptions
             SET status='CANCELLED',cancelled_at=now(),version=version+1,updated_at=now()
             WHERE id=$1`,
            [subscription.id],
          );
          await c.query(
            `INSERT INTO platform_subscription_history(tenant_id,subscription_id,from_status,to_status,reason,request_id,snapshot_json)
             VALUES($1::uuid,$2::uuid,'CANCEL_AT_PERIOD_END','CANCELLED','Period-end cancellation','worker:renewal:'||$2::uuid::text,$3)`,
            [
              subscription.tenant_id,
              subscription.id,
              JSON.stringify({ periodEnd: subscription.current_period_end }),
            ],
          );
          await this.event(
            c,
            subscription.tenant_id,
            "platform.subscription_cancelled",
            "platform_subscription",
            subscription.id,
          );
          continue;
        }

        const scheduled = (
          await c.query<any>(
            `SELECT ch.*,v.plan_id,p.id price_id,p.unit_amount_minor,p.currency,p.billing_interval,p.interval_count
             FROM platform_subscription_changes ch
             JOIN platform_plan_versions v ON v.id=ch.to_plan_version_id
             JOIN platform_prices p ON p.plan_version_id=v.id AND p.status='ACTIVE'
             WHERE ch.subscription_id=$1 AND ch.status='PENDING' AND ch.effective_mode='NEXT_PERIOD'
               AND ch.effective_at<=$2
             ORDER BY ch.created_at,ch.id FOR UPDATE OF ch LIMIT 1`,
            [subscription.id, subscription.current_period_end],
          )
        ).rows[0];
        const activePrice =
          scheduled ??
          (
            await c.query<any>(
              `SELECT p.id price_id,p.unit_amount_minor,p.currency,p.billing_interval,p.interval_count,
                      s.plan_id,s.plan_version_id
               FROM platform_subscription_items i
               JOIN platform_prices p ON p.id=i.price_id
               JOIN platform_subscriptions s ON s.id=i.subscription_id
               WHERE i.subscription_id=$1 AND i.status='ACTIVE'
               ORDER BY i.created_at DESC LIMIT 1`,
              [subscription.id],
            )
          ).rows[0];
        if (!activePrice) continue;

        const periodStart = subscription.current_period_end;
        const periodEnd = (
          await c.query<{ period_end: Date }>(
            `SELECT CASE $2
               WHEN 'MONTHLY' THEN $1::timestamptz + make_interval(months => $3::int)
               WHEN 'YEARLY' THEN $1::timestamptz + make_interval(years => $3::int)
               ELSE $1::timestamptz + make_interval(days => $3::int)
             END period_end`,
            [
              periodStart,
              activePrice.billing_interval,
              activePrice.interval_count,
            ],
          )
        ).rows[0]!.period_end;
        const planVersionId =
          scheduled?.to_plan_version_id ?? subscription.plan_version_id;

        if (scheduled) {
          await c.query(
            "UPDATE platform_subscription_items SET status='CANCELLED',ends_at=$2 WHERE subscription_id=$1 AND status='ACTIVE'",
            [subscription.id, periodStart],
          );
          await c.query(
            `INSERT INTO platform_subscription_items(tenant_id,subscription_id,price_id,quantity,starts_at)
             VALUES($1,$2,$3,1,$4)`,
            [
              subscription.tenant_id,
              subscription.id,
              scheduled.price_id,
              periodStart,
            ],
          );
          await c.query(
            "UPDATE platform_subscription_changes SET status='APPLIED',applied_at=now() WHERE id=$1",
            [scheduled.id],
          );
          await c.query(
            `INSERT INTO platform_entitlement_projections(tenant_id,entitlement_code,enabled,quota_limit,unlimited,source_type,source_id,fingerprint)
             SELECT $1::uuid,e.entitlement_code,e.enabled,e.quota_limit,e.unlimited,'PLAN_VERSION',$2::uuid,
                    encode(digest($1::uuid::text||':'||e.entitlement_code||':'||$3::uuid::text,'sha256'),'hex')
             FROM platform_plan_entitlements e WHERE e.plan_version_id=$3::uuid
             ON CONFLICT(tenant_id,entitlement_code) DO UPDATE
             SET enabled=excluded.enabled,quota_limit=excluded.quota_limit,unlimited=excluded.unlimited,
                 source_type=excluded.source_type,source_id=excluded.source_id,
                 version=platform_entitlement_projections.version+1,fingerprint=excluded.fingerprint,rebuilt_at=now()`,
            [subscription.tenant_id, subscription.id, planVersionId],
          );
        }

        const period = (
          await c.query<any>(
            `INSERT INTO platform_subscription_periods(
               tenant_id,subscription_id,period_start,period_end,billing_timezone,plan_version_id,
               price_snapshot_json,entitlement_snapshot_json,quota_snapshot_json,fingerprint)
             SELECT $1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,$5,$6::uuid,
                    jsonb_build_object('priceId',$7::uuid::text,'unitAmountMinor',$8::text,'currency',$9::text),
                    v.entitlement_snapshot_json,v.quota_snapshot_json,
                    encode(digest($2::uuid::text||':'||$3::timestamptz::text||':'||$6::uuid::text,'sha256'),'hex')
             FROM platform_plan_versions v WHERE v.id=$6::uuid
             ON CONFLICT(subscription_id,period_start) DO NOTHING RETURNING *`,
            [
              subscription.tenant_id,
              subscription.id,
              periodStart,
              periodEnd,
              subscription.timezone,
              planVersionId,
              activePrice.price_id,
              activePrice.unit_amount_minor,
              activePrice.currency,
            ],
          )
        ).rows[0];
        if (!period) continue;

        await c.query(
          `UPDATE platform_subscriptions
           SET plan_id=$2,plan_version_id=$3,current_period_start=$4,current_period_end=$5,
               version=version+1,updated_at=now()
           WHERE id=$1`,
          [
            subscription.id,
            scheduled?.plan_id ?? subscription.plan_id,
            planVersionId,
            periodStart,
            periodEnd,
          ],
        );

        if (
          subscription.account_collection_mode !== "DISABLED" &&
          BigInt(activePrice.unit_amount_minor) > 0n
        ) {
          const invoice = (
            await c.query<any>(
              `INSERT INTO platform_invoices(
                 tenant_id,billing_account_id,subscription_id,subscription_period_id,currency,status,
                 subtotal_minor,total_minor,due_at)
               VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$6,now()+interval '14 days') RETURNING *`,
              [
                subscription.tenant_id,
                subscription.billing_account_id,
                subscription.id,
                period.id,
                activePrice.currency,
                activePrice.unit_amount_minor,
              ],
            )
          ).rows[0];
          await c.query(
            `INSERT INTO platform_invoice_lines(
               tenant_id,invoice_id,line_type,description,quantity,unit_amount_minor,total_minor,
               source_type,source_id,snapshot_json)
             VALUES($1,$2,'BASE_PLAN','Subscription renewal',1,$3,$3,'SUBSCRIPTION_PERIOD',$4,$5)`,
            [
              subscription.tenant_id,
              invoice.id,
              activePrice.unit_amount_minor,
              period.id,
              JSON.stringify({ priceId: activePrice.price_id, planVersionId }),
            ],
          );
          const sequence = (
            await c.query<{ value: string }>(
              `UPDATE platform_invoice_number_sequences
               SET next_value=next_value+1,version=version+1
               WHERE billing_account_id=$1 RETURNING (next_value-1)::text value`,
              [subscription.billing_account_id],
            )
          ).rows[0]!.value;
          const invoiceNumber = `${subscription.invoice_prefix}-${sequence.padStart(8, "0")}`;
          await c.query(
            `UPDATE platform_invoices
             SET invoice_number=$2,status='OPEN',finalized_at=now(),
                 fingerprint=encode(digest(id::text||':'||$2||':'||total_minor::text,'sha256'),'hex'),
                 version=version+1,updated_at=now() WHERE id=$1`,
            [invoice.id, invoiceNumber],
          );
          await c.query(
            "UPDATE platform_subscription_periods SET invoice_id=$2,locked_at=now() WHERE id=$1",
            [period.id, invoice.id],
          );
          await this.event(
            c,
            subscription.tenant_id,
            "platform.invoice_finalized",
            "platform_invoice",
            invoice.id,
          );
        }
        await this.event(
          c,
          subscription.tenant_id,
          "platform.subscription_renewed",
          "platform_subscription",
          subscription.id,
        );
      }
      await c.query("COMMIT");
      return rows.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async aggregateUsage() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const events = (
        await c.query<any>(
          `SELECT e.*,m.code FROM platform_usage_events e JOIN platform_usage_meter_definitions m ON m.id=e.meter_id WHERE e.status='RECORDED' ORDER BY e.recorded_at FOR UPDATE OF e SKIP LOCKED LIMIT 100`,
        )
      ).rows;
      for (const e of events) {
        const start = new Date(
            Date.UTC(
              new Date(e.occurred_at).getUTCFullYear(),
              new Date(e.occurred_at).getUTCMonth(),
              1,
            ),
          ),
          end = new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
          );
        await c.query(
          `INSERT INTO platform_usage_aggregates(tenant_id,meter_id,period_start,period_end,quantity,fingerprint) VALUES($1,$2,$3,$4,$5,encode(digest($1::text||':'||$2::text||':'||$3::text,'sha256'),'hex')) ON CONFLICT(tenant_id,meter_id,period_start) DO UPDATE SET quantity=platform_usage_aggregates.quantity+excluded.quantity,version=platform_usage_aggregates.version+1,fingerprint=encode(digest(platform_usage_aggregates.id::text||':'||(platform_usage_aggregates.quantity+excluded.quantity)::text,'sha256'),'hex') WHERE platform_usage_aggregates.finalized_at IS NULL`,
          [e.tenant_id, e.meter_id, start, end, e.quantity],
        );
        await c.query(
          "UPDATE platform_usage_events SET status='AGGREGATED' WHERE id=$1 AND status='RECORDED'",
          [e.id],
        );
      }
      await c.query("COMMIT");
      return events.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async expireTrials() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const rows = (
        await c.query<any>(
          `SELECT * FROM platform_subscriptions WHERE status='TRIALING' AND trial_ends_at<=now() ORDER BY trial_ends_at FOR UPDATE SKIP LOCKED LIMIT 50`,
        )
      ).rows;
      for (const row of rows) {
        await c.query(
          "UPDATE platform_subscriptions SET status='GRACE',version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await c.query(
          "UPDATE tenants SET access_mode='GRACE',lifecycle_status='GRACE',lifecycle_version=lifecycle_version+1,updated_at=now() WHERE id=$1",
          [row.tenant_id],
        );
        await this.event(
          c,
          row.tenant_id,
          "platform.trial_expired",
          "platform_subscription",
          row.id,
        );
      }
      await c.query("COMMIT");
      return rows.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async materializeDunning() {
    const result = await this.pool
      .query(`INSERT INTO platform_dunning_cases(tenant_id,invoice_id,policy_id,status,current_stage,next_action_at,generation_key)
    SELECT DISTINCT i.tenant_id,i.id,p.id,'OPEN','PAYMENT_FAILED',now()+interval '3 days','invoice:'||i.id::text||':dunning'
    FROM platform_invoices i JOIN platform_payment_intents x ON x.invoice_id=i.id CROSS JOIN platform_dunning_policies p
    WHERE x.status='FAILED' AND i.status IN('OPEN','PARTIALLY_PAID','PAST_DUE') AND p.active
    ON CONFLICT(generation_key) DO NOTHING`);
    return result.rowCount ?? 0;
  }
  async advanceDunning() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const rows = (
        await c.query<any>(
          `SELECT d.*,i.status invoice_status FROM platform_dunning_cases d JOIN platform_invoices i ON i.id=d.invoice_id WHERE d.status='OPEN' AND d.next_action_at<=now() ORDER BY d.next_action_at FOR UPDATE OF d SKIP LOCKED LIMIT 50`,
        )
      ).rows;
      for (const row of rows) {
        const next =
            row.current_stage === "GRACE_STARTED"
              ? "READ_ONLY_STARTED"
              : "GRACE_STARTED",
          mode = next === "READ_ONLY_STARTED" ? "READ_ONLY" : "GRACE",
          key = `${row.id}:${next}`;
        await c.query(
          `INSERT INTO platform_dunning_history(tenant_id,dunning_case_id,from_stage,to_stage,generation_key,evidence_json) VALUES($1,$2,$3,$4,$5,'{"channel":"EMAIL","transactional":true}') ON CONFLICT(generation_key) DO NOTHING`,
          [row.tenant_id, row.id, row.current_stage, next, key],
        );
        await c.query(
          "UPDATE platform_dunning_cases SET current_stage=$2,next_action_at=now()+interval '7 days',updated_at=now() WHERE id=$1",
          [row.id, next],
        );
        await c.query(
          "UPDATE tenants SET access_mode=$2,lifecycle_status=$2,lifecycle_version=lifecycle_version+1,updated_at=now() WHERE id=$1",
          [row.tenant_id, mode],
        );
        await this.event(
          c,
          row.tenant_id,
          "platform.dunning_stage_changed",
          "platform_dunning_case",
          row.id,
        );
      }
      await c.query("COMMIT");
      return rows.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async expireSupport() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const sessions = (
        await c.query<any>(
          `UPDATE platform_support_sessions SET state='EXPIRED',ended_at=now() WHERE state='ACTIVE' AND expires_at<=now() RETURNING *`,
        )
      ).rows;
      const grants = (
        await c.query<any>(
          `UPDATE platform_support_access_grants SET state='EXPIRED',version=version+1 WHERE state IN('APPROVED','ACTIVE') AND expires_at<=now() RETURNING *`,
        )
      ).rows;
      for (const row of grants)
        await this.event(
          c,
          row.tenant_id,
          "support.grant_expired",
          "platform_support_access_grant",
          row.id,
        );
      await c.query("COMMIT");
      return sessions.length + grants.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async recoverQuotaReservations() {
    const result = await this.pool.query(
      `UPDATE platform_quota_reservations SET status='EXPIRED' WHERE status='HELD' AND expires_at<=now()`,
    );
    return result.rowCount ?? 0;
  }
  async processRefunds() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const rows = (
        await c.query<any>(
          `SELECT * FROM platform_refunds WHERE status='APPROVED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20`,
        )
      ).rows;
      for (const row of rows) {
        if (
          process.env.NODE_ENV === "production" &&
          !process.env.PLATFORM_BILLING_PROVIDER
        ) {
          await c.query(
            "UPDATE platform_refunds SET status='FAILED',updated_at=now() WHERE id=$1",
            [row.id],
          );
          continue;
        }
        await c.query(
          "UPDATE platform_refunds SET status='SUCCEEDED',provider_reference=COALESCE(provider_reference,'fake-refund-'||id::text),updated_at=now() WHERE id=$1",
          [row.id],
        );
        const refunded =
          (
            await c.query<{ refunded_minor: string }>(
              `SELECT COALESCE(sum(amount_minor),0)::text refunded_minor
             FROM platform_refunds
             WHERE payment_intent_id=$1 AND status='SUCCEEDED'`,
              [row.payment_intent_id],
            )
          ).rows[0]?.refunded_minor ?? "0";
        await c.query(
          "UPDATE platform_payment_intents SET status=CASE WHEN amount_minor=$2 THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END,version=version+1,updated_at=now() WHERE id=$1",
          [row.payment_intent_id, refunded],
        );
        await c.query(
          `UPDATE platform_invoices i SET refunded_minor=refunded_minor+$2,version=version+1,updated_at=now() FROM platform_payment_intents p WHERE p.id=$1 AND i.id=p.invoice_id`,
          [row.payment_intent_id, row.amount_minor],
        );
        await this.event(
          c,
          row.tenant_id,
          "platform.refund_completed",
          "platform_refund",
          row.id,
        );
      }
      await c.query("COMMIT");
      return rows.length;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private event(
    c: pg.PoolClient,
    tenant: string,
    event: string,
    type: string,
    id: string,
  ) {
    return c.query(
      `INSERT INTO outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_json,actor_json,source,metadata_json) VALUES($1,$2,$3,$4,$5,'{"type":"SYSTEM","id":null}','worker','{"schemaVersion":1}')`,
      [tenant, event, type, id, JSON.stringify({ id, refetch: true })],
    );
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
