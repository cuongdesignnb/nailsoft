const { createHash, createHmac, randomUUID } = require("node:crypto");
const { chromium } = require("@playwright/test");
const { Client } = require("pg");

const adminBaseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const secret = process.env.COMMUNICATION_TOKEN_SECRET || process.env.JWT_SECRET || "local-qa-secret-please-change-32-characters";
const tenantId = "10000000-0000-4000-8000-000000000001";
const customerId = "60000000-0000-4000-8000-000000000015";
const branchId = "20000000-0000-4000-8000-000000000001";
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
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function seedReviewToken() {
  const reviewRequestId = randomUUID();
  const expiresAt = new Date(Date.now() + 14 * 86400_000);
  const token = sign({
    tenantId,
    reviewRequestId,
    customerId,
    purpose: "REVIEW",
    exp: Math.floor((Date.now() + 14 * 86400_000) / 1000),
  });
  const client = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://nailsoft:nailsoft@localhost:55432/nailsoft" });
  await client.connect();
  await client.query(
    `INSERT INTO review_requests(id,tenant_id,branch_id,customer_id,appointment_id,invoice_id,token_hash,expires_at,status,generation_key,sent_at,due_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SENT',$9,now(),now())`,
    [reviewRequestId, tenantId, branchId, customerId, appointmentId, invoiceId, createHash("sha256").update(token).digest("hex"), expiresAt, `qa.visual.review.${reviewRequestId}`],
  );
  await client.end();
  return token;
}

function unsubscribeToken() {
  return sign({
    tenantId,
    customerId: "60000000-0000-4000-8000-000000000001",
    purpose: "MARKETING_EMAIL",
    exp: Math.floor((Date.now() + 14 * 86400_000) / 1000),
  });
}

async function waitForReview(page, token) {
  await page.goto(`${adminBaseUrl}/public/review?token=${encodeURIComponent(token)}`, { waitUntil: "networkidle" });
  await page.locator("#customer-public-title").waitFor();
  await page.getByText("Lời mời đánh giá đã được xác minh").waitFor();
}

async function captureViewports(page, directory, waitForText) {
  for (const [name, viewport] of viewports) {
    await page.setViewportSize(viewport);
    if (waitForText) await page.getByText(waitForText).first().waitFor();
    await page.screenshot({ path: `artifacts/ui-completion/${directory}/${name}.png`, fullPage: true });
  }
}

(async () => {
  const skipReview = process.env.SKIP_REVIEW === "1";
  const skipReviewSubmit = process.env.SKIP_REVIEW_SUBMIT === "1";
  const token = skipReview ? null : (process.env.REVIEW_TOKEN || await seedReviewToken());
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();

  if (!skipReview) {
    await waitForReview(page, token);
    await captureViewports(page, "customer-public-review-valid", "Lời mời đánh giá đã được xác minh");
    if (!skipReviewSubmit) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByLabel("Chia sẻ thêm (không bắt buộc)").fill("QA review state captured from the signed public flow.");
      await page.getByRole("button", { name: "Gửi đánh giá" }).click();
      await page.getByText("Cảm ơn bạn đã chia sẻ").waitFor();
      await captureViewports(page, "customer-public-review-success", "Cảm ơn bạn đã chia sẻ");
    }
  }

  await page.goto(`${adminBaseUrl}/public/unsubscribe?token=${encodeURIComponent(unsubscribeToken())}`, { waitUntil: "networkidle" });
  await page.locator("#customer-public-title").waitFor();
  await page.getByRole("button", { name: "Xác nhận không nhận email marketing" }).waitFor();
  await captureViewports(page, "customer-public-unsubscribe-valid", "Xác nhận không nhận email marketing");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Xác nhận không nhận email marketing" }).click();
  await page.getByRole("heading", { name: "Đã tiếp nhận yêu cầu" }).waitFor();
  await captureViewports(page, "customer-public-unsubscribe-success", "Đã tiếp nhận yêu cầu");

  await browser.close();
  console.log(JSON.stringify({ review: "valid+success", unsubscribe: "valid+success" }));
})().catch(async (error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
