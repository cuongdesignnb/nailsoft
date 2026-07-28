import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001";
const order = "a4000000-0000-4000-8000-000000000001";
const firstLine = "a5000000-0000-4000-8000-000000000001";

describe("Sprint 8 package units and multi-line invariant", () => {
  afterAll(() => pool.end());

  it("stores the server eligibility unit requirement", async () => {
    const row = await pool.query(
      `SELECT units_per_redemption FROM service_package_eligibility_items
       WHERE tenant_id=$1 AND id='c8000000-0000-4000-8000-000000000402'`,
      [tenant],
    );
    expect(row.rows[0].units_per_redemption).toBe(1);
  });

  it("allows one PACKAGE application per distinct covered line only", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const secondLine = "cf000000-0000-4000-8000-000000000002";
      await c.query(
        `INSERT INTO pos_order_lines(
           id,tenant_id,pos_order_id,line_no,line_type,service_id,description_snapshot_json,
           quantity,unit_price_minor,gross_minor,taxable_minor,tax_minor,net_minor)
         VALUES($1,$2,$3,2,'SERVICE','50000000-0000-4000-8000-000000000002','{}',1,10000,10000,10000,0,10000)`,
        [secondLine, tenant, order],
      );
      const insert = (id: string, line: string, key: string) =>
        c.query(
          `INSERT INTO pos_order_benefit_applications(
             id,tenant_id,pos_order_id,customer_id,benefit_type,source_entity_id,
             covered_order_line_id,sequence_no,amount_minor,units,policy_snapshot_json,generation_key)
           VALUES($1,$2,$3,'60000000-0000-4000-8000-000000000008','PACKAGE',
             'c8000000-0000-4000-8000-000000000403',$4,1,10000,1,'{}',$5)`,
          [id, tenant, order, line, key],
        );
      await insert(
        "cf000000-0000-4000-8000-000000000011",
        firstLine,
        "test:package:first",
      );
      await insert(
        "cf000000-0000-4000-8000-000000000012",
        secondLine,
        "test:package:second",
      );
      await expect(
        insert(
          "cf000000-0000-4000-8000-000000000013",
          firstLine,
          "test:package:duplicate",
        ),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
