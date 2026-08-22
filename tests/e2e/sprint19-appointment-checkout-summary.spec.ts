import { expect, test, type Page } from "@playwright/test";

const appointmentId = "70000000-0000-4000-8000-000000000016";

test.use({
  viewport: { width: 1440, height: 900 },
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

test.describe("Appointment checkout summary", () => {
  test("renders the backend-driven handoff review", async ({ page }) => {
    await signIn(page);
    await page.goto(`/admin/appointments/${appointmentId}/checkout-summary`);

    await expect(
      page.getByRole("heading", { name: "Tổng kết lịch hẹn", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Dịch vụ đã hoàn thành", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Tóm tắt thanh toán", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Kiểm tra trước khi thanh toán",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Chuyển sang thanh toán/ }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Tính tại POS", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("[object Object]", { exact: true }),
    ).toHaveCount(0);
  });

  test("stacks without horizontal overflow on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto(`/admin/appointments/${appointmentId}/checkout-summary`);

    await expect(
      page.getByRole("heading", { name: "Tổng kết lịch hẹn", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  });
});
