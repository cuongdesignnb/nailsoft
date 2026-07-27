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
  const orderId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  try {
    await db.query(
      `INSERT INTO pos_orders(
        id,tenant_id,branch_id,register_id,order_number,source,status,currency,subtotal_minor,
        taxable_minor,total_minor,amount_paid_minor,amount_due_minor,pricing_snapshot_json,
        tax_snapshot_json,customer_snapshot_json,pricing_locked_at,finalized_at,paid_at,
        created_by_user_id,updated_by_user_id)
       VALUES($1,$2,$3,$4,$5,'MANUAL','PAID','VND',25000,0,25000,25000,0,'{}','{}','{}',now(),now(),now(),$6,$6)`,
      [orderId, tenantId, branch, register, `E2E-RECON-${Date.now()}`, cashier],
    );
    await db.query(
      `INSERT INTO payments(
        id,tenant_id,branch_id,register_id,pos_order_id,payment_reference,tender_type,status,currency,
        requested_minor,captured_minor,provider,provider_transaction_id,idempotency_key_hash,
        request_hash,created_by_user_id,captured_at)
       VALUES($1,$2,$3,$4,$5,$6,'BANK_TRANSFER','CAPTURED','VND',25000,25000,'bank-transfer',$7,'e2e','e2e',$8,now())`,
      [
        paymentId,
        tenantId,
        branch,
        register,
        orderId,
        `PAY-${paymentId}`,
        `BANK-${paymentId}`,
        cashier,
      ],
    );
    await db.query(
      "INSERT INTO payment_allocations(tenant_id,payment_id,pos_order_id,allocation_type,amount_minor) VALUES($1,$2,$3,'ORDER_TOTAL',25000)",
      [tenantId, paymentId, orderId],
    );
    await db.query(
      `INSERT INTO invoices(
        tenant_id,branch_id,pos_order_id,invoice_number,status,currency,subtotal_minor,discount_minor,
        taxable_minor,tax_minor,total_minor,tip_minor,paid_minor,customer_snapshot_json,
        branch_snapshot_json,tax_snapshot_json,issued_at,issued_by_user_id)
       VALUES($1,$2,$3,$4,'ISSUED','VND',25000,0,0,0,25000,0,25000,'{}','{}','{}',now(),$5)`,
      [tenantId, branch, orderId, `E2E-${paymentId}`, cashier],
    );

    const response = await accountant.api.get(
      `/v1/financial/reconciliation/daily?branchId=${branch}&registerId=${register}&cashierUserId=${cashier}`,
      { headers: headers(accountant) },
    );
    expect(response.status()).toBe(200);
    const report = (await response.json()).data;
    expect(report.filters.cashierSemantics).toBe("PAYMENT_CAPTURE_ACTOR");
    expect(report.paymentMix.CASH.amountMinor).toBeGreaterThan(0);
    expect(report.paymentMix.CARD_EXTERNAL.amountMinor).toBeGreaterThan(0);
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
