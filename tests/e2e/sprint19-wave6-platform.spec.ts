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

test.describe.serial("Sprint 19 Wave 6 platform billing and support", () => {
  test("keeps platform catalog separate from salon operations", async ({ page }) => {
    await loginUi(page);
    await page.goto("/platform/plans");
    await expect(page.getByRole("heading", { name: "Danh mục gói nền tảng" }).first()).toBeVisible();
    await expect(page.locator(".ns-branch-picker select")).toHaveCount(0);
    await expect(page.locator(".ns-header-actions .ns-status")).toHaveText("PLATFORM ADMIN");
    await audit(page);
    await page.goto("/platform/discounts");
    await expect(page.getByRole("heading", { name: "Danh mục giảm giá nền tảng" }).first()).toBeVisible();
    await expect(page.getByText(/đọc các định nghĩa giảm giá nền tảng; màn hình không cung cấp thao tác/i).first()).toBeVisible();
    await audit(page);
    await page.goto("/platform/invoices");
    await expect(page.getByRole("heading", { name: "Vận hành hóa đơn nền tảng", exact: true }).first()).toBeVisible();
    await audit(page);
  });

  test("renders refund, reconciliation, dunning and disabled break-glass surfaces", async ({ page }) => {
    await loginUi(page);
    await page.goto("/platform/refunds");
    await expect(page.getByRole("heading", { name: "Hoàn tiền & đối soát nền tảng", exact: true }).first()).toBeVisible();
    await expect(page.getByText(/kiểm soát kép/i)).toBeVisible();
    await audit(page);
    await page.goto("/platform/dunning");
    await expect(page.getByRole("heading", { name: "Theo dõi công nợ nền tảng", exact: true }).first()).toBeVisible();
    await audit(page);
    await page.goto("/platform/break-glass");
    await expect(page.getByRole("heading", { name: "Truy cập khẩn cấp", exact: true }).first()).toBeVisible();
    await expect(page.getByText(/đang được tắt/i)).toBeVisible();
    await audit(page);
  });
});
