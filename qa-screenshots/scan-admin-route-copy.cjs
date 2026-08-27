const fs = require("fs");
const { chromium } = require("@playwright/test");

const baseUrl = process.env.ADMIN_WEB_URL || "http://127.0.0.1:3000";
const email = process.env.ADMIN_QA_EMAIL || "owner@example.test";
const password = process.env.ADMIN_QA_PASSWORD || "DemoPass123!";
const inventoryPath = "docs/agent/ADMIN_ROUTE_INVENTORY.md";
const replacementId = "60000000-0000-4000-8000-000000000001";
const legacySignals = [
  "Benefits workspace",
  "Campaigns, hashed codes and usage limits.",
  "Versioned tiers and effective assignments.",
  "Resource ID",
  "Workspace access required",
  "The request could not be completed.",
];
const englishUiSignals = [
  /\bSign in\b/i,
  /\bLoading\b/i,
  /\bPermission denied\b/i,
  /\bUnable to\b/i,
  /\bRequest failed\b/i,
  /\bRefresh\b/i,
  /\bRetry\b/i,
  /\bCreate (?:staff|vendor|purchase|service|campaign|new)/i,
  /\bOpen (?:wallet|customer|detail|report)/i,
  /\bApply (?:package|membership|voucher|points)/i,
  /\bApprove\b|\bReject\b|\bCancel\b/i,
  /\bSaved successfully\b/i,
  /\bVersion conflict\b/i,
  /\bNo active\b|\bNo (?:staff|skills|leave|branch|resource|team)/i,
  /\bService catalog\b|\bVoucher campaigns\b|\bVoucher codes\b/i,
  /\bMembership tiers\b|\bLoyalty programs\b|\bPackage entitlements\b/i,
  /\bInvoice detail\b|\bPayment operations\b|\bPlatform billing\b/i,
  /\bSelect workspace\b|\bTry again\b|\bDashboard\b/i,
];

function inventoryRoutes() {
  const source = fs.readFileSync(inventoryPath, "utf8");
  return [...source.matchAll(/\|\s+\d+\s+\|\s+(\/(?:admin|platform)\/[^|]+?)\s+\|/g)]
    .map((match) => match[1].trim().replace(/:[^/]+/g, replacementId))
    .filter((route) => !route.includes("and "))
    .filter((route, index, routes) => routes.indexOf(route) === index);
}

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
  const findings = [];
  for (const route of inventoryRoutes()) {
    try {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(700);
      const bodyText = await page.locator("body").innerText();
      const h1 = (await page.locator("h1").allTextContents()).map((value) => value.trim()).filter(Boolean);
      const copyText = (await page.locator("h1,h2,h3,button,label,.eyebrow,.hint,.topbar,.title-row").allTextContents()).join("\n");
      const signals = legacySignals.filter((signal) => bodyText.includes(signal));
      const englishSignals = englishUiSignals.filter((signal) => signal.test(copyText));
      if (signals.length || englishSignals.length) findings.push({ route, h1, signals, englishSignals: englishSignals.map(String), copy: copyText.slice(0, 1200) });
    } catch (error) {
      findings.push({ route, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await browser.close();
  console.log(JSON.stringify({ scanned: inventoryRoutes().length, findings }, null, 2));
  if (findings.some((item) => item.signals?.length || item.englishSignals?.length)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
