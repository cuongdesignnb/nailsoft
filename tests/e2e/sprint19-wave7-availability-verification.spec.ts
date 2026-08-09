import { expect, test } from "@playwright/test";

const bookingWeb = "http://127.0.0.1:3002";

test("public booking availability, hold, contact and OTP flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${bookingWeb}/book/nailsoft-demo`);
  await page.getByRole("button", { name: /Quận 1/ }).click();
  await expect(page.locator("#services-heading")).toBeVisible();
  await page.locator(".choice-card").first().click();
  await page.locator("#booking-date").fill("2026-08-10");
  await page.getByRole("button", { name: /Find available times|Tìm giờ trống/ }).click();
  await expect(page.getByRole("heading", { name: /Available times|Giờ còn trống/ })).toBeVisible();
  const slot = page.locator(".slot").first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(page.getByRole("heading", { name: /Contact details|Thông tin liên hệ/ })).toBeVisible();
  await page.getByLabel(/Full name|Họ và tên/).fill("Wave Seven Customer");
  await page.getByLabel(/Phone|Số điện thoại/).fill("0900000019");
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await expect(page.getByRole("heading", { name: /Verification code|Mã xác minh/ })).toBeVisible();
  await expect(page.locator("#verification-code")).toHaveValue(/\d{6}/);
  await page.getByRole("button", { name: /Verify|Xác minh/ }).click();
  await expect(page.getByRole("heading", { name: /Review booking|Xem lại lịch hẹn/ })).toBeVisible();
});
