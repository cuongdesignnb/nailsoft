import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmailProvider } from "../../apps/worker/src/email.provider";
import { EngagementProcessor } from "../../apps/worker/src/engagement.processor";

const url = process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const tenant = "10000000-0000-4000-8000-000000000001";
const customer = "60000000-0000-4000-8000-000000000001";

class CountingProvider extends EmailProvider {
  calls = 0;
  override async sendEmail(_mode: string, request: any) {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { providerReference: `frequency:${request.messageId}`, status: "SENT" as const };
  }
}

describe.sequential("Sprint 11 frequency cap and consent send lease", () => {
  const pool = new pg.Pool({ connectionString: url, max: 24 });
  const provider = new CountingProvider();
  const processor = new EngagementProcessor(provider);
  beforeAll(async () => {
    await pool.query(
      `UPDATE communication_settings SET marketing_frequency_limit=2,marketing_frequency_window_days=7,quiet_hours_start='00:00',quiet_hours_end='00:00' WHERE tenant_id=$1`,
      [tenant],
    );
  });
  afterAll(async () => {
    await processor.onModuleDestroy();
    await pool.end();
  });

  it("allows at most two provider calls across twenty concurrent marketing messages", async () => {
    for (let i = 0; i < 20; i += 1)
      await pool.query(
        `INSERT INTO communication_messages(tenant_id,customer_id,category,purpose,template_version_id,generation_key,status,scheduled_at)
         VALUES($1,$2,'MARKETING','PROMOTION','e8100000-0000-4000-8000-000000000002',$3,'SCHEDULED',now())`,
        [tenant, customer, `frequency-closure:${i}`],
      );
    await Promise.all(Array.from({ length: 20 }, () => processor.deliverOne()));
    expect(provider.calls).toBeLessThanOrEqual(2);
    const counts = (await pool.query(
      `SELECT status,count(*)::int count FROM communication_messages WHERE tenant_id=$1 AND generation_key LIKE 'frequency-closure:%' GROUP BY status`,
      [tenant],
    )).rows;
    expect(counts.find((x) => x.status === "SENT")?.count).toBe(2);
    expect(counts.find((x) => x.status === "SUPPRESSED")?.count).toBe(18);
    const active = (await pool.query("SELECT count(*)::int n FROM marketing_frequency_reservations WHERE tenant_id=$1 AND status='ACTIVE'", [tenant])).rows[0].n;
    expect(active).toBe(0);
  });

  it("withdrawal after claim invalidates the lease before provider call", async () => {
    const id = "ea200000-0000-4000-8000-000000000001";
    const claim = "ea210000-0000-4000-8000-000000000001";
    const versions = (await pool.query(
      `SELECT p.version preference_version,s.version consent_version FROM customer_communication_preferences p
       JOIN customer_consent_states s ON s.tenant_id=p.tenant_id AND s.customer_id=p.customer_id AND s.purpose='MARKETING_EMAIL'
       WHERE p.tenant_id=$1 AND p.customer_id=$2`,
      [tenant, customer],
    )).rows[0];
    await pool.query(
      `INSERT INTO communication_messages(id,tenant_id,customer_id,category,purpose,template_version_id,generation_key,status,claim_token,claim_expires_at,preference_version,consent_state_version,suppression_generation)
       VALUES($1,$2,$3,'MARKETING','PROMOTION','e8100000-0000-4000-8000-000000000002','consent-race-closure','PROCESSING',$4,now()+interval '5 minutes',$5,$6,0)`,
      [id, tenant, customer, claim, versions.preference_version, versions.consent_version],
    );
    await pool.query("UPDATE customer_consent_states SET state='WITHDRAWN',version=version+1,updated_at=now() WHERE tenant_id=$1 AND customer_id=$2 AND purpose='MARKETING_EMAIL'", [tenant, customer]);
    await pool.query("UPDATE customer_communication_preferences SET marketing_email_allowed=false,version=version+1,updated_at=now() WHERE tenant_id=$1 AND customer_id=$2", [tenant, customer]);
    await pool.query(
      `INSERT INTO communication_suppressions(tenant_id,customer_id,purpose,reason) VALUES($1,$2,'MARKETING_EMAIL','MARKETING_WITHDRAWN') ON CONFLICT DO NOTHING`,
      [tenant, customer],
    );
    const eligible = await (processor as any).preflight({
      id,
      tenant_id: tenant,
      customer_id: customer,
      claim_token: claim,
      preference_version: versions.preference_version,
      consent_state_version: versions.consent_version,
      suppression_generation: 0,
    });
    expect(eligible).toBe(false);
    expect((await pool.query("SELECT status FROM communication_messages WHERE id=$1", [id])).rows[0].status).toBe("SUPPRESSED");
    expect(provider.calls).toBe(2);
  });

  it("recovers an abandoned claim and releases its frequency reservation", async () => {
    const id = "ea200000-0000-4000-8000-000000000002";
    const reservation = "ea220000-0000-4000-8000-000000000001";
    await pool.query(
      `INSERT INTO communication_messages(id,tenant_id,customer_id,category,purpose,generation_key,status,claim_token,claim_expires_at)
       VALUES($1,$2,$3,'MARKETING','PROMOTION','crashed-claim-closure','PROCESSING',gen_random_uuid(),now()-interval '1 minute')`,
      [id, tenant, customer],
    );
    await pool.query(
      `INSERT INTO marketing_frequency_reservations(id,tenant_id,customer_id,message_id,window_started_at,lease_expires_at)
       VALUES($1,$2,$3,$4,now()-interval '7 days',now()-interval '1 minute')`,
      [reservation, tenant, customer, id],
    );
    await pool.query("UPDATE communication_messages SET frequency_reservation_id=$2 WHERE id=$1", [id, reservation]);
    await processor.recoverExpiredClaims();
    expect((await pool.query("SELECT status FROM communication_messages WHERE id=$1", [id])).rows[0].status).toBe("FAILED");
    expect((await pool.query("SELECT status FROM marketing_frequency_reservations WHERE id=$1", [reservation])).rows[0].status).toBe("EXPIRED");
  });
});
