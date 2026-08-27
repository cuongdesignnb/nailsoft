const { createHash, createHmac, randomUUID } = require("node:crypto");
const { Client } = require("pg");

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000015";
const secret = process.env.COMMUNICATION_TOKEN_SECRET || process.env.JWT_SECRET || "local-qa-secret-please-change-32-characters";

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

(async () => {
  const appointmentId = randomUUID();
  const orderId = randomUUID();
  const invoiceId = randomUUID();
  const reviewRequestId = randomUUID();
  const suffix = appointmentId.replaceAll("-", "").slice(0, 8).toUpperCase();
  const bookingReference = `QA-${suffix}`;
  const orderNumber = `QA-ORDER-${suffix}`;
  const invoiceNumber = `QA-INV-${suffix}`;
  const userId = "30000000-0000-4000-8000-000000000001";
  const expiresAt = new Date(Date.now() + 14 * 86400_000);
  const token = sign({ tenantId, reviewRequestId, customerId, purpose: "REVIEW", exp: Math.floor(expiresAt.getTime() / 1000) });
  const startAt = new Date(Date.now() - 2 * 86400_000);
  const endAt = new Date(startAt.getTime() + 60 * 60_000);
  const client = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://nailsoft:nailsoft@localhost:55432/nailsoft" });
  await client.connect();
  try {
    await client.query("BEGIN");
    const register = (await client.query("SELECT id FROM pos_registers WHERE tenant_id=$1 ORDER BY id LIMIT 1", [tenantId])).rows[0];
    if (!register) throw new Error("QA register not found");
    await client.query(
      `INSERT INTO appointments(id,tenant_id,branch_id,customer_id,status,start_at,end_at,booking_reference,source,locale,timezone,contact_snapshot_json,policy_snapshot_json,pricing_summary_json,deposit_required_minor,deposit_status,confirmed_at,created_by_user_id,updated_by_user_id)
       VALUES($1,$2,$3,$4,'COMPLETED',$5,$6,$7,'API','vi-VN','Asia/Ho_Chi_Minh',$8::jsonb,$9::jsonb,$10::jsonb,0,'NOT_REQUIRED',$5,$11,$11)`,
      [appointmentId, tenantId, branchId, customerId, startAt, endAt, bookingReference, JSON.stringify({ email: "customer15@example.test", phone: "+84900000015" }), JSON.stringify({ source: "QA_VISUAL" }), JSON.stringify({ currency: "VND", totalMinor: 100000 }), userId],
    );
    await client.query(
      `INSERT INTO pos_orders(id,tenant_id,branch_id,register_id,appointment_id,customer_id,order_number,source,status,currency,subtotal_minor,taxable_minor,total_minor,amount_paid_minor,amount_due_minor,pricing_snapshot_json,tax_snapshot_json,customer_snapshot_json,pricing_locked_at,finalized_at,paid_at,created_by_user_id,updated_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,'APPOINTMENT','PAID','VND',100000,100000,100000,100000,0,'{}'::jsonb,'{}'::jsonb,$8::jsonb,$9,$9,$9,$10,$10)`,
      [orderId, tenantId, branchId, register.id, appointmentId, customerId, orderNumber, JSON.stringify({ displayName: "QA review customer" }), startAt, userId],
    );
    await client.query(
      `INSERT INTO invoices(id,tenant_id,branch_id,pos_order_id,invoice_number,status,currency,subtotal_minor,discount_minor,taxable_minor,tax_minor,total_minor,tip_minor,paid_minor,issued_at,issued_by_user_id,customer_snapshot_json,branch_snapshot_json,tax_snapshot_json)
       VALUES($1,$2,$3,$4,$5,'ISSUED','VND',100000,0,100000,0,100000,0,100000,$6,$7,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb)`,
      [invoiceId, tenantId, branchId, orderId, invoiceNumber, startAt, userId],
    );
    await client.query(
      `INSERT INTO review_requests(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,token_hash,expires_at,status,generation_key,sent_at,due_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SENT',$9,now(),now())`,
      [reviewRequestId, tenantId, branchId, customerId, appointmentId, invoiceId, createHash("sha256").update(token).digest("hex"), expiresAt, `qa.visual.review.success.${reviewRequestId}`],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify({ token, bookingReference, appointmentId, invoiceId }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
