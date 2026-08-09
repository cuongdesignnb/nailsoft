import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function capture(page: Page, path: string, filename: string) {
  await page.goto(path);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts?.ready);
  await expect(page.locator("main").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  await page.screenshot({ path: `artifacts/sprint19/screens/${filename}`, fullPage: true });
}

test.describe.serial("Sprint 19 Wave 6 deterministic visual evidence", () => {
  test.beforeAll(() => fs.mkdirSync("artifacts/sprint19/screens", { recursive: true }));

  test("accounting and billing desktop", async ({ page }) => {
    await loginUi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, "/admin/accounting", "accounting-control-center.png");
    await capture(page, "/admin/accounting/reconciliation", "banking-control-center.png");
    await capture(page, "/admin/billing", "tenant-billing-overview.png");
    await capture(page, "/admin/support-access", "tenant-support-access.png");
  });

  test("platform and analytics responsive", async ({ page }) => {
    await loginUi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "/platform/plans", "platform-catalog-mobile.png");
    await capture(page, "/platform/refunds", "platform-refunds-mobile.png");
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, "/admin/analytics", "analytics-command-center.png");
    await capture(page, "/admin/analytics/data-quality", "analytics-data-quality.png");
  });
});
