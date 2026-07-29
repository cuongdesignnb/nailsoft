import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseService } from "../../apps/api/src/infrastructure/database.service";
import { BookingIdempotencyService } from "../../apps/api/src/modules/booking/booking-idempotency.service";
import { CommunicationService } from "../../apps/api/src/modules/engagement/communication.service";
import { EmailProvider } from "../../apps/worker/src/email.provider";
import { EngagementProcessor } from "../../apps/worker/src/engagement.processor";

const url = process.env.DATABASE_URL ?? "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const tenant = "10000000-0000-4000-8000-000000000001";
const customer = "60000000-0000-4000-8000-000000000015";
const branch = "20000000-0000-4000-8000-000000000001";
const caseId = "e5000000-0000-4000-8000-000000000001";
const owner = {
  tenantId: tenant,
  userId: "30000000-0000-4000-8000-000000000001",
  membershipId: "closure-owner",
  authorizationVersion: 1,
  sessionId: "closure",
  roles: ["SALON_OWNER"] as any,
  branchIds: [branch],
};

describe.sequential("Sprint 11 review delay, withdrawal and compensation posting", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = new DatabaseService();
  const communications = new CommunicationService(db, new BookingIdempotencyService());
  const processor = new EngagementProcessor(new EmailProvider());
  afterAll(async () => {
    await processor.onModuleDestroy();
    await db.onModuleDestroy();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query("UPDATE communication_settings SET review_requests_enabled_from=now()-interval '30 days',review_request_delay_hours=24 WHERE tenant_id=$1", [tenant]);
  });

  it("does not schedule before delay and generates exactly once after due", async () => {
    await pool.query("DELETE FROM communication_messages WHERE tenant_id=$1 AND review_request_id='e3000000-0000-4000-8000-000000000001'", [tenant]);
    await pool.query("DELETE FROM review_requests WHERE tenant_id=$1 AND id='e3000000-0000-4000-8000-000000000001'", [tenant]);
    await pool.query("UPDATE communication_settings SET review_request_delay_hours=720 WHERE tenant_id=$1", [tenant]);
    expect(await processor.scheduleReviewRequests()).toBe(0);
    await pool.query("UPDATE communication_settings SET review_request_delay_hours=24 WHERE tenant_id=$1", [tenant]);
    expect(await processor.scheduleReviewRequests()).toBe(1);
    expect(await processor.scheduleReviewRequests()).toBe(0);
    const row = (await pool.query("SELECT rr.status,rr.policy_version,m.status message_status FROM review_requests rr JOIN communication_messages m ON m.review_request_id=rr.id WHERE rr.tenant_id=$1 AND rr.appointment_id='70000000-0000-4000-8000-000000000035'", [tenant])).rows[0];
    expect(row).toEqual({ status: "PENDING", policy_version: 1, message_status: "SCHEDULED" });
  });

  it("review withdrawal suppresses pending review request but not transactional email", async () => {
    await pool.query(
      `INSERT INTO communication_messages(tenant_id,customer_id,category,purpose,generation_key,status,scheduled_at)
       VALUES($1,$2,'TRANSACTIONAL','APPOINTMENT_REMINDER','review-withdraw-transactional','SCHEDULED',now()) ON CONFLICT DO NOTHING`,
      [tenant, customer],
    );
    await communications.consent(
      owner,
      customer,
      "WITHDRAW",
      { purpose: "REVIEW_REQUEST", source: "CUSTOMER_PORTAL", evidence: { closure: true } },
      "review-withdraw-key-0001",
      "closure",
    );
    const review = (await pool.query("SELECT rr.status,m.status message_status FROM review_requests rr JOIN communication_messages m ON m.review_request_id=rr.id WHERE rr.tenant_id=$1 AND rr.appointment_id='70000000-0000-4000-8000-000000000035'", [tenant])).rows[0];
    expect(review).toEqual({ status: "SUPPRESSED", message_status: "SUPPRESSED" });
    expect((await pool.query("SELECT status FROM communication_messages WHERE tenant_id=$1 AND generation_key='review-withdraw-transactional'", [tenant])).rows[0].status).toBe("SCHEDULED");
    expect((await pool.query("SELECT state FROM customer_consent_states WHERE tenant_id=$1 AND customer_id=$2 AND purpose='MARKETING_EMAIL'", [tenant, customer])).rows[0].state).not.toBe("WITHDRAWN");
  });

  it("synchronizes Customer Credit and Loyalty owning-domain decisions to terminal compensation", async () => {
    const requester = "30000000-0000-4000-8000-000000000004";
    const approver = "30000000-0000-4000-8000-000000000001";
    const creditAdjustment = "ea300000-0000-4000-8000-000000000001";
    const creditComp = "ea310000-0000-4000-8000-000000000001";
    await pool.query(
      `INSERT INTO stored_value_adjustment_requests(id,tenant_id,customer_id,currency,adjustment_type,amount_minor,reason_code,note,requested_by_user_id,branch_id)
       VALUES($1,$2,$3,'VND','SERVICE_RECOVERY_CREDIT',1000,'SERVICE_RECOVERY','closure',$4,$5)`,
      [creditAdjustment, tenant, customer, requester, branch],
    );
    await pool.query(
      `INSERT INTO service_recovery_compensation_requests(id,tenant_id,case_id,branch_id,customer_id,compensation_type,proposal_json,status,requested_by_user_id,approved_by_user_id,existing_domain_reference_type,existing_domain_reference_id,reason,sync_status)
       VALUES($1,$2,$3,$4,$5,'CUSTOMER_CREDIT','{}','APPROVED',$6,$7,'CUSTOMER_CREDIT',$8,'closure','PENDING')`,
      [creditComp, tenant, caseId, branch, customer, requester, approver, creditAdjustment],
    );
    await pool.query("UPDATE stored_value_adjustment_requests SET status='APPROVED',decided_by_user_id=$3,decided_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, creditAdjustment, approver]);
    expect((await pool.query("SELECT status,sync_status,posted_at IS NOT NULL posted FROM service_recovery_compensation_requests WHERE id=$1", [creditComp])).rows[0]).toEqual({ status: "POSTED", sync_status: "POSTED", posted: true });

    await pool.query("INSERT INTO loyalty_accounts(tenant_id,customer_id) VALUES($1,$2) ON CONFLICT(tenant_id,customer_id) DO NOTHING", [tenant, customer]);
    const loyaltyAccount = (await pool.query("SELECT id FROM loyalty_accounts WHERE tenant_id=$1 AND customer_id=$2 LIMIT 1", [tenant, customer])).rows[0].id;
    const loyaltyAdjustment = "ea300000-0000-4000-8000-000000000002";
    const loyaltyComp = "ea310000-0000-4000-8000-000000000002";
    await pool.query(
      `INSERT INTO loyalty_adjustment_requests(id,tenant_id,customer_id,account_id,points_delta,reason_code,note,requested_by_user_id)
       VALUES($1,$2,$3,$4,10,'SERVICE_RECOVERY','closure',$5)`,
      [loyaltyAdjustment, tenant, customer, loyaltyAccount, requester],
    );
    await pool.query(
      `INSERT INTO service_recovery_compensation_requests(id,tenant_id,case_id,branch_id,customer_id,compensation_type,proposal_json,status,requested_by_user_id,approved_by_user_id,existing_domain_reference_type,existing_domain_reference_id,reason,sync_status)
       VALUES($1,$2,$3,$4,$5,'LOYALTY_POINTS','{}','APPROVED',$6,$7,'LOYALTY_POINTS',$8,'closure','PENDING')`,
      [loyaltyComp, tenant, caseId, branch, customer, requester, approver, loyaltyAdjustment],
    );
    const ledger = "ea320000-0000-4000-8000-000000000001";
    await pool.query("INSERT INTO loyalty_ledger_entries(id,tenant_id,account_id,customer_id,entry_type,available_delta,policy_snapshot_json,generation_key,created_by_user_id) VALUES($1,$2,$3,$4,'MANUAL_ADJUSTMENT',10,'{}','closure-loyalty-ledger',$5)", [ledger, tenant, loyaltyAccount, customer, approver]);
    await pool.query("UPDATE loyalty_adjustment_requests SET status='APPROVED',decided_by_user_id=$3,decided_at=now(),ledger_entry_id=$4 WHERE tenant_id=$1 AND id=$2", [tenant, loyaltyAdjustment, approver, ledger]);
    expect((await pool.query("SELECT status,sync_status FROM service_recovery_compensation_requests WHERE id=$1", [loyaltyComp])).rows[0]).toEqual({ status: "POSTED", sync_status: "POSTED" });
    expect((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='service_recovery.compensation_posted' AND aggregate_id IN($2,$3)", [tenant, creditComp, loyaltyComp])).rows[0].n).toBe(2);
  });

  it("synchronizes an owning-domain rejection without leaving compensation APPROVED", async () => {
    const requester = "30000000-0000-4000-8000-000000000004";
    const approver = "30000000-0000-4000-8000-000000000001";
    const adjustment = "ea300000-0000-4000-8000-000000000003";
    const compensation = "ea310000-0000-4000-8000-000000000003";
    await pool.query(
      `INSERT INTO stored_value_adjustment_requests(id,tenant_id,customer_id,currency,adjustment_type,amount_minor,reason_code,note,requested_by_user_id,branch_id)
       VALUES($1,$2,$3,'VND','SERVICE_RECOVERY_CREDIT',1000,'SERVICE_RECOVERY','closure rejection',$4,$5)`,
      [adjustment, tenant, customer, requester, branch],
    );
    await pool.query(
      `INSERT INTO service_recovery_compensation_requests(id,tenant_id,case_id,branch_id,customer_id,compensation_type,proposal_json,status,requested_by_user_id,approved_by_user_id,existing_domain_reference_type,existing_domain_reference_id,reason,sync_status)
       VALUES($1,$2,$3,$4,$5,'CUSTOMER_CREDIT','{}','APPROVED',$6,$7,'CUSTOMER_CREDIT',$8,'closure rejection','PENDING')`,
      [compensation, tenant, caseId, branch, customer, requester, approver, adjustment],
    );
    await pool.query(
      "UPDATE stored_value_adjustment_requests SET status='REJECTED',decided_by_user_id=$3,decided_at=now(),decision_reason='Rejected by owning domain' WHERE tenant_id=$1 AND id=$2",
      [tenant, adjustment, approver],
    );
    expect(
      (await pool.query("SELECT status,sync_status FROM service_recovery_compensation_requests WHERE id=$1", [compensation])).rows[0],
    ).toEqual({ status: "REJECTED", sync_status: "REJECTED" });
    expect(
      (await pool.query("SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='service_recovery.compensation_failed' AND aggregate_id=$2", [tenant, compensation])).rows[0].n,
    ).toBe(1);
  });
});
