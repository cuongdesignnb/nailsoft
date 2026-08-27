import { expect, test } from "@playwright/test";

const bookingWeb = "http://127.0.0.1:3002";

test("public booking availability, hold, contact and OTP flow", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${bookingWeb}/book/nailsoft-demo`);
  await page.getByRole("button", { name: /Quận 1/ }).click();
  await expect(page.locator("#services-heading")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: /Available times|Giờ còn trống/ }).first()).toBeVisible();
  const slot = page.locator(".slot").first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(page.getByRole("heading", { name: /Contact details|Thông tin liên hệ/ }).first()).toBeVisible();
  await page.getByLabel(/Full name|Họ và tên/).fill("Wave Seven Customer");
  await page.getByLabel(/Phone|Số điện thoại/).fill("0900000019");
  await page.getByRole("button", { name: /Send verification code|Gửi mã xác minh/ }).click();
  await expect(page.getByRole("heading", { name: /Verification code|Mã xác minh/ }).first()).toBeVisible();
  await expect(page.locator("#verification-code")).toHaveValue(/\d{6}/);
  await page.getByRole("button", { name: /Verify|Xác minh/ }).click();
  await expect(page.getByRole("heading", { name: /Review booking|Xem lại lịch hẹn/ }).first()).toBeVisible();
});
