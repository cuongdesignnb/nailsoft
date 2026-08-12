import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

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

async function ensureAccountingBook() {
  const accountant = await login("accountant@example.test");
  try {
    const response = await accountant.api.post("/v1/accounting/books", {
      headers: headers(accountant, `wave6-book-${Date.now()}`),
      data: { code: `W6E2E${Date.now().toString().slice(-6)}`, name: "Wave 6 E2E Accounting", functionalCurrency: "VND", timezone: "Asia/Ho_Chi_Minh" },
    });
    expect(response.ok(), `accounting book setup failed: ${JSON.stringify(await response.json())}`).toBeTruthy();
  } finally {
    await close(accountant);
  }
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

  test("keeps banking evidence bounded while exposing approved reconciliation mutations", async ({ page }) => {
    await ensureAccountingBook();
    await loginUi(page);
    await expectWorkspace(page, "/admin/accounting/reconciliation", "Bank accounts & imports");
    await expectWorkspace(page, "/admin/accounting/reconciliation/exceptions", "Reconciliation & exceptions");
    await expect(page.getByText(/Request manual reconciliation adjustment/i)).toBeVisible();
    await expect(page.getByText(/manual ledger adjustment.*deferred/i)).toHaveCount(0);
    await expectWorkspace(page, "/admin/accounting/statement-snapshots", "Statement snapshots");
  });
});
