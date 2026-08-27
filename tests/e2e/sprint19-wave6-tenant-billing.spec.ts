import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/deterministic-visual-fixture";
import type { Page } from "@playwright/test";

async function loginUi(page: Page) {
  await page.goto("/auth/login");
  await page.evaluate(() => localStorage.clear());
  await page.locator('input[name="email"]').fill("owner@example.test");
  await page.locator('input[name="password"]').fill("DemoPass123!");
  await Promise.all([page.waitForURL("**/admin/dashboard"), page.locator("form button").click()]);
}

async function audit(page: Page) {
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Command JSON")).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
}

test.describe.serial("Sprint 19 Wave 6 tenant billing and support", () => {
  test("renders subscription, usage and invoice read models", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/billing");
    await expect(page.getByRole("heading", { name: "Tổng quan thanh toán gói" })).toBeVisible();
    await audit(page);
    await page.goto("/admin/billing/usage");
    await expect(page.getByRole("heading", { name: "Sản lượng & hạn mức" }).first()).toBeVisible();
    await audit(page);
    await page.goto("/admin/billing/invoices");
    await expect(page.getByRole("heading", { name: "Hóa đơn gói nền tảng" })).toBeVisible();
    await expect(page.getByText(/tách biệt với hóa đơn POS của salon/i)).toBeVisible();
    await audit(page);
  });

  test("keeps payment methods masked and support grants dual-controlled", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/billing/payment-methods");
    await expect(page.getByRole("heading", { name: "Phương thức thanh toán", exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Thông tin phương thức đã được che/i)).toBeVisible();
    await audit(page);
    await page.goto("/admin/support-access");
    await expect(page.getByRole("heading", { name: "Quyền hỗ trợ Tenant" })).toBeVisible();
    await expect(page.getByText(/Kiểm soát kép và phạm vi|Chưa có quyền hỗ trợ/i).first()).toBeVisible();
    await audit(page);
  });
});
