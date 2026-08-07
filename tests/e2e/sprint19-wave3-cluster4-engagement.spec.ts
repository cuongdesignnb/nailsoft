import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers } from "./helpers/api-client";

async function loginUi(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/auth/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function expectA11y(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 3 Cluster 4 engagement workspace", () => {
  test("owner can open communications, marketing, reviews and recovery screens", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    for (const [path, heading] of [
      ["/admin/communications/templates", "Communication templates"],
      ["/admin/communications/rules", "Communication rules"],
      ["/admin/communications/messages", "Message delivery"],
      ["/admin/communications/suppressions", "Contact suppressions"],
      ["/admin/marketing/segments", "Customer segments"],
      ["/admin/marketing/campaigns", "Email campaigns"],
      ["/admin/reviews", "Reviews"],
      ["/admin/review-requests", "Review requests"],
      ["/admin/service-recovery", "Service recovery"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    }
    await expect(page.getByText("email only", { exact: false }).first()).toBeVisible();
    await expectA11y(page);
  });

  test("owner can inspect seeded campaign and recovery detail without raw secrets", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto("/admin/marketing/campaigns/e9100000-0000-4000-8000-000000000001");
    await expect(page.locator("h1").filter({ hasText: "July welcome fixture" })).toBeVisible();
    await expect(page.getByText(/consent and suppression/i).first()).toBeVisible();
    await page.goto("/admin/service-recovery/e5000000-0000-4000-8000-000000000001");
    await expect(page.getByRole("heading", { name: /OPEN/i })).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/password|provider[_ -]?token|secret|code_hash/i);
    await expectA11y(page);
  });

  test("technician and platform users are denied by API permission, not hidden-menu assumptions", async () => {
    const technician = await authenticated("technicianA");
    const platform = await authenticated("platform");
    try {
      expect((await technician.api.get("/v1/marketing-campaigns", { headers: headers(technician) })).status()).toBe(403);
      expect((await platform.api.get("/v1/service-recovery/cases", { headers: headers(platform) })).status()).toBe(403);
    } finally {
      await close(technician);
      await close(platform);
    }
  });

  test("review and engagement route ownership remains explicit", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto("/admin/customers/60000000-0000-4000-8000-000000000001/engagement");
    await expect(page.getByRole("heading", { name: "Customer engagement timeline" })).toBeVisible();
  });
});
