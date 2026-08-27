const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const baseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.ADMIN_QA_EMAIL || "owner@example.test";
const password = process.env.ADMIN_QA_PASSWORD || "DemoPass123!";
const routes = [
  ["gift-cards", "/admin/gift-cards"],
  ["customer-credit", "/admin/customer-credit"],
  ["customer-care", "/admin/customer-care"],
  ["marketing-campaigns", "/admin/marketing/campaigns"],
];
const viewports = [
  ["desktop-1440", { width: 1440, height: 900 }],
  ["desktop-1280", { width: 1280, height: 800 }],
  ["tablet-768", { width: 768, height: 1024 }],
  ["mobile-390", { width: 390, height: 844 }],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/admin\/dashboard$/, { timeout: 15_000 });
  const results = [];
  for (const [key, route] of routes) {
    for (const [viewportName, viewport] of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
      await page.locator("h1").first().waitFor({ timeout: 15_000 });
      const axe = await new AxeBuilder({ page }).analyze();
      const layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth, bodyWidth: document.body.scrollWidth }));
      results.push({ key, route, viewport: viewportName, violations: axe.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) })), layout });
    }
  }
  await browser.close();
  console.log(JSON.stringify({ routes: results }, null, 2));
  if (results.some((item) => item.violations.length || item.layout.documentWidth !== item.layout.viewportWidth || item.layout.bodyWidth !== item.layout.viewportWidth)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
