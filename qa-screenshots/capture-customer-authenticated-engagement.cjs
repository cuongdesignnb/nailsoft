const { chromium } = require("@playwright/test");

const adminBaseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.CUSTOMER_QA_EMAIL || "qa.customer1@example.test";
const password = process.env.CUSTOMER_QA_PASSWORD || "CustomerPass123!";
const viewports = [
  ["desktop-1440", { width: 1440, height: 900 }],
  ["desktop-1280", { width: 1280, height: 800 }],
  ["tablet-768", { width: 768, height: 1024 }],
  ["mobile-390", { width: 390, height: 844 }],
];

async function signIn(page) {
  await page.goto(`${adminBaseUrl}/auth/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15_000 });
}

async function capture(page, mode, readySelector) {
  await page.goto(`${adminBaseUrl}/customer/${mode}`, { waitUntil: "networkidle" });
  await page.locator(readySelector).waitFor({ timeout: 15_000 });
  if (await page.locator(".customer-public-state-error").count()) {
    throw new Error(`${mode} rendered an error state: ${(await page.locator(".customer-public-state-error").innerText()).slice(0, 500)}`);
  }
  for (const [name, viewport] of viewports) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `artifacts/ui-completion/customer-${mode}/${name}.png`, fullPage: true });
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  await signIn(page);
  await capture(page, "preferences", ".customer-public-form");
  await capture(page, "consents", ".customer-public-consent-list");
  await browser.close();
  console.log(JSON.stringify({ preferences: "authenticated", consents: "authenticated" }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
