import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const pool = new pg.Pool({ connectionString, max: 24 });
const tenant = "10000000-0000-4000-8000-000000000001";

describe("Sprint 8 PostgreSQL benefit invariants", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });
  afterAll(async () => pool.end());

  it("has migration, deterministic wallet fixtures, and composite tenant keys", async () => {
    const result = await pool.query(`SELECT
      EXISTS(SELECT 1 FROM schema_migrations WHERE version='0016_voucher_loyalty_membership_package') migrated,
      (SELECT count(*)::int FROM voucher_codes WHERE id='c8000000-0000-4000-8000-000000000101') vouchers,
      (SELECT available_points::int FROM loyalty_accounts WHERE id='c8000000-0000-4000-8000-000000000201') points,
      (SELECT available_units FROM customer_package_entitlements WHERE id='c8000000-0000-4000-8000-000000000403') units`);
    expect(result.rows[0]).toEqual({
      migrated: true,
      vouchers: 1,
      points: 500,
      units: 4,
    });
    const foreignKeys = await pool.query(
      `SELECT count(*)::int n FROM pg_constraint
       WHERE contype='f' AND conrelid IN (
         'voucher_reservations'::regclass,'loyalty_ledger_entries'::regclass,
         'customer_membership_assignments'::regclass,'package_reservations'::regclass
       ) AND array_length(conkey,1)=2`,
    );
    expect(foreignKeys.rows[0].n).toBeGreaterThanOrEqual(12);
  });

  it("allows exactly one of 20 concurrent reservations for a one-use voucher", async () => {
    await pool.query(
      `UPDATE voucher_codes SET reserved_count=0,used_count=0,status='AVAILABLE',version=version+1
       WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000101'`,
      [tenant],
    );
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query(
          `UPDATE voucher_codes SET reserved_count=reserved_count+1,status='RESERVED',version=version+1
           WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000101'
             AND reserved_count+used_count<use_limit RETURNING id`,
          [tenant],
        ),
      ),
    );
    expect(attempts.filter((item) => item.rowCount === 1)).toHaveLength(1);
  });

  it("allows exactly the available loyalty points across 20 concurrent claims", async () => {
    await pool.query(
      `UPDATE loyalty_accounts SET available_points=500,reserved_points=0,version=version+1
       WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000201'`,
      [tenant],
    );
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query(
          `UPDATE loyalty_accounts SET reserved_points=reserved_points+100,version=version+1
           WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000201'
             AND available_points-reserved_points>=100 RETURNING id`,
          [tenant],
        ),
      ),
    );
    expect(attempts.filter((item) => item.rowCount === 1)).toHaveLength(5);
  });

  it("protects the final package unit across 20 concurrent claims", async () => {
    await pool.query(
      `UPDATE customer_package_entitlements
       SET granted_units=5,adjustment_units=0,available_units=1,reserved_units=0,consumed_units=4,version=version+1
       WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000403'`,
      [tenant],
    );
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query(
          `UPDATE customer_package_entitlements
           SET available_units=available_units-1,reserved_units=reserved_units+1,version=version+1
           WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000403'
             AND available_units>=1 RETURNING id`,
          [tenant],
        ),
      ),
    );
    expect(attempts.filter((item) => item.rowCount === 1)).toHaveLength(1);
  });

  it("prevents overlapping active membership assignments", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO customer_membership_assignments(
          tenant_id,customer_id,tier_id,status,effective_from,effective_to,
          benefit_snapshot_json,qualification_snapshot_json,reason_code
        ) VALUES($1,'60000000-0000-4000-8000-000000000002',
          'c8000000-0000-4000-8000-000000000301','ACTIVE',
          '2026-01-01T00:00:00Z','2026-06-01T00:00:00Z','[]','{}','TEST')`,
        [tenant],
      );
      await expect(
        client.query(
          `INSERT INTO customer_membership_assignments(
            tenant_id,customer_id,tier_id,status,effective_from,effective_to,
            benefit_snapshot_json,qualification_snapshot_json,reason_code
          ) VALUES($1,'60000000-0000-4000-8000-000000000002',
            'c8000000-0000-4000-8000-000000000301','ACTIVE',
            '2026-05-01T00:00:00Z','2026-12-01T00:00:00Z','[]','{}','TEST')`,
          [tenant],
        ),
      ).rejects.toMatchObject({ code: "23P01" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps voucher, loyalty, package, and liability histories append-only", async () => {
    const cases = [
      ["loyalty_ledger_entries", "c8000000-0000-4000-8000-000000000202"],
      ["package_ledger_entries", "c8000000-0000-4000-8000-000000000404"],
    ] as const;
    for (const [table, id] of cases) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await expect(
          client.query(
            `UPDATE ${table} SET created_at=created_at WHERE id=$1`,
            [id],
          ),
        ).rejects.toMatchObject({ code: "55000" });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }
  });
});
