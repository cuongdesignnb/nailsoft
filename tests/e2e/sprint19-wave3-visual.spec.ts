import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function capture(page: Page, path: string, filename: string) {
  await page.goto(path);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts?.ready);
  await expect(page.locator("main").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  await page.screenshot({ path: `artifacts/sprint19/screens/${filename}`, fullPage: true });
}

test.describe.serial("Sprint 19 Wave 3 deterministic visual evidence", () => {
  test.beforeAll(() => fs.mkdirSync("artifacts/sprint19/screens", { recursive: true }));
  test("customer and benefit surfaces", async ({ page }) => {
    await loginUi(page);
    await capture(page, "/admin/customers", "customer-directory-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "/admin/customers/60000000-0000-4000-8000-000000000001", "customer-360-mobile.png");
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, "/admin/benefits", "benefits-wallet.png");
    await capture(page, "/admin/gift-cards", "gift-card-detail.png");
  });

  test("engagement and recovery surfaces", async ({ page }) => {
    await loginUi(page);
    await capture(page, "/admin/marketing/campaigns/e9100000-0000-4000-8000-000000000001", "campaign-detail.png");
    await capture(page, "/admin/service-recovery/e5000000-0000-4000-8000-000000000001", "service-recovery-detail.png");
  });
});
