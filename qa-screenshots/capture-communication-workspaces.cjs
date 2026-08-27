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
const routes = [
  { path: "/admin/communications/templates", heading: "Mẫu Email", dir: "admin-communication-templates" },
  { path: "/admin/communications/rules", heading: "Quy tắc gửi", dir: "admin-communications-rules" },
  { path: "/admin/communications/messages", heading: "Giao nhận Email", dir: "admin-communications-messages" },
  { path: "/admin/communications/suppressions", heading: "Danh sách Email bị chặn", dir: "admin-communication-suppressions" },
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
  for (const route of routes) {
    for (const [name, viewport] of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${adminBaseUrl}${route.path}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: route.heading, exact: true }).first().waitFor({ timeout: 15_000 });
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
        legacyEnglishVisible: bodyText.includes("Message delivery") || bodyText.includes("Contact suppressions") || bodyText.includes("Communication templates"),
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
