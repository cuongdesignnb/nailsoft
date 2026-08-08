import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

test.describe.serial("Sprint 19 Wave 5 Inventory workspace", () => {
  test("renders authorized branch context and server-backed stock screen", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/inventory/stock");
    await expect(page.getByRole("heading", { name: "Stock availability" })).toBeVisible();
    await expect(page.getByLabel("Active branch")).toBeVisible();
    await expect(page.getByRole("option")).not.toHaveCount(0);
    const branchSelector = page.getByLabel("Active branch");
    const selected = await branchSelector.inputValue();
    expect(selected).not.toContain("20000000-0000-4000-8000-000000000001");
    await expect(page.getByText(/Server-authoritative/)).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  });

  test("keeps inventory routes distinct and exposes blind-count copy", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/inventory/counts");
    await expect(page.getByRole("heading", { name: "Blind stock counts" })).toBeVisible();
    await expect(page.getByText(/expected stock stays hidden/i)).toBeVisible();
    await page.goto("/admin/inventory/valuation");
    await expect(page.getByRole("heading", { name: "Inventory valuation" })).toBeVisible();
  });
});
