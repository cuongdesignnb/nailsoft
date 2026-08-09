import { expect, test } from "@playwright/test";

const bookingWeb = "http://127.0.0.1:3002";

test("review uses the server hold plan and creates an idempotent booking", async ({ page }) => {
  await page.goto(`${bookingWeb}/book/nailsoft-demo`);
  await page.getByRole("button", { name: /Quận 1/ }).click();
  await page.locator(".choice-card").first().click();
  await page.locator("#booking-date").fill("2026-08-10");
  await page.getByRole("button", { name: /Find available times|Tìm giờ trống/ }).click();
  await page.locator(".slot").first().click();
  await page.getByLabel(/Full name|Họ và tên/).fill("Wave Seven Confirmation");
  await page.getByLabel(/Phone|Số điện thoại/).fill("0900000020");
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await page.getByRole("button", { name: /Verify|Xác minh/ }).click();
  await expect(page.getByText(/No payment is collected|Không thu tiền/)).toBeVisible();
  const policy = page.getByRole("checkbox").first();
  await policy.check();
  await page.getByRole("button", { name: /Confirm booking|Xác nhận đặt lịch/ }).click();
  await expect(page.getByRole("heading", { name: /Booking confirmed|Đặt lịch thành công/ })).toBeVisible();
  await expect(page.getByText(/NS-/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("holdToken");
  await expect(page.locator("body")).not.toContainText("verificationToken");
});
