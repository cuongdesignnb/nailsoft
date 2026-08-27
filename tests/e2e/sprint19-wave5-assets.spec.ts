import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

test.describe("Sprint 19 Wave 5 fixed assets workspace", () => {
  test("renders asset register with authorized branch context and safe controls", async ({ page }) => {
    await login(page);
    await page.goto("/admin/assets");
    await expect(page.getByRole("heading", { name: "Sổ tài sản cố định" })).toBeVisible();
    await expect(page.getByText(/số liệu kinh tế đã ghi nhận/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Làm mới" })).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  });

  test("keeps depreciation and maintenance routes distinct", async ({ page }) => {
    await login(page);
    await page.goto("/admin/assets/depreciation");
    await expect(page.getByRole("heading", { name: "Kỳ khấu hao" })).toBeVisible();
    await page.goto("/admin/assets/maintenance");
    await expect(page.getByRole("heading", { name: "Lệnh bảo trì" })).toBeVisible();
  });
});
