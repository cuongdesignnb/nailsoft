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
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  await page.screenshot({ path: `artifacts/sprint19/screens/${filename}`, fullPage: true });
}

test.describe.serial("Sprint 19 Wave 5 deterministic visual evidence", () => {
  test.beforeAll(() => fs.mkdirSync("artifacts/sprint19/screens", { recursive: true }));

  test("inventory and procurement desktop evidence", async ({ page }) => {
    await loginUi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, "/admin/inventory/stock", "inventory-stock.png");
    await capture(page, "/admin/inventory/transfers", "inventory-transfer.png");
    await capture(page, "/admin/procurement", "procurement-control-center.png");
    await capture(page, "/admin/procurement/vendor-bills", "vendor-bill.png");
    await capture(page, "/admin/procurement/payment-proposals", "payment-proposal.png");
  });

  test("asset mobile evidence", async ({ page }) => {
    await loginUi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "/admin/assets", "asset-register.png");
    await capture(page, "/admin/assets/depreciation", "asset-depreciation.png");
    await capture(page, "/admin/assets/disposals", "asset-disposal.png");
  });
});
