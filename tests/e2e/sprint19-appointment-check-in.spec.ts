import { expect, test, type Page } from "@playwright/test";

const appointmentId = "70000000-0000-4000-8000-000000000010";

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

test.describe("Appointment check-in", () => {
  test("keeps arrival and final check-in as separate explicit steps", async ({ page }) => {
    await signIn(page);
    await page.goto(`/admin/appointments/${appointmentId}/check-in`);

    await expect(page.getByRole("heading", { name: "Check-in khách" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Thông tin lịch hẹn" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Xác nhận khách đến" })).toBeVisible();
    await expect(page.getByText("Chưa ghi nhận khách đến")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ghi nhận khách đã đến" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Xác nhận Check-in khách", exact: true }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Xác nhận Check-in", exact: true }).first()).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("keeps the workspace usable on mobile without horizontal overflow", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/appointments/${appointmentId}/check-in`);

    await expect(page.getByRole("heading", { name: "Check-in khách" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Khách hàng", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Khách chưa đến" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});
