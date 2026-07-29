import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { BookingIdempotencyService } from "../../apps/api/src/modules/booking/booking-idempotency.service";
import { CommunicationService } from "../../apps/api/src/modules/engagement/communication.service";
import { MarketingService } from "../../apps/api/src/modules/engagement/marketing.service";
import { EmailProvider } from "../../apps/worker/src/email.provider";
import { EngagementProcessor } from "../../apps/worker/src/engagement.processor";

const url = process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const customer = "60000000-0000-4000-8000-000000000001";
const owner = {
  tenantId: tenant,
  userId: "30000000-0000-4000-8000-000000000001",
  membershipId: "closure-owner",
  authorizationVersion: 1,
  sessionId: "closure",
  roles: ["SALON_OWNER"] as any,
  branchIds: [branch],
};
const manager = {
  ...owner,
  userId: "30000000-0000-4000-8000-000000000004",
  membershipId: "closure-manager",
  roles: ["BRANCH_MANAGER"] as any,
};

class CountingProvider extends EmailProvider {
  calls = 0;
  override async sendEmail(mode: string, request: any) {
    this.calls += 1;
    return { providerReference: `closure:${request.messageId}`, status: "SENT" as const };
  }
}

describe.sequential("Sprint 11 campaign pause, cancel and finalization", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = new DatabaseService();
  const marketing = new MarketingService(
    new CommunicationService(db, new BookingIdempotencyService()),
  );
  const provider = new CountingProvider();
  const processor = new EngagementProcessor(provider);

  beforeAll(async () => {
    await pool.query("UPDATE communication_settings SET quiet_hours_start='00:00',quiet_hours_end='00:00' WHERE tenant_id=$1", [tenant]);
  });
  afterAll(async () => {
    await processor.onModuleDestroy();
    await db.onModuleDestroy();
    await pool.end();
  });

  async function campaign(id: string, messageId: string) {
    await pool.query(
      `INSERT INTO marketing_campaigns(id,tenant_id,branch_id,segment_id,template_version_id,name,campaign_type,status,requested_by_user_id,approved_by_user_id,audience_generation,started_at)
       VALUES($1,$2,$3,'e9000000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000002','Closure campaign','PROMOTION','RUNNING','30000000-0000-4000-8000-000000000004',$4,1,now())`,
      [id, tenant, branch, owner.userId],
    );
    await pool.query(
      `INSERT INTO marketing_campaign_audience(tenant_id,campaign_id,customer_id,generation,consent_event_id,contact_hash,contact_reference,locale,timezone,segment_version,eligibility_snapshot_json)
       VALUES($1,$2,$3,1,'e7000000-0000-4000-8000-000000000001','closure-hash','preference:closure','vi-VN','Asia/Ho_Chi_Minh',1,'{}')`,
      [tenant, id, customer],
    );
    await pool.query(
      `INSERT INTO communication_messages(id,tenant_id,branch_id,customer_id,category,purpose,template_version_id,generation_key,status,scheduled_at,marketing_campaign_id)
       VALUES($1,$2,$3,$4,'MARKETING','PROMOTION','e8100000-0000-4000-8000-000000000002',$5,'SCHEDULED',now(),$6)`,
      [messageId, tenant, branch, customer, `closure:${id}`, id],
    );
  }

  it("pause prevents provider calls, resume sends once, and finalizer is idempotent", async () => {
    const id = "ea100000-0000-4000-8000-000000000001";
    await campaign(id, "ea110000-0000-4000-8000-000000000001");
    await marketing.transition(owner, id, "PAUSED", { version: 1 }, "closure-pause-key-0001", "closure");
    expect(await processor.deliverOne()).toBe(0);
    expect(provider.calls).toBe(0);
    const paused = (await pool.query("SELECT status FROM communication_messages WHERE marketing_campaign_id=$1", [id])).rows[0];
    expect(paused.status).toBe("SCHEDULED");

    await marketing.transition(owner, id, "RUNNING", { version: 2 }, "closure-resume-key-001", "closure");
    await processor.deliverOne();
    expect(provider.calls).toBe(1);
    expect(await processor.finalizeCampaigns()).toBe(1);
    expect(await processor.finalizeCampaigns()).toBe(0);
    const completed = (await pool.query("SELECT status,sent_total,final_generation FROM marketing_campaigns WHERE id=$1", [id])).rows[0];
    expect(completed).toMatchObject({ status: "COMPLETED", sent_total: 1, final_generation: 1 });
  });

  it("cancel atomically cancels unsent messages and audience evidence", async () => {
    const id = "ea100000-0000-4000-8000-000000000002";
    await campaign(id, "ea110000-0000-4000-8000-000000000002");
    await marketing.transition(owner, id, "CANCELLED", { version: 1 }, "closure-cancel-key-001", "closure");
    expect(await processor.deliverOne()).toBe(0);
    const row = (await pool.query(
      `SELECT c.status campaign,m.status message,a.status audience FROM marketing_campaigns c
       JOIN communication_messages m ON m.marketing_campaign_id=c.id JOIN marketing_campaign_audience a ON a.campaign_id=c.id WHERE c.id=$1`,
      [id],
    )).rows[0];
    expect(row).toEqual({ campaign: "CANCELLED", message: "CANCELLED", audience: "CANCELLED" });
  });

  it("finalizes a running campaign whose approved audience is empty", async () => {
    const id = "ea100000-0000-4000-8000-000000000003";
    await pool.query(
      `INSERT INTO marketing_campaigns(id,tenant_id,branch_id,segment_id,template_version_id,name,campaign_type,status,requested_by_user_id,approved_by_user_id,audience_generation,started_at)
       VALUES($1,$2,$3,'e9000000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000002','Empty closure campaign','PROMOTION','RUNNING','30000000-0000-4000-8000-000000000004',$4,1,now())`,
      [id, tenant, branch, owner.userId],
    );
    expect(await processor.finalizeCampaigns()).toBe(1);
    expect(
      (await pool.query("SELECT status,sent_total,suppressed_total,failed_total,cancelled_total FROM marketing_campaigns WHERE id=$1", [id])).rows[0],
    ).toEqual({ status: "COMPLETED", sent_total: 0, suppressed_total: 0, failed_total: 0, cancelled_total: 0 });
  });

  it("fails explicitly instead of silently truncating an oversized audience", async () => {
    const secondCustomer = "60000000-0000-4000-8000-000000000015";
    const communications = marketing.core;
    await communications.consent(
      owner,
      secondCustomer,
      "GRANT",
      { purpose: "MARKETING_EMAIL", source: "ADMIN_WEB", evidence: { closure: true } },
      "closure-second-consent-key",
      "closure",
    );
    await pool.query("UPDATE customer_communication_preferences SET email_address='audience-limit@example.test',email_status='VERIFIED',marketing_email_allowed=true WHERE tenant_id=$1 AND customer_id=$2", [tenant, secondCustomer]);
    await pool.query("UPDATE communication_settings SET campaign_audience_limit=1 WHERE tenant_id=$1", [tenant]);
    const created = await marketing.createCampaign(
      manager,
      {
        branchId: branch,
        segmentId: "e9000000-0000-4000-8000-000000000001",
        templateVersionId: "e8100000-0000-4000-8000-000000000002",
        name: "Audience limit closure",
        campaignType: "PROMOTION",
        riskLevel: "STANDARD",
      },
      "closure-audience-campaign",
      "closure",
    );
    const pending = await marketing.transition(manager, created.id, "PENDING_APPROVAL", { version: 1 }, "closure-audience-pending", "closure");
    await expect(
      marketing.transition(owner, created.id, "APPROVED", { version: pending.version }, "closure-audience-approve", "closure"),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "CAMPAIGN_AUDIENCE_LIMIT_EXCEEDED" }) });
    expect((await pool.query("SELECT count(*)::int n FROM marketing_campaign_audience WHERE campaign_id=$1", [created.id])).rows[0].n).toBe(0);
  });
});
