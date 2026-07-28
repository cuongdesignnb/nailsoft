import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  max: 24,
});
const tenant = "10000000-0000-4000-8000-000000000001",
  balance = "b9080000-0000-4000-8000-000000000001";
describe.sequential("Sprint 9 inventory PostgreSQL invariants", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });
  afterAll(async () => pool.end());
  it("migrates deterministic inventory with composite keys and exact types", async () => {
    const row = (
      await pool.query(
        `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='0018_inventory_supplier_purchase_operations') migrated,(SELECT on_hand::text FROM inventory_stock_balances WHERE id=$1) on_hand,(SELECT count(*)::int FROM inventory_stock_ledger_entries WHERE tenant_id=$2) ledger`,
        [balance, tenant],
      )
    ).rows[0];
    expect(row).toEqual({ migrated: true, on_hand: "110.000000", ledger: 3 });
    const type = (
      await pool.query(
        "SELECT numeric_precision,numeric_scale FROM information_schema.columns WHERE table_name='inventory_stock_balances' AND column_name='on_hand'",
      )
    ).rows[0];
    expect(type).toEqual({ numeric_precision: 20, numeric_scale: 6 });
  });
  it("makes the physical ledger and posted receipts immutable", async () => {
    for (const [table, id] of [
      [
        "inventory_stock_ledger_entries",
        "b9090000-0000-4000-8000-000000000001",
      ],
      ["inventory_receipts", "b9190000-0000-4000-8000-000000000001"],
    ]) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await expect(
          c.query(
            `UPDATE ${table} SET created_at=created_at WHERE tenant_id=$1 AND id=$2`,
            [tenant, id],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }
  });
  it("serializes concurrent reservations without exceeding available", async () => {
    await pool.query(
      "UPDATE inventory_stock_balances SET reserved=108 WHERE tenant_id=$1 AND id=$2",
      [tenant, balance],
    );
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query(
          "UPDATE inventory_stock_balances SET reserved=reserved+1,version=version+1 WHERE tenant_id=$1 AND id=$2 AND on_hand-reserved>=1 RETURNING id",
          [tenant, balance],
        ),
      ),
    );
    expect(attempts.filter((x) => x.rowCount === 1)).toHaveLength(2);
    const row = (
      await pool.query(
        "SELECT on_hand::text,reserved::text,(on_hand-reserved)::text available FROM inventory_stock_balances WHERE tenant_id=$1 AND id=$2",
        [tenant, balance],
      )
    ).rows[0];
    expect(row).toEqual({
      on_hand: "110.000000",
      reserved: "110.000000",
      available: "0.000000",
    });
  });
  it("rejects negative availability and cross-tenant lot references", async () => {
    await expect(
      pool.query(
        "UPDATE inventory_stock_balances SET reserved=on_hand+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, balance],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await expect(
        c.query(
          "INSERT INTO inventory_stock_balances(tenant_id,branch_id,location_id,item_id,lot_id) VALUES('10000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','b9050000-0000-4000-8000-000000000001','b9030000-0000-4000-8000-000000000001','b9070000-0000-4000-8000-000000000001')",
        ),
      ).rejects.toBeTruthy();
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
  it("keeps quarantine and expired lots outside the FEFO candidate set", async () => {
    const rows = await pool.query(
      `SELECT l.id FROM inventory_lots l JOIN inventory_stock_balances b ON b.tenant_id=l.tenant_id AND b.lot_id=l.id WHERE l.tenant_id=$1 AND l.status='AVAILABLE' AND (l.expiry_date IS NULL OR l.expiry_date>=CURRENT_DATE) AND b.on_hand-b.reserved>0 ORDER BY l.expiry_date NULLS LAST`,
      [tenant],
    );
    expect(
      rows.rows.every((x) => x.id !== "b9070000-0000-4000-8000-000000000002"),
    ).toBe(true);
  });
});
