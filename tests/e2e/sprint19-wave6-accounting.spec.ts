import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function expectWorkspace(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.getByText("Command JSON")).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 6 accounting and banking", () => {
  test("renders accounting control center, periods and journals", async ({ page }) => {
    await loginUi(page);
    await expectWorkspace(page, "/admin/accounting", "Accounting control center");
    await expectWorkspace(page, "/admin/accounting/periods", "Accounting periods");
    await expect(page.getByText(/Dual control/i)).toBeVisible();
    await expectWorkspace(page, "/admin/accounting/journals", "Journal workbench");
    await expect(page.getByText(/Posted journals are immutable/i)).toBeVisible();
  });

  test("keeps banking evidence bounded and separate from mutation commands", async ({ page }) => {
    await loginUi(page);
    await expectWorkspace(page, "/admin/accounting/reconciliation", "Bank accounts & imports");
    await expectWorkspace(page, "/admin/accounting/reconciliation/exceptions", "Reconciliation & exceptions");
    await expect(page.getByText(/manual ledger adjustment.*deferred/i)).toBeVisible();
    await expectWorkspace(page, "/admin/accounting/statement-snapshots", "Statement snapshots");
  });
});
