import { PlatformBillingProcessor } from "../../apps/worker/src/platform-billing.processor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool } from "./sprint12-closure-helpers";

const tenantId = "13000000-0000-4000-8000-000000000903";
const paymentId = "13000000-0000-4000-8000-000000000962";
const invoiceId = "13000000-0000-4000-8000-000000000960";
const lineId = "13000000-0000-4000-8000-000000000961";
const db = pool();
const worker = new PlatformBillingProcessor();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 13 refund approval, provider lease, and credit-note cap", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await worker.onModuleDestroy();
    await db.end();
  });

  it("requires independent approval and finishes a leased refund outside the API transaction", async () => {
    const requester = await login(app, "platform-e2e@example.test");
    const approver = await login(app, "platform-billing-approver@example.test");
    const created = await app.inject({
      method: "POST",
      url: `/v1/platform/payments/${paymentId}/refunds`,
      headers: command(requester, "s13-closure-refund-create"),
      payload: {
        tenantId,
        amountMinor: "5000",
        reason: "Approved refund closure",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const refundId = created.json().data.id;
    await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${refundId}/submit`,
      headers: command(requester, "s13-closure-refund-submit"),
      payload: { tenantId },
    });
    const self = await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${refundId}/approve`,
      headers: command(requester, "s13-closure-refund-self"),
      payload: { tenantId },
    });
    expect(self.statusCode, self.body).toBe(403);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${refundId}/approve`,
      headers: command(approver, "s13-closure-refund-approve"),
      payload: { tenantId, reason: "Independent approval" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const scheduled = await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${refundId}/process`,
      headers: command(requester, "s13-closure-refund-process"),
      payload: { tenantId, simulateOutcome: "SUCCEEDED" },
    });
    expect(scheduled.statusCode, scheduled.body).toBe(201);
    expect(scheduled.json().data.status).toBe("PROCESSING");
    expect(
      (
        await db.query(
          "SELECT 1 FROM platform_provider_operations WHERE aggregate_id=$1 AND state='PENDING'",
          [refundId],
        )
      ).rowCount,
    ).toBe(1);

    expect(await worker.processRefunds()).toBe(1);
    const result = (
      await db.query<any>(
        `SELECT r.status,r.requested_by_user_id,r.approved_by_user_id,r.provider_evidence_hash,
                i.refunded_minor,p.status payment_status
         FROM platform_refunds r
         JOIN platform_payment_intents p ON p.id=r.payment_intent_id
         JOIN platform_invoices i ON i.id=p.invoice_id
         WHERE r.id=$1`,
        [refundId],
      )
    ).rows[0];
    expect(result).toMatchObject({
      status: "SUCCEEDED",
      requested_by_user_id: "30000000-0000-4000-8000-000000000015",
      approved_by_user_id: "13000000-0000-4000-8000-000000000918",
      refunded_minor: "6000",
      payment_status: "PARTIALLY_REFUNDED",
    });
    expect(result.provider_evidence_hash).toBeTruthy();
    const note = (
      await db.query<any>(
        `SELECT n.id,n.status,n.total_minor,l.source_invoice_line_id,l.amount_minor
         FROM platform_credit_notes n
         JOIN platform_credit_note_lines l ON l.credit_note_id=n.id
         WHERE n.source_refund_id=$1`,
        [refundId],
      )
    ).rows[0];
    expect(note).toMatchObject({
      status: "DRAFT",
      total_minor: "5000",
      source_invoice_line_id: lineId,
      amount_minor: "5000",
    });

    const cap = await app.inject({
      method: "POST",
      url: `/v1/platform/invoices/${invoiceId}/credit-notes`,
      headers: command(requester, "s13-closure-credit-cap"),
      payload: {
        tenantId,
        reason: "Must exceed remaining line eligibility",
        lineAllocations: [{ invoiceLineId: lineId, amountMinor: "15000" }],
      },
    });
    expect(cap.statusCode, cap.body).toBe(409);
    expect(cap.json().error.code).toBe("PLATFORM_CREDIT_NOTE_CUMULATIVE_CAP");

    const unknownCreated = await app.inject({
      method: "POST",
      url: `/v1/platform/payments/${paymentId}/refunds`,
      headers: command(requester, "s13-closure-unknown-create"),
      payload: { tenantId, amountMinor: "1000", reason: "Unknown outcome" },
    });
    expect(unknownCreated.statusCode, unknownCreated.body).toBe(201);
    const unknownId = unknownCreated.json().data.id;
    await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${unknownId}/submit`,
      headers: command(requester, "s13-closure-unknown-submit"),
      payload: { tenantId },
    });
    await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${unknownId}/approve`,
      headers: command(approver, "s13-closure-unknown-approve"),
      payload: { tenantId },
    });
    await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${unknownId}/process`,
      headers: command(requester, "s13-closure-unknown-process"),
      payload: { tenantId, simulateOutcome: "UNKNOWN" },
    });
    expect(await worker.processRefunds()).toBe(1);
    expect(
      (
        await db.query<any>("SELECT status FROM platform_refunds WHERE id=$1", [
          unknownId,
        ])
      ).rows[0].status,
    ).toBe("UNKNOWN");
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/platform/payments/${paymentId}/refunds`,
      headers: command(requester, "s13-closure-unknown-blocks"),
      payload: {
        tenantId,
        amountMinor: "500",
        reason: "Must wait for reconciliation",
      },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().error.code).toBe("PLATFORM_REFUND_OUTCOME_UNKNOWN");
    const reconciliation = await app.inject({
      method: "POST",
      url: `/v1/platform/refunds/${unknownId}/reconcile`,
      headers: command(approver, "s13-closure-unknown-reconcile"),
      payload: {
        tenantId,
        observedStatus: "SUCCEEDED",
        reason: "Provider status query confirmed success",
      },
    });
    expect(reconciliation.statusCode, reconciliation.body).toBe(201);
    expect(await worker.processRefunds()).toBe(1);
    expect(
      (
        await db.query<any>("SELECT status FROM platform_refunds WHERE id=$1", [
          unknownId,
        ])
      ).rows[0].status,
    ).toBe("SUCCEEDED");
  });
});
