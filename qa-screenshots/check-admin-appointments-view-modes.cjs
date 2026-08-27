const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const baseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.ADMIN_QA_EMAIL || "owner@example.test";
const password = process.env.ADMIN_QA_PASSWORD || "DemoPass123!";
const cases = [
  ["day", "?view=day", { width: 1440, height: 900 }],
  ["week", "?view=week", { width: 1440, height: 900 }],
  ["week-mobile", "?view=week", { width: 390, height: 844 }],
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
  for (const [name, query, viewport] of cases) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseUrl}/admin/appointments${query}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Quản lý lịch hẹn", exact: true }).waitFor({ timeout: 15_000 });
    const axe = await new AxeBuilder({ page }).analyze();
    const layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth, bodyWidth: document.body.scrollWidth }));
    results.push({ name, violations: axe.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) })), layout });
  }
  await browser.close();
  console.log(JSON.stringify({ route: "/admin/appointments", viewModes: results }));
  if (results.some((item) => item.violations.length || item.layout.documentWidth !== item.layout.viewportWidth || item.layout.bodyWidth !== item.layout.viewportWidth)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
