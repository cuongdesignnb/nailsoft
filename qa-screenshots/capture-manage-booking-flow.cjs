const { chromium } = require("@playwright/test");

const baseUrl = "http://127.0.0.1:3002/manage-booking?salon=nailsoft-demo";
const outputRoot = "artifacts/ui-completion";
const bookingReference = process.env.MANAGE_BOOKING_REFERENCE || "NS-7JF9FU58";
const bookingContact = process.env.MANAGE_BOOKING_CONTACT || "+84900000000";
const replacementDate = process.env.MANAGE_REPLACEMENT_DATE || "2026-09-01";
const viewports = [
  ["desktop-1440", 1440, 900],
  ["desktop-1280", 1280, 800],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
];

async function captureAcross(page, directory, selector) {
  await page.locator(selector).waitFor();
  for (const [viewportName, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    await page.screenshot({
      path: `${outputRoot}/${directory}/${viewportName}.png`,
      animations: "disabled",
      fullPage: true,
    });
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "vi-VN",
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#manage-reference").waitFor();
  await captureAcross(page, "customer-manage-booking-lookup", "#lookup-heading");

  await page.locator("#manage-salon").fill("nailsoft-demo");
  await page.locator("#manage-reference").fill(bookingReference);
  await page.locator("#manage-contact").fill(bookingContact);
  await page.getByRole("button", { name: /Gửi mã xác minh/ }).click();
  await page.locator("#manage-otp-heading").waitFor();
  await captureAcross(page, "customer-manage-booking-otp", "#manage-otp-heading");

  await page.getByRole("button", { name: /Xác minh/ }).click();
  await page.locator("#detail-heading").waitFor();
  await captureAcross(page, "customer-manage-booking-detail", "#detail-heading");

  const rescheduleButton = page.getByRole("button", { name: /Chọn giờ khác/ });
  await rescheduleButton.click();
  await page.locator("#replacement-heading").waitFor();
  await page.locator("#replacement-date").fill(replacementDate);
  await page.waitForTimeout(600);
  await captureAcross(page, "customer-manage-booking-reschedule", "#replacement-heading");

  const slots = page.locator(".manage-slot-grid button.slot");
  let reviewCaptured = false;
  if (await slots.count()) {
    await slots.first().click();
    await page.locator("#reschedule-heading").waitFor();
    await captureAcross(page, "customer-manage-booking-reschedule-review", "#reschedule-heading");
    reviewCaptured = true;
  }

  await context.close();
  await browser.close();
  return { bookingReference, replacementDate, reviewCaptured };
}

run().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
