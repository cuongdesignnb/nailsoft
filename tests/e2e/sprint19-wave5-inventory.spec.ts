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

test.describe.serial("Sprint 19 Wave 5 Inventory workspace", () => {
  test("renders authorized branch context and server-backed stock screen", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/inventory/stock");
    await expect(page.getByRole("heading", { name: "Tình trạng tồn kho" })).toBeVisible();
    await expect(page.getByLabel("Chi nhánh đang chọn")).toBeVisible();
    await expect(page.getByRole("option")).not.toHaveCount(0);
    const shellBranchSelector = page.locator(".ns-branch-picker select");
    await expect(shellBranchSelector).toHaveValue("");
    await expect(shellBranchSelector.locator('option[value=""]')).toHaveText(/Workspace|Không gian làm việc/);
    await shellBranchSelector.selectOption({ label: "New York DST Lab" });
    await expect(shellBranchSelector).not.toHaveValue("");
    await expect(shellBranchSelector).toHaveValue(/.+/);
    const branchSelector = page.getByLabel("Chi nhánh đang chọn");
    const selected = await branchSelector.inputValue();
    expect(selected).not.toContain("20000000-0000-4000-8000-000000000001");
    await expect(page.getByText(/máy chủ xác nhận/i)).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  });

  test("keeps inventory routes distinct and exposes blind-count copy", async ({ page }) => {
    await loginUi(page);
    await page.goto("/admin/inventory/counts");
    await expect(page.getByRole("heading", { name: "Kiểm kê mù" })).toBeVisible();
    await expect(page.getByText(/số tồn kỳ vọng.*giữ kín/i)).toBeVisible();
    await page.goto("/admin/inventory/valuation");
    await expect(page.getByRole("heading", { name: "Định giá tồn kho" })).toBeVisible();
  });
});
