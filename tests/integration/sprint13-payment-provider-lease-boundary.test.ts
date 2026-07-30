import { PlatformBillingProcessor } from "../../apps/worker/src/platform-billing.processor";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiApp, command, login, pool } from "./sprint12-closure-helpers";

const tenantId = "13000000-0000-4000-8000-000000000902";
const invoiceId = "13000000-0000-4000-8000-000000000952";
const db = pool();
const worker = new PlatformBillingProcessor();
let app: Awaited<ReturnType<typeof apiApp>>;

describe("Sprint 13 payment provider lease boundary", () => {
  beforeAll(async () => {
    app = await apiApp();
  });
  afterAll(async () => {
    await app.close();
    await worker.onModuleDestroy();
    await db.end();
  });

  it("schedules in API, claims briefly, calls provider, then finishes separately", async () => {
    const platform = await login(app, "platform-e2e@example.test");
    const created = await app.inject({
      method: "POST",
      url: "/v1/platform/payment-intents",
      headers: command(platform, "s13-provider-payment-create"),
      payload: {
        tenantId,
        invoiceId,
        paymentMethodId: "13000000-0000-4000-8000-000000000951",
        amountMinor: "9900",
        provider: "FAKE",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const paymentId = created.json().data.id;
    const scheduled = await app.inject({
      method: "POST",
      url: `/v1/platform/payment-intents/${paymentId}/confirm`,
      headers: command(platform, "s13-provider-payment-confirm"),
      payload: { tenantId, simulateOutcome: "SUCCEEDED" },
    });
    expect(scheduled.statusCode, scheduled.body).toBe(201);
    expect(scheduled.json().data.status).toBe("PROCESSING");
    const pending = (
      await db.query<any>(
        "SELECT state,attempt_no,leased_at,finished_at FROM platform_provider_operations WHERE aggregate_id=$1",
        [paymentId],
      )
    ).rows[0];
    expect(pending).toMatchObject({
      state: "PENDING",
      attempt_no: 0,
      leased_at: null,
      finished_at: null,
    });

    expect(await worker.processPayments()).toBe(1);
    const result = (
      await db.query<any>(
        `SELECT o.state,o.attempt_no,o.leased_at,o.finished_at,
                p.status,p.applied_to_invoice_minor,p.overpayment_minor,
                i.paid_minor
         FROM platform_provider_operations o
         JOIN platform_payment_intents p ON p.id=o.aggregate_id
         JOIN platform_invoices i ON i.id=p.invoice_id
         WHERE o.aggregate_id=$1`,
        [paymentId],
      )
    ).rows[0];
    expect(result).toMatchObject({
      state: "SUCCEEDED",
      attempt_no: 1,
      status: "SUCCEEDED",
      applied_to_invoice_minor: "9900",
      overpayment_minor: "0",
      paid_minor: "9900",
    });
    expect(result.leased_at).toBeTruthy();
    expect(result.finished_at).toBeTruthy();
  });
});
