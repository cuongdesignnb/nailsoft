const { createHash, createHmac } = require("node:crypto");
const { Client } = require("pg");

const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000015";
const appointmentId = "70000000-0000-4000-8000-000000000035";
const invoiceId = "e2000000-0000-4000-8000-000000000001";
const reviewRequestId = "e3000000-0000-4000-8000-000000000002";
const secret = process.env.COMMUNICATION_TOKEN_SECRET || process.env.JWT_SECRET || "local-qa-secret-please-change-32-characters";

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

(async () => {
  const expiresAt = new Date(Date.now() + 14 * 86400_000);
  const token = sign({
    tenantId,
    reviewRequestId,
    customerId,
    purpose: "REVIEW",
    exp: Math.floor(expiresAt.getTime() / 1000),
  });
  const client = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://nailsoft:nailsoft@localhost:55432/nailsoft" });
  await client.connect();
  await client.query(
    `INSERT INTO review_requests(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,token_hash,expires_at,status,generation_key,sent_at,due_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SENT',$9,now(),now())
     ON CONFLICT (tenant_id,id) DO NOTHING`,
    [reviewRequestId, tenantId, branchId, customerId, appointmentId, invoiceId, createHash("sha256").update(token).digest("hex"), expiresAt, "qa.visual.review.e300000000000000000000000000000002"],
  );
  await client.end();
  console.log(JSON.stringify({ reviewRequestId, token, expiresAt: expiresAt.toISOString() }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
