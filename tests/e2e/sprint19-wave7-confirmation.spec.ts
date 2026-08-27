import { expect, test } from "@playwright/test";

const bookingWeb = "http://127.0.0.1:3002";

test("review uses the server hold plan and creates an idempotent booking", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`${bookingWeb}/book/nailsoft-demo`);
  await page.getByRole("button", { name: /Quận 1/ }).click();
  await page.locator(".choice-card").first().click();
  const bookingDate = page.locator("#booking-date");
  const minimumDate = (await bookingDate.getAttribute("min")) ?? "";
  const maximumDate = (await bookingDate.getAttribute("max")) ?? minimumDate;
  const toDate = (value: string) => new Date(`${value}T12:00:00Z`);
  const dateValue = (value: Date) => value.toISOString().slice(0, 10);
  let foundSlot = false;
  for (let cursor = toDate(minimumDate); dateValue(cursor) <= maximumDate && !foundSlot; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    await bookingDate.fill(dateValue(cursor));
    await page.getByRole("button", { name: /Find available times|Tìm giờ trống/ }).click();
    await expect.poll(async () => page.locator(".slot").count(), { timeout: 5000 }).toBeGreaterThan(0).catch(() => undefined);
    foundSlot = (await page.locator(".slot").count()) > 0;
    if (!foundSlot) await page.getByRole("button", { name: /Change services or date|Đổi dịch vụ hoặc ngày/ }).click();
  }
  expect(foundSlot).toBe(true);
  await page.locator(".slot").first().click();
  await page.getByLabel(/Full name|Họ và tên/).fill("Wave Seven Confirmation");
  await page.getByLabel(/Phone|Số điện thoại/).fill("0900000020");
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await page.getByRole("button", { name: /Verify|Xác minh/ }).click();
  await expect(page.getByText(/No payment is collected|Không thu tiền/)).toBeVisible();
  const policy = page.getByRole("checkbox").first();
  await policy.check();
  await page.getByRole("button", { name: /Confirm booking|Xác nhận đặt lịch/ }).click();
  await expect(page.getByRole("heading", { name: /Booking confirmed|Đặt lịch thành công/ }).first()).toBeVisible();
  await expect(page.getByText(/NS-/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("holdToken");
  await expect(page.locator("body")).not.toContainText("verificationToken");
});
