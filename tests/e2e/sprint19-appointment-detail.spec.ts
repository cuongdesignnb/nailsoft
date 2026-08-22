import { expect, test, type Page } from "@playwright/test";

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

test.describe("Appointment detail", () => {
  test("renders API-backed detail and preserves the history route", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/appointments/70000000-0000-4000-8000-000000000001/overview");

    await expect(page.getByRole("heading", { name: "Chi tiết lịch hẹn" })).toBeVisible();
    await expect(page.getByText("#NS-C4CA4238")).toBeVisible();
    await expect(page.getByText("Đã xác nhận").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dịch vụ trong lịch hẹn" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tóm tắt thanh toán" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chỉnh sửa" }).first()).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

    await page.goto("/admin/appointments/70000000-0000-4000-8000-000000000001/history");
    await expect(page.getByRole("heading", { name: "Lịch sử hoạt động" })).toBeVisible();
    await expect(page.getByText("Khởi tạo dữ liệu")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/appointments/70000000-0000-4000-8000-000000000001/overview");
    await expect(page.getByRole("heading", { name: "Chi tiết lịch hẹn" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});
