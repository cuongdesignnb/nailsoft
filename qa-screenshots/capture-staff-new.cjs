const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const adminBaseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.ADMIN_QA_EMAIL || "owner@example.test";
const password = process.env.ADMIN_QA_PASSWORD || "DemoPass123!";
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  await signIn(page);
  const results = [];
  for (const [name, viewport] of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${adminBaseUrl}/admin/staff/new`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Tạo hồ sơ nhân sự" }).waitFor({ timeout: 15_000 });
    const axe = await new AxeBuilder({ page }).analyze();
    const layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth, bodyWidth: document.body.scrollWidth }));
    results.push({ name, violations: axe.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) })), layout });
    await page.screenshot({ path: `artifacts/ui-completion/admin-staff-new/${name}.png`, fullPage: true });
  }
  await browser.close();
  console.log(JSON.stringify({ route: "/admin/staff/new", viewports: results }));
  if (results.some((item) => item.violations.length || item.layout.documentWidth !== item.layout.viewportWidth || item.layout.bodyWidth !== item.layout.viewportWidth)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
