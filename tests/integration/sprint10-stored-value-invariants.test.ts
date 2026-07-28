import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  max: 24,
});
const tenant = "10000000-0000-4000-8000-000000000001";

describe.sequential("Sprint 10 stored-value PostgreSQL invariants", () => {
  beforeAll(async () => void (await pool.query("SELECT 1")));
  afterAll(async () => pool.end());

  it("has migration, deterministic liabilities, and disabled-by-default rollout", async () => {
    const row = (
      await pool.query(
        `SELECT
      EXISTS(SELECT 1 FROM schema_migrations WHERE version='0019_gift_card_customer_credit_stored_value') migrated,
      (SELECT count(*)::int FROM gift_cards WHERE tenant_id=$1) cards,
      (SELECT sum(available_minor)::text FROM stored_value_accounts WHERE tenant_id=$1 AND account_type='GIFT_CARD') gift_liability,
      (SELECT feature_status FROM stored_value_settings WHERE tenant_id=$1) feature`,
        [tenant],
      )
    ).rows[0];
    expect(row).toEqual({
      migrated: true,
      cards: 3,
      gift_liability: "700000",
      feature: "ENABLED",
    });
    const other = (
      await pool.query(
        "INSERT INTO tenants(name,slug) VALUES('Sprint 10 disabled tenant','sprint10-disabled') RETURNING id",
      )
    ).rows[0];
    try {
      expect(
        (
          await pool.query(
            "SELECT feature_status FROM stored_value_settings WHERE tenant_id=$1",
            [other.id],
          )
        ).rows[0]?.feature_status,
      ).toBeUndefined();
      await pool.query(
        "INSERT INTO stored_value_settings(tenant_id) VALUES($1)",
        [other.id],
      );
      expect(
        (
          await pool.query(
            "SELECT feature_status FROM stored_value_settings WHERE tenant_id=$1",
            [other.id],
          )
        ).rows[0].feature_status,
      ).toBe("DISABLED");
    } finally {
      await pool.query("DELETE FROM stored_value_settings WHERE tenant_id=$1", [
        other.id,
      ]);
      await pool.query("DELETE FROM tenants WHERE id=$1", [other.id]);
    }
  });

  it("rejects direct balance mutation and all ledger update/delete operations", async () => {
    await expect(
      pool.query(
        "UPDATE stored_value_accounts SET available_minor=available_minor+1 WHERE tenant_id=$1 AND id='da300000-0000-4000-8000-000000000001'",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    for (const statement of [
      "UPDATE stored_value_ledger_entries SET occurred_at=occurred_at WHERE tenant_id=$1 AND id='da400000-0000-4000-8000-000000000001'",
      "DELETE FROM stored_value_ledger_entries WHERE tenant_id=$1 AND id='da400000-0000-4000-8000-000000000001'",
    ])
      await expect(pool.query(statement, [tenant])).rejects.toMatchObject({
        code: "23514",
      });
  });

  it("keeps projections equal to append-only ledger buckets", async () => {
    const mismatches = await pool.query(
      `SELECT a.id FROM stored_value_accounts a WHERE a.tenant_id=$1 AND
      a.pending_minor+a.available_minor+a.reserved_minor+a.redeemed_minor+a.expired_minor+a.cancelled_minor <>
      (SELECT COALESCE(sum(l.pending_delta_minor+l.available_delta_minor+l.reserved_delta_minor+l.redeemed_delta_minor+l.expired_delta_minor+l.cancelled_delta_minor),0) FROM stored_value_ledger_entries l WHERE l.tenant_id=a.tenant_id AND l.account_id=a.id)`,
      [tenant],
    );
    expect(mismatches.rowCount).toBe(0);
  });

  it("allows only one active reservation per account and order under concurrency", async () => {
    const order = (
      await pool.query(
        "SELECT id,customer_id,currency FROM pos_orders WHERE tenant_id=$1 ORDER BY created_at LIMIT 1",
        [tenant],
      )
    ).rows[0];
    expect(order).toBeTruthy();
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        pool.query(
          `INSERT INTO stored_value_reservations(tenant_id,account_id,order_id,customer_id,currency,requested_minor,accepted_minor,expires_at,generation_key)
      VALUES($1,'da300000-0000-4000-8000-000000000001',$2,$3,$4,1,1,now()+interval '5 minutes',$5)`,
          [
            tenant,
            order.id,
            order.customer_id,
            order.currency,
            `test-concurrent:${index}`,
          ],
        ),
      ),
    );
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    await pool.query(
      "DELETE FROM stored_value_reservations WHERE tenant_id=$1 AND generation_key LIKE 'test-concurrent:%'",
      [tenant],
    );
  });

  it("has no default operational stored-value permissions for technicians or platform admins", async () => {
    const rows = await pool.query(
      "SELECT role,permission_code FROM role_permissions WHERE role IN('NAIL_TECHNICIAN','PLATFORM_SUPER_ADMIN') AND (permission_code LIKE 'gift_card.%' OR permission_code LIKE 'stored_value.%' OR permission_code LIKE 'customer_credit.%')",
    );
    expect(rows.rowCount).toBe(0);
  });
});
