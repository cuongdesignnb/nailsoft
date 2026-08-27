import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";
import { authenticated, close } from "./auth/setup";
import { headers } from "./helpers/api-client";

const customerId = "60000000-0000-4000-8000-000000000001";

async function loginUi(page: Page, email: string) {
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

test.describe.serial("Sprint 19 Wave 3 Cluster 2", () => {
  test("owner sees server-authoritative wallet and masked voucher evidence", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto(`/admin/benefits/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: "Ví quyền lợi", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ví điểm", exact: true })).toBeVisible();
    await expect(page.getByText("Đã ẩn bí mật", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("WELCOME10");
    await expect(page.locator("body")).not.toContainText("code_hash");
    await expectA11y(page);
  });

  test("loyalty, membership and package read models load through explicit routes", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto(`/admin/loyalty/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: "Loyalty & lịch sử điểm" })).toBeVisible();
    await page.goto(`/admin/membership/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: "Customer membership history" })).toBeVisible();
    await page.goto("/admin/membership/tiers");
    await expect(page.getByRole("heading", { name: "Các hạng Membership", exact: true })).toBeVisible();
    await page.goto("/admin/packages/catalog");
    await expect(page.getByRole("heading", { name: "Danh mục gói dịch vụ", exact: true })).toBeVisible();
    await expectA11y(page);
  });

  test("loyalty adjustment request presents independent approval contract", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.goto("/admin/loyalty/adjustments");
    await expect(page.getByRole("heading", { name: "Điều chỉnh Loyalty", exact: true })).toBeVisible();
    await expect(page.getByText("người đã xác thực khác")).toBeVisible();
    await expect(page.getByLabel("Tìm khách hàng")).toBeVisible();
  });

  test("technician and platform users receive forbidden states", async () => {
    const technician = await authenticated("technicianA");
    const platform = await authenticated("platform");
    try {
      expect((await technician.api.get(`/v1/customers/${customerId}/loyalty`, { headers: headers(technician) })).status()).toBe(403);
      expect((await platform.api.get(`/v1/customers/${customerId}/membership`, { headers: headers(platform) })).status()).toBe(403);
    } finally { await close(technician); await close(platform); }
  });

  test("mobile wallet has no document overflow", async ({ page }) => {
    await loginUi(page, "owner@example.test");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/benefits/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: "Ví quyền lợi", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
