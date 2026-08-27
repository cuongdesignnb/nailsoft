import { expect, test } from "@playwright/test";

const bookingWeb = "http://127.0.0.1:3002";

test("management lookup stays neutral before OTP and supports localized entry", async ({ page }) => {
  await page.goto(`${bookingWeb}/manage-booking`);
  await page.getByLabel(/Salon code|Mã salon/).fill("nailsoft-demo");
  await page.getByLabel(/Booking reference|Mã lịch hẹn/).fill("NS-NOTFOUND");
  await page.getByLabel(/Phone|Email|Số điện thoại/).fill("customer@example.test");
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await expect(page.getByRole("heading", { name: /Verify your contact details|Xác minh thông tin liên hệ/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/booking exists|contact mismatch/i);
});
