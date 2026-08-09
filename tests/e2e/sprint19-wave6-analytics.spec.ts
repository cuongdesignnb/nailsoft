import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function audit(page: Page) {
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Command JSON")).toHaveCount(0);
  await expect(page.getByText(/Freshness|Projection health/i).first()).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 6 analytics", () => {
  test("renders server-backed analytics surfaces and freshness evidence", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/analytics");
    await expect(page.getByRole("heading", { name: "Analytics command center" })).toBeVisible();
    await audit(page);
    await page.goto("/admin/analytics/sales");
    await expect(page.getByRole("heading", { name: "Sales analytics" })).toBeVisible();
    await audit(page);
    await page.goto("/admin/analytics/bookings");
    await expect(page.getByRole("heading", { name: "Booking analytics" })).toBeVisible();
    await audit(page);
    await page.goto("/admin/analytics/staff");
    await expect(page.getByRole("heading", { name: "Staff analytics" })).toBeVisible();
    await audit(page);
    await page.goto("/admin/analytics/data-quality");
    await expect(page.getByRole("heading", { name: "Data quality, alerts & exports" })).toBeVisible();
    await audit(page);
  });
});
