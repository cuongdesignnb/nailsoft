import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  max: 24,
});
const tenant = "10000000-0000-4000-8000-000000000001";

describe.sequential("Sprint 11 PostgreSQL engagement invariants", () => {
  beforeAll(async () => void (await pool.query("SELECT 1")));
  afterAll(async () => pool.end());

  it("migrates deterministic email-only consent, campaign, review, and recovery fixtures", async () => {
    const row = (
      await pool.query(
        `SELECT
        EXISTS(SELECT 1 FROM schema_migrations WHERE version='0021_notifications_marketing_reviews_service_recovery') migrated,
        (SELECT email_provider_mode FROM communication_settings WHERE tenant_id=$1) mode,
        (SELECT state FROM customer_consent_states WHERE tenant_id=$1 AND customer_id='60000000-0000-4000-8000-000000000001' AND purpose='MARKETING_EMAIL') marketing_state,
        (SELECT count(*)::int FROM marketing_campaign_audience WHERE tenant_id=$1) audience,
        (SELECT count(*)::int FROM review_requests WHERE tenant_id=$1) requests,
        (SELECT count(*)::int FROM service_recovery_cases WHERE tenant_id=$1) recoveries`,
        [tenant],
      )
    ).rows[0];
    expect(row).toEqual({
      migrated: true,
      mode: "FAKE",
      marketing_state: "GRANTED",
      audience: 1,
      requests: 1,
      recoveries: 1,
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM communication_templates WHERE channel<>'EMAIL'",
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("initializes every new customer as marketing NOT_GRANTED", async () => {
    const id = "eb000000-0000-4000-8000-000000000001";
    await pool.query(
      "INSERT INTO customers(id,tenant_id,display_name,email_normalized) VALUES($1,$2,'Sprint 11 default fixture','not-granted@example.test')",
      [id, tenant],
    );
    try {
      const states = await pool.query(
        "SELECT purpose,state FROM customer_consent_states WHERE tenant_id=$1 AND customer_id=$2 ORDER BY purpose",
        [tenant, id],
      );
      expect(states.rowCount).toBe(4);
      expect(states.rows.every((row) => row.state === "NOT_GRANTED")).toBe(
        true,
      );
      expect(
        (
          await pool.query(
            "SELECT marketing_email_allowed FROM customer_communication_preferences WHERE tenant_id=$1 AND customer_id=$2",
            [tenant, id],
          )
        ).rows[0].marketing_email_allowed,
      ).toBe(false);
    } finally {
      await pool.query(
        "DELETE FROM customer_consent_states WHERE tenant_id=$1 AND customer_id=$2",
        [tenant, id],
      );
      await pool.query(
        "DELETE FROM customer_communication_preferences WHERE tenant_id=$1 AND customer_id=$2",
        [tenant, id],
      );
      await pool.query("DELETE FROM customers WHERE tenant_id=$1 AND id=$2", [
        tenant,
        id,
      ]);
    }
  });

  it("protects append-only consent and immutable template/audience snapshots", async () => {
    await expect(
      pool.query(
        "UPDATE customer_consent_events SET occurred_at=occurred_at WHERE tenant_id=$1 AND id='e7000000-0000-4000-8000-000000000001'",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      pool.query(
        "UPDATE communication_template_versions SET subject='tampered' WHERE tenant_id=$1 AND id='e8100000-0000-4000-8000-000000000001'",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      pool.query(
        "UPDATE marketing_campaign_audience SET contact_hash='tampered' WHERE tenant_id=$1 AND id='e9200000-0000-4000-8000-000000000001'",
        [tenant],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("deduplicates twenty concurrent message-generation attempts", async () => {
    const generation = "test:s11:twenty-duplicate-events";
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        pool.query(
          `INSERT INTO communication_messages(tenant_id,category,purpose,generation_key,status)
           VALUES($1,'TRANSACTIONAL','APPOINTMENT_REMINDER',$2,'PENDING')`,
          [tenant, generation],
        ),
      ),
    );
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM communication_messages WHERE tenant_id=$1 AND generation_key=$2",
          [tenant, generation],
        )
      ).rows[0].n,
    ).toBe(1);
    await pool.query(
      "DELETE FROM communication_messages WHERE tenant_id=$1 AND generation_key=$2",
      [tenant, generation],
    );
  });

  it("does not grant Sprint 11 salon-data permissions to Platform Super Admin", async () => {
    const rows = await pool.query(
      "SELECT 1 FROM role_permissions WHERE role='PLATFORM_SUPER_ADMIN' AND (permission_code LIKE 'communication.%' OR permission_code LIKE 'marketing.%' OR permission_code LIKE 'review.%' OR permission_code LIKE 'service_recovery.%' OR permission_code LIKE 'customer.engagement%')",
    );
    expect(rows.rowCount).toBe(0);
  });
});
