const { chromium } = require("@playwright/test");

const baseUrl = "http://127.0.0.1:3002/book/nailsoft-demo";
const outputRoot = "artifacts/ui-completion";
const viewports = [
  ["desktop-1440", 1440, 900],
  ["desktop-1280", 1280, 800],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
];

async function selectLiveSlot(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#booking-title").waitFor();
  await page.getByRole("button", { name: /Quận 1/ }).click();
  await page.locator("#services-heading").waitFor();
  await page.locator("button.choice-card").first().click();
  await page.locator("#booking-date").fill("2026-09-03");
  await page.getByRole("button", { name: /Tìm giờ trống/ }).click();
  await page.locator("#availability-heading").waitFor();
  await page.locator("button.slot").first().click();
  await page.locator("#contact-heading").waitFor();
}

async function captureAcross(page, directory, selector) {
  await page.locator(selector).waitFor();
  for (const [viewportName, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    await page.screenshot({
      path: `${outputRoot}/${directory}/${viewportName}.png`,
      animations: "disabled",
    });
  }
}

async function runFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
  const page = await context.newPage();
  await selectLiveSlot(page);
  await captureAcross(page, "customer-booking-contact", "#contact-heading");

  await page.locator("#contact-name").fill("QA Visual Booking");
  await page.locator("#contact-phone").fill("0900000094");
  await page.locator("#contact-email").fill("qa.visual@example.test");
  await page.getByRole("button", { name: /Gửi mã xác minh/ }).click();
  await page.locator("#otp-heading").waitFor();
  await captureAcross(page, "customer-booking-otp", "#otp-heading");

  await page.getByRole("button", { name: /Xác minh/ }).click();
  await page.locator("#review-heading").waitFor();
  await page.locator(".check-field input[type=checkbox]").first().check();
  await captureAcross(page, "customer-booking-review", "#review-heading");

  await page.getByRole("button", { name: /Xác nhận đặt lịch/ }).click();
  await page.locator("#result-heading").waitFor();
  await captureAcross(page, "customer-booking-success", "#result-heading");
  const reference = await page.locator(".booking-result-card strong").first().textContent();
  await context.close();
  return { reference };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const result = await runFlow(browser);
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
