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
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 6 platform billing and support", () => {
  test("keeps platform catalog separate from salon operations", async ({ page }) => {
    await loginUi(page);
    await page.goto("/platform/plans");
    await expect(page.getByRole("heading", { name: "Plan, price & discount catalog" })).toBeVisible();
    await expect(page.locator(".ns-branch-picker select")).toHaveCount(0);
    await expect(page.locator(".ns-header-actions .ns-status")).toHaveText("PLATFORM ADMIN");
    await audit(page);
    await page.goto("/platform/discounts");
    await expect(page.getByRole("heading", { name: "Discount catalog" })).toBeVisible();
    await expect(page.getByText(/Discount definitions are read-only/i)).toBeVisible();
    await audit(page);
    await page.goto("/platform/invoices");
    await expect(page.getByRole("heading", { name: "Platform invoice & payment operations" })).toBeVisible();
    await audit(page);
  });

  test("renders refund, reconciliation, dunning and disabled break-glass surfaces", async ({ page }) => {
    await loginUi(page);
    await page.goto("/platform/refunds");
    await expect(page.getByRole("heading", { name: "Refund & reconciliation" })).toBeVisible();
    await expect(page.getByText(/Dual control/i)).toBeVisible();
    await audit(page);
    await page.goto("/platform/dunning");
    await expect(page.getByRole("heading", { name: "Dunning & platform reports" })).toBeVisible();
    await audit(page);
    await page.goto("/platform/break-glass");
    await expect(page.getByRole("heading", { name: "Break-glass access" })).toBeVisible();
    await expect(page.getByText(/disabled by platform security policy/i)).toBeVisible();
    await audit(page);
  });
});
