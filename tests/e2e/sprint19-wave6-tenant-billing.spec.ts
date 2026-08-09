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

test.describe.serial("Sprint 19 Wave 6 tenant billing and support", () => {
  test("renders subscription, usage and invoice read models", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/billing");
    await expect(page.getByRole("heading", { name: "Billing overview" })).toBeVisible();
    await audit(page);
    await page.goto("/admin/billing/usage");
    await expect(page.getByRole("heading", { name: "Plans, entitlements & usage" })).toBeVisible();
    await audit(page);
    await page.goto("/admin/billing/invoices");
    await expect(page.getByRole("heading", { name: "Invoices & history" })).toBeVisible();
    await expect(page.getByText(/separate from salon POS invoices/i)).toBeVisible();
    await audit(page);
  });

  test("keeps payment methods masked and support grants dual-controlled", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/billing/payment-methods");
    await expect(page.getByRole("heading", { name: "Payment methods" })).toBeVisible();
    await expect(page.getByText(/raw card data is never collected/i)).toBeVisible();
    await audit(page);
    await page.goto("/admin/support-access");
    await expect(page.getByRole("heading", { name: "Tenant support access" })).toBeVisible();
    await expect(page.locator("strong", { hasText: "Dual control:" })).toBeVisible();
    await audit(page);
  });
});
