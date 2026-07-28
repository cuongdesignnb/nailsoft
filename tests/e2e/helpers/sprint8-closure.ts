import { expect } from "@playwright/test";
import pg from "pg";
import { close, headers, login, type Session } from "./api-client";

export const orderId = "a4000000-0000-4000-8000-000000000001";
export const firstLineId = "a5000000-0000-4000-8000-000000000001";
export const secondLineId = "cf800000-0000-4000-8000-000000000001";
export const customerId = "60000000-0000-4000-8000-000000000008";
export const serviceId = "50000000-0000-4000-8000-000000000008";
const tenant = "10000000-0000-4000-8000-000000000001";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://nailsoft:nailsoft@localhost:5432/nailsoft",
});

export async function closeClosureDb() {
  await pool.end();
}

export async function getOrder(owner: Session) {
  const response = await owner.api.get(`/v1/pos-orders/${orderId}`, {
    headers: headers(owner),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

export async function addSecondServiceLine(
  owner: Session,
  amountMinor: number,
) {
  await pool.query(
    `INSERT INTO pos_order_lines(
       id,tenant_id,pos_order_id,line_no,line_type,service_id,description_snapshot_json,
       quantity,unit_price_minor,gross_minor,taxable_minor,tax_minor,net_minor)
     VALUES($1,$2,$3,2,'SERVICE',$4,'{"en-US":"Closure service line"}',1,$5,$5,$5,0,$5)`,
    [secondLineId, tenant, orderId, serviceId, amountMinor],
  );
  const current = await getOrder(owner);
  const response = await owner.api.post(
    `/v1/pos-orders/${orderId}/recalculate`,
    {
      headers: headers(owner, "s8-close-recalculate"),
      data: { version: current.version },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

export async function createPackage(owner: Session, grantedUnits: number) {
  const created = await owner.api.post("/v1/service-packages", {
    headers: headers(owner, "s8-close-package-create"),
    data: {
      code: `CLOSE-PACKAGE-${grantedUnits}`,
      name: { "en-US": "Closure Package" },
      description: {},
      grantedUnits,
      unitsPerRedemption: 1,
      priceMinor: 100000,
      currency: "VND",
      validityDays: 30,
      refundPolicy: "RESTORE_UNIT",
      policy: { closure: true },
      eligibility: [{ serviceId, unitsPerRedemption: 1 }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()).data;
  const activated = await owner.api.post(
    `/v1/service-packages/${product.id}/activate`,
    {
      headers: headers(owner, "s8-close-package-activate"),
      data: { version: product.version, reason: "Closure lifecycle" },
    },
  );
  expect(activated.status()).toBe(201);
  const issued = await owner.api.post(
    `/v1/customers/${customerId}/packages/issue`,
    {
      headers: headers(owner, "s8-close-package-issue"),
      data: {
        packageProductId: product.id,
        generationKey: `s8-close-issue-${grantedUnits}`,
      },
    },
  );
  expect(issued.status()).toBe(201);
  return (await issued.json()).data;
}

export async function applyPackage(
  owner: Session,
  entitlementId: string,
  lineId: string,
  key: string,
) {
  const current = await getOrder(owner);
  const response = await owner.api.post(
    `/v1/pos-orders/${orderId}/benefits/package`,
    {
      headers: headers(owner, key),
      data: {
        version: current.version,
        entitlementId,
        orderLineId: lineId,
        units: 1,
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

export async function finalizeAndPay(owner: Session) {
  const current = await getOrder(owner);
  const finalizedResponse = await owner.api.post(
    `/v1/pos-orders/${orderId}/finalize`,
    {
      headers: headers(owner, "s8-close-finalize"),
      data: { version: current.version },
    },
  );
  expect(finalizedResponse.status()).toBe(201);
  let order = (await finalizedResponse.json()).data;
  if (order.amountDueMinor > 0) {
    const paid = await owner.api.post(`/v1/pos-orders/${orderId}/payments`, {
      headers: headers(owner, "s8-close-payment"),
      data: {
        version: order.version,
        amountToApplyMinor: order.amountDueMinor,
        tenderType: "CARD_EXTERNAL",
        provider: "E2E_CLOSURE",
        providerTransactionId: `s8-close-${Date.now()}`,
        cardLast4: "4242",
      },
    });
    expect(paid.status()).toBe(201);
    order = (await paid.json()).data;
  }
  expect(order.status).toBe("PAID");
  return order;
}

export async function refundLine(
  owner: Session,
  order: any,
  sourceOrderLineId: string,
  amountMinor: number,
) {
  const invoiceResponse = await owner.api.get(
    `/v1/invoices/${order.invoice.id}`,
    {
      headers: headers(owner),
    },
  );
  expect(invoiceResponse.status()).toBe(200);
  const invoice = (await invoiceResponse.json()).data;
  const line = await dbRow<{ id: string }>(
    "SELECT id FROM invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 AND source_order_line_id=$3",
    [tenant, invoice.id, sourceOrderLineId],
  );
  expect(line).toBeTruthy();
  const payment = order.payments[0];
  expect(payment).toBeTruthy();
  const created = await owner.api.post(`/v1/invoices/${invoice.id}/refunds`, {
    headers: headers(owner, "s8-close-refund-create"),
    data: {
      items: [{ invoiceLineId: line.id, amountMinor }],
      tipAmountMinor: 0,
      paymentPreferences: [{ paymentId: payment.id, amountMinor }],
      reasonCode: "SPRINT8_CLOSURE",
      reasonText: "Authenticated benefit reversal lifecycle",
    },
  });
  expect(created.status()).toBe(201);
  let refund = (await created.json()).data;
  const submitted = await owner.api.post(`/v1/refunds/${refund.id}/submit`, {
    headers: headers(owner, "s8-close-refund-submit"),
    data: { version: refund.version },
  });
  expect(submitted.status()).toBe(201);
  refund = (await submitted.json()).data;
  const manager = await login("staff2@example.test");
  try {
    const approved = await manager.api.post(
      `/v1/refunds/${refund.id}/approve`,
      {
        headers: headers(manager, "s8-close-refund-approve"),
        data: {
          version: refund.version,
          reason: "Independent closure approval",
        },
      },
    );
    expect(approved.status()).toBe(201);
    refund = (await approved.json()).data;
  } finally {
    await close(manager);
  }
  const executed = await owner.api.post(
    `/v1/refunds/${refund.id}/execute-external`,
    {
      headers: headers(owner, "s8-close-refund-execute"),
      data: {
        version: refund.version,
        provider: "E2E_CLOSURE",
        providerRefundId: `s8-refund-${Date.now()}`,
        processedAt: new Date().toISOString(),
        evidenceNote: "Provider-confirmed closure refund",
      },
    },
  );
  expect(executed.status()).toBe(201);
  refund = (await executed.json()).data;
  expect(refund.status).toBe("COMPLETED");
  return refund;
}

export async function setupLoyalty(points = 1000) {
  const program = (
    await pool.query(
      "SELECT id FROM loyalty_programs WHERE tenant_id=$1 AND status='ACTIVE' LIMIT 1",
      [tenant],
    )
  ).rows[0].id;
  const ledger = "cf800000-0000-4000-8000-000000000010";
  await pool.query(
    `INSERT INTO loyalty_accounts(id,tenant_id,customer_id,available_points,lifetime_earned_points)
     VALUES('cf800000-0000-4000-8000-000000000011',$1,$2,$3,$3)`,
    [tenant, customerId, points],
  );
  await pool.query(
    `INSERT INTO loyalty_ledger_entries(id,tenant_id,account_id,customer_id,program_id,entry_type,available_delta,lifetime_delta,policy_snapshot_json,generation_key)
     VALUES($1,$2,'cf800000-0000-4000-8000-000000000011',$3,$4,'MIGRATION',$5,$5,'{}','s8-close-loyalty-opening')`,
    [ledger, tenant, customerId, program, points],
  );
  await pool.query(
    `INSERT INTO loyalty_point_lots(tenant_id,account_id,source_ledger_entry_id,original_points,available_points,expires_at)
     VALUES($1,'cf800000-0000-4000-8000-000000000011',$2,$3,$3,now()+interval '1 year')`,
    [tenant, ledger, points],
  );
}

export async function dbRow<T = any>(sql: string, values: unknown[] = []) {
  return (await pool.query<T & pg.QueryResultRow>(sql, values)).rows[0];
}

export async function dbRows<T = any>(sql: string, values: unknown[] = []) {
  return (await pool.query<T & pg.QueryResultRow>(sql, values)).rows;
}
