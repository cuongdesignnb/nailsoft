import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const db = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});

describe("Sprint 13 platform billing PostgreSQL invariants", () => {
  afterAll(() => db.end());
  it("provides deterministic lifecycle, collection, refund and support fixtures", async () => {
    const states = (
      await db.query<{ status: string }>(
        "SELECT status FROM platform_subscriptions WHERE tenant_id IN('13000000-0000-4000-8000-000000000901','13000000-0000-4000-8000-000000000902','13000000-0000-4000-8000-000000000903') ORDER BY status",
      )
    ).rows.map((row) => row.status);
    expect(states).toEqual(["PAST_DUE", "READ_ONLY", "TRIALING"]);
    const coverage = (
      await db.query<{
        invoices: number;
        refunds: number;
        dunning: number;
        overrides: number;
        support_sessions: number;
      }>(`SELECT
      (SELECT count(*)::int FROM platform_invoices WHERE id IN('13000000-0000-4000-8000-000000000952','13000000-0000-4000-8000-000000000960')) invoices,
      (SELECT count(*)::int FROM platform_refunds WHERE id='13000000-0000-4000-8000-000000000963' AND status='SUCCEEDED') refunds,
      (SELECT count(*)::int FROM platform_dunning_cases WHERE id='13000000-0000-4000-8000-000000000955') dunning,
      (SELECT count(*)::int FROM platform_entitlement_overrides WHERE id='13000000-0000-4000-8000-000000000957') overrides,
      (SELECT count(*)::int FROM platform_support_sessions WHERE id='13000000-0000-4000-8000-000000000959' AND state='ACTIVE') support_sessions`)
    ).rows[0];
    expect(coverage).toEqual({
      invoices: 2,
      refunds: 1,
      dunning: 1,
      overrides: 1,
      support_sessions: 1,
    });
  });
  it("migrates existing tenant to no-charge full legacy access", async () => {
    const row = (
      await db.query<any>(`SELECT p.code,s.status,s.collection_mode,pr.unit_amount_minor,
      (SELECT count(*)::int FROM platform_entitlement_projections e WHERE e.tenant_id=t.id AND (e.enabled=true OR e.unlimited=true)) enabled,
      (SELECT count(*)::int FROM platform_invoices i WHERE i.tenant_id=t.id) invoices
      FROM tenants t JOIN platform_subscriptions s ON s.tenant_id=t.id JOIN platform_plans p ON p.id=s.plan_id JOIN platform_prices pr ON pr.plan_version_id=s.plan_version_id WHERE t.slug='nailsoft-demo'`)
    ).rows[0];
    expect(row).toMatchObject({
      code: "LEGACY_INTERNAL",
      status: "ACTIVE",
      collection_mode: "DISABLED",
      unit_amount_minor: "0",
      enabled: 20,
      invoices: 0,
    });
  });
  it("makes active plan economics and price immutable", async () => {
    await expect(
      db.query(
        "UPDATE platform_plan_versions SET quota_snapshot_json='{\"changed\":true}' WHERE id='13000000-0000-4000-8000-000000000101'",
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("PLATFORM_PLAN_VERSION_IMMUTABLE"),
    });
    await expect(
      db.query(
        "UPDATE platform_prices SET unit_amount_minor=1 WHERE code='STARTER_MONTHLY_USD'",
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("PLATFORM_PRICE_IMMUTABLE"),
    });
  });
  it("deduplicates source usage and keeps corrections append-only", async () => {
    const tenant = (
        await db.query<any>("SELECT id FROM tenants WHERE slug='nailsoft-demo'")
      ).rows[0].id,
      meter = (
        await db.query<any>(
          "SELECT id FROM platform_usage_meter_definitions WHERE code='API_REQUEST'",
        )
      ).rows[0].id;
    await db.query(
      `INSERT INTO platform_usage_events(tenant_id,meter_id,source_type,source_id,source_fingerprint,quantity,occurred_at) VALUES($1,$2,'API','request-1','same-source',1,now())`,
      [tenant, meter],
    );
    await expect(
      db.query(
        `INSERT INTO platform_usage_events(tenant_id,meter_id,source_type,source_id,source_fingerprint,quantity,occurred_at) VALUES($1,$2,'API','request-1','same-source',1,now())`,
        [tenant, meter],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    const event = (
      await db.query<any>(
        "SELECT id FROM platform_usage_events WHERE tenant_id=$1 AND source_fingerprint='same-source'",
        [tenant],
      )
    ).rows[0];
    const correction = (
      await db.query<any>(
        `INSERT INTO platform_usage_corrections(tenant_id,usage_event_id,delta_quantity,reason,ticket_reference,approved_by_user_id,created_by_user_id,apply_mode) VALUES($1,$2,-1,'duplicate','TICKET-13','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','NEXT_PERIOD') RETURNING id`,
        [tenant, event.id],
      )
    ).rows[0];
    await expect(
      db.query("DELETE FROM platform_usage_corrections WHERE id=$1", [
        correction.id,
      ]),
    ).rejects.toMatchObject({
      message: expect.stringContaining("PLATFORM_LEDGER_IMMUTABLE"),
    });
  });
  it("serializes the final quota slot under 20 contenders", async () => {
    const tenant = (
      await db.query<any>("SELECT id FROM tenants WHERE slug='nailsoft-demo'")
    ).rows[0].id;
    await db.query(
      "UPDATE platform_entitlement_projections SET unlimited=false,quota_limit=1 WHERE tenant_id=$1 AND entitlement_code='active_users.max'",
      [tenant],
    );
    const reserve = async (index: number) => {
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `quota:${tenant}:active_users.max`,
        ]);
        const count = BigInt(
          (
            await c.query<any>(
              "SELECT count(*) n FROM platform_quota_reservations WHERE tenant_id=$1 AND entitlement_code='active_users.max' AND status IN('HELD','COMMITTED') AND expires_at>now()",
              [tenant],
            )
          ).rows[0].n,
        );
        if (count >= 1n) {
          await c.query("ROLLBACK");
          return false;
        }
        await c.query(
          `INSERT INTO platform_quota_reservations(tenant_id,entitlement_code,resource_type,idempotency_fingerprint,expires_at,status) VALUES($1,'active_users.max','USER',$2,now()+interval '5 minutes','COMMITTED')`,
          [tenant, `contender-${index}`],
        );
        await c.query("COMMIT");
        return true;
      } catch (error) {
        await c.query("ROLLBACK");
        throw error;
      } finally {
        c.release();
      }
    };
    expect(
      (
        await Promise.all(
          Array.from({ length: 20 }, (_, index) => reserve(index)),
        )
      ).filter(Boolean),
    ).toHaveLength(1);
  });
  it("keeps credit ledger append-only and support sessions fail closed", async () => {
    const tenant = (
        await db.query<any>("SELECT id FROM tenants WHERE slug='nailsoft-demo'")
      ).rows[0].id,
      account = (
        await db.query<any>(
          "SELECT id FROM platform_billing_accounts WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0].id;
    const entry = (
      await db.query<any>(
        `INSERT INTO platform_billing_credit_ledger(tenant_id,billing_account_id,entry_type,amount_minor,currency,source_type,source_id,evidence_json) VALUES($1,$2,'MANUAL_CREDIT',100,'USD','TEST',gen_random_uuid(),'{"test":true}') RETURNING id`,
        [tenant, account],
      )
    ).rows[0];
    await expect(
      db.query(
        "UPDATE platform_billing_credit_ledger SET amount_minor=200 WHERE id=$1",
        [entry.id],
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("PLATFORM_LEDGER_IMMUTABLE"),
    });
    const grant = (
      await db.query<any>(
        `INSERT INTO platform_support_access_grants(tenant_id,support_user_id,state,ticket_reference,reason,permission_scope_json,expires_at,session_ttl_seconds,requested_by_user_id,tenant_approver_user_id,approved_at) VALUES($1,'30000000-0000-4000-8000-000000000003','ACTIVE','SUP-13','QA','["appointment.read"]',now()+interval '1 hour',600,'30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001',now()) RETURNING id`,
        [tenant],
      )
    ).rows[0];
    const session = (
      await db.query<any>(
        `INSERT INTO platform_support_sessions(tenant_id,grant_id,support_user_id,token_hash,expires_at) VALUES($1,$2,'30000000-0000-4000-8000-000000000003','test-token-hash',now()+interval '5 minutes') RETURNING id`,
        [tenant, grant.id],
      )
    ).rows[0];
    await db.query(
      "UPDATE platform_support_access_grants SET state='REVOKED',revoked_at=now() WHERE id=$1",
      [grant.id],
    );
    await db.query(
      "UPDATE platform_support_sessions SET state='REVOKED',ended_at=now() WHERE id=$1",
      [session.id],
    );
    expect(
      (
        await db.query(
          "SELECT 1 FROM platform_support_sessions s JOIN platform_support_access_grants g ON g.id=s.grant_id WHERE s.id=$1 AND s.state='ACTIVE' AND g.state='ACTIVE'",
          [session.id],
        )
      ).rowCount,
    ).toBe(0);
  });
});
