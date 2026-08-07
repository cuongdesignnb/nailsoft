import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers } from "./helpers/api-client";

async function loginUi(page: Page, email = "owner@example.test") {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function expectA11y(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 3 Cluster 3", () => {
  test("voucher campaign and code surfaces are API-backed and mask secrets", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/vouchers/campaigns");
    await expect(page.getByRole("heading", { name: "Voucher campaigns" })).toBeVisible();
    await page.goto("/admin/vouchers/codes");
    await expect(page.getByRole("heading", { name: "Voucher codes" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("code_hash");
    await expectA11y(page);
  });

  test("gift-card products, issuance handoff and masked detail routes load", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/gift-cards/products");
    await expect(page.getByRole("heading", { name: "Gift card products" })).toBeVisible();
    await page.goto("/admin/gift-cards/issuance");
    await expect(page.getByRole("heading", { name: "Gift card issuance" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start gift-card sale" })).toBeVisible();
    await page.goto("/admin/gift-cards");
    await expect(page.getByRole("heading", { name: "Gift cards" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("pin_hash");
    await expectA11y(page);
  });

  test("customer credit and adjustment screens expose approval states", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/customer-credit");
    await expect(page.getByRole("heading", { name: "Customer credit" })).toBeVisible();
    await page.goto("/admin/stored-value/adjustments");
    await expect(page.getByRole("heading", { name: "Stored-value adjustments" })).toBeVisible();
    await expect(page.getByText("Approval required")).toBeVisible();
    await expectA11y(page);
  });

  test("stored-value POS and liability routes remain owned by their legacy renderers", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/stored-value/liability");
    await expect(page.getByRole("heading", { name: /Stored-value liability/i })).toBeVisible();
    await page.goto("/admin/pos/orders/90000000-0000-4000-8000-000000000001/gift-card");
    await expect(page.getByText(/POS/i).first()).toBeVisible();
  });

  test("technician and platform cannot access customer credit data", async () => {
    const technician = await authenticated("technicianA");
    const platform = await authenticated("platform");
    try {
      expect((await technician.api.get("/v1/customer-credit", { headers: headers(technician) })).status()).toBe(403);
      expect((await platform.api.get("/v1/customer-credit", { headers: headers(platform) })).status()).toBe(403);
    } finally {
      await close(technician);
      await close(platform);
    }
  });

  test("mobile viewport does not overflow the stored-value workspace", async ({ page }) => {
    await loginUi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/gift-cards");
    await expect(page.getByRole("heading", { name: "Gift cards" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
