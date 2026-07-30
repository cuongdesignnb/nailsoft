import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool } from "./sprint12-closure-helpers";

const tenantId = "13000000-0000-4000-8000-000000000902";
const invoiceId = "13000000-0000-4000-8000-000000000952";
const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 13 manual-payment approval and exact allocation", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("requires an authenticated independent approver and allocates overpayment", async () => {
    const requester = await login(app, "platform-e2e@example.test");
    const approver = await login(app, "platform-billing-approver@example.test");
    const forged = await app.inject({
      method: "POST",
      url: `/v1/platform/invoices/${invoiceId}/manual-payment-requests`,
      headers: command(requester, "s13-closure-forged-approver"),
      payload: {
        tenantId,
        amountMinor: "12000",
        currency: "USD",
        evidenceReference: "WIRE-CLOSURE-FORGED",
        reason: "Closure verification",
        approvedByUserId: "13000000-0000-4000-8000-000000000918",
      },
    });
    expect(forged.statusCode, forged.body).toBe(409);

    const created = await app.inject({
      method: "POST",
      url: `/v1/platform/invoices/${invoiceId}/manual-payment-requests`,
      headers: command(requester, "s13-closure-manual-create"),
      payload: {
        tenantId,
        amountMinor: "12000",
        currency: "USD",
        evidenceReference: "WIRE-CLOSURE-0001",
        reason: "Closure overpayment verification",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const requestId = created.json().data.id;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/platform/manual-payment-requests/${requestId}/submit`,
          headers: command(requester, "s13-closure-manual-submit"),
          payload: { tenantId },
        })
      ).statusCode,
    ).toBe(201);
    const selfApproval = await app.inject({
      method: "POST",
      url: `/v1/platform/manual-payment-requests/${requestId}/approve`,
      headers: command(requester, "s13-closure-manual-self"),
      payload: { tenantId },
    });
    expect(selfApproval.statusCode, selfApproval.body).toBe(403);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/platform/manual-payment-requests/${requestId}/approve`,
      headers: command(approver, "s13-closure-manual-approve"),
      payload: { tenantId, reason: "Independent billing approval" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json().data.approvedByUserId).toBe(
      "13000000-0000-4000-8000-000000000918",
    );

    const processed = await app.inject({
      method: "POST",
      url: `/v1/platform/manual-payment-requests/${requestId}/process`,
      headers: command(requester, "s13-closure-manual-process"),
      payload: { tenantId },
    });
    expect(processed.statusCode, processed.body).toBe(201);
    const evidence = (
      await db.query<any>(
        `SELECT i.paid_minor,i.total_minor,p.applied_to_invoice_minor,p.overpayment_minor,
                r.requested_by_user_id,r.approved_by_user_id,r.approval_fingerprint
         FROM platform_manual_payment_requests r
         JOIN platform_payment_intents p ON p.id=r.payment_intent_id
         JOIN platform_invoices i ON i.id=p.invoice_id
         WHERE r.id=$1`,
        [requestId],
      )
    ).rows[0];
    expect(evidence).toMatchObject({
      paid_minor: "9900",
      total_minor: "9900",
      applied_to_invoice_minor: "9900",
      overpayment_minor: "2100",
      requested_by_user_id: "30000000-0000-4000-8000-000000000015",
      approved_by_user_id: "13000000-0000-4000-8000-000000000918",
    });
    expect(evidence.approval_fingerprint).toBeTruthy();
    expect(
      (
        await db.query(
          "SELECT 1 FROM platform_billing_credit_ledger WHERE source_type='PAYMENT_INTENT' AND entry_type='OVERPAYMENT' AND amount_minor=2100",
        )
      ).rowCount,
    ).toBe(1);
  });
});
