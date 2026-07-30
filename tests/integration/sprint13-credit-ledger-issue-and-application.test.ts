import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool } from "./sprint12-closure-helpers";

const tenantId = "13000000-0000-4000-8000-000000000902";
const sourceInvoiceId = "13000000-0000-4000-8000-000000000952";
const sourceLineId = "13000000-0000-4000-8000-000000000953";
const targetInvoiceId = "13000000-0000-4000-8000-000000000970";
const db = pool();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 13 credit issuance and application ledger", () => {
  beforeAll(async () => {
    await db.query(
      `INSERT INTO platform_invoices(
         id,tenant_id,billing_account_id,invoice_number,status,currency,
         subtotal_minor,total_minor,finalized_at,fingerprint
       ) VALUES($1,$2,'13000000-0000-4000-8000-000000000912','S13P-00000070','OPEN','USD',4000,4000,now(),'closure-target')`,
      [targetInvoiceId, tenantId],
    );
    await db.query(
      `INSERT INTO platform_invoice_lines(
         tenant_id,invoice_id,line_type,description,quantity,unit_amount_minor,total_minor
       ) VALUES($1,$2,'MANUAL_ADJUSTMENT','Closure target invoice',1,4000,4000)`,
      [tenantId, targetInvoiceId],
    );
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("separates finalized issuance from account-credit application", async () => {
    const requester = await login(app, "platform-e2e@example.test");
    const approver = await login(app, "platform-billing-approver@example.test");
    const created = await app.inject({
      method: "POST",
      url: `/v1/platform/invoices/${sourceInvoiceId}/credit-notes`,
      headers: command(requester, "s13-closure-credit-create"),
      payload: {
        tenantId,
        reason: "Line-level service credit",
        lineAllocations: [{ invoiceLineId: sourceLineId, amountMinor: "4000" }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const noteId = created.json().data.id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/platform/credit-notes/${noteId}/submit`,
          headers: command(requester, "s13-closure-credit-submit"),
          payload: { tenantId },
        })
      ).statusCode,
    ).toBe(201);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/platform/credit-notes/${noteId}/approve`,
      headers: command(approver, "s13-closure-credit-approve"),
      payload: { tenantId },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const finalized = await app.inject({
      method: "POST",
      url: `/v1/platform/credit-notes/${noteId}/finalize`,
      headers: command(requester, "s13-closure-credit-finalize"),
      payload: { tenantId },
    });
    expect(finalized.statusCode, finalized.body).toBe(201);
    expect(finalized.json().data.status).toBe("FINALIZED");
    expect(
      (
        await db.query<any>(
          "SELECT credited_minor FROM platform_invoices WHERE id=$1",
          [sourceInvoiceId],
        )
      ).rows[0].credited_minor,
    ).toBe("4000");

    const applied = await app.inject({
      method: "POST",
      url: `/v1/platform/credit-notes/${noteId}/apply`,
      headers: command(requester, "s13-closure-credit-apply"),
      payload: {
        tenantId,
        invoiceId: targetInvoiceId,
        amountMinor: "4000",
        reason: "Apply account credit to target invoice",
      },
    });
    expect(applied.statusCode, applied.body).toBe(201);
    const reconciliation = (
      await db.query<any>(
        `SELECT
           (SELECT status FROM platform_credit_notes WHERE id=$1) note_status,
           (SELECT credit_applied_minor FROM platform_invoices WHERE id=$2) applied_minor,
           (SELECT status FROM platform_invoices WHERE id=$2) invoice_status,
           (SELECT sum(amount_minor)::text FROM platform_billing_credit_ledger
              WHERE source_id IN($1,$3)) ledger_balance`,
        [noteId, targetInvoiceId, applied.json().data.id],
      )
    ).rows[0];
    expect(reconciliation).toEqual({
      note_status: "APPLIED",
      applied_minor: "4000",
      invoice_status: "CREDITED",
      ledger_balance: "0",
    });
  });
});
