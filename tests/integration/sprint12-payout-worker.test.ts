import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkforceProcessor } from "../../apps/worker/src/workforce.processor";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});
const tenant = "10000000-0000-4000-8000-000000000001",
  batch = "f1200000-0000-4000-8000-000000000095",
  item = "f1200000-0000-4000-8000-000000000096";
let processor: WorkforceProcessor;

describe.sequential("Sprint 12 payout Worker", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.PAYOUT_PROVIDER_MODE = "FAKE";
    delete process.env.PAYOUT_FAKE_RESULT;
    await pool.query(
      "DELETE FROM payout_reconciliations WHERE tenant_id=$1 AND payout_item_id=$2",
      [tenant, item],
    );
    await pool.query(
      "DELETE FROM payout_attempts WHERE tenant_id=$1 AND payout_item_id=$2",
      [tenant, item],
    );
    await pool.query(
      "UPDATE pay_statements SET payment_status='UNPAID' WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000094'",
      [tenant],
    );
    await pool.query(
      "UPDATE payout_items SET state='PROCESSING',confirmed_minor=NULL,provider_reference=NULL,manual_evidence_json=NULL,paid_at=NULL,failure_code=NULL WHERE tenant_id=$1 AND id=$2",
      [tenant, item],
    );
    await pool.query(
      "UPDATE payout_batches SET state='PROCESSING',method='EXTERNAL_PAYROLL_PROVIDER',provider_code='FAKE' WHERE tenant_id=$1 AND id=$2",
      [tenant, batch],
    );
    processor = new WorkforceProcessor();
  });
  afterAll(async () => {
    delete process.env.PAYOUT_PROVIDER_MODE;
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("claims one provider request under twenty concurrent processors", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => processor.processPayouts()),
    );
    const result = (
      await pool.query(
        `SELECT i.state,i.provider_reference,s.payment_status,
          (SELECT count(*)::int FROM payout_attempts a WHERE a.tenant_id=i.tenant_id AND a.payout_item_id=i.id) attempts
         FROM payout_items i JOIN pay_statements s ON s.tenant_id=i.tenant_id AND s.id=i.pay_statement_id
         WHERE i.tenant_id=$1 AND i.id=$2`,
        [tenant, item],
      )
    ).rows[0];
    expect(result.state).toBe("PAID");
    expect(result.payment_status).toBe("PAID");
    expect(result.provider_reference).toMatch(/^FAKE-/);
    expect(result.attempts).toBe(1);
  });
  it("bounds provider retries and never fabricates PAID after failures", async () => {
    await pool.query(
      "DELETE FROM payout_reconciliations WHERE tenant_id=$1 AND payout_item_id=$2",
      [tenant, item],
    );
    await pool.query(
      "DELETE FROM payout_attempts WHERE tenant_id=$1 AND payout_item_id=$2",
      [tenant, item],
    );
    await pool.query(
      "UPDATE pay_statements SET payment_status='UNPAID' WHERE tenant_id=$1 AND id='f1200000-0000-4000-8000-000000000094'",
      [tenant],
    );
    await pool.query(
      "UPDATE payout_items SET state='PROCESSING',confirmed_minor=NULL,provider_reference=NULL,paid_at=NULL,failure_code=NULL WHERE tenant_id=$1 AND id=$2",
      [tenant, item],
    );
    await pool.query(
      "UPDATE payout_batches SET state='PROCESSING' WHERE tenant_id=$1 AND id=$2",
      [tenant, batch],
    );
    process.env.PAYOUT_FAKE_RESULT = "FAILED";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await processor.processPayouts();
      await pool.query(
        "UPDATE payout_attempts SET next_retry_at=now()-interval '1 second' WHERE tenant_id=$1 AND payout_item_id=$2 AND state='FAILED'",
        [tenant, item],
      );
    }
    const result = (
      await pool.query(
        `SELECT state,provider_reference,paid_at,failure_code,
          (SELECT count(*)::int FROM payout_attempts WHERE tenant_id=$1 AND payout_item_id=$2) attempts
         FROM payout_items WHERE tenant_id=$1 AND id=$2`,
        [tenant, item],
      )
    ).rows[0];
    expect(result).toMatchObject({
      state: "FAILED",
      provider_reference: null,
      paid_at: null,
      failure_code: "FAKE_PROVIDER_DECLINED",
      attempts: 3,
    });
  });
});
