const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const viewports = [
  ["desktop-1440", 1440, 900],
  ["desktop-1280", 1280, 800],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
];

async function inspect(page, state, selector) {
  const results = [];
  await page.locator(selector).waitFor();
  for (const [name, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const axe = await new AxeBuilder({ page }).analyze();
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll("*")]
        .filter((element) => element.scrollWidth > element.clientWidth + 1 && !element.classList.contains("sr-only"))
        .slice(0, 8)
        .map((element) => ({ tag: element.tagName, id: element.id, className: String(element.className), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })),
    }));
    results.push({ state, viewport: name, violations: axe.violations.map((violation) => ({ id: violation.id, impact: violation.impact, html: violation.nodes[0]?.html })), layout });
  }
  return results;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3002/book/nailsoft-demo", { waitUntil: "networkidle" });
  await page.locator("#booking-title").waitFor();
  await page.getByRole("button", { name: /Quận 1/ }).click();
  await page.locator("#services-heading").waitFor();
  await page.locator("button.choice-card").first().click();
  await page.locator("#booking-date").fill("2026-09-03");
  await page.getByRole("button", { name: /Tìm giờ trống/ }).click();
  await page.locator("#availability-heading").waitFor();
  await page.locator("button.slot").first().click();
  const results = [];
  results.push(...(await inspect(page, "CONTACT", "#contact-heading")));
  await page.locator("#contact-name").fill("QA Accessibility Booking");
  await page.locator("#contact-phone").fill("0900000095");
  await page.locator("#contact-email").fill("qa.a11y@example.test");
  await page.getByRole("button", { name: /Gửi mã xác minh/ }).click();
  await page.locator("#otp-heading").waitFor();
  results.push(...(await inspect(page, "OTP", "#otp-heading")));
  await page.getByRole("button", { name: /Xác minh/ }).click();
  await page.locator("#review-heading").waitFor();
  await page.locator(".check-field input[type=checkbox]").first().check();
  results.push(...(await inspect(page, "REVIEW", "#review-heading")));
  await page.getByRole("button", { name: /Xác nhận đặt lịch/ }).click();
  await page.locator("#result-heading").waitFor();
  results.push(...(await inspect(page, "SUCCESS", "#result-heading")));
  console.log(JSON.stringify(results, null, 2));
  await context.close();
  await browser.close();
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
