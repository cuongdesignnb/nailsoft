import { expect, test, type Page } from "@playwright/test";

const appointmentId = "70000000-0000-4000-8000-000000000001";

test.use({
  viewport: { width: 1672, height: 941 },
  locale: "vi-VN",
  colorScheme: "light",
  reducedMotion: "reduce",
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin/dashboard");
}

test.describe("Appointment cancellation", () => {
  test("renders API-backed cancellation review and requires explicit confirmation", async ({ page }) => {
    await signIn(page);
    await page.goto(`/admin/appointments/${appointmentId}/cancel`);

    await expect(page.getByRole("heading", { name: "Hủy lịch hẹn" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lịch hẹn sẽ hủy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ảnh hưởng khi hủy lịch" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Xác nhận hủy lịch", exact: true }).first()).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

    await page.getByRole("checkbox", { name: "Tôi đã kiểm tra đúng khách hàng và lịch hẹn cần hủy." }).check();
    await page.getByRole("checkbox", { name: "Tôi hiểu thao tác này sẽ giải phóng khung giờ hiện tại." }).check();
    await expect(page.getByRole("button", { name: "Xác nhận hủy lịch", exact: true }).first()).toBeEnabled();
    await page.getByRole("button", { name: "Xác nhận hủy lịch", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Xác nhận hủy lịch?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Xác nhận hủy lịch?" })).toBeHidden();

    await page.getByRole("radio").nth(4).check();
    await page.getByLabel("Ghi chú nội bộ").fill("x");
    await expect(page.getByRole("button", { name: "Xác nhận hủy lịch", exact: true }).first()).toBeDisabled();
    await page.getByLabel("Ghi chú nội bộ").fill("Khách hẹn lại sau");
    await expect(page.getByRole("button", { name: "Xác nhận hủy lịch", exact: true }).first()).toBeEnabled();
  });

  test("keeps the review usable on mobile without horizontal overflow", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/appointments/${appointmentId}/cancel`);

    await expect(page.getByRole("heading", { name: "Hủy lịch hẹn" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Khách hàng", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});
