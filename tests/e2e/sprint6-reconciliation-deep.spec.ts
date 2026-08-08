import { expect, test } from "@playwright/test";
import pg from "pg";
import { close, headers, login, tenantId } from "./helpers/api-client";

const branch = "20000000-0000-4000-8000-000000000001";
const register = "a1000000-0000-4000-8000-000000000001";
const cashier = "30000000-0000-4000-8000-000000000016";

test("register/cashier reconciliation includes cash, card and bank with exact sums", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
  });
  await db.connect();
  const accountant = await login("accountant@example.test");
  const explicitFixtures = [
    {
      tender: "CASH",
      amount: 10_000,
      cashSessionId: "a3000000-0000-4000-8000-000000000001",
    },
    { tender: "CARD_EXTERNAL", amount: 20_000, cashSessionId: null },
    { tender: "BANK_TRANSFER", amount: 25_000, cashSessionId: null },
  ] as const;
  try {
    for (const { tender, amount, cashSessionId } of explicitFixtures) {
      const orderId = crypto.randomUUID();
      const paymentId = crypto.randomUUID();
      const fixtureRef = `${Date.now()}-${paymentId}`;
      await db.query(
        `INSERT INTO pos_orders(
          id,tenant_id,branch_id,register_id,order_number,source,status,currency,subtotal_minor,
          taxable_minor,total_minor,amount_paid_minor,amount_due_minor,pricing_snapshot_json,
          tax_snapshot_json,customer_snapshot_json,pricing_locked_at,finalized_at,paid_at,
          created_by_user_id,updated_by_user_id)
         VALUES($1,$2,$3,$4,$5,'MANUAL','PAID','VND',$6,0,$6,$6,0,'{}','{}','{}',now(),now(),now(),$7,$7)`,
        [
          orderId,
          tenantId,
          branch,
          register,
          `E2E-RECON-${tender}-${fixtureRef}`,
          amount,
          cashier,
        ],
      );
      await db.query(
        `INSERT INTO payments(
          id,tenant_id,branch_id,register_id,pos_order_id,payment_reference,tender_type,status,currency,
          requested_minor,captured_minor,provider,provider_transaction_id,cash_session_id,
          idempotency_key_hash,request_hash,created_by_user_id,captured_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'CAPTURED','VND',$8,$8,'e2e-fixture',$9,$10,$11,$11,$12,now())`,
        [
          paymentId,
          tenantId,
          branch,
          register,
          orderId,
          `PAY-${paymentId}`,
          tender,
          amount,
          `${tender}-${paymentId}`,
          cashSessionId,
          `e2e-${paymentId}`,
          cashier,
        ],
      );
      await db.query(
        "INSERT INTO payment_allocations(tenant_id,payment_id,pos_order_id,allocation_type,amount_minor) VALUES($1,$2,$3,'ORDER_TOTAL',$4)",
        [tenantId, paymentId, orderId, amount],
      );
      await db.query(
        `INSERT INTO invoices(
          tenant_id,branch_id,pos_order_id,invoice_number,status,currency,subtotal_minor,discount_minor,
          taxable_minor,tax_minor,total_minor,tip_minor,paid_minor,customer_snapshot_json,
          branch_snapshot_json,tax_snapshot_json,issued_at,issued_by_user_id)
         VALUES($1,$2,$3,$4,'ISSUED','VND',$5,0,0,0,$5,0,$5,'{}','{}','{}',now(),$6)`,
        [tenantId, branch, orderId, `E2E-RECON-${paymentId}`, amount, cashier],
      );
    }

    const response = await accountant.api.get(
      `/v1/financial/reconciliation/daily?branchId=${branch}&registerId=${register}&cashierUserId=${cashier}`,
      { headers: headers(accountant) },
    );
    expect(response.status()).toBe(200);
    const report = (await response.json()).data;
    expect(report.filters.cashierSemantics).toBe("PAYMENT_CAPTURE_ACTOR");
    expect(report.paymentMix.CASH.amountMinor).toBeGreaterThanOrEqual(10_000);
    expect(report.paymentMix.CARD_EXTERNAL.amountMinor).toBeGreaterThanOrEqual(20_000);
    expect(report.paymentMix.BANK_TRANSFER.amountMinor).toBeGreaterThanOrEqual(
      25_000,
    );
    const mix = Object.values(
      report.paymentMix as Record<string, { amountMinor: number }>,
    ).reduce(
      (sum, row) => sum + Number(row.amountMinor),
      0,
    );
    expect(mix).toBe(report.totalCollectedMinor);
    expect(report.serviceCollectedMinor + report.tipCollectedMinor).toBe(
      report.totalCollectedMinor,
    );
  } finally {
    await close(accountant);
    await db.end();
  }
});
