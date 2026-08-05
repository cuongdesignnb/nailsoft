import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: "vi-VN",
  colorScheme: "light",
  reducedMotion: "reduce",
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin/dashboard");
}

async function assertAccessible(page: Page, screenId: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations, `${screenId} axe violations`).toEqual([]);
  const evidence = resolve("artifacts/sprint19/screens", screenId);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, "ready.png"), fullPage: true, animations: "disabled" });
}

test.describe("Sprint 19 Wave 1 remediation visual and accessibility evidence", () => {
  test("booking create has responsive real-data states", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/appointments/new");
    await expect(page.getByRole("heading", { name: "Quick create" })).toBeVisible();
    await expect(page.locator('select[name="branchId"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Find availability" })).toBeEnabled();
    await assertAccessible(page, "19.1.01-booking-create");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: resolve("artifacts/sprint19/screens/19.1.01-booking-create", "mobile.png"), fullPage: true, animations: "disabled" });
  });

  test("operations board and service workspace use the redesigned state shell", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/operations/board");
    await expect(page.getByRole("heading", { name: "Operational board" })).toBeVisible();
    await expect(page.getByText(/Data version/)).toBeVisible();
    await assertAccessible(page, "19.1.07-queue-board");
    await page.goto("/admin/service-sessions/77000000-0000-4000-8000-000000000008");
    await expect(page.locator("main")).toBeVisible();
    await assertAccessible(page, "19.1.10-service-session");
  });
});
