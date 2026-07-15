import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});

describe("PostgreSQL foundation", () => {
  beforeAll(async () => client.connect());
  afterAll(async () => client.end());

  it("contains deterministic SRS fixture counts", async () => {
    // Count only deterministic seed identifiers. Other integration suites intentionally
    // retain append-only booking/audit evidence and may execute before this assertion.
    const result =
      await client.query(`SELECT (SELECT count(*)::int FROM tenants WHERE id::text LIKE '10000000-0000-4000-8000-%') tenants,
      (SELECT count(*)::int FROM branches WHERE id::text LIKE '20000000-0000-4000-8000-%') branches,
      (SELECT count(*)::int FROM users WHERE id::text LIKE '30000000-0000-4000-8000-%') users,
      (SELECT count(*)::int FROM services WHERE id::text LIKE '50000000-0000-4000-8000-%') services,
      (SELECT count(*)::int FROM customers WHERE id::text LIKE '60000000-0000-4000-8000-%') customers,
      (SELECT count(*)::int FROM appointments WHERE id::text LIKE '70000000-0000-4000-8000-%') appointments`);
    expect(result.rows[0]).toEqual({
      tenants: 1,
      branches: 3,
      users: 15,
      services: 30,
      customers: 20,
      appointments: 40,
    });
  });

  it("allows null phones but rejects duplicate non-null phones per tenant", async () => {
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO users(origin_tenant_id,display_name) VALUES
        ('10000000-0000-4000-8000-000000000001','No phone A'),
        ('10000000-0000-4000-8000-000000000001','No phone B')`);
      await client.query(`INSERT INTO users(origin_tenant_id,display_name,phone_e164) VALUES
        ('10000000-0000-4000-8000-000000000001','Phone A','+84999999999')`);
      await expect(
        client.query(`INSERT INTO users(origin_tenant_id,display_name,phone_e164) VALUES
        ('10000000-0000-4000-8000-000000000001','Phone B','+84999999999')`),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("has durable reliability tables", async () => {
    const result = await client.query(
      `SELECT to_regclass('audit_logs') audit, to_regclass('idempotency_keys') idempotency, to_regclass('outbox_events') outbox`,
    );
    expect(result.rows[0]).toEqual({
      audit: "audit_logs",
      idempotency: "idempotency_keys",
      outbox: "outbox_events",
    });
  });
});
