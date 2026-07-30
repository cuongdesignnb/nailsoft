import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformBillingProcessor } from "../../apps/worker/src/platform-billing.processor";

const db = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const processor = new PlatformBillingProcessor();
let subscriptionId: string;
let tenantId: string;
let expiredPeriodEnd: Date;

describe("Sprint 13 subscription renewal worker", () => {
  beforeAll(async () => {
    const legacy = (
      await db.query<{
        id: string;
        tenant_id: string;
        billing_account_id: string;
      }>(
        `SELECT s.id,s.tenant_id,s.billing_account_id
         FROM platform_subscriptions s JOIN tenants t ON t.id=s.tenant_id
         WHERE t.slug='nailsoft-demo'`,
      )
    ).rows[0];
    subscriptionId = legacy.id;
    tenantId = legacy.tenant_id;
    expiredPeriodEnd = new Date(Date.now() - 60_000);
    const expiredPeriodStart = new Date(
      expiredPeriodEnd.getTime() - 31 * 86_400_000,
    );
    await db.query(
      `UPDATE platform_billing_accounts
       SET collection_mode='MANUAL_INVOICE',currency='USD',invoice_prefix='QA13'
       WHERE id=$1`,
      [legacy.billing_account_id],
    );
    await db.query(
      `UPDATE platform_subscriptions
       SET plan_id='13000000-0000-4000-8000-000000000012',
           plan_version_id='13000000-0000-4000-8000-000000000102',status='ACTIVE',
           collection_mode='MANUAL_INVOICE',current_period_start=$2,current_period_end=$3,
           cancel_at_period_end=false,cancelled_at=NULL
       WHERE id=$1`,
      [subscriptionId, expiredPeriodStart, expiredPeriodEnd],
    );
    await db.query(
      "DELETE FROM platform_subscription_items WHERE subscription_id=$1",
      [subscriptionId],
    );
    await db.query(
      "DELETE FROM platform_subscription_changes WHERE subscription_id=$1",
      [subscriptionId],
    );
    await db.query(
      `INSERT INTO platform_subscription_items(tenant_id,subscription_id,price_id,quantity,starts_at)
       SELECT $1,$2,id,1,$3 FROM platform_prices WHERE code='GROWTH_MONTHLY_USD'`,
      [tenantId, subscriptionId, expiredPeriodStart],
    );
    await db.query(
      `INSERT INTO platform_subscription_changes(
         tenant_id,subscription_id,change_type,effective_mode,from_plan_version_id,
         to_plan_version_id,proration_minor,currency,status,effective_at,evidence_json)
       VALUES($1,$2,'DOWNGRADE','NEXT_PERIOD',
         '13000000-0000-4000-8000-000000000102',
         '13000000-0000-4000-8000-000000000101',0,'USD','PENDING',$3,'{}')`,
      [tenantId, subscriptionId, expiredPeriodEnd],
    );
  });

  afterAll(async () => {
    await processor.onModuleDestroy();
    await db.end();
  });

  it("applies a scheduled downgrade and creates one immutable period/invoice under contention", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => processor.renewSubscriptions()),
    );
    const subscription = (
      await db.query<{
        status: string;
        plan_id: string;
        current_period_start: Date;
        current_period_end: Date;
      }>("SELECT * FROM platform_subscriptions WHERE id=$1", [subscriptionId])
    ).rows[0];
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.plan_id).toBe("13000000-0000-4000-8000-000000000011");
    expect(new Date(subscription.current_period_start).toISOString()).toBe(
      expiredPeriodEnd.toISOString(),
    );
    expect(subscription.current_period_end.getTime()).toBeGreaterThan(
      subscription.current_period_start.getTime(),
    );

    const result = (
      await db.query<{
        periods: number;
        invoices: number;
        lines: number;
        total_minor: string;
        line_total: string;
        change_status: string;
      }>(
        `SELECT
           (SELECT count(*)::int FROM platform_subscription_periods WHERE subscription_id=$1 AND period_start=$2) periods,
           (SELECT count(*)::int FROM platform_invoices i JOIN platform_subscription_periods p ON p.id=i.subscription_period_id WHERE i.subscription_id=$1 AND p.period_start=$2) invoices,
           (SELECT count(*)::int FROM platform_invoice_lines l JOIN platform_invoices i ON i.id=l.invoice_id JOIN platform_subscription_periods p ON p.id=i.subscription_period_id WHERE i.subscription_id=$1 AND p.period_start=$2) lines,
           (SELECT i.total_minor::text FROM platform_invoices i JOIN platform_subscription_periods p ON p.id=i.subscription_period_id WHERE i.subscription_id=$1 AND p.period_start=$2 LIMIT 1) total_minor,
           (SELECT sum(l.total_minor)::text FROM platform_invoice_lines l JOIN platform_invoices i ON i.id=l.invoice_id JOIN platform_subscription_periods p ON p.id=i.subscription_period_id WHERE i.subscription_id=$1 AND p.period_start=$2) line_total,
           (SELECT status FROM platform_subscription_changes WHERE subscription_id=$1 ORDER BY created_at DESC LIMIT 1) change_status`,
        [subscriptionId, expiredPeriodEnd],
      )
    ).rows[0];
    expect(result).toMatchObject({
      periods: 1,
      invoices: 1,
      lines: 1,
      total_minor: "4900",
      line_total: "4900",
      change_status: "APPLIED",
    });
  });

  it("ends cancellation-at-period without creating another invoice", async () => {
    const invoiceCount = (
      await db.query<{ count: number }>(
        "SELECT count(*)::int count FROM platform_invoices WHERE subscription_id=$1",
        [subscriptionId],
      )
    ).rows[0].count;
    await db.query(
      `UPDATE platform_subscriptions
       SET status='CANCEL_AT_PERIOD_END',cancel_at_period_end=true,current_period_end=now()-interval '1 second'
       WHERE id=$1`,
      [subscriptionId],
    );
    await processor.renewSubscriptions();
    expect(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM platform_subscriptions WHERE id=$1",
          [subscriptionId],
        )
      ).rows[0].status,
    ).toBe("CANCELLED");
    expect(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int count FROM platform_invoices WHERE subscription_id=$1",
          [subscriptionId],
        )
      ).rows[0].count,
    ).toBe(invoiceCount);
  });
});
