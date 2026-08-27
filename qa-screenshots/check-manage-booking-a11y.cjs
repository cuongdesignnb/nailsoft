const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const baseUrl = "http://127.0.0.1:3002/manage-booking?salon=nailsoft-demo";
const bookingReference = process.env.MANAGE_BOOKING_REFERENCE || "NS-7JF9FU58";
const bookingContact = process.env.MANAGE_BOOKING_CONTACT || "+84900000000";
const replacementDate = process.env.MANAGE_REPLACEMENT_DATE || "2026-09-01";
const viewports = [
  ["desktop-1440", 1440, 900],
  ["desktop-1280", 1280, 800],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
];

async function checkState(page, state, selector) {
  await page.locator(selector).waitFor();
  for (const [viewportName, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    const axe = await new AxeBuilder({ page }).analyze();
    const layout = await page.evaluate(() => ({
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }));
    console.log(JSON.stringify({ state, viewport: viewportName, violations: axe.violations, layout }));
    if (axe.violations.length || layout.documentScrollWidth !== layout.documentClientWidth) process.exitCode = 1;
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#manage-reference").waitFor();
  await checkState(page, "LOOKUP", "#lookup-heading");

  await page.locator("#manage-salon").fill("nailsoft-demo");
  await page.locator("#manage-reference").fill(bookingReference);
  await page.locator("#manage-contact").fill(bookingContact);
  await page.getByRole("button", { name: /Gửi mã xác minh/ }).click();
  await page.locator("#manage-otp-heading").waitFor();
  await checkState(page, "OTP", "#manage-otp-heading");

  await page.getByRole("button", { name: /Xác minh/ }).click();
  await page.locator("#detail-heading").waitFor();
  await checkState(page, "DETAIL", "#detail-heading");

  await page.getByRole("button", { name: /Chọn giờ khác/ }).click();
  await page.locator("#replacement-heading").waitFor();
  await page.locator("#replacement-date").fill(replacementDate);
  await page.waitForTimeout(600);
  await checkState(page, "REPLACEMENT_AVAILABILITY", "#replacement-heading");

  if (await page.locator(".manage-slot-grid button.slot").count()) {
    await page.locator(".manage-slot-grid button.slot").first().click();
    await page.locator("#reschedule-heading").waitFor();
    await checkState(page, "RESCHEDULE_REVIEW", "#reschedule-heading");
  }
  await context.close();
  await browser.close();
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
