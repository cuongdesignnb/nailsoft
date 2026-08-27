const { chromium } = require("@playwright/test");

const baseUrl = "http://127.0.0.1:3002/manage-booking?salon=nailsoft-demo";
const outputRoot = "artifacts/ui-completion/customer-manage-booking-cancel";
const bookingReference = process.env.MANAGE_CANCEL_REFERENCE || "NS-XCZJ7U8C";
const bookingContact = process.env.MANAGE_CANCEL_CONTACT || "+84900000098";
const viewports = [
  ["desktop-1440", 1440, 900],
  ["desktop-1280", 1280, 800],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
];

async function captureAcross(page) {
  await page.locator("#detail-heading").waitFor();
  for (const [viewportName, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${outputRoot}/${viewportName}.png`, animations: "disabled", fullPage: true });
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#manage-salon").fill("nailsoft-demo");
  await page.locator("#manage-reference").fill(bookingReference);
  await page.locator("#manage-contact").fill(bookingContact);
  await page.getByRole("button", { name: /Gửi mã xác minh/ }).click();
  await page.locator("#manage-otp-heading").waitFor();
  await page.getByRole("button", { name: /Xác minh/ }).click();
  await page.locator("#detail-heading").waitFor();
  const cancelButton = page.getByRole("button", { name: /Hủy lịch hẹn/ });
  if (await cancelButton.count()) await cancelButton.click();
  await page.getByText(/Khách đã hủy/).first().waitFor();
  await captureAcross(page);
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ bookingReference, status: "CANCELLED" }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
