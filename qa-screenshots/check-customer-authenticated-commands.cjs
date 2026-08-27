const { chromium } = require("@playwright/test");

const adminBaseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.CUSTOMER_QA_EMAIL || "qa.customer1@example.test";
const password = process.env.CUSTOMER_QA_PASSWORD || "CustomerPass123!";

async function signIn(page) {
  await page.goto(`${adminBaseUrl}/auth/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15_000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  await signIn(page);

  await page.goto(`${adminBaseUrl}/customer/preferences`, { waitUntil: "networkidle" });
  await page.locator(".customer-public-form").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByText("Thay đổi đã được lưu.").waitFor({ timeout: 15_000 });

  await page.goto(`${adminBaseUrl}/customer/consents`, { waitUntil: "networkidle" });
  await page.locator(".customer-public-consent-list").waitFor({ timeout: 15_000 });
  const marketing = page.locator("article").filter({ hasText: "Email marketing" });
  await marketing.getByRole("button", { name: "Cho phép" }).click();
  await marketing.getByText("Đã đồng ý").waitFor({ timeout: 15_000 });
  await marketing.getByRole("button", { name: "Rút lại" }).click();
  await marketing.getByText("Đã rút lại").waitFor({ timeout: 15_000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".customer-public-consent-list").waitFor({ timeout: 15_000 });
  await page.locator("article").filter({ hasText: "Email marketing" }).getByText("Đã rút lại").waitFor({ timeout: 15_000 });

  await browser.close();
  console.log(JSON.stringify({ preferenceUpdate: "persisted", consentGrant: "persisted", consentWithdraw: "persisted", finalState: "withdrawn" }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
