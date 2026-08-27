import { expect, test, type Page } from "@playwright/test";

test.use({
  viewport: { width: 1280, height: 800 },
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

test.describe("Sprint 19 Wave 1 booking operations", () => {
  test("overview routes expose real API state surfaces", async ({ page }) => {
    await signIn(page);
    const screens = [
      { path: "/admin/dashboard", heading: "Tổng quan vận hành" },
      { path: "/admin/calendar/day", heading: "Lịch hôm nay" },
      { path: "/admin/calendar/week", heading: "Lịch tuần" },
      { path: "/admin/appointments", heading: "Lịch hẹn" },
      { path: "/admin/availability/search", heading: "Tìm khung giờ trống" },
    ];
    for (const screen of screens) {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { name: screen.heading })).toBeVisible();
      await expect(page.locator("main").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
  });

  test("booking and operations command routes keep a responsive shell", async ({ page }) => {
    await signIn(page);
    const routes = [
      "/admin/appointments/new",
      "/admin/appointments/70000000-0000-4000-8000-000000000001/overview",
      "/admin/appointments/70000000-0000-4000-8000-000000000001/reschedule",
      "/admin/appointments/70000000-0000-4000-8000-000000000001/cancel",
      "/admin/scheduling/blocks",
      "/admin/operations/board",
      "/admin/operations/walk-ins/new",
      "/admin/appointments/70000000-0000-4000-8000-000000000001/check-in",
      "/admin/appointments/70000000-0000-4000-8000-000000000001/execution",
      "/admin/appointments/70000000-0000-4000-8000-000000000001/add-service",
      "/admin/service-sessions/77000000-0000-4000-8000-000000000008",
    ];
    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.ok(), route).toBeTruthy();
      await expect(page.locator("main")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
  });
});
