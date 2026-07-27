import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVOICE, TENANT, harness } from "./sprint7-closure-test-utils";

describe.sequential("Sprint 7 refund window and branch numbering", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let manager: string;
  let owner: string;
  beforeAll(async () => {
    h = await harness("refund-window");
    manager = await h.login("staff2@example.test");
    owner = await h.login("owner@example.test");
    // Build an out-of-window immutable invoice fixture without weakening the
    // production guard. The trigger is disabled only for this deterministic
    // test setup statement and is re-enabled before the API is exercised.
    await h.db.transaction(async (client) => {
      await client.query(
        "ALTER TABLE invoices DISABLE TRIGGER issued_invoice_immutable",
      );
      await client.query(
        "UPDATE invoices SET issued_at=now()-interval '31 days' WHERE tenant_id=$1 AND id=$2",
        [TENANT, INVOICE],
      );
      await client.query(
        "ALTER TABLE invoices ENABLE TRIGGER issued_invoice_immutable",
      );
    });
  });
  afterAll(async () => h?.app.close());

  const payload = (overrideReason?: string) => ({
    items: [
      {
        invoiceLineId: "aa000000-0000-4000-8000-000000000001",
        amountMinor: 1000,
      },
    ],
    tipAmountMinor: 0,
    ...(overrideReason ? { overrideReason } : {}),
  });

  it("requires override permission and reason outside local calendar window", async () => {
    const denied = await h.app.inject({
      method: "POST",
      url: `/v1/invoices/${INVOICE}/refund-plans`,
      headers: h.headers(manager),
      payload: payload(),
    });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json().error.code).toBe("REFUND_WINDOW_OVERRIDE_REQUIRED");
    const allowed = await h.app.inject({
      method: "POST",
      url: `/v1/invoices/${INVOICE}/refund-plans`,
      headers: h.headers(owner),
      payload: payload("Owner reviewed local-calendar deadline"),
    });
    expect(allowed.statusCode, allowed.body).toBe(201);
    expect(allowed.json().data.policy.refundWindowEvidence.outOfWindow).toBe(
      true,
    );
    expect(allowed.json().data.policy.refundWindowOverride.actorUserId).toBe(
      "30000000-0000-4000-8000-000000000001",
    );
  });
});
