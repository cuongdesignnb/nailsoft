const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const baseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.ADMIN_QA_EMAIL || "owner@example.test";
const password = process.env.ADMIN_QA_PASSWORD || "DemoPass123!";
const viewports = [
  ["desktop-1440", { width: 1440, height: 900 }],
  ["desktop-1280", { width: 1280, height: 800 }],
  ["tablet-768", { width: 768, height: 1024 }],
  ["mobile-390", { width: 390, height: 844 }],
];
const routes = [
  { path: "/admin/benefits/customers", heading: "Quyền lợi khách hàng", dir: "admin-benefits-customers" },
  { path: "/admin/membership/customers", heading: "Membership & Hạng thành viên", dir: "admin-membership-customers" },
];

async function signIn(page) {
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: "networkidle" });
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
  for (const route of routes) {
    for (const [name, viewport] of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: route.heading, exact: true }).waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      const axe = await new AxeBuilder({ page }).analyze();
      const layout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      const bodyText = await page.locator("body").innerText();
      results.push({
        route: route.path,
        name,
        legacyEnglishVisible: ["Benefits workspace", "Campaigns, hashed codes and usage limits.", "Versioned tiers and effective assignments."].some((value) => bodyText.includes(value)),
        violations: axe.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) })),
        layout,
      });
      await page.screenshot({ path: `artifacts/ui-completion/${route.dir}/${name}.png`, fullPage: true });
    }
  }
  await browser.close();
  console.log(JSON.stringify({ routes: results }));
  if (results.some((item) => item.legacyEnglishVisible || item.violations.length || item.layout.documentWidth !== item.layout.viewportWidth || item.layout.bodyWidth !== item.layout.viewportWidth)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
