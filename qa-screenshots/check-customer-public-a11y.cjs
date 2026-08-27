const { createHash, createHmac, randomUUID } = require("node:crypto");
const { chromium } = require("@playwright/test");
const { Client } = require("pg");
const AxeBuilder = require("@axe-core/playwright").default;

const adminBaseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const secret = process.env.COMMUNICATION_TOKEN_SECRET || process.env.JWT_SECRET || "local-qa-secret-please-change-32-characters";
const tenantId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000015";
const appointmentId = "70000000-0000-4000-8000-000000000035";
const invoiceId = "e2000000-0000-4000-8000-000000000001";
const viewports = [
  ["desktop-1440", { width: 1440, height: 900 }],
  ["desktop-1280", { width: 1280, height: 800 }],
  ["tablet-768", { width: 768, height: 1024 }],
  ["mobile-390", { width: 390, height: 844 }],
];

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

async function seedReviewToken() {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 14 * 86400_000);
  const token = sign({ tenantId, reviewRequestId: id, customerId, purpose: "REVIEW", exp: Math.floor(expiresAt.getTime() / 1000) });
  const client = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://nailsoft:nailsoft@localhost:55432/nailsoft" });
  await client.connect();
  await client.query(
    `INSERT INTO review_requests(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,token_hash,expires_at,status,generation_key,sent_at,due_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SENT',$9,now(),now())`,
    [id, tenantId, branchId, customerId, appointmentId, invoiceId, createHash("sha256").update(token).digest("hex"), expiresAt, `qa.visual.a11y.${id}`],
  );
  await client.end();
  return token;
}

async function inspect(page, label) {
  const axe = await new AxeBuilder({ page }).analyze();
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  return { label, violations: axe.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) })), layout };
}

(async () => {
  const checkReviewSuccess = process.env.CHECK_REVIEW_SUCCESS === "1";
  const review = process.env.REVIEW_TOKEN || await seedReviewToken();
  const unsubscribe = sign({ tenantId, customerId: "60000000-0000-4000-8000-000000000001", purpose: "MARKETING_EMAIL", exp: Math.floor((Date.now() + 14 * 86400_000) / 1000) });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  const results = [];

  for (const [name, viewport] of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${adminBaseUrl}/public/review?token=${encodeURIComponent(review)}`, { waitUntil: "networkidle" });
    await page.getByText("Lời mời đánh giá đã được xác minh").waitFor();
    results.push(await inspect(page, `review-valid:${name}`));
    await page.goto(`${adminBaseUrl}/public/unsubscribe?token=${encodeURIComponent(unsubscribe)}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Xác nhận không nhận email marketing" }).waitFor();
    results.push(await inspect(page, `unsubscribe-valid:${name}`));
  }

  if (checkReviewSuccess) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${adminBaseUrl}/public/review?token=${encodeURIComponent(review)}`, { waitUntil: "networkidle" });
    await page.getByText("Lời mời đánh giá đã được xác minh").waitFor();
    await page.getByLabel("Chia sẻ thêm (không bắt buộc)").fill("QA accessibility review success state.");
    await page.getByRole("button", { name: "Gửi đánh giá" }).click();
    await page.getByRole("heading", { name: "Cảm ơn bạn đã chia sẻ" }).waitFor();
    for (const [name, viewport] of viewports) {
      await page.setViewportSize(viewport);
      results.push(await inspect(page, `review-success:${name}`));
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${adminBaseUrl}/public/unsubscribe?token=${encodeURIComponent(unsubscribe)}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Xác nhận không nhận email marketing" }).click();
  await page.getByRole("heading", { name: "Đã tiếp nhận yêu cầu" }).waitFor();
  for (const [name, viewport] of viewports) {
    await page.setViewportSize(viewport);
    results.push(await inspect(page, `unsubscribe-success:${name}`));
  }

  await browser.close();
  console.log(JSON.stringify(results));
  if (results.some((item) => item.violations.length || item.layout.documentWidth !== item.layout.viewportWidth || item.layout.bodyWidth !== item.layout.viewportWidth)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
