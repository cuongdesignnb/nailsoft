import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function check(page: Page, path: string) {
  await page.goto(path); await page.emulateMedia({ reducedMotion: "reduce" }); await expect(page.locator("main").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 4 visual and accessibility", () => {
  test("staff and scheduling desktop", async ({ page }) => { await loginUi(page); await check(page, "/admin/staff/list"); await check(page, "/admin/scheduling/shifts"); await check(page, "/admin/scheduling/leave-requests"); });
  test("attendance and payroll responsive", async ({ page }) => { await loginUi(page); await page.setViewportSize({ width: 390, height: 844 }); await check(page, "/admin/time-clock"); await check(page, "/admin/timesheets"); await check(page, "/admin/payroll/runs"); await check(page, "/admin/payouts"); });
});
