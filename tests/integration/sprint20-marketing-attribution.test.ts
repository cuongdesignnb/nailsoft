import crypto from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { MarketingAttributionService } from "../../apps/api/src/modules/marketing-attribution/marketing-attribution.service";

const url =
  process.env.DATABASE_URL ??
  "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft";
const tenant = "10000000-0000-4000-8000-000000000001";
const branch = "20000000-0000-4000-8000-000000000001";
const customer = "60000000-0000-4000-8000-000000000015";
const owner = {
  tenantId: tenant,
  userId: "30000000-0000-4000-8000-000000000001",
  membershipId: "marketing-attribution-owner",
  authorizationVersion: 1,
  sessionId: "marketing-attribution",
  roles: ["SALON_OWNER"] as any,
  branchIds: [branch],
};

describe.sequential("Marketing attribution G3 controls", () => {
  const pool = new pg.Pool({ connectionString: url });

  afterAll(async () => pool.end());

  it("attaches explicit last-touch, records paid net sales, and adjusts once for a refund", async () => {
    const client = await pool.connect();
    await client.query("BEGIN");
    const service = new MarketingAttributionService({
      query: (text: string, values?: unknown[]) => client.query(text, values),
      transaction: async <T>(work: (tx: pg.PoolClient) => Promise<T>) => work(client),
    } as never);
    const campaignId = "f3100000-0000-4000-8000-000000000001";
    const recipientId = "f3200000-0000-4000-8000-000000000001";
    const consentEventId = "f3300000-0000-4000-8000-000000000001";
    const orderLineId = "f3500000-0000-4000-8000-000000000001";
    const invoiceLineId = "f3600000-0000-4000-8000-000000000001";
    const paymentId = "f3650000-0000-4000-8000-000000000001";
    const refundId = "f3700000-0000-4000-8000-000000000001";
    const refundItemId = "f3800000-0000-4000-8000-000000000001";
    const creditNoteId = "f3900000-0000-4000-8000-000000000001";
    const controlAppointmentId = "70000000-0000-4000-8000-000000000015";

    try {
      await client.query(
        `INSERT INTO customer_consent_events(
           id,tenant_id,customer_id,purpose,event_type,resulting_state,source,evidence_redacted_json,request_id,generation_key
         ) VALUES($1,$2,$3,'MARKETING_EMAIL','GRANT','GRANTED','ADMIN_WEB','{}',$4,$5)`,
        [consentEventId, tenant, customer, "marketing-attribution-test", "marketing-attribution-test"],
      );
      await client.query(
        `INSERT INTO marketing_campaigns(
           id,tenant_id,branch_id,segment_id,template_version_id,name,campaign_type,status,
           requested_by_user_id,approved_by_user_id,audience_generation
         ) VALUES($1,$2,$3,'e9000000-0000-4000-8000-000000000001',
           'e8100000-0000-4000-8000-000000000002','Attribution control campaign','PROMOTION','APPROVED',
           $4,'30000000-0000-4000-8000-000000000004',1)`,
        [campaignId, tenant, branch, owner.userId],
      );
      await client.query(
        `INSERT INTO marketing_campaign_audience(
           id,tenant_id,campaign_id,customer_id,generation,consent_event_id,contact_hash,
           contact_reference,locale,timezone,segment_version,eligibility_snapshot_json,status
         ) VALUES($1,$2,$3,$4,1,$5,'control-contact-hash','preference:control','vi-VN',
           'Asia/Ho_Chi_Minh',1,'{"consent":"GRANTED","emailStatus":"VERIFIED"}','SENT')`,
        [recipientId, tenant, campaignId, customer, consentEventId],
      );
      await client.query(
        `INSERT INTO pos_order_lines(
           id,tenant_id,pos_order_id,line_no,line_type,description_snapshot_json,quantity,
           unit_price_minor,gross_minor,taxable_minor,tax_minor,net_minor,tax_profile_snapshot_json,source_snapshot_json
         ) VALUES($1,$2,'e1000000-0000-4000-8000-000000000001',1,'MANUAL_SERVICE','{}',1,110000,110000,110000,0,110000,'{}','{}')`,
        [orderLineId, tenant],
      );
      await client.query(
        `INSERT INTO invoice_lines(
           id,tenant_id,invoice_id,line_no,source_order_line_id,description_snapshot_json,quantity,
           unit_price_minor,discount_minor,taxable_minor,tax_minor,net_minor,tax_snapshot_json
         ) VALUES($1,$2,'e2000000-0000-4000-8000-000000000001',1,$3,'{}',1,110000,0,110000,0,110000,'{}')`,
        [invoiceLineId, tenant, orderLineId],
      );
      await client.query(
        `INSERT INTO payments(
           id,tenant_id,branch_id,register_id,pos_order_id,payment_reference,tender_type,status,currency,
           requested_minor,captured_minor,captured_at,idempotency_key_hash,request_hash
         ) VALUES($1,$2,$3,'a1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','ATTR-TEST-PAYMENT-001','CARD_EXTERNAL','CAPTURED','VND',110000,110000,now(),'attribution-payment-key','attribution-payment-request')`,
        [paymentId, tenant, branch],
      );
      await client.query(
        `INSERT INTO refunds(
           id,tenant_id,branch_id,invoice_id,pos_order_id,customer_id,refund_reference,status,currency,
           requested_minor,approved_minor,completed_minor,service_refund_minor,tax_refund_minor,
           tip_refund_minor,reason_code,reason_text,policy_snapshot_json,requested_by_user_id,
           approved_by_user_id,approval_reason,approved_at,processing_at,completed_at,refund_destination
         ) VALUES($1,$2,$3,'e2000000-0000-4000-8000-000000000001',
           'e1000000-0000-4000-8000-000000000001',$4,'ATTR-TEST-REFUND-001','COMPLETED','VND',
           50000,50000,50000,50000,0,0,'CUSTOMER_REQUEST','test','{}',$5,
           '30000000-0000-4000-8000-000000000004','test',now(),now(),now(),'ORIGINAL_TENDER')`,
        [refundId, tenant, branch, customer, owner.userId],
      );
      await client.query(
        `INSERT INTO refund_items(
           id,tenant_id,refund_id,item_type,invoice_line_id,quantity,gross_refund_minor,
           discount_reversal_minor,taxable_refund_minor,tax_refund_minor,tip_refund_minor,
           total_refund_minor,source_snapshot_json
         ) VALUES($1,$2,$3,'INVOICE_LINE',$4,1,50000,0,50000,0,0,50000,'{}')`,
        [refundItemId, tenant, refundId, invoiceLineId],
      );
      await client.query(
        `INSERT INTO credit_notes(
           id,tenant_id,branch_id,refund_id,original_invoice_id,credit_note_number,status,
           currency,gross_minor,discount_reversal_minor,taxable_minor,tax_minor,tip_minor,total_minor,
           customer_snapshot_json,branch_snapshot_json,original_invoice_snapshot_json,issued_at,issued_by_user_id
         ) VALUES($1,$2,$3,$4,'e2000000-0000-4000-8000-000000000001','ATTR-TEST-CN-001','ISSUED',
           'VND',50000,0,50000,0,0,50000,'{}','{}','{}',now(),$5)`,
        [creditNoteId, tenant, branch, refundId, owner.userId],
      );

      const issued = await service.issueContext(
        owner,
        campaignId,
        recipientId,
        "marketing-attribution-idempotency-001",
        "marketing-attribution-test",
      );
      expect(issued).toMatchObject({
        campaignId,
        recipientId,
        model: "EXPLICIT_LAST_TOUCH",
        replayed: false,
      });
      const contextId = issued.contextId as string;
      expect(contextId).toEqual(expect.any(String));
      expect(issued.attributionReference).toEqual(expect.any(String));
      expect(issued.bookingUrl).toContain("attribution=");
      const replayedIssue = await service.issueContext(
        owner,
        campaignId,
        recipientId,
        "marketing-attribution-idempotency-001",
        "marketing-attribution-test-retry",
      );
      expect(replayedIssue).toMatchObject({
        contextId,
        attributionReference: contextId,
        replayed: true,
      });
      const beforeControlAttribution = (
        await client.query<any>(
          "SELECT count(*)::int count FROM marketing_booking_attributions WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0].count;
      await expect(
        service.attach(client, {
          tenantId: tenant,
          customerId: customer,
          appointmentId: controlAppointmentId,
          branchId: branch,
          actorUserId: owner.userId,
          requestId: "marketing-attribution-control-no-context",
        }),
      ).resolves.toEqual({ status: "NONE" });
      const afterControlAttribution = (
        await client.query<any>(
          "SELECT count(*)::int count FROM marketing_booking_attributions WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0].count;
      expect(afterControlAttribution).toBe(beforeControlAttribution);

      const wrongCustomerContext = await service.issueContext(
        owner,
        campaignId,
        recipientId,
        "marketing-attribution-idempotency-wrong-customer",
        "marketing-attribution-test",
      );
      await expect(
        service.attach(client, {
          tenantId: tenant,
          attributionReference: wrongCustomerContext.attributionReference,
          customerId: "60000000-0000-4000-8000-000000000001",
          appointmentId: "70000000-0000-4000-8000-000000000035",
          branchId: branch,
          actorUserId: owner.userId,
          requestId: "marketing-attribution-wrong-customer",
        }),
      ).resolves.toMatchObject({ status: "CUSTOMER_MISMATCH" });

      const wrongBranchContext = await service.issueContext(
        owner,
        campaignId,
        recipientId,
        "marketing-attribution-idempotency-wrong-branch",
        "marketing-attribution-test",
      );
      await expect(
        service.attach(client, {
          tenantId: tenant,
          attributionReference: wrongBranchContext.attributionReference,
          customerId: customer,
          appointmentId: "70000000-0000-4000-8000-000000000035",
          branchId: "20000000-0000-4000-8000-000000000002",
          actorUserId: owner.userId,
          requestId: "marketing-attribution-wrong-branch",
        }),
      ).resolves.toMatchObject({ status: "BRANCH_MISMATCH" });

      const expiredContextId = "f3400000-0000-4000-8000-000000000001";
      await client.query(
        `INSERT INTO marketing_attribution_contexts(
           id,tenant_id,campaign_id,recipient_id,customer_id,generation,reference_hash,
           model,status,valid_from,expires_at,issued_by_user_id
         ) VALUES($1,$2,$3,$4,$5,1,$6,'EXPLICIT_LAST_TOUCH','ACTIVE',now()-interval '2 days',now()-interval '1 day',$7)`,
        [
          expiredContextId,
          tenant,
          campaignId,
          recipientId,
          customer,
          crypto.createHash("sha256").update(expiredContextId).digest("hex"),
          owner.userId,
        ],
      );
      await expect(
        service.attach(client, {
          tenantId: tenant,
          attributionReference: expiredContextId,
          customerId: customer,
          appointmentId: "70000000-0000-4000-8000-000000000035",
          branchId: branch,
          actorUserId: owner.userId,
          requestId: "marketing-attribution-expired",
        }),
      ).resolves.toMatchObject({ status: "EXPIRED", contextId: expiredContextId });

      const attached = await service.attach(client, {
        tenantId: tenant,
        attributionReference: issued.attributionReference,
        customerId: customer,
        appointmentId: "70000000-0000-4000-8000-000000000035",
        branchId: branch,
        actorUserId: owner.userId,
        requestId: "marketing-attribution-test",
      });
      expect(attached).toMatchObject({
        status: "ATTACHED",
        campaignId,
        contextId,
        model: "EXPLICIT_LAST_TOUCH",
      });

      const paid = (
        await client.query<any>(
          `SELECT o.id order_id,i.id invoice_id,p.id payment_id
             FROM pos_orders o
             JOIN invoices i ON i.tenant_id=o.tenant_id AND i.pos_order_id=o.id AND i.status='ISSUED'
             LEFT JOIN payments p ON p.tenant_id=o.tenant_id AND p.pos_order_id=o.id AND p.status='CAPTURED'
            WHERE o.tenant_id=$1 AND o.appointment_id=$2 AND o.status='PAID'
            ORDER BY o.created_at DESC LIMIT 1`,
          [tenant, "70000000-0000-4000-8000-000000000035"],
        )
      ).rows[0];
      expect(paid).toBeTruthy();

      const evidence = await service.projectPaidOrder(
        client,
        tenant,
        paid.order_id,
        paid.invoice_id,
        paid.payment_id,
        "marketing-attribution-test",
      );
      expect(evidence.status).toBe("POSTED");
      expect(Number(evidence.grossEligibleRevenueMinor)).toBe(110000);

      const refund = (
        await client.query<any>(
          `SELECT id FROM refunds WHERE tenant_id=$1 AND invoice_id=$2 AND status='COMPLETED' LIMIT 1`,
          [tenant, paid.invoice_id],
        )
      ).rows[0];
      expect(refund).toBeTruthy();
      const adjustment = await service.projectRefundAdjustment(
        client,
        tenant,
        refund.id,
        "marketing-attribution-test",
      );
      expect(adjustment.status).toBe("POSTED");
      expect(Number(adjustment.amountMinor)).toBe(50000);

      const replayEvidence = await service.projectPaidOrder(
        client,
        tenant,
        paid.order_id,
        paid.invoice_id,
        paid.payment_id,
        "marketing-attribution-test-retry",
      );
      const replayAdjustment = await service.projectRefundAdjustment(
        client,
        tenant,
        refund.id,
        "marketing-attribution-test-retry",
      );
      expect(replayEvidence.status).toBe("POSTED");
      expect(replayEvidence.evidenceId).toBe(evidence.evidenceId);
      expect(replayAdjustment.status).toBe("POSTED");
      expect(replayAdjustment.adjustmentId).toBe(adjustment.adjustmentId);

      const summary = await service.campaignSummary(owner, campaignId);
      expect(summary).toMatchObject({
        attributedBookings: 1,
        completedAttributedBookings: 1,
        attributedPaidOrders: 1,
        capabilities: {
          bookingAttribution: true,
          revenueAttribution: true,
          openTracking: false,
          clickTracking: false,
        },
      });
      expect(summary.byCurrency).toEqual([
        expect.objectContaining({
          currency: "VND",
          grossRevenueMinor: 110000,
          refundMinor: 50000,
          netRevenueMinor: 60000,
        }),
      ]);

      await client.query("SAVEPOINT attribution_append_only");
      await expect(
        client.query(
          "UPDATE marketing_attributed_financial_evidence SET evidence_json='{}' WHERE tenant_id=$1 AND id=$2",
          [tenant, evidence.evidenceId],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      await client.query("ROLLBACK TO SAVEPOINT attribution_append_only");

      await client.query("SAVEPOINT attribution_replay_guard");
      await expect(
        service.attach(client, {
          tenantId: tenant,
          attributionReference: issued.attributionReference,
          customerId: customer,
          appointmentId: "70000000-0000-4000-8000-000000000035",
          branchId: branch,
          actorUserId: owner.userId,
          requestId: "marketing-attribution-test-retry",
        }),
      ).resolves.toMatchObject({ status: "REPLAYED" });
      await client.query("ROLLBACK TO SAVEPOINT attribution_replay_guard");

      const stored = (
        await client.query<any>(
          `SELECT status,consumed_by_appointment_id FROM marketing_attribution_contexts WHERE tenant_id=$1 AND id=$2`,
          [tenant, contextId],
        )
      ).rows[0];
      expect(stored).toEqual({
        status: "CONSUMED",
        consumed_by_appointment_id: "70000000-0000-4000-8000-000000000035",
      });

      const persistedReferenceHash = (
        await client.query<any>(
          "SELECT reference_hash FROM marketing_attribution_contexts WHERE tenant_id=$1 AND id=$2",
          [tenant, contextId],
        )
      ).rows[0].reference_hash;
      expect(persistedReferenceHash).toBe(
        crypto.createHash("sha256").update(issued.attributionReference).digest("hex"),
      );
      expect(persistedReferenceHash).not.toBe(issued.attributionReference);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
