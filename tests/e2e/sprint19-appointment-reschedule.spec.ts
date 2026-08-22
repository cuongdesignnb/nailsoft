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

test.describe("Appointment reschedule", () => {
  test("loads availability without creating an automatic hold", async ({ page }) => {
    const holdRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(`/v1/appointments/${appointmentId}/reschedule-hold`)) holdRequests.push(request.url());
    });

    await signIn(page);
    await page.goto(`/admin/appointments/${appointmentId}/reschedule`);

    await expect(page.getByRole("heading", { name: "Đổi lịch hẹn" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chọn ngày mới" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tóm tắt thay đổi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "✓ Xác nhận đổi lịch" }).first()).toBeDisabled();
    await page.waitForTimeout(900);
    expect(holdRequests).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(await page.evaluate(() => {
      const panel = document.querySelector('[class*="calendarPanel"]');
      const days = Array.from(document.querySelectorAll('[class*="calendarDay"]'));
      if (!panel || !days.length) return false;
      const panelRight = panel.getBoundingClientRect().right;
      return Math.max(...days.map((day) => day.getBoundingClientRect().right)) <= panelRight + 1;
    })).toBeTruthy();

    await page.getByRole("checkbox", { name: "Tôi đã kiểm tra thời gian mới với khách hàng" }).check();
    await expect(page.getByRole("button", { name: "✓ Xác nhận đổi lịch" }).first()).toBeDisabled();
  });

  test("keeps the two-column workflow usable on mobile", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/appointments/${appointmentId}/reschedule`);

    await expect(page.getByRole("heading", { name: "Đổi lịch hẹn" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lý do đổi lịch" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});
