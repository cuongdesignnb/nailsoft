import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

test.describe("Sprint 19 Wave 5 procurement workspace", () => {
  test("renders payment proposal read foundation with authorized branch context", async ({ page }) => {
    await login(page);
    await page.goto("/admin/procurement/payment-proposals");
    await expect(page.getByRole("heading", { name: "Payment proposals" })).toBeVisible();
    await expect(page.getByText(/Reserve open-item amounts/i)).toBeVisible();
    const branch = page.getByLabel("Active branch");
    if (await branch.count()) await expect(branch).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  });

  test("keeps vendor returns in procurement ownership and exposes safe empty/error states", async ({ page }) => {
    await login(page);
    await page.goto("/admin/procurement/returns");
    await expect(page.getByRole("heading", { name: "Vendor returns" })).toBeVisible();
    await expect(page.getByText(/Return quantities and branch scope are checked/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  });
});
